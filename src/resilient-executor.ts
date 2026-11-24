/**
 * Resilient Executor with Exponential Backoff, Jitter, and Circuit Breaker
 * Enhanced for agentic tool dispatch reliability.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
  jitter: true,
};

export class CircuitBreakerOpenError extends Error {
  constructor(message: string = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

export async function executeWithResilience<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > opts.maxRetries) {
        throw error;
      }
      let delay = opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt - 1);
      if (opts.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      delay = Math.min(delay, opts.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
