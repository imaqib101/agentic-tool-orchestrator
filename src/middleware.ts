export interface ToolMiddlewareContext {
  toolName: string;
  args: any;
  metadata: Record<string, unknown>;
  startTime: number;
}

export type ToolMiddleware = (
  context: ToolMiddlewareContext,
  next: () => Promise<any>
) => Promise<any>;

/**
 * Composes an array of middlewares into a single execution function (Koa/Express-style onion model).
 */
export function composeMiddlewares(
  middlewares: ToolMiddleware[],
  coreExecution: (context: ToolMiddlewareContext) => Promise<any>
): (context: ToolMiddlewareContext) => Promise<any> {
  return function (context: ToolMiddlewareContext): Promise<any> {
    let index = -1;

    function dispatch(i: number): Promise<any> {
      if (i <= index) {
        return Promise.reject(new Error("next() called multiple times in middleware chain"));
      }
      index = i;
      const fn = middlewares[i];
      if (i === middlewares.length) {
        return coreExecution(context);
      }
      try {
        return Promise.resolve(fn(context, () => dispatch(i + 1)));
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return dispatch(0);
  };
}

export interface TimingMetric {
  toolName: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Creates timing middleware that measures execution latency and invokes an optional telemetry callback.
 */
export function createTimingMiddleware(
  onComplete?: (metric: TimingMetric) => void
): ToolMiddleware {
  return async (context, next) => {
    const start = Date.now();
    try {
      const result = await next();
      const durationMs = Date.now() - start;
      context.metadata.durationMs = durationMs;
      if (onComplete) {
        onComplete({ toolName: context.toolName, durationMs, success: true });
      }
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      context.metadata.durationMs = durationMs;
      if (onComplete) {
        onComplete({
          toolName: context.toolName,
          durationMs,
          success: false,
          error: err?.message || String(err)
        });
      }
      throw err;
    }
  };
}

export interface CacheMiddlewareOptions {
  ttlMs?: number;
  maxEntries?: number;
}

export interface CacheMiddlewareInstance extends ToolMiddleware {
  clear(): void;
  size(): number;
  has(toolName: string, args: unknown): boolean;
}

/**
 * Creates an in-memory TTL caching middleware for deterministic/idempotent tool results.
 */
export function createCacheMiddleware(
  options: CacheMiddlewareOptions = {}
): CacheMiddlewareInstance {
  const ttlMs = options.ttlMs ?? 60000;
  const maxEntries = options.maxEntries ?? 100;
  const cache = new Map<string, { value: any; expiresAt: number }>();

  function computeKey(toolName: string, args: unknown): string {
    return `${toolName}:${JSON.stringify(args ?? {})}`;
  }

  const middleware: any = async (
    context: ToolMiddlewareContext,
    next: () => Promise<any>
  ) => {
    const key = computeKey(context.toolName, context.args);
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && entry.expiresAt > now) {
      context.metadata.cached = true;
      return entry.value;
    }

    const result = await next();

    if (cache.size >= maxEntries) {
      // Evict oldest entry (first key in iteration)
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    cache.set(key, { value: result, expiresAt: now + ttlMs });
    context.metadata.cached = false;
    return result;
  };

  middleware.clear = () => cache.clear();
  middleware.size = () => cache.size;
  middleware.has = (toolName: string, args: unknown) => {
    const key = computeKey(toolName, args);
    const entry = cache.get(key);
    return !!entry && entry.expiresAt > Date.now();
  };

  return middleware as CacheMiddlewareInstance;
}

export interface RateLimitOptions {
  maxCalls: number;
  windowMs: number;
}

/**
 * Creates rate-limiting middleware to guard against tool invocation spikes.
 */
export function createRateLimitMiddleware(options: RateLimitOptions): ToolMiddleware {
  const { maxCalls, windowMs } = options;
  const callTimestamps = new Map<string, number[]>();

  return async (context, next) => {
    const now = Date.now();
    let timestamps = callTimestamps.get(context.toolName);
    if (!timestamps) {
      timestamps = [];
      callTimestamps.set(context.toolName, timestamps);
    }

    // Filter out expired timestamps
    const active = timestamps.filter((t) => now - t < windowMs);
    callTimestamps.set(context.toolName, active);

    if (active.length >= maxCalls) {
      throw new Error(
        `Rate limit exceeded for tool "${context.toolName}". Allowed: ${maxCalls} calls per ${windowMs}ms.`
      );
    }

    active.push(now);
    return await next();
  };
}
