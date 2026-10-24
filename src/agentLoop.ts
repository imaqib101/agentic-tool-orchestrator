import { ToolRegistry } from "./toolRegistry";
import { runWithTimeout, retryWithBackoff, type RetryOptions } from "./executor";

export interface ToolCallSpec {
  id?: string;
  name: string;
  args: any;
}

export interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: { name: string; args: any };
  toolCalls?: ToolCallSpec[];
  toolCallId?: string;
}

export interface AgentHooks {
  onStepStart?: (turn: number, history: Message[]) => void | Promise<void>;
  onToolStart?: (toolCall: ToolCallSpec) => void | Promise<void>;
  onToolEnd?: (toolCall: ToolCallSpec, result: unknown, durationMs: number) => void | Promise<void>;
  onError?: (error: Error, turn: number) => void | Promise<void>;
}

export interface AgentOptions {
  maxTurns?: number;
  toolTimeoutMs?: number;
  toolRetry?: RetryOptions;
  maxHistoryMessages?: number;
  systemPrompt?: string;
  hooks?: AgentHooks;
}

export interface AgentRunResult {
  message: Message;
  history: Message[];
  turns: number;
  totalDurationMs: number;
  toolInvocations: number;
}

export class AgentRuntime {
  constructor(
    private registry: ToolRegistry,
    private llmCaller: (history: Message[]) => Promise<Message>,
    private options: AgentOptions = {}
  ) {}

  async run(initialPrompt: string): Promise<Message> {
    const result = await this.runDetailed(initialPrompt);
    return result.message;
  }

  async runDetailed(initialPrompt: string): Promise<AgentRunResult> {
    const startTime = Date.now();
    const maxTurns = this.options.maxTurns ?? 10;
    const timeout = this.options.toolTimeoutMs ?? 15000;
    const maxHistory = this.options.maxHistoryMessages ?? 50;
    let toolInvocations = 0;

    const history: Message[] = [];
    if (this.options.systemPrompt) {
      history.push({ role: "system", content: this.options.systemPrompt });
    }
    history.push({ role: "user", content: initialPrompt });

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.options.hooks?.onStepStart) {
        await this.options.hooks.onStepStart(turn, [...history]);
      }

      this.pruneHistory(history, maxHistory);

      let response: Message;
      try {
        response = await this.llmCaller(history);
      } catch (err: any) {
        if (this.options.hooks?.onError) {
          await this.options.hooks.onError(err, turn);
        }
        throw err;
      }

      history.push(response);

      const callsToExecute: ToolCallSpec[] = [];
      if (response.toolCalls && response.toolCalls.length > 0) {
        callsToExecute.push(...response.toolCalls);
      } else if (response.toolCall) {
        callsToExecute.push({
          id: `call_${Date.now()}`,
          name: response.toolCall.name,
          args: response.toolCall.args
        });
      }

      if (callsToExecute.length === 0) {
        return {
          message: response,
          history,
          turns: turn + 1,
          totalDurationMs: Date.now() - startTime,
          toolInvocations
        };
      }

      // Execute tool calls in parallel
      toolInvocations += callsToExecute.length;
      const toolResults = await Promise.allSettled(
        callsToExecute.map(async (call) => {
          const callStart = Date.now();
          if (this.options.hooks?.onToolStart) {
            await this.options.hooks.onToolStart(call);
          }

          try {
            const res = await retryWithBackoff(
              () =>
                runWithTimeout(
                  () => this.registry.invoke(call.name, call.args),
                  timeout,
                  call.name
                ),
              this.options.toolRetry
            );

            const durationMs = Date.now() - callStart;
            if (this.options.hooks?.onToolEnd) {
              await this.options.hooks.onToolEnd(call, res, durationMs);
            }
            return { call, success: true, result: res };
          } catch (err: any) {
            const durationMs = Date.now() - callStart;
            if (this.options.hooks?.onToolEnd) {
              await this.options.hooks.onToolEnd(call, { error: err.message }, durationMs);
            }
            return { call, success: false, error: err.message };
          }
        })
      );

      for (const settled of toolResults) {
        if (settled.status === "fulfilled") {
          const outcome = settled.value;
          if (outcome.success) {
            history.push({
              role: "tool",
              toolCallId: outcome.call.id,
              content: JSON.stringify(outcome.result)
            });
          } else {
            history.push({
              role: "tool",
              toolCallId: outcome.call.id,
              content: JSON.stringify({ error: outcome.error })
            });
          }
        } else {
          history.push({
            role: "tool",
            content: JSON.stringify({ error: settled.reason?.message || "Execution failed" })
          });
        }
      }
    }

    throw new Error(`Turn budget exceeded (${maxTurns} turns) without reaching final resolution.`);
  }

  private pruneHistory(history: Message[], maxMessages: number): void {
    if (history.length <= maxMessages) return;

    // Retain initial system or user prompt, drop oldest tool exchanges from the middle
    const preservedPrefix = history[0].role === "system" ? 2 : 1;
    const excess = history.length - maxMessages;
    history.splice(preservedPrefix, excess);
  }
}
