import { describe, it, expect } from "vitest";
import { AgentRuntime, type Message } from "../src/agentLoop";
import { ToolRegistry } from "../src/toolRegistry";
import { calculateBackoff } from "../src/executor";

describe("Parallel Agent Runtime & Lifecycle Hooks", () => {
  it("executes multiple tool calls in parallel within a single assistant turn", async () => {
    const registry = new ToolRegistry();
    const executedTools: string[] = [];

    registry.register({
      name: "fetchWeather",
      description: "Gets weather",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: async (args) => {
        executedTools.push(`weather:${args.city}`);
        return { city: args.city, temp: 28, condition: "Sunny" };
      }
    });

    registry.register({
      name: "fetchTraffic",
      description: "Gets traffic",
      parameters: { type: "object", properties: { route: { type: "string" } }, required: ["route"] },
      execute: async (args) => {
        executedTools.push(`traffic:${args.route}`);
        return { route: args.route, status: "Normal", delayMinutes: 0 };
      }
    });

    let turnsCount = 0;
    const llm = async (history: Message[]): Promise<Message> => {
      turnsCount++;
      if (turnsCount === 1) {
        return {
          role: "assistant",
          content: "Fetching both weather and traffic concurrently...",
          toolCalls: [
            { id: "call_1", name: "fetchWeather", args: { city: "Bengaluru" } },
            { id: "call_2", name: "fetchTraffic", args: { route: "Outer Ring Road" } }
          ]
        };
      }
      return {
        role: "assistant",
        content: "Bengaluru is 28°C Sunny, and Outer Ring Road traffic is normal."
      };
    };

    const runtime = new AgentRuntime(registry, llm);
    const result = await runtime.runDetailed("What is the status of Bengaluru and ORR traffic?");

    expect(result.message.content).toContain("28°C Sunny");
    expect(result.turns).toBe(2);
    expect(result.toolInvocations).toBe(2);
    expect(executedTools).toContain("weather:Bengaluru");
    expect(executedTools).toContain("traffic:Outer Ring Road");

    // History should contain tool response messages with matching toolCallIds
    const toolMsgs = result.history.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs.map((m) => m.toolCallId)).toEqual(["call_1", "call_2"]);
  });

  it("triggers lifecycle hooks accurately", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "Echoes input",
      parameters: { type: "object" },
      execute: (args) => args
    });

    const stepsSeen: number[] = [];
    const startedTools: string[] = [];
    const endedTools: string[] = [];

    const llm = async (history: Message[]): Promise<Message> => {
      if (history.length === 1) {
        return {
          role: "assistant",
          content: "Invoking echo",
          toolCall: { name: "echo", args: { msg: "hello hooks" } }
        };
      }
      return { role: "assistant", content: "Done" };
    };

    const runtime = new AgentRuntime(registry, llm, {
      hooks: {
        onStepStart: (turn) => { stepsSeen.push(turn); },
        onToolStart: (call) => { startedTools.push(call.name); },
        onToolEnd: (call) => { endedTools.push(call.name); }
      }
    });

    await runtime.run("Start test");
    expect(stepsSeen).toEqual([0, 1]);
    expect(startedTools).toEqual(["echo"]);
    expect(endedTools).toEqual(["echo"]);
  });

  it("calculates exponential backoff with full and equal jitter correctly", () => {
    const none = calculateBackoff(3, 100, 2, 1000, "none");
    expect(none).toBe(400); // 100 * 2^2

    const full = calculateBackoff(3, 100, 2, 1000, "full");
    expect(full).toBeGreaterThanOrEqual(0);
    expect(full).toBeLessThanOrEqual(400);

    const equal = calculateBackoff(3, 100, 2, 1000, "equal");
    expect(equal).toBeGreaterThanOrEqual(200);
    expect(equal).toBeLessThanOrEqual(400);
  });
});
