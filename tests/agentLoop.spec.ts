import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import { AgentRuntime, type Message } from "../src/agentLoop";

describe("AgentRuntime", () => {
  it("should successfully execute tool calls and return final resolution", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "fetchWeather",
      description: "Gets temperature for city",
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, temp: "28C", condition: "Sunny" })
    });

    const mockLLM = vi.fn()
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
});
