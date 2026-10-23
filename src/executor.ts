export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export async function runWithTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${timeoutMs}ms for "${toolName}"`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 0;
  if (maxRetries <= 0) {
    return await fn();
  }

  const initialDelayMs = options.initialDelayMs ?? 100;
  const backoffFactor = options.backoffFactor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const calculatedDelay = initialDelayMs * Math.pow(backoffFactor, attempt - 1);
      const delayMs = Math.min(calculatedDelay, maxDelayMs);

      if (options.onRetry) {
        options.onRetry(error, attempt, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
