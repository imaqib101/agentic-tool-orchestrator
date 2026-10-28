import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitBreakerError } from "../src/circuitBreaker";
import { ToolRegistry } from "../src/toolRegistry";

describe("CircuitBreaker & Fault Tolerance", () => {
  it("trips open after reaching failure threshold", async () => {
    const cb = new CircuitBreaker("weatherApi", {
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      halfOpenMaxSuccess: 1
    });

    const fail = true;
    const task = async () => {
      if (fail) throw new Error("Connection refused");
      return "sunny";
    };

    // 1st failure
    await expect(cb.execute(task)).rejects.toThrow("Connection refused");
    expect(cb.getState()).toBe("CLOSED");

    // 2nd failure - threshold reached
    await expect(cb.execute(task)).rejects.toThrow("Connection refused");
    expect(cb.getState()).toBe("OPEN");

    // Subsequent call immediately rejected with CircuitBreakerError
    await expect(cb.execute(task)).rejects.toBeInstanceOf(CircuitBreakerError);
  });

  it("transitions to HALF_OPEN after recovery timeout and recovers on success", async () => {
    const cb = new CircuitBreaker("dbService", {
      failureThreshold: 1,
      recoveryTimeoutMs: 50,
      halfOpenMaxSuccess: 2
    });

    let fail = true;
    const task = async () => {
      if (fail) throw new Error("DB down");
      return "data";
    };

    await expect(cb.execute(task)).rejects.toThrow("DB down");
    expect(cb.getState()).toBe("OPEN");

    // Wait for recovery timeout
    await new Promise((res) => setTimeout(res, 60));
    expect(cb.getState()).toBe("HALF_OPEN");

    // Allow task to succeed
    fail = false;
    await cb.execute(task); // 1st success in half-open
    expect(cb.getState()).toBe("HALF_OPEN");

    await cb.execute(task); // 2nd success in half-open -> closes
    expect(cb.getState()).toBe("CLOSED");
  });

  it("works with ToolRegistry declarative options", async () => {
    const registry = new ToolRegistry();
    const fail = true;

    registry.register({
      name: "flakyApi",
      description: "Flaky remote endpoint",
      parameters: { type: "object" },
      circuitBreaker: { failureThreshold: 2, recoveryTimeoutMs: 100 },
      execute: async () => {
        if (fail) throw new Error("Service unavailable 503");
        return "success";
      }
    });

    await expect(registry.invoke("flakyApi", {})).rejects.toThrow("Service unavailable");
    await expect(registry.invoke("flakyApi", {})).rejects.toThrow("Service unavailable");

    // Circuit should now trip
    await expect(registry.invoke("flakyApi", {})).rejects.toBeInstanceOf(CircuitBreakerError);
  });
});
