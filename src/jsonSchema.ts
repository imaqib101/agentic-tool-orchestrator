export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  description?: string;
  enum?: (string | number | boolean)[];
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean;
}

export interface JsonSchema extends JsonSchemaProperty {
  type: "object";
}

export interface ValidationError {
  path: string;
  message: string;
}

export class JsonSchemaValidator {
  static validate(schema: JsonSchemaProperty, data: unknown, path = "$"): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (data === undefined) {
      errors.push({ path, message: "Value is undefined" });
      return { valid: false, errors };
    }

    if (schema.enum && !schema.enum.includes(data as any)) {
      errors.push({
        path,
        message: `Value ${JSON.stringify(data)} is not in allowed enum: ${JSON.stringify(schema.enum)}`
      });
    }

    if (schema.type) {
      const typeValid = this.checkType(schema.type, data);
      if (!typeValid) {
        errors.push({
          path,
          message: `Expected type "${schema.type}", but received "${this.getTypeName(data)}"`
        });
        return { valid: false, errors };
      }
    }

    if (typeof data === "number") {
      if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push({ path, message: `Value ${data} is less than minimum ${schema.minimum}` });
      }
      if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push({ path, message: `Value ${data} is greater than maximum ${schema.maximum}` });
      }
    }

    if (typeof data === "string") {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        errors.push({ path, message: `String length ${data.length} is shorter than minLength ${schema.minLength}` });
      }
      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        errors.push({ path, message: `String length ${data.length} is longer than maxLength ${schema.maxLength}` });
      }
    }

    if (Array.isArray(data) && schema.items) {
      data.forEach((item, index) => {
        const itemResult = this.validate(schema.items!, item, `${path}[${index}]`);
        if (!itemResult.valid) {
          errors.push(...itemResult.errors);
        }
      });
    }

    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;

      if (schema.required) {
        for (const reqKey of schema.required) {
          if (!(reqKey in record) || record[reqKey] === undefined) {
            errors.push({
              path: `${path}.${reqKey}`,
              message: `Missing required property "${reqKey}"`
            });
          }
        }
      }

      if (schema.properties) {
        for (const [propKey, propSchema] of Object.entries(schema.properties)) {
          if (propKey in record && record[propKey] !== undefined) {
            const propResult = this.validate(propSchema, record[propKey], `${path}.${propKey}`);
            if (!propResult.valid) {
              errors.push(...propResult.errors);
            }
          }
        }
      }

      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(record)) {
          if (!(key in schema.properties)) {
            errors.push({
              path: `${path}.${key}`,
              message: `Additional property "${key}" is not allowed`
            });
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private static checkType(expected: string, val: unknown): boolean {
    if (expected === "null") return val === null;
    if (expected === "array") return Array.isArray(val);
    if (expected === "integer") return typeof val === "number" && Number.isInteger(val);
    if (expected === "number") return typeof val === "number" && !isNaN(val);
    if (expected === "object") return typeof val === "object" && val !== null && !Array.isArray(val);
    return typeof val === expected;
  }

  private static getTypeName(val: unknown): string {
    if (val === null) return "null";
    if (Array.isArray(val)) return "array";
    return typeof val;
  }
}
