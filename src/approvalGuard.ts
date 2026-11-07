import { ToolMiddleware, ToolMiddlewareContext } from "./middleware";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: any;
  riskLevel: RiskLevel;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
  modifiedArgs?: any;
  approver?: string;
  timestamp?: number;
}

export interface AuditRecord {
  request: ApprovalRequest;
  decision: ApprovalDecision;
  durationMs: number;
}

export interface ApprovalRule {
  id?: string;
  /** Matches tool name by exact string or RegExp, or custom predicate function */
  match: string | RegExp | ((context: ToolMiddlewareContext) => boolean);
  riskLevel?: RiskLevel;
  /** Explicit flag or dynamic predicate whether approval is required */
  requiresApproval?: boolean | ((context: ToolMiddlewareContext) => boolean | Promise<boolean>);
  description?: string;
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

export interface ApprovalGuardOptions {
  defaultRiskLevel?: RiskLevel;
  rules?: ApprovalRule[];
  timeoutMs?: number;
  onApprovalRequested?: (request: ApprovalRequest) => void | Promise<void>;
  onApprovalDecided?: (request: ApprovalRequest, decision: ApprovalDecision) => void | Promise<void>;
}

export class ApprovalDeniedError extends Error {
  constructor(
    public readonly request: ApprovalRequest,
    public readonly decision: ApprovalDecision
  ) {
    super(`Approval denied for tool "${request.toolName}": ${decision.reason || "Execution rejected by approval policy"}`);
    this.name = "ApprovalDeniedError";
  }
}

export class ApprovalTimeoutError extends Error {
  constructor(public readonly request: ApprovalRequest, public readonly timeoutMs: number) {
    super(`Approval timed out after ${timeoutMs}ms for tool "${request.toolName}"`);
    this.name = "ApprovalTimeoutError";
  }
}

export class ApprovalGuard {
  private rules: ApprovalRule[] = [];
  private defaultRiskLevel: RiskLevel;
  private timeoutMs?: number;
  private onApprovalRequested?: (request: ApprovalRequest) => void | Promise<void>;
  private onApprovalDecided?: (request: ApprovalRequest, decision: ApprovalDecision) => void | Promise<void>;
  private auditHistory: AuditRecord[] = [];

  constructor(options: ApprovalGuardOptions = {}) {
    this.defaultRiskLevel = options.defaultRiskLevel ?? "medium";
    this.timeoutMs = options.timeoutMs;
    this.onApprovalRequested = options.onApprovalRequested;
    this.onApprovalDecided = options.onApprovalDecided;
    if (options.rules) {
      this.rules = [...options.rules];
    }
  }

  addRule(rule: ApprovalRule): this {
    this.rules.push(rule);
    return this;
  }

  async shouldRequireApproval(context: ToolMiddlewareContext): Promise<{
    requires: boolean;
    riskLevel: RiskLevel;
    matchedRule?: ApprovalRule;
  }> {
    for (const rule of this.rules) {
      let matched = false;
      if (typeof rule.match === "string") {
        matched = rule.match === context.toolName;
      } else if (rule.match instanceof RegExp) {
        matched = rule.match.test(context.toolName);
      } else if (typeof rule.match === "function") {
        matched = rule.match(context);
      }

      if (matched) {
        let req = true;
        if (typeof rule.requiresApproval === "boolean") {
          req = rule.requiresApproval;
        } else if (typeof rule.requiresApproval === "function") {
          req = await rule.requiresApproval(context);
        }
        return {
          requires: req,
          riskLevel: rule.riskLevel ?? this.defaultRiskLevel,
          matchedRule: rule,
        };
      }
    }

    return {
      requires: false,
      riskLevel: this.defaultRiskLevel,
    };
  }

  async evaluateAndExecute(
    context: ToolMiddlewareContext,
    next: () => Promise<any>,
    handler: ApprovalHandler
  ): Promise<any> {
    const { requires, riskLevel } = await this.shouldRequireApproval(context);

    if (!requires) {
      return next();
    }

    const request: ApprovalRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      toolName: context.toolName,
      args: context.args,
      riskLevel,
      metadata: context.metadata,
      timestamp: Date.now(),
    };

    if (this.onApprovalRequested) {
      await this.onApprovalRequested(request);
    }

    const startWait = Date.now();
    let decision: ApprovalDecision;

    if (this.timeoutMs && this.timeoutMs > 0) {
      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new ApprovalTimeoutError(request, this.timeoutMs!));
        }, this.timeoutMs);
      });

      try {
        decision = await Promise.race([
          Promise.resolve(handler(request)),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timer!);
      }
    } else {
      decision = await handler(request);
    }

    const durationMs = Date.now() - startWait;
    this.auditHistory.push({ request, decision, durationMs });

    if (this.onApprovalDecided) {
      await this.onApprovalDecided(request, decision);
    }

    if (!decision.approved) {
      throw new ApprovalDeniedError(request, decision);
    }

    if (decision.modifiedArgs !== undefined) {
      context.args = decision.modifiedArgs;
    }

    return next();
  }

  getAuditHistory(): AuditRecord[] {
    return [...this.auditHistory];
  }

  clearHistory(): void {
    this.auditHistory = [];
  }
}

/**
 * Creates human-in-the-loop approval middleware for ToolRegistry.
 */
export function createApprovalMiddleware(
  guard: ApprovalGuard,
  handler: ApprovalHandler
): ToolMiddleware {
  return async (context: ToolMiddlewareContext, next: () => Promise<any>) => {
    return guard.evaluateAndExecute(context, next, handler);
  };
}
