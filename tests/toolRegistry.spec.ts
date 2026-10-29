import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import { CircuitBreaker } from "../src/circuitBreaker";
import type { JsonSchema } from "../src/jsonSchema";

describe("ToolRegistry", () => {
  it("registers a tool and retrieves its definition", () => {
    const registry = new ToolRegistry();
    const tool = {
      name: "calculator",
      description: "Performs basic math",
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: vi.fn(({ a, b }: { a: number; b: number }) => a + b)
    };

    registry.register(tool);

    expect(registry.has("calculator")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
    expect(registry.get("calculator")).toBe(tool);
    expect(registry.count).toBe(1);
  });

  it("throws error when registering duplicate tool names", () => {
    const registry = new ToolRegistry();
    const tool = {
      name: "search",
      description: "Search documents",
      parameters: {},
      execute: vi.fn((_args: any) => undefined)
    };

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('Tool "search" is already registered.');
  });

  it("lists all tools and supports unregister and clear", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "toolA",
      description: "Tool A",
      parameters: {},
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 100 },
      execute: vi.fn((_args: any) => undefined)
    });
    registry.register({
      name: "toolB",
      description: "Tool B",
      parameters: {},
      execute: vi.fn((_args: any) => undefined)
    });

    expect(registry.count).toBe(2);
    expect(registry.getAll().map((t) => t.name)).toEqual(["toolA", "toolB"]);
    expect(registry.getCircuitBreaker("toolA")).toBeInstanceOf(CircuitBreaker);

    // Unregister toolA
    const unregistered = registry.unregister("toolA");
    expect(unregistered).toBe(true);
    expect(registry.has("toolA")).toBe(false);
    expect(registry.getCircuitBreaker("toolA")).toBeUndefined();
    expect(registry.count).toBe(1);

    // Unregistering nonexistent tool returns false
    expect(registry.unregister("toolA")).toBe(false);

    // Clear remaining tools
    registry.clear();
    expect(registry.count).toBe(0);
    expect(registry.getAll()).toEqual([]);
  });

  it("validates parameters using Zod schema on invoke", async () => {
    const registry = new ToolRegistry();
    const executeFn = vi.fn((args: { query: string; limit?: number }) => `found ${args.query}`);
    registry.register({
      name: "search",
      description: "Searches knowledge base",
      parameters: z.object({
        query: z.string().min(1),
        limit: z.number().optional()
      }),
      execute: executeFn
    });

    const result = await registry.invoke("search", { query: "agent loops" });
    expect(result).toBe("found agent loops");
    expect(executeFn).toHaveBeenCalledWith({ query: "agent loops" });

    // Invalid parameters throw error
    await expect(registry.invoke("search", { query: 123 })).rejects.toThrow(
      'Schema validation failed for tool "search"'
    );
  });

  it("validates parameters using JSON Schema on invoke", async () => {
    const registry = new ToolRegistry();
    const jsonSchema: JsonSchema = {
      type: "object",
      properties: {
        city: { type: "string" },
        units: { type: "string", enum: ["metric", "imperial"] }
      },
      required: ["city"]
    };

    const executeFn = vi.fn((args: { city: string; units?: string }) => `weather in ${args.city}`);
    registry.register({
      name: "weather",
      description: "Fetches weather info",
      parameters: jsonSchema,
      execute: executeFn
    });

    const result = await registry.invoke("weather", { city: "Bengaluru", units: "metric" });
    expect(result).toBe("weather in Bengaluru");

    // Invalid JSON schema parameters throw error
    await expect(registry.invoke("weather", { city: 42 })).rejects.toThrow(
      'Schema validation failed for tool "weather"'
    );
  });

  it("throws when invoking a non-registered tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke("missing", {})).rejects.toThrow('Tool not found: "missing"');
  });

  it("runs middlewares in execution pipeline", async () => {
    const registry = new ToolRegistry();
    const order: string[] = [];

    registry.use(async (ctx, next) => {
      order.push("mw1_before");
      const res = await next(ctx);
      order.push("mw1_after");
      return res;
    });

    registry.use(async (ctx, next) => {
      order.push("mw2_before");
      const res = await next(ctx);
      order.push("mw2_after");
      return res;
    });

    registry.register({
      name: "echo",
      description: "Echoes input",
      parameters: {},
      execute: (args) => {
        order.push("execute");
        return args;
      }
    });

    const output = await registry.invoke("echo", { text: "hello" });
    expect(output).toEqual({ text: "hello" });
    expect(order).toEqual(["mw1_before", "mw2_before", "execute", "mw2_after", "mw1_after"]);
  });

  it("generates OpenAI function specs and definitions", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "tool_zod",
      description: "Tool with Zod schema",
      parameters: z.object({ id: z.string() }),
      execute: (_args: any) => undefined
    });
    registry.register({
      name: "tool_json",
      description: "Tool with JSON schema",
      parameters: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"]
      },
      execute: (_args: any) => undefined
    });

    const definitions = registry.getToolDefinitions();
    expect(definitions).toEqual([
      { name: "tool_zod", description: "Tool with Zod schema" },
      { name: "tool_json", description: "Tool with JSON schema" }
    ]);

    const openAiSpecs = registry.toOpenAITools();
    expect(openAiSpecs).toHaveLength(2);
    expect(openAiSpecs[0]).toEqual({
      type: "function",
      function: {
        name: "tool_zod",
        description: "Tool with Zod schema",
        parameters: {
          type: "object",
          description: "Zod-validated parameters"
        }
      }
    });
    expect(openAiSpecs[1].function.name).toBe("tool_json");
    expect(openAiSpecs[1].function.parameters).toHaveProperty("required", ["count"]);
  });
});
