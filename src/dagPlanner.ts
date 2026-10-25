import { ToolRegistry } from './toolRegistry';

export interface ToolPlanStep {
  id: string;
  toolName: string;
  args: Record<string, any>;
  dependsOn?: string[];
}

export interface StepExecutionResult {
  stepId: string;
  toolName: string;
  resolvedArgs: Record<string, any>;
  output?: any;
  error?: Error;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
}

export interface DAGExecutionResult {
  steps: Map<string, StepExecutionResult>;
  stages: string[][];
  success: boolean;
  totalDurationMs: number;
}

export class DependencyCycleError extends Error {
  constructor(public readonly cyclePath: string[]) {
    super('Cycle detected in tool execution plan: ' + cyclePath.join(' -> '));
    this.name = 'DependencyCycleError';
  }
}

export class DependencyFailedError extends Error {
  constructor(public readonly stepId: string, public readonly failedDependencyId: string) {
    super('Step "' + stepId + '" skipped because prerequisite step "' + failedDependencyId + '" failed.');
    this.name = 'DependencyFailedError';
  }
}

const REF_PATTERN = /^\$ref:([a-zA-Z0-9_-]+)(?:\.(.+))?$/;

export class ToolPlanDAG {
  private steps = new Map<string, ToolPlanStep>();
  private adjacencyList = new Map<string, Set<string>>();
  private inDegree = new Map<string, number>();

  constructor(steps: ToolPlanStep[] = []) {
    for (const step of steps) {
      this.addStep(step);
    }
  }

  addStep(step: ToolPlanStep): this {
    if (this.steps.has(step.id)) {
      throw new Error('Step with id "' + step.id + '" is already defined.');
    }
    this.steps.set(step.id, { ...step });
    return this;
  }

  private discoverImplicitDependencies(args: unknown): string[] {
    const deps: string[] = [];
    if (!args || typeof args !== 'object') return deps;

    for (const value of Object.values(args as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const match = value.match(REF_PATTERN);
        if (match) {
          deps.push(match[1]);
        }
      } else if (typeof value === 'object') {
        deps.push(...this.discoverImplicitDependencies(value));
      }
    }
    return deps;
  }

  private resolveReferences(args: any, results: Map<string, StepExecutionResult>): any {
    if (args === null || args === undefined) return args;

    if (typeof args === 'string') {
      const match = args.match(REF_PATTERN);
      if (match) {
        const depStepId = match[1];
        const propPath = match[2];
        const depResult = results.get(depStepId);
        if (!depResult || depResult.status !== 'success') {
          throw new Error('Referenced output from step "' + depStepId + '" is not available.');
        }
        if (!propPath) {
          return depResult.output;
        }
        return this.getNestedProperty(depResult.output, propPath);
      }
      return args;
    }

    if (Array.isArray(args)) {
      return args.map((item) => this.resolveReferences(item, results));
    }

    if (typeof args === 'object') {
      const resolved: Record<string, any> = {};
      for (const [key, val] of Object.entries(args)) {
        resolved[key] = this.resolveReferences(val, results);
      }
      return resolved;
    }

    return args;
  }

  private getNestedProperty(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  computeStages(): string[][] {
    this.adjacencyList.clear();
    this.inDegree.clear();

    for (const id of this.steps.keys()) {
      this.adjacencyList.set(id, new Set());
      this.inDegree.set(id, 0);
    }

    for (const [stepId, step] of this.steps.entries()) {
      const explicitDeps = step.dependsOn ?? [];
      const implicitDeps = this.discoverImplicitDependencies(step.args);
      const allDeps = Array.from(new Set([...explicitDeps, ...implicitDeps]));

      for (const dep of allDeps) {
        if (!this.steps.has(dep)) {
          throw new Error('Step "' + stepId + '" depends on unknown step "' + dep + '".');
        }
        this.adjacencyList.get(dep)!.add(stepId);
        this.inDegree.set(stepId, (this.inDegree.get(stepId) ?? 0) + 1);
      }
    }

    const inDegreeCopy = new Map(this.inDegree);
    const stages: string[][] = [];
    let currentStage: string[] = [];

    for (const [id, deg] of inDegreeCopy.entries()) {
      if (deg === 0) {
        currentStage.push(id);
      }
    }

    let processedCount = 0;

    while (currentStage.length > 0) {
      stages.push(currentStage);
      processedCount += currentStage.length;
      const nextStage: string[] = [];

      for (const stepId of currentStage) {
        const neighbors = this.adjacencyList.get(stepId) ?? new Set();
        for (const neighbor of neighbors) {
          const currentDeg = (inDegreeCopy.get(neighbor) ?? 1) - 1;
          inDegreeCopy.set(neighbor, currentDeg);
          if (currentDeg === 0) {
            nextStage.push(neighbor);
          }
        }
      }

      currentStage = nextStage;
    }

    if (processedCount < this.steps.size) {
      const unvisited = Array.from(inDegreeCopy.entries())
        .filter(([, deg]) => deg > 0)
        .map(([id]) => id);
      throw new DependencyCycleError(unvisited);
    }

    return stages;
  }

  async execute(registry: ToolRegistry): Promise<DAGExecutionResult> {
    const startTime = Date.now();
    const stages = this.computeStages();
    const stepResults = new Map<string, StepExecutionResult>();
    let overallSuccess = true;

    for (const stage of stages) {
      await Promise.all(
        stage.map(async (stepId) => {
          const step = this.steps.get(stepId)!;
          const stepStart = Date.now();

          const explicitDeps = step.dependsOn ?? [];
          const implicitDeps = this.discoverImplicitDependencies(step.args);
          const allDeps = Array.from(new Set([...explicitDeps, ...implicitDeps]));

          const failedDep = allDeps.find((dep) => {
            const res = stepResults.get(dep);
            return !res || res.status !== 'success';
          });

          if (failedDep) {
            overallSuccess = false;
            stepResults.set(stepId, {
              stepId,
              toolName: step.toolName,
              resolvedArgs: step.args,
              error: new DependencyFailedError(stepId, failedDep),
              status: 'skipped',
              durationMs: Date.now() - stepStart
            });
            return;
          }

          try {
            const resolvedArgs = this.resolveReferences(step.args, stepResults);
            const output = await registry.invoke(step.toolName, resolvedArgs);
            stepResults.set(stepId, {
              stepId,
              toolName: step.toolName,
              resolvedArgs,
              output,
              status: 'success',
              durationMs: Date.now() - stepStart
            });
          } catch (err: any) {
            overallSuccess = false;
            stepResults.set(stepId, {
              stepId,
              toolName: step.toolName,
              resolvedArgs: step.args,
              error: err instanceof Error ? err : new Error(String(err)),
              status: 'failed',
              durationMs: Date.now() - stepStart
            });
          }
        })
      );
    }

    return {
      steps: stepResults,
      stages,
      success: overallSuccess,
      totalDurationMs: Date.now() - startTime
    };
  }
}
