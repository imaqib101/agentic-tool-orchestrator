import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry, CircuitBreaker, type ToolMiddleware } from "../src/index";

const echoTool = {
  name: "echo",
  description: "Echo input",
  parameters: z.object({ text: z.string().min(2) }),
  execute: async ({ text }: { text: string }) => ({ text })
};

describe("ToolRegistry", () => {
  it("registers and retrieves tools, rejecting duplicates", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.get("echo")?.description).toBe("Echo input");
    expect(registry.get("missing")).toBeUndefined();
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
    expect(registry.getToolDefinitions()).toEqual([{ name: "echo", description: "Echo input" }]);
  });

  it("throws for unknown tools", async () => {
    await expect(new ToolRegistry().invoke("nope", {})).rejects.toThrow(/Tool not found/);
  });

  it("validates Zod parameters and passes parsed data to the tool", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    await expect(registry.invoke("echo", { text: "hi" })).resolves.toEqual({ text: "hi" });
    await expect(registry.invoke("echo", { text: "x" })).rejects.toThrow(/Schema validation failed for tool "echo"/);
  });

  it("validates JSON Schema parameters", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "sum",
      description: "Sum numbers",
      parameters: {
        type: "object",
        properties: { values: { type: "array", items: { type: "number" } } },
        required: ["values"]
      },
      execute: ({ values }: { values: number[] }) => values.reduce((a, b) => a + b, 0)
    });
    await expect(registry.invoke("sum", { values: [1, 2, 3] })).resolves.toBe(6);
    await expect(registry.invoke("sum", {})).rejects.toThrow(/Schema validation failed for tool "sum"/);
  });

  it("creates circuit breakers from options or accepts an instance", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "flaky",
      description: "Always fails",
      parameters: z.object({}),
      circuitBreaker: { failureThreshold: 1, recoveryTimeoutMs: 60_000 },
      execute: async () => {
        throw new Error("boom");
      }
    });
    const custom = new CircuitBreaker("custom", { failureThreshold: 2, recoveryTimeoutMs: 1000 });
    registry.register({ ...echoTool, circuitBreaker: custom });

    expect(registry.getCircuitBreaker("echo")).toBe(custom);
    expect(registry.getCircuitBreaker("flaky")).toBeInstanceOf(CircuitBreaker);

    await expect(registry.invoke("flaky", {})).rejects.toThrow("boom");
    // Circuit is now open: the failure is no longer the tool's own error.
    await expect(registry.invoke("flaky", {})).rejects.not.toThrow("boom");
  });

  it("runs registered middleware around execution", async () => {
    const registry = new ToolRegistry();
    const order: string[] = [];
    const mw: ToolMiddleware = async (ctx, next) => {
      order.push(`before:${ctx.toolName}`);
      const res = await next();
      order.push("after");
      return res;
    };
    expect(registry.use(mw)).toBe(registry);
    registry.register(echoTool);
    await registry.invoke("echo", { text: "hello" });
    expect(order).toEqual(["before:echo", "after"]);
  });

  it("exports OpenAI-style tool specs", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const schema = { type: "object", properties: { n: { type: "number" } } };
    registry.register({ name: "raw", description: "Raw", parameters: schema, execute: () => 1 });

    const tools = registry.toOpenAITools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ type: "function", function: { name: "echo", description: "Echo input" } });
    expect(tools[1].function.parameters).toBe(schema);
  });
});
