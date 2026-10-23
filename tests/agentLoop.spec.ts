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
});
