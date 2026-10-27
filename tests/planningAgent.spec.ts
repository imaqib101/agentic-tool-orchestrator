import { describe, it, expect, beforeEach } from "vitest";
import {
  PlanningAgent,
  PlanStep,
  ValidationResult,
} from "../src/planningAgent";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOOLS = ["search", "fetch", "parse", "summarise", "store", "notify"];

function makeAgent(tools: string[] = TOOLS): PlanningAgent {
  return new PlanningAgent(tools);
}

// ---------------------------------------------------------------------------
// planSteps
// ---------------------------------------------------------------------------

describe("PlanningAgent.planSteps", () => {
  it("returns a non-empty array for a valid goal", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Summarise the latest news", TOOLS);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("returns PlanStep objects with required fields", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Do something useful", ["search", "fetch"]);

    for (const step of steps) {
      expect(step).toHaveProperty("id");
      expect(step).toHaveProperty("toolName");
      expect(step).toHaveProperty("args");
      expect(step).toHaveProperty("dependsOn");
      expect(step).toHaveProperty("rationale");
    }
  });

  it("chains steps sequentially by default", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Fetch and store data", ["fetch", "store"]);

    expect(steps[0].dependsOn).toEqual([]);
    expect(steps[1].dependsOn).toContain(steps[0].id);
  });

  it("respects maxSteps option", () => {
    const agent = new PlanningAgent(TOOLS, { maxSteps: 2 });
    const steps = agent.planSteps("Any goal", TOOLS);
    expect(steps.length).toBeLessThanOrEqual(2);
  });

  it("throws when goal is empty", () => {
    const agent = makeAgent();
    expect(() => agent.planSteps("", TOOLS)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validatePlan — cycles
// ---------------------------------------------------------------------------

describe("PlanningAgent.validatePlan — cycle detection", () => {
  it("reports a cycle when two steps depend on each other", () => {
    const agent = makeAgent();

    const steps: PlanStep[] = [
      {
        id: "A",
        toolName: "search",
        args: {},
        dependsOn: ["B"],
        rationale: "Search first",
      },
      {
        id: "B",
        toolName: "fetch",
        args: {},
        dependsOn: ["A"],
        rationale: "Then fetch",
      },
    ];

    const result: ValidationResult = agent.validatePlan(steps);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it("accepts an acyclic plan as valid (no cycle errors)", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Valid linear plan", ["search", "store"]);
    const result = agent.validatePlan(steps);
    expect(result.errors.filter((e) => /cycle/i.test(e))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validatePlan — unknown tool references
// ---------------------------------------------------------------------------

describe("PlanningAgent.validatePlan — unknown tool references", () => {
  it("flags a step that references a tool not in the registry", () => {
    const agent = makeAgent(["search"]);

    const steps: PlanStep[] = [
      {
        id: "step-1",
        toolName: "nonExistentTool",
        args: {},
        dependsOn: [],
        rationale: "This tool does not exist",
      },
    ];

    const result = agent.validatePlan(steps);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => /unknown tool/i.test(e))
    ).toBe(true);
  });

  it("passes when all referenced tools are registered", () => {
    const agent = makeAgent(["search", "store"]);
    const steps = agent.planSteps("Goal", ["search", "store"]);
    const result = agent.validatePlan(steps);
    expect(result.errors.filter((e) => /unknown tool/i.test(e))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validatePlan — empty plan
// ---------------------------------------------------------------------------

describe("PlanningAgent.validatePlan — empty plan", () => {
  it("rejects an empty steps array", () => {
    const agent = makeAgent();
    const result = agent.validatePlan([]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// toDAG
// ---------------------------------------------------------------------------

describe("PlanningAgent.toDAG — adjacency list", () => {
  it("produces a key for every step", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Build a DAG", ["search", "fetch", "store"]);
    const dag = agent.toDAG(steps);

    for (const step of steps) {
      expect(dag.has(step.id)).toBe(true);
    }
  });

  it("correctly wires forward edges", () => {
    const agent = makeAgent();

    // A → B → C (B depends on A, C depends on B)
    const a: PlanStep = { id: "A", toolName: "search", args: {}, dependsOn: [], rationale: "root" };
    const b: PlanStep = { id: "B", toolName: "fetch",  args: {}, dependsOn: ["A"], rationale: "after A" };
    const c: PlanStep = { id: "C", toolName: "store",  args: {}, dependsOn: ["B"], rationale: "after B" };

    const dag = agent.toDAG([a, b, c]);

    // A's dependents should include B
    const aDeps = dag.get("A") ?? [];
    expect(aDeps.map((s) => s.id)).toContain("B");

    // B's dependents should include C
    const bDeps = dag.get("B") ?? [];
    expect(bDeps.map((s) => s.id)).toContain("C");

    // C has no dependents
    const cDeps = dag.get("C") ?? [];
    expect(cDeps).toHaveLength(0);
  });

  it("returns empty dependents list for a root node", () => {
    const agent = makeAgent();
    const steps = agent.planSteps("Single step", ["search"]);
    const dag = agent.toDAG(steps);
    const rootDeps = dag.get(steps[0].id) ?? [];
    expect(rootDeps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// constructor
// ---------------------------------------------------------------------------

describe("PlanningAgent constructor", () => {
  it("throws when constructed with an empty tools array", () => {
    expect(() => new PlanningAgent([])).toThrow();
  });
});
