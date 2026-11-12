import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import { AgentRuntime, type Message } from "../src/agentLoop";
import { TelemetryCollector } from "../src/telemetry";

describe("TelemetryCollector integration with AgentRuntime", () => {
  it("records successful tool executions and returns summary in AgentRunResult", async () => {
    const telemetry = new TelemetryCollector();
    const registry = new ToolRegistry();

    registry.register({
      name: "getQuote",
      description: "Fetches an inspirational quote",
      parameters: z.object({ topic: z.string() }),
      execute: async () => ({ quote: "Stay hungry, stay foolish." }),
    });

    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Fetching quote...",
        toolCall: { name: "getQuote", args: { topic: "innovation" } },
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Here is your quote: Stay hungry, stay foolish.",
      });

    const runtime = new AgentRuntime(registry, mockLLM, {
      maxTurns: 5,
      telemetry,
    });

    const result = await runtime.runDetailed("Give me a quote about innovation.");

    expect(result.toolInvocations).toBe(1);
    expect(result.telemetrySummary).toBeDefined();
    expect(result.telemetrySummary!.totalExecutions).toBe(1);
    expect(result.telemetrySummary!.successRate).toBe(1);
    expect(result.telemetrySummary!.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("records failed tool executions and reflects them in success rate", async () => {
    const telemetry = new TelemetryCollector();
    const registry = new ToolRegistry();

    registry.register({
      name: "unreliableTool",
      description: "A flaky tool that always errors",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Tool failure");
      },
    });

    const mockLLM = vi
      .fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Trying tool...",
        toolCall: { name: "unreliableTool", args: {} },
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Tool failed, handling gracefully.",
      });

    const runtime = new AgentRuntime(registry, mockLLM, {
      maxTurns: 5,
      telemetry,
    });

    const result = await runtime.runDetailed("Try unreliable tool.");

    expect(result.toolInvocations).toBe(1);
    expect(result.telemetrySummary).toBeDefined();
    expect(result.telemetrySummary!.totalExecutions).toBe(1);
    expect(result.telemetrySummary!.successRate).toBe(0);
  });

  it("records multiple tool calls including parallel execution correctly in telemetry", async () => {
    const telemetry = new TelemetryCollector();
    const registry = new ToolRegistry();

    registry.register({
      name: "toolA",
      description: "Tool A",
      parameters: z.object({}),
      execute: async () => ({ result: "a" }),
    });
    registry.register({
      name: "toolB",
      description: "Tool B",
      parameters: z.object({}),
      execute: async () => ({ result: "b" }),
    });

    let callCount = 0;
    const mockLLM = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          role: "assistant" as const,
          content: "Running both tools...",
          toolCalls: [
            { id: "c1", name: "toolA", args: {} },
            { id: "c2", name: "toolB", args: {} },
          ],
        };
      }
      return { role: "assistant" as const, content: "Done." };
    });

    const runtime = new AgentRuntime(registry, mockLLM, {
      maxTurns: 5,
      telemetry,
    });

    const result = await runtime.runDetailed("Run both tools.");

    expect(result.telemetrySummary!.totalExecutions).toBe(2);
    expect(result.telemetrySummary!.successRate).toBe(1);
  });

  it("returns no telemetrySummary when no telemetry collector is configured", async () => {
    const registry = new ToolRegistry();

    const mockLLM = vi.fn().mockResolvedValueOnce({
      role: "assistant",
      content: "Direct answer without any tools.",
    });

    const runtime = new AgentRuntime(registry, mockLLM, { maxTurns: 3 });
    const result = await runtime.runDetailed("Quick question.");

    expect(result.telemetrySummary).toBeUndefined();
  });

  it("TelemetryCollector.getSummary returns 100% success rate with no recorded metrics", () => {
    const t = new TelemetryCollector();
    const summary = t.getSummary();
    expect(summary.totalExecutions).toBe(0);
    expect(summary.successRate).toBe(1);
    expect(summary.avgDurationMs).toBe(0);
  });

  it("calculates percentile durations correctly", () => {
    const t = new TelemetryCollector();
    for (let i = 1; i <= 100; i++) {
      t.record({ toolName: "testTool", durationMs: i, success: true });
    }
    expect(t.getPercentileDuration(50)).toBe(50);
    expect(t.getPercentileDuration(95)).toBe(95);
    expect(t.getPercentileDuration(99)).toBe(99);
  });
});
