import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import { AgentRuntime } from "../src/agentLoop";

describe("AgentRuntime", () => {
  it("should successfully execute tool calls and return final resolution", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "fetchWeather",
      description: "Gets temperature for city",
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temp: "28C", condition: "Sunny" })
    });

    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Checking weather...",
        toolCall: { name: "fetchWeather", args: { city: "Bengaluru" } }
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "The weather in Bengaluru is 28C and sunny."
      });

    const runtime = new AgentRuntime(registry, mockLLM, { maxTurns: 5 });
    const finalMsg = await runtime.run("What is the weather in Bengaluru?");

    expect(finalMsg.content).toBe("The weather in Bengaluru is 28C and sunny.");
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it("should retry transient tool failures when toolRetry is configured", async () => {
    const registry = new ToolRegistry();
    const executeMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ status: "healthy" });

    registry.register({
      name: "checkStatus",
      description: "Checks system status",
      parameters: z.object({}),
      execute: executeMock
    });

    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Probing health...",
        toolCall: { name: "checkStatus", args: {} }
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "System is healthy after recovery."
      });

    const runtime = new AgentRuntime(registry, mockLLM, {
      maxTurns: 5,
      toolRetry: {
        maxRetries: 2,
        initialDelayMs: 10
      }
    });

    const finalMsg = await runtime.run("Is the system healthy?");

    expect(finalMsg.content).toBe("System is healthy after recovery.");
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it("should abort execution when AbortSignal is triggered", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "slowTool",
      description: "A slow tool",
      parameters: z.object({}),
      execute: async () => new Promise((resolve) => setTimeout(resolve, 50))
    });

    const controller = new AbortController();
    const mockLLM = vi.fn().mockImplementation(async () => {
      controller.abort();
      return {
        role: "assistant" as const,
        content: "Starting slow tool...",
        toolCall: { name: "slowTool", args: {} }
      };
    });

    const runtime = new AgentRuntime(registry, mockLLM, {
      signal: controller.signal
    });

    await expect(runtime.run("Run slow task")).rejects.toThrow("Agent execution aborted by signal");
  });
});
