export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  halfOpenMaxSuccess?: number;
}

export class CircuitBreakerError extends Error {
  constructor(public readonly toolName: string) {
    super(`Circuit breaker is OPEN for tool "${toolName}". Execution rejected to protect downstream resources.`);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastStateChangedAt = 0;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenMaxSuccess: number;

  constructor(public readonly name: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 5000;
    this.halfOpenMaxSuccess = options.halfOpenMaxSuccess ?? 2;
  }

  getState(): CircuitState {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastStateChangedAt;
      if (elapsed >= this.recoveryTimeoutMs) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        this.lastStateChangedAt = Date.now();
      }
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === "OPEN") {
      throw new CircuitBreakerError(this.name);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private recordSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxSuccess) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
        this.lastStateChangedAt = Date.now();
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    if (this.state === "HALF_OPEN" || this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.lastStateChangedAt = Date.now();
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChangedAt = Date.now();
  }
}
