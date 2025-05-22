import { ToolRegistry } from "./toolRegistry";
import { runWithTimeout } from "./executor";

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: { name: string; args: any };
}

export interface AgentOptions {
  maxTurns?: number;
  toolTimeoutMs?: number;
}

export class AgentRuntime {
  constructor(
    private registry: ToolRegistry,
    private llmCaller: (history: Message[]) => Promise<Message>,
    private options: AgentOptions = {}
  ) {}

  async run(initialPrompt: string): Promise<Message> {
    const maxTurns = this.options.maxTurns ?? 10;
    const timeout = this.options.toolTimeoutMs ?? 15000;
    const history: Message[] = [{ role: "user", content: initialPrompt }];

    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await this.llmCaller(history);
      history.push(response);

      if (!response.toolCall) {
        return response;
      }

      const { name, args } = response.toolCall;
      try {
        const result = await runWithTimeout(
          () => this.registry.invoke(name, args),
          timeout,
          name
        );
        history.push({
          role: "tool",
          content: JSON.stringify(result)
        });
      } catch (err: any) {
        history.push({
          role: "tool",
          content: JSON.stringify({ error: err.message })
        });
      }
    }

    throw new Error(`Turn budget exceeded (${maxTurns} turns) without reaching final resolution.`);
  }
}
