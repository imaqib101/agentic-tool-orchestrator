import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/toolRegistry";
import { ToolPlanDAG, DependencyCycleError } from "../src/dagPlanner";

describe("ToolPlanDAG (Autonomous DAG Execution Planner)", () => {
  it("should compute topological stages for independent and dependent steps", () => {
    const dag = new ToolPlanDAG([
      { id: "stepA", toolName: "toolA", args: {} },
      { id: "stepB", toolName: "toolB", args: {} },
      { id: "stepC", toolName: "toolC", args: { val: "$ref:stepA.value" } },
      { id: "stepD", toolName: "toolD", args: {}, dependsOn: ["stepB", "stepC"] }
    ]);

    const stages = dag.computeStages();
    expect(stages.length).toBe(3);
    // Stage 0: stepA and stepB (in parallel)
    expect(stages[0].sort()).toEqual(["stepA", "stepB"]);
    // Stage 1: stepC (depends on stepA)
    expect(stages[1]).toEqual(["stepC"]);
    // Stage 2: stepD (depends on stepB and stepC)
    expect(stages[2]).toEqual(["stepD"]);
  });

  it("should detect dependency cycles and throw DependencyCycleError", () => {
    const dag = new ToolPlanDAG([
      { id: "step1", toolName: "t1", args: {}, dependsOn: ["step2"] },
      { id: "step2", toolName: "t2", args: {}, dependsOn: ["step1"] }
    ]);

    expect(() => dag.computeStages()).toThrow(DependencyCycleError);
  });

  it("should execute DAG end-to-end and resolve output references", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "getUser",
      description: "Gets user info",
      parameters: { type: "object", properties: { id: { type: "string" } } },
      execute: ({ id }) => ({ id, name: "Aqib", departmentId: "dept_42" })
    });

    registry.register({
      name: "getDepartment",
      description: "Gets department info",
      parameters: { type: "object", properties: { deptId: { type: "string" } } },
      execute: ({ deptId }) => ({ deptId, title: "AI Engineering", headCount: 15 })
    });

    registry.register({
      name: "composeWelcome",
      description: "Composes message",
      parameters: {
        type: "object",
        properties: { userName: { type: "string" }, deptName: { type: "string" } }
      },
      execute: ({ userName, deptName }) => `Welcome ${userName} to ${deptName}!`
    });

    const dag = new ToolPlanDAG([
      {
        id: "fetchUser",
        toolName: "getUser",
        args: { id: "user_101" }
      },
      {
        id: "fetchDept",
        toolName: "getDepartment",
        args: { deptId: "$ref:fetchUser.departmentId" }
      },
      {
        id: "sendWelcome",
        toolName: "composeWelcome",
        args: {
          userName: "$ref:fetchUser.name",
          deptName: "$ref:fetchDept.title"
        }
      }
    ]);

    const result = await dag.execute(registry);

    expect(result.success).toBe(true);
    expect(result.stages.length).toBe(3);

    const welcomeResult = result.steps.get("sendWelcome");
    expect(welcomeResult?.status).toBe("success");
    expect(welcomeResult?.output).toBe("Welcome Aqib to AI Engineering!");
  });

  it("should gracefully handle failures and skip downstream dependent tasks", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "flakyApi",
      description: "Always fails",
      parameters: { type: "object", properties: {} },
      execute: () => {
        throw new Error("Downstream service unreachable");
      }
    });

    registry.register({
      name: "dependentTask",
      description: "Should not execute",
      parameters: { type: "object", properties: { input: { type: "string" } } },
      execute: ({ input }) => input
    });

    const dag = new ToolPlanDAG([
      { id: "step1", toolName: "flakyApi", args: {} },
      { id: "step2", toolName: "dependentTask", args: { input: "$ref:step1.data" } }
    ]);

    const result = await dag.execute(registry);

    expect(result.success).toBe(false);
    expect(result.steps.get("step1")?.status).toBe("failed");
    expect(result.steps.get("step2")?.status).toBe("skipped");
  });
});
