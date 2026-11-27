import { ToolRegistry } from "./toolRegistry";
import { ToolMiddleware, ToolMiddlewareContext } from "./middleware";

export interface FallbackContext<TArgs = any> {
  toolName: string;
  args: TArgs;
  error: Error;
  attemptNumber: number;
}

export type FallbackValueHandler<TResult = any, TArgs = any> =
  | TResult
  | ((ctx: FallbackContext<TArgs>) => Promise<TResult> | TResult);

export interface ToolFallbackRule<TArgs = any, TResult = any> {
  /** Name of the primary tool this rule applies to, or RegExp, or '*' for all tools */
  match: string | RegExp;
  /**
   * Optional name of a secondary tool registered in the registry to execute as a fallback.
   * If both fallbackTool and fallbackValue are specified, fallbackTool is tried first;
   * if fallbackTool also throws, fallbackValue is used.
   */
  fallbackTool?: string;
  /**
   * Optional static value or recovery function returning a fallback result.
   */
  fallbackValue?: FallbackValueHandler<TResult, TArgs>;
  /**
   * Optional function to transform parameters before delegating to the fallback tool.
   */
  transformArgs?: (args: TArgs, error: Error) => any;
  /**
   * Optional predicate to decide if fallback should be activated for a given error.
   * Defaults to activating on any error.
   */
  when?: (error: Error, args: TArgs) => boolean;
}

export interface FallbackEventInfo {
  primaryTool: string;
  fallbackTool?: string;
  usedValue: boolean;
  args: unknown;
  error: Error;
  durationMs: number;
}

export interface ToolFallbackPolicyOptions {
  rules?: ToolFallbackRule[];
  /** Callback triggered whenever a fallback route or value is used */
  onFallback?: (info: FallbackEventInfo) => void | Promise<void>;
  /** Maximum delegation depth to prevent infinite loops (default: 3) */
  maxFallbackDepth?: number;
}

export class ToolFallbackPolicy {
  private rules: ToolFallbackRule[] = [];
  private onFallback?: (info: FallbackEventInfo) => void | Promise<void>;
  private maxFallbackDepth: number;

  constructor(options: ToolFallbackPolicyOptions = {}) {
    if (options.rules) {
      this.rules.push(...options.rules);
    }
    this.onFallback = options.onFallback;
    this.maxFallbackDepth = options.maxFallbackDepth ?? 3;
  }

  addRule<TArgs = any, TResult = any>(rule: ToolFallbackRule<TArgs, TResult>): this {
    this.rules.push(rule);
    return this;
  }

  getRules(): readonly ToolFallbackRule[] {
    return this.rules;
  }

  findRule(toolName: string, error: Error, args: unknown): ToolFallbackRule | undefined {
    for (const rule of this.rules) {
      const isMatch =
        rule.match === "*" ||
        (typeof rule.match === "string" && rule.match === toolName) ||
        (rule.match instanceof RegExp && rule.match.test(toolName));

      if (isMatch) {
        if (!rule.when || rule.when(error, args)) {
          return rule;
        }
      }
    }
    return undefined;
  }

  get depthLimit(): number {
    return this.maxFallbackDepth;
  }

  async notifyFallback(info: FallbackEventInfo): Promise<void> {
    if (this.onFallback) {
      await this.onFallback(info);
    }
  }
}

/**
 * Creates a ToolMiddleware that intercepts tool failures and gracefully recovers
 * using the configured ToolFallbackPolicy.
 */
export function createFallbackMiddleware(
  policy: ToolFallbackPolicy,
  registry: ToolRegistry
): ToolMiddleware {
  return async (context: ToolMiddlewareContext, next: () => Promise<any>): Promise<any> => {
    try {
      return await next();
    } catch (primaryError: any) {
      const error = primaryError instanceof Error ? primaryError : new Error(String(primaryError));

      const rule = policy.findRule(context.toolName, error, context.args);
      if (!rule) {
        throw error;
      }

      const currentDepth = (context.metadata.__fallbackDepth as number) || 0;
      if (currentDepth >= policy.depthLimit) {
        throw new Error(
          `Max fallback depth (${policy.depthLimit}) exceeded for tool "${context.toolName}". Last error: ${error.message}`
        );
      }

      const startTime = Date.now();

      // Attempt 1: Delegate to fallbackTool if configured
      if (rule.fallbackTool) {
        try {
          const secondaryArgs = rule.transformArgs
            ? rule.transformArgs(context.args, error)
            : context.args;

          const secondaryTool = registry.get(rule.fallbackTool);
          if (!secondaryTool) {
            throw new Error(`Fallback tool "${rule.fallbackTool}" not registered in ToolRegistry`);
          }

          // Execute secondary tool through registry invoke to preserve validation & middleware
          const result = await secondaryTool.execute(secondaryArgs);

          context.metadata.fallbackApplied = true;
          context.metadata.fallbackTool = rule.fallbackTool;

          await policy.notifyFallback({
            primaryTool: context.toolName,
            fallbackTool: rule.fallbackTool,
            usedValue: false,
            args: context.args,
            error,
            durationMs: Date.now() - startTime,
          });

          return result;
        } catch (secondaryError: any) {
          // If fallbackTool also failed, continue to fallbackValue if available
          if (rule.fallbackValue === undefined) {
            throw secondaryError;
          }
        }
      }

      // Attempt 2: Use fallbackValue if configured
      if (rule.fallbackValue !== undefined) {
        let value: any;
        if (typeof rule.fallbackValue === "function") {
          value = await (rule.fallbackValue as Function)({
            toolName: context.toolName,
            args: context.args,
            error,
            attemptNumber: currentDepth + 1,
          });
        } else {
          value = rule.fallbackValue;
        }

        context.metadata.fallbackApplied = true;
        context.metadata.fallbackValue = true;

        await policy.notifyFallback({
          primaryTool: context.toolName,
          usedValue: true,
          args: context.args,
          error,
          durationMs: Date.now() - startTime,
        });

        return value;
      }

      throw error;
    }
  };
}
