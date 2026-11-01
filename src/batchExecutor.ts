import { ToolRegistry } from "./toolRegistry";
import { runWithTimeout, retryWithBackoff, RetryOptions } from "./index";

export interface BatchToolItem {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  retryOptions?: RetryOptions;
}

export interface BatchToolResultItem<T = unknown> {
  id: string;
  toolName: string;
  success: boolean;
  result?: T;
  error?: unknown;
  durationMs: number;
}

export interface BatchExecutionReport<T = unknown> {
  results: BatchToolResultItem<T>[];
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

export interface BatchExecutionOptions {
  concurrencyLimit?: number;
}

export async function executeBatchTools(
  registry: ToolRegistry,
  items: BatchToolItem[],
  options: BatchExecutionOptions = {}
): Promise<BatchExecutionReport> {
  const concurrencyLimit = options.concurrencyLimit ?? 5;
  const startTime = Date.now();
  const results: BatchToolResultItem[] = new Array(items.length);

  let currentIndex = 0;

  async function worker() {
    while (true) {
      const index = currentIndex++;
      if (index >= items.length) {
        break;
      }

      const item = items[index];
      const itemStart = Date.now();
      try {
        const tool = registry.get(item.toolName);
        if (!tool) {
          throw new Error(`Tool "${item.toolName}" not found in registry`);
        }

        let executeFn = () => tool.execute(item.args);

        if (item.retryOptions) {
          const originalFn = executeFn;
          executeFn = () => retryWithBackoff(originalFn, item.retryOptions);
        }

        if (item.timeoutMs && item.timeoutMs > 0) {
          const originalFn = executeFn;
          executeFn = () => runWithTimeout(originalFn, item.timeoutMs!, item.toolName);
        }

        const res = await executeFn();
        results[index] = {
          id: item.id,
          toolName: item.toolName,
          success: true,
          result: res,
          durationMs: Date.now() - itemStart,
        };
      } catch (err) {
        results[index] = {
          id: item.id,
          toolName: item.toolName,
          success: false,
          error: err,
          durationMs: Date.now() - itemStart,
        };
      }
    }
  }

  const workerCount = Math.min(concurrencyLimit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  const totalDurationMs = Date.now() - startTime;
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  return {
    results,
    successCount,
    failureCount,
    totalDurationMs,
  };
}
