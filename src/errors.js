export class SkillSyntaxError extends Error {
  constructor(message, context = {}) {
    const { line, source, hint } = context;
    let full = message;
    if (line != null) {
      full += `\n  at line ${line}`;
    }
    if (source) {
      const lines = source.split("\n");
      const lineIndex = (line ?? 1) - 1;
      const startIndex = Math.max(0, lineIndex - 1);
      const snippet = lines.slice(startIndex, lineIndex + 2);
      const pointer = snippet.map((l, i) => {
        const num = (startIndex + i + 1).toString().padStart(3);
        const marker = (startIndex + i) === lineIndex ? ">" : " ";
        return `  ${marker} ${num} | ${l}`;
      }).join("\n");
      full += `\n${snippet.length ? "\n" + pointer : ""}`;
    }
    if (hint) {
      full += `\n  hint: ${hint}`;
    }
    super(full);
    this.name = "SkillSyntaxError";
    this.line = line ?? null;
    this.hint = hint ?? null;
    this.source = source ?? null;
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
