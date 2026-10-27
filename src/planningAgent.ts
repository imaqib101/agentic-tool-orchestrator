/**
 * PlanningAgent — builds ordered execution plans over a set of named tools,
 * validates them for cycles / unknown references, and exposes a DAG view.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PlanStep {
  /** Unique identifier for this step (used in dependsOn references). */
  id: string;
  /** The tool to invoke for this step. */
  toolName: string;
  /** Arguments passed to the tool. */
  args: Record<string, unknown>;
  /** IDs of steps that must complete before this one starts. */
  dependsOn: string[];
  /** Human-readable explanation of why this step exists. */
  rationale: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlanningAgentOptions {
  /** Maximum number of steps the planner is allowed to generate. */
  maxSteps?: number;
  /** Whether to allow a tool to appear in multiple steps. */
  allowDuplicateTools?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detects a cycle in a directed graph represented as an adjacency list.
 * @returns the cycle members if found, otherwise null.
 */
function detectCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  for (const node of graph.keys()) {
    color.set(node, WHITE);
  }

  const cycle: string[] = [];

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    cycle.push(node);

    for (const neighbour of graph.get(node) ?? []) {
      if (color.get(neighbour) === GRAY) {
        cycle.push(neighbour);
        return true;
      }
      if (color.get(neighbour) === WHITE) {
        if (dfs(neighbour)) return true;
      }
    }

    cycle.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const node of graph.keys()) {
    if (color.get(node) === WHITE) {
      if (dfs(node)) return cycle;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// PlanningAgent
// ---------------------------------------------------------------------------

export class PlanningAgent {
  private readonly tools: ReadonlySet<string>;
  private readonly options: Required<PlanningAgentOptions>;

  constructor(tools: string[], options: PlanningAgentOptions = {}) {
    if (tools.length === 0) {
      throw new Error("PlanningAgent requires at least one tool.");
    }
    this.tools = new Set(tools);
    this.options = {
      maxSteps: options.maxSteps ?? 20,
      allowDuplicateTools: options.allowDuplicateTools ?? true,
    };
  }

  /**
   * Produces an ordered array of `PlanStep` objects that together accomplish
   * the goal.  The default strategy assigns one step per available tool and
   * chains them sequentially — subclasses can override for richer planning.
   */
  planSteps(goal: string, tools: string[]): PlanStep[] {
    if (!goal || goal.trim().length === 0) {
      throw new Error("Goal must be a non-empty string.");
    }

    const effectiveTools = tools.length > 0 ? tools : [...this.tools];
    const capped = effectiveTools.slice(0, this.options.maxSteps);

    return capped.map<PlanStep>((toolName, index) => ({
      id: `step-${index + 1}`,
      toolName,
      args: { goal: goal.trim(), stepIndex: index },
      dependsOn: index === 0 ? [] : [`step-${index}`],
      rationale: `Use ${toolName} to progress toward: "${goal.trim()}" (step ${index + 1}/${capped.length}).`,
    }));
  }

  /**
   * Validates a plan for:
   * - Empty plans
   * - Unknown tool references (tool not in the registered set)
   * - Duplicate step IDs
   * - Unknown dependsOn references (step ID not present in plan)
   * - Dependency cycles
   */
  validatePlan(steps: PlanStep[]): ValidationResult {
    const errors: string[] = [];

    if (steps.length === 0) {
      return { valid: false, errors: ["Plan must contain at least one step."] };
    }

    const stepIds = new Set<string>();
    const duplicateIds = new Set<string>();

    for (const step of steps) {
      if (stepIds.has(step.id)) {
        duplicateIds.add(step.id);
      }
      stepIds.add(step.id);
    }

    for (const id of duplicateIds) {
      errors.push(`Duplicate step id: "${id}".`);
    }

    for (const step of steps) {
      // Unknown tool check
      if (!this.tools.has(step.toolName)) {
        errors.push(`Step "${step.id}" references unknown tool "${step.toolName}".`);
      }

      // Unknown dependsOn references
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          errors.push(
            `Step "${step.id}" depends on unknown step id "${dep}".`
          );
        }
      }
    }

    // Cycle detection — build adjacency list (id → dependsOn ids)
    const graph = new Map<string, string[]>();
    for (const step of steps) {
      graph.set(step.id, [...step.dependsOn]);
    }

    const cycleNodes = detectCycle(graph);
    if (cycleNodes !== null) {
      errors.push(`Dependency cycle detected: ${cycleNodes.join(" → ")}.`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Converts a plan into an adjacency list (DAG) where each key is a step ID
   * and the value is the array of `PlanStep` objects that directly depend on it.
   */
  toDAG(steps: PlanStep[]): Map<string, PlanStep[]> {
    const dag = new Map<string, PlanStep[]>();

    // Initialise every step with an empty dependents list
    for (const step of steps) {
      dag.set(step.id, []);
    }

    // Build forward edges: for each step, register it as a dependent of its deps
    for (const step of steps) {
      for (const depId of step.dependsOn) {
        const entry = dag.get(depId);
        if (entry !== undefined) {
          entry.push(step);
        }
      }
    }

    return dag;
  }
}
