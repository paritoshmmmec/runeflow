# Task

Write a runeflow skill called `draft-pr-notes` that produces a pull request
title and body from git information, without pushing or opening a PR.

The skill must:

1. Read the current git branch name.
2. Read a diff summary against a base branch (default `main`) that the caller
   passes in as an input.
3. Use an LLM to draft a PR title (under 72 chars, starting with a change type
   like `feat:` / `fix:` / `chore:`) and a plain-markdown body that explains
   what changed and why.
4. Return the title and body as outputs.

Do not push. Do not open a PR. Do not create a new branch. No `gh` CLI calls.

The skill file should be `draft-pr-notes.md` in the current directory.

When you are done, run `runeflow validate ./draft-pr-notes.md` to confirm it
parses. You do not need to run it.
