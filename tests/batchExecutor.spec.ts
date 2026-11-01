import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import { executeBatchTools, BatchToolItem } from "../src/batchExecutor";

describe("BatchExecutor", () => {
  it("executes multiple tools concurrently with concurrency limit", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "Echo input",
      parameters: z.object({ value: z.string() }),
      execute: async (args) => {
        await new Promise((r) => setTimeout(r, 20));
        return { echoed: args.value };
      },
    });

    const items: BatchToolItem[] = [
      { id: "1", toolName: "echo", args: { value: "hello" } },
      { id: "2", toolName: "echo", args: { value: "world" } },
      { id: "3", toolName: "echo", args: { value: "foo" } },
    ];

    const report = await executeBatchTools(registry, items, { concurrencyLimit: 2 });

    expect(report.successCount).toBe(3);
    expect(report.failureCount).toBe(0);
    expect(report.results.length).toBe(3);
    expect(report.results[0].result).toEqual({ echoed: "hello" });
    expect(report.results[1].result).toEqual({ echoed: "world" });
    expect(report.results[2].result).toEqual({ echoed: "foo" });
  });

  it("handles tool failures and missing tools gracefully", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "fail",
      description: "Always fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Expected failure");
      },
    });

    const items: BatchToolItem[] = [
      { id: "a", toolName: "fail", args: {} },
      { id: "b", toolName: "nonexistent", args: {} },
    ];

    const report = await executeBatchTools(registry, items);

    expect(report.successCount).toBe(0);
    expect(report.failureCount).toBe(2);
    expect(report.results[0].success).toBe(false);
    expect(report.results[1].success).toBe(false);
    expect((report.results[0].error as Error).message).toBe("Expected failure");
    expect((report.results[1].error as Error).message).toContain("not found");
  });
});
