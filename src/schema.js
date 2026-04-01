import { isPlainObject } from "./utils.js";

const PRIMITIVES = new Set(["string", "number", "boolean", "object", "any"]);

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

    if (!isPlainObject(current) || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  return true;
}
