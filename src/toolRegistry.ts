import { z, type ZodSchema } from "zod";

export interface ToolDefinition<TParams extends ZodSchema = any, TResult = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>) => Promise<TResult> | TResult;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register<T extends ZodSchema, R>(tool: ToolDefinition<T, R>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  async invoke(name: string, rawArgs: unknown): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: "${name}"`);
    }

    const parseResult = tool.parameters.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Schema validation failed for tool "${name}": ${parseResult.error.message}`);
    }

    return await tool.execute(parseResult.data);
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description
    }));
  }
}
