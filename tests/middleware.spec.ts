import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../src/toolRegistry";
import {
  createCacheMiddleware,
  createTimingMiddleware,
  createRateLimitMiddleware
} from "../src/middleware";

describe("Tool Execution Middlewares", () => {
  it("should cache repeated invocations with same parameters", async () => {
    const registry = new ToolRegistry();
    const cache = createCacheMiddleware({ ttlMs: 1000 });
    registry.use(cache);

    let executionCount = 0;
    registry.register({
      name: "fetchWeather",
      description: "Gets weather for city",
      parameters: { type: "object", properties: { city: { type: "string" } } },
      execute: (args) => {
        executionCount++;
        return { city: args.city, temp: 72 };
      }
    });

    const res1 = await registry.invoke("fetchWeather", { city: "Tempe" });
    const res2 = await registry.invoke("fetchWeather", { city: "Tempe" });

    expect(res1).toEqual({ city: "Tempe", temp: 72 });
    expect(res2).toEqual({ city: "Tempe", temp: 72 });
    expect(executionCount).toBe(1);
    expect(cache.size()).toBe(1);

    cache.clear();
    expect(cache.size()).toBe(0);

    const res3 = await registry.invoke("fetchWeather", { city: "Tempe" });
    expect(executionCount).toBe(2);
    expect(res3).toEqual({ city: "Tempe", temp: 72 });
  });

  it("should record execution latency metrics in timing middleware", async () => {
    const registry = new ToolRegistry();
    const metrics: any[] = [];
    const timing = createTimingMiddleware((m) => metrics.push(m));
    registry.use(timing);

    registry.register({
      name: "computeSquare",
      description: "Computes square",
      parameters: { type: "object", properties: { n: { type: "number" } } },
      execute: async ({ n }) => {
        await new Promise((r) => setTimeout(r, 10));
        return n * n;
      }
    });

    const result = await registry.invoke("computeSquare", { n: 5 });
    expect(result).toBe(25);
    expect(metrics.length).toBe(1);
    expect(metrics[0].toolName).toBe("computeSquare");
    expect(metrics[0].durationMs).toBeGreaterThanOrEqual(8);
    expect(metrics[0].success).toBe(true);
  });

  it("should enforce rate limits and throw error when threshold exceeded", async () => {
    const registry = new ToolRegistry();
    const rateLimiter = createRateLimitMiddleware({ maxCalls: 2, windowMs: 500 });
    registry.use(rateLimiter);

    registry.register({
      name: "echo",
      description: "echoes message",
      parameters: { type: "object", properties: { msg: { type: "string" } } },
      execute: ({ msg }) => msg
    });

    expect(await registry.invoke("echo", { msg: "1" })).toBe("1");
    expect(await registry.invoke("echo", { msg: "2" })).toBe("2");
    await expect(registry.invoke("echo", { msg: "3" })).rejects.toThrow(/Rate limit exceeded/);
  });
});
