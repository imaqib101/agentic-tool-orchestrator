import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../src/toolRegistry";
import {
  ApprovalGuard,
  ApprovalDeniedError,
  ApprovalTimeoutError,
  createApprovalMiddleware,
  type ApprovalRequest,
  type ApprovalDecision,
} from "../src/approvalGuard";

describe("ApprovalGuard & Human-In-The-Loop Middleware", () => {
  it("allows tool execution without approval when no rules match", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard();
    const handler = vi.fn();

    registry.use(createApprovalMiddleware(guard, handler));
    registry.register({
      name: "safeSearch",
      description: "Search documents",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      execute: (args) => ({ matches: [`result for ${args.q}`] }),
    });

    const result = await registry.invoke("safeSearch", { q: "types" });
    expect(result).toEqual({ matches: ["result for types"] });
    expect(handler).not.toHaveBeenCalled();
    expect(guard.getAuditHistory()).toHaveLength(0);
  });

  it("intercepts and executes tool when approved by human handler", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard({
      rules: [
        {
          match: "deployService",
          riskLevel: "high",
          requiresApproval: true,
        },
      ],
    });

    const handler = vi.fn(async (req: ApprovalRequest): Promise<ApprovalDecision> => {
      expect(req.toolName).toBe("deployService");
      expect(req.riskLevel).toBe("high");
      return {
        approved: true,
        approver: "lead-engineer@corp.local",
        reason: "Staging deployment verified",
      };
    });

    registry.use(createApprovalMiddleware(guard, handler));
    registry.register({
      name: "deployService",
      description: "Deploys a microservice",
      parameters: { type: "object", properties: { env: { type: "string" } } },
      execute: (args) => ({ status: "deployed", env: args.env }),
    });

    const result = await registry.invoke("deployService", { env: "staging" });
    expect(result).toEqual({ status: "deployed", env: "staging" });
    expect(handler).toHaveBeenCalledTimes(1);

    const audit = guard.getAuditHistory();
    expect(audit).toHaveLength(1);
    expect(audit[0].decision.approved).toBe(true);
    expect(audit[0].decision.approver).toBe("lead-engineer@corp.local");
  });

  it("blocks execution and throws ApprovalDeniedError when rejected", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard({
      rules: [
        {
          match: /^drop_/,
          riskLevel: "critical",
        },
      ],
    });

    const handler = vi.fn(async (): Promise<ApprovalDecision> => ({
      approved: false,
      reason: "Destructive database drops forbidden in automated workflows",
    }));

    registry.use(createApprovalMiddleware(guard, handler));
    registry.register({
      name: "drop_table",
      description: "Drops a table",
      parameters: { type: "object", properties: { table: { type: "string" } } },
      execute: (args) => ({ dropped: args.table }),
    });

    await expect(
      registry.invoke("drop_table", { table: "customers" })
    ).rejects.toThrow(ApprovalDeniedError);

    const audit = guard.getAuditHistory();
    expect(audit).toHaveLength(1);
    expect(audit[0].decision.approved).toBe(false);
    expect(audit[0].decision.reason).toContain("Destructive database drops forbidden");
  });

  it("supports modifying arguments during human approval review", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard({
      rules: [
        {
          match: "transferFunds",
          riskLevel: "critical",
        },
      ],
    });

    registry.use(
      createApprovalMiddleware(guard, async (req) => {
        // Human reviews and caps transfer amount
        return {
          approved: true,
          modifiedArgs: { ...req.args, amount: Math.min(req.args.amount, 1000) },
          reason: "Approved with $1,000 safety cap applied",
        };
      })
    );

    registry.register({
      name: "transferFunds",
      description: "Transfers funds",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" }, recipient: { type: "string" } },
      },
      execute: (args) => ({ transferred: args.amount, to: args.recipient }),
    });

    const result = await registry.invoke("transferFunds", {
      amount: 50000,
      recipient: "vendor_123",
    });

    expect(result).toEqual({ transferred: 1000, to: "vendor_123" });
  });

  it("supports dynamic rule predicate matching", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard();

    // Only require approval if quantity > 100
    guard.addRule({
      match: (ctx) => ctx.toolName === "orderItems",
      requiresApproval: (ctx) => ctx.args.quantity > 100,
      riskLevel: "medium",
    });

    const handler = vi.fn(async () => ({ approved: true }));
    registry.use(createApprovalMiddleware(guard, handler));
    registry.register({
      name: "orderItems",
      description: "Order catalog items",
      parameters: { type: "object", properties: { quantity: { type: "number" } } },
      execute: (args) => ({ count: args.quantity }),
    });

    // Under threshold: no approval needed
    await registry.invoke("orderItems", { quantity: 5 });
    expect(handler).not.toHaveBeenCalled();

    // Over threshold: approval requested
    await registry.invoke("orderItems", { quantity: 150 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("times out and throws ApprovalTimeoutError when approval exceeds timeoutMs", async () => {
    const registry = new ToolRegistry();
    const guard = new ApprovalGuard({
      timeoutMs: 30,
      rules: [{ match: "slowApproval", riskLevel: "high" }],
    });

    registry.use(
      createApprovalMiddleware(guard, async () => {
        // Simulate sluggish human approver
        await new Promise((r) => setTimeout(r, 100));
        return { approved: true };
      })
    );

    registry.register({
      name: "slowApproval",
      description: "Slow test tool",
      parameters: { type: "object" },
      execute: () => "ok",
    });

    await expect(registry.invoke("slowApproval", {})).rejects.toThrow(
      ApprovalTimeoutError
    );
  });

  it("dispatches onApprovalRequested and onApprovalDecided lifecycle hooks", async () => {
    const requestedHook = vi.fn();
    const decidedHook = vi.fn();

    const guard = new ApprovalGuard({
      onApprovalRequested: requestedHook,
      onApprovalDecided: decidedHook,
      rules: [{ match: "auditTest", riskLevel: "low" }],
    });

    const registry = new ToolRegistry();
    registry.use(
      createApprovalMiddleware(guard, async () => ({
        approved: true,
        reason: "Looks great",
      }))
    );

    registry.register({
      name: "auditTest",
      description: "Audit test tool",
      parameters: { type: "object" },
      execute: () => "success",
    });

    await registry.invoke("auditTest", {});
    expect(requestedHook).toHaveBeenCalledTimes(1);
    expect(decidedHook).toHaveBeenCalledTimes(1);

    expect(guard.getAuditHistory()).toHaveLength(1);
    guard.clearHistory();
    expect(guard.getAuditHistory()).toHaveLength(0);
  });
});
