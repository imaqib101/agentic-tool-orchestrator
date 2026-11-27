import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../src/toolRegistry";
import {
  ToolFallbackPolicy,
  createFallbackMiddleware,
  type FallbackEventInfo,
} from "../src/toolFallback";

describe("ToolFallbackPolicy & createFallbackMiddleware", () => {
  it("passes through normal execution when primary tool succeeds", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "primarySearch",
          fallbackTool: "backupSearch",
        },
      ],
    });

    registry.register({
      name: "primarySearch",
      description: "Primary search",
      parameters: z.object({ q: z.string() }),
      execute: async ({ q }) => ({ source: "primary", results: [q] }),
    });

    registry.register({
      name: "backupSearch",
      description: "Backup search",
      parameters: z.object({ q: z.string() }),
      execute: async ({ q }) => ({ source: "backup", results: [q] }),
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("primarySearch", { q: "agentic AI" });
    expect(result).toEqual({ source: "primary", results: ["agentic AI"] });
  });

  it("delegates to fallbackTool when primary tool throws", async () => {
    const registry = new ToolRegistry();
    const onFallback = vi.fn();
    const policy = new ToolFallbackPolicy({
      onFallback,
      rules: [
        {
          match: "primarySearch",
          fallbackTool: "backupSearch",
        },
      ],
    });

    registry.register({
      name: "primarySearch",
      description: "Failing primary search",
      parameters: z.object({ q: z.string() }),
      execute: async () => {
        throw new Error("503 Service Unavailable");
      },
    });

    registry.register({
      name: "backupSearch",
      description: "Working backup search",
      parameters: z.object({ q: z.string() }),
      execute: async ({ q }) => ({ source: "backup", results: [q] }),
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("primarySearch", { q: "distributed tasks" });
    expect(result).toEqual({ source: "backup", results: ["distributed tasks"] });
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining<Partial<FallbackEventInfo>>({
        primaryTool: "primarySearch",
        fallbackTool: "backupSearch",
        usedValue: false,
      })
    );
  });

  it("transforms arguments before delegating to fallbackTool", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "complexApi",
          fallbackTool: "simpleApi",
          transformArgs: (args: any) => ({ query: args.filters.name }),
        },
      ],
    });

    registry.register({
      name: "complexApi",
      description: "Complex API that fails",
      parameters: z.object({ filters: z.object({ name: z.string() }) }),
      execute: async () => {
        throw new Error("Rate limit exceeded");
      },
    });

    registry.register({
      name: "simpleApi",
      description: "Simple API",
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ simpleResult: query.toUpperCase() }),
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("complexApi", { filters: { name: "hermes" } });
    expect(result).toEqual({ simpleResult: "HERMES" });
  });

  it("recovers with static fallbackValue when tool throws", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "weatherService",
          fallbackValue: { temperature: 22, condition: "sunny (cached)" },
        },
      ],
    });

    registry.register({
      name: "weatherService",
      description: "Live weather service",
      parameters: z.object({ city: z.string() }),
      execute: async () => {
        throw new Error("Connection timeout");
      },
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("weatherService", { city: "Bengaluru" });
    expect(result).toEqual({ temperature: 22, condition: "sunny (cached)" });
  });

  it("recovers with dynamic fallbackValue handler function", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "currencyConverter",
          fallbackValue: async (ctx: any) => ({
            from: ctx.args.from,
            to: ctx.args.to,
            rate: 1.0,
            recoveredFrom: ctx.error.message,
          }),
        },
      ],
    });

    registry.register({
      name: "currencyConverter",
      description: "Currency converter",
      parameters: z.object({ from: z.string(), to: z.string() }),
      execute: async () => {
        throw new Error("Network unreachability");
      },
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("currencyConverter", { from: "USD", to: "INR" });
    expect(result).toEqual({
      from: "USD",
      to: "INR",
      rate: 1.0,
      recoveredFrom: "Network unreachability",
    });
  });

  it("respects conditional 'when' predicate before applying fallback", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "databaseQuery",
          when: (err) => err.message.includes("429 Too Many Requests"),
          fallbackValue: { data: [], rateLimited: true },
        },
      ],
    });

    registry.register({
      name: "databaseQuery",
      description: "DB query",
      parameters: z.object({ id: z.number() }),
      execute: async ({ id }) => {
        if (id === 1) throw new Error("429 Too Many Requests");
        throw new Error("Fatal: Table not found");
      },
    });

    registry.use(createFallbackMiddleware(policy, registry));

    // When error matches predicate, fallback is used
    const handled = await registry.invoke("databaseQuery", { id: 1 });
    expect(handled).toEqual({ data: [], rateLimited: true });

    // When error does not match predicate, error is thrown
    await expect(registry.invoke("databaseQuery", { id: 2 })).rejects.toThrow(
      "Fatal: Table not found"
    );
  });

  it("cascades from failing fallbackTool to fallbackValue", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy({
      rules: [
        {
          match: "primary",
          fallbackTool: "secondary",
          fallbackValue: { finalFallback: true },
        },
      ],
    });

    registry.register({
      name: "primary",
      description: "Primary",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Primary failed");
      },
    });

    registry.register({
      name: "secondary",
      description: "Secondary",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Secondary failed too");
      },
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("primary", {});
    expect(result).toEqual({ finalFallback: true });
  });

  it("matches wildcard '*' or RegExp rule matches", async () => {
    const registry = new ToolRegistry();
    const policy = new ToolFallbackPolicy();

    policy.addRule({
      match: /^api_/,
      fallbackValue: { defaultApiResult: true },
    });

    registry.register({
      name: "api_fetchUsers",
      description: "Fetch users",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Endpoint 500");
      },
    });

    registry.use(createFallbackMiddleware(policy, registry));

    const result = await registry.invoke("api_fetchUsers", {});
    expect(result).toEqual({ defaultApiResult: true });
  });
});
