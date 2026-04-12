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
      const snippet = lines.slice(Math.max(0, lineIndex - 1), lineIndex + 2);
      const pointer = snippet.map((l, i) => {
        const num = (lineIndex - 1 + i + 1).toString().padStart(3);
        const marker = i === (lineIndex > 0 ? 1 : 0) ? ">" : " ";
        return `  ${marker} ${num} | ${l}`;
      }).join("\n");
      full += `\n${snippet.length ? snippet[0] && "\n" + pointer : ""}`;
    }
    if (hint) {
      full += `\n  hint: ${hint}`;
    }
    super(full);
    this.name = "SkillSyntaxError";
    this.line = line ?? null;
    this.hint = hint ?? null;
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
