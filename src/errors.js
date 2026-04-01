export class SkillSyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = "SkillSyntaxError";
  }
}

export class ValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export class RuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeError";
  }
}
