import { describe, it, expect, vi } from "vitest";
import { withAdaptiveRetry, RetryExhaustedError } from "../src/adaptiveRetryPolicy";

describe("AdaptiveRetryPolicy", () => {
  it("succeeds on first attempt without retrying", async () => {
    let attempts = 0;
    const result = await withAdaptiveRetry(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withAdaptiveRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return "recovered";
      },
      { maxRetries: 3, initialDelayMs: 10, jitter: false }
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("throws RetryExhaustedError when maxRetries is exceeded", async () => {
    let attempts = 0;
    await expect(
      withAdaptiveRetry(
        async () => {
          attempts++;
          throw new Error("Persistent failure");
        },
        { maxRetries: 2, initialDelayMs: 5, jitter: false }
      )
    ).rejects.toThrow(RetryExhaustedError);

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("respects shouldRetry predicate", async () => {
    let attempts = 0;
    await expect(
      withAdaptiveRetry(
        async () => {
          attempts++;
          throw new Error("Fatal Error");
        },
        {
          maxRetries: 3,
          initialDelayMs: 5,
          shouldRetry: (err) => !err.message.includes("Fatal"),
        }
      )
    ).rejects.toThrow(RetryExhaustedError);

    expect(attempts).toBe(1); // should not retry on Fatal Error
  });
});
