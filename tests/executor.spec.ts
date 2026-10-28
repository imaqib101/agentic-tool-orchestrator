import { describe, it, expect, vi } from "vitest";
import { runWithTimeout, retryWithBackoff } from "../src/executor";

describe("runWithTimeout", () => {
  it("resolves when the operation completes before the timeout", async () => {
    const res = await runWithTimeout(async () => "success", 1000, "testTool");
    expect(res).toBe("success");
  });

  it("throws a timeout error when operation exceeds duration", async () => {
    await expect(
      runWithTimeout(() => new Promise((resolve) => setTimeout(resolve, 200)), 50, "slowTool")
    ).rejects.toThrow('Tool execution timed out after 50ms for "slowTool"');
  });
});

describe("retryWithBackoff", () => {
  it("returns immediate result if no error occurs", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const result = await retryWithBackoff(fn, { maxRetries: 3 });

    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and resolves once succeeding", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transient connection error"))
      .mockResolvedValueOnce("recovered");

    const onRetry = vi.fn();
    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
      backoffFactor: 2,
      onRetry
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 10);
  });

  it("re-throws error after exceeding max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Permanent failure"));

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        initialDelayMs: 10
      })
    ).rejects.toThrow("Permanent failure");

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects shouldRetry predicate and aborts early", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Fatal auth error"));

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 5,
        initialDelayMs: 10,
        shouldRetry: (err: any) => !err.message.includes("Fatal")
      })
    ).rejects.toThrow("Fatal auth error");

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
