export interface RetryPolicyOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitter?: boolean;
  shouldRetry?: (error: any, attempt: number) => boolean;
}

export class RetryExhaustedError extends Error {
  constructor(public readonly lastError: any, public readonly attempts: number) {
    super(`Operation failed after ${attempts} attempts. Last error: ${lastError?.message || lastError}`);
    this.name = "RetryExhaustedError";
  }
}

export async function withAdaptiveRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryPolicyOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const backoffFactor = options.backoffFactor ?? 2;
  const useJitter = options.jitter ?? true;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > maxRetries || !shouldRetry(err, attempt)) {
        throw new RetryExhaustedError(err, attempt);
      }

      let delay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      if (delay > maxDelayMs) {
        delay = maxDelayMs;
      }

      if (useJitter) {
        // Full jitter between 0 and delay
        delay = Math.random() * delay;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
