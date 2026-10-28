import { describe, it, expect } from "vitest";
import { JsonSchemaValidator, type JsonSchema } from "../src/jsonSchema";
import { ToolRegistry } from "../src/toolRegistry";

describe("JsonSchemaValidator & ToolRegistry JSON Schema", () => {
  const userSchema: JsonSchema = {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 1 },
      username: { type: "string", minLength: 3, maxLength: 20 },
      role: { type: "string", enum: ["admin", "editor", "viewer"] },
      tags: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["id", "username", "role"],
    additionalProperties: false
  };

  it("validates compliant payload correctly", () => {
    const payload = {
      id: 42,
      username: "aqib_dev",
      role: "admin",
      tags: ["frontend", "ai", "systems"]
    };

    const result = JsonSchemaValidator.validate(userSchema, payload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails on missing required properties", () => {
    const payload = {
      id: 42,
      username: "aqib_dev"
      // role is missing
    };

    const result = JsonSchemaValidator.validate(userSchema, payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Missing required property "role"'))).toBe(true);
  });

  it("fails on enum violation and bounds violation", () => {
    const payload = {
      id: -5,
      username: "a", // too short
      role: "superhero" // invalid enum
    };

    const result = JsonSchemaValidator.validate(userSchema, payload);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("fails on unallowed additional properties when additionalProperties=false", () => {
    const payload = {
      id: 10,
      username: "validuser",
      role: "viewer",
      unwanted: "injection"
    };

    const result = JsonSchemaValidator.validate(userSchema, payload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Additional property "unwanted" is not allowed'))).toBe(true);
  });

  it("integrates seamlessly into ToolRegistry", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "getUser",
      description: "Lookup user profile",
      parameters: userSchema,
      execute: async (args) => {
        return { success: true, user: args.username };
      }
    });

    const output = await registry.invoke("getUser", {
      id: 1,
      username: "lead_architect",
      role: "admin"
    });

    expect(output).toEqual({ success: true, user: "lead_architect" });

    // Should reject invalid payload
    await expect(registry.invoke("getUser", { id: 1, username: "ab" })).rejects.toThrow("Schema validation failed");
  });

  it("exports OpenAI-compatible function definitions", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "calc",
      description: "Perform math",
      parameters: {
        type: "object",
        properties: { expr: { type: "string" } },
        required: ["expr"]
      },
      execute: () => 42
    });

    const openAiTools = registry.toOpenAITools();
    expect(openAiTools).toHaveLength(1);
    expect(openAiTools[0].type).toBe("function");
    expect(openAiTools[0].function.name).toBe("calc");
    expect(openAiTools[0].function.parameters.type).toBe("object");
  });
});
