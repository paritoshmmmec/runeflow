import { isPlainObject } from "./utils.js";

const PRIMITIVES = new Set(["string", "number", "boolean", "object", "any"]);
const JSON_SCHEMA_PRIMITIVES = new Set(["string", "number", "integer", "boolean", "object", "array"]);
const JSON_SCHEMA_KEYS = new Set(["type", "properties", "items", "required", "additionalProperties", "description"]);

function isJsonSchemaNode(schema) {
  if (!isPlainObject(schema)) {
    return false;
  }

  const keys = Object.keys(schema);
  const hasOnlySchemaKeys = keys.every((key) => JSON_SCHEMA_KEYS.has(key));
  if (!hasOnlySchemaKeys) {
    return false;
  }

  return "properties" in schema
    || "required" in schema
    || "additionalProperties" in schema
    || (typeof schema.type === "string" && JSON_SCHEMA_PRIMITIVES.has(schema.type));
}

function normalizeJsonSchemaType(schema) {
  if (typeof schema.type === "string") {
    return schema.type;
  }

  if (isPlainObject(schema.properties)) {
    return "object";
  }

  if (schema.items !== undefined) {
    return "array";
  }

  return null;
}

export function validateShape(value, schema, path = "value") {
  const issues = [];

  function walk(currentValue, currentSchema, currentPath) {
    if (typeof currentSchema === "string") {
      if (!PRIMITIVES.has(currentSchema)) {
        issues.push(`${currentPath}: unsupported schema primitive '${currentSchema}'`);
        return;
      }

      if (currentSchema === "any") {
        return;
      }

      if (currentSchema === "object") {
        if (!isPlainObject(currentValue)) {
          issues.push(`${currentPath}: expected object`);
        }
        return;
      }

      if (typeof currentValue !== currentSchema) {
        issues.push(`${currentPath}: expected ${currentSchema}`);
      }
      return;
    }

    if (Array.isArray(currentSchema)) {
      if (!Array.isArray(currentValue)) {
        issues.push(`${currentPath}: expected array`);
        return;
      }

      if (currentSchema.length !== 1) {
        issues.push(`${currentPath}: array schema must contain exactly one item schema`);
        return;
      }

      currentValue.forEach((item, index) => walk(item, currentSchema[0], `${currentPath}[${index}]`));
      return;
    }

    if (isJsonSchemaNode(currentSchema)) {
      const schemaType = normalizeJsonSchemaType(currentSchema);

      if (!schemaType || !JSON_SCHEMA_PRIMITIVES.has(schemaType)) {
        issues.push(`${currentPath}: unsupported JSON Schema type '${schemaType}'`);
        return;
      }

      if (schemaType === "object") {
        if (!isPlainObject(currentValue)) {
          issues.push(`${currentPath}: expected object`);
          return;
        }

        const properties = isPlainObject(currentSchema.properties) ? currentSchema.properties : {};
        const required = Array.isArray(currentSchema.required) ? currentSchema.required : [];

        for (const key of required) {
          if (!(key in currentValue)) {
            issues.push(`${currentPath}.${key}: missing required field`);
          }
        }

        for (const [key, childSchema] of Object.entries(properties)) {
          if (key in currentValue) {
            walk(currentValue[key], childSchema, `${currentPath}.${key}`);
          }
        }

        if (currentSchema.additionalProperties === false) {
          for (const key of Object.keys(currentValue)) {
            if (!(key in properties)) {
              issues.push(`${currentPath}.${key}: unexpected field`);
            }
          }
        }

        return;
      }

      if (schemaType === "array") {
        if (!Array.isArray(currentValue)) {
          issues.push(`${currentPath}: expected array`);
          return;
        }

        if (currentSchema.items !== undefined) {
          currentValue.forEach((item, index) => walk(item, currentSchema.items, `${currentPath}[${index}]`));
        }
        return;
      }

      if (schemaType === "integer") {
        if (typeof currentValue !== "number" || !Number.isInteger(currentValue)) {
          issues.push(`${currentPath}: expected integer`);
        }
        return;
      }

      if (typeof currentValue !== schemaType) {
        issues.push(`${currentPath}: expected ${schemaType}`);
      }
      return;
    }

    if (!isPlainObject(currentSchema)) {
      issues.push(`${currentPath}: unsupported schema node`);
      return;
    }

    if (!isPlainObject(currentValue)) {
      issues.push(`${currentPath}: expected object`);
      return;
    }

    for (const [key, childSchema] of Object.entries(currentSchema)) {
      if (!(key in currentValue)) {
        issues.push(`${currentPath}.${key}: missing required field`);
        continue;
      }

      walk(currentValue[key], childSchema, `${currentPath}.${key}`);
    }
  }

  walk(value, schema, path);
  return issues;
}

export function shapeHasPath(schema, segments) {
  let current = schema;

  for (const segment of segments) {
    if (typeof current === "string") {
      return false;
    }

    if (Array.isArray(current)) {
      if (segment === "*") {
        current = current[0];
        continue;
      }
      return false;
    }

    if (isJsonSchemaNode(current)) {
      const schemaType = normalizeJsonSchemaType(current);

      if (schemaType === "array") {
        if (segment !== "*") {
          return false;
        }
        current = current.items;
        continue;
      }

      if (schemaType !== "object") {
        return false;
      }

      const properties = isPlainObject(current.properties) ? current.properties : {};
      if (!(segment in properties)) {
        return false;
      }

      current = properties[segment];
      continue;
    }

    if (!isPlainObject(current) || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  return true;
}
