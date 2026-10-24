import { z, type ZodSchema } from "zod";
import { JsonSchemaValidator, type JsonSchema } from "./jsonSchema";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuitBreaker";

export type SchemaDefinition = ZodSchema | JsonSchema;

export interface ToolDefinition<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: TParams;
  circuitBreaker?: CircuitBreakerOptions | CircuitBreaker;
  execute: (args: any) => Promise<TResult> | TResult;
}

export interface OpenAIFunctionSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  register<T = any, R = any>(tool: ToolDefinition<T, R>) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);

    if (tool.circuitBreaker) {
      if (tool.circuitBreaker instanceof CircuitBreaker) {
        this.circuitBreakers.set(tool.name, tool.circuitBreaker);
      } else {
        this.circuitBreakers.set(tool.name, new CircuitBreaker(tool.name, tool.circuitBreaker));
      }
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getCircuitBreaker(name: string): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  async invoke(name: string, rawArgs: unknown): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: "${name}"`);
    }

    const validatedArgs = this.validateParameters(tool, rawArgs);

    const cb = this.circuitBreakers.get(name);
    if (cb) {
      return await cb.execute(() => Promise.resolve(tool.execute(validatedArgs)));
    }

    return await tool.execute(validatedArgs);
  }

  private validateParameters(tool: ToolDefinition, rawArgs: unknown): any {
    const schema = tool.parameters;

    // Check if it is a Zod schema
    if (schema && typeof (schema as ZodSchema).safeParse === "function") {
      const parseResult = (schema as ZodSchema).safeParse(rawArgs);
      if (!parseResult.success) {
        throw new Error(`Schema validation failed for tool "${tool.name}": ${parseResult.error.message}`);
      }
      return parseResult.data;
    }

    // Check if it is a JSON Schema object
    if (schema && typeof schema === "object" && "type" in schema) {
      const res = JsonSchemaValidator.validate(schema as JsonSchema, rawArgs);
      if (!res.valid) {
        const msg = res.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
        throw new Error(`Schema validation failed for tool "${tool.name}": ${msg}`);
      }
      return rawArgs;
    }

    return rawArgs;
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description
    }));
  }

  toOpenAITools(): OpenAIFunctionSpec[] {
    return Array.from(this.tools.values()).map((t) => {
      let params: Record<string, unknown> = { type: "object", properties: {} };

      if (t.parameters && typeof t.parameters === "object") {
        if ("type" in t.parameters) {
          params = t.parameters as Record<string, unknown>;
        } else if ("_def" in t.parameters) {
          params = {
            type: "object",
            description: "Zod-validated parameters"
          };
        }
      }

      return {
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: params
        }
      };
    });
  }
}
