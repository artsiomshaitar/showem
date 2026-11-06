---
name: cr
description: Review the current changes with /code-review, fix what it finds, then clean up the changed code - remove AI slop, apply DRY/SOLID where it actually helps, and bring it in line with the best practices of the languages and tools it uses. Use when the user types /cr, or asks to "review and fix", "clean up my changes", "cr this", or wants the diff reviewed and tidied before a commit or PR.
argument-hint: "[level] [target]"
---

# /cr: review, fix, clean up

The goal is a diff the user would be happy to commit: no bugs the review can find, no noise, and code that looks like the rest of the project wrote it.

Work only on the changed code (the same target `/code-review` reviews). Code outside the diff is context, not a cleanup target. If you spot a real problem there, mention it, but don't change it.

## 1. Review

Run the `code-review` skill with the Skill tool and pass `$ARGUMENTS` through unchanged, so the user can pick the level and target the same way (`/cr high`, `/cr 123`, `/cr medium src/`). Don't add `--fix` or `--comment`: you fix findings yourself in the next step so each one gets checked first.

## 2. Fix the findings

For each finding, read the code it points at and decide whether it's real before touching anything. Reviews produce false positives, and a "fix" for a non-bug adds risk and noise.

- Real: fix it with the smallest change that removes the problem.
- Not real: skip it, and keep one line on why for the report.
- Real but the fix is a design decision the user should make (changes behavior, an API, or a lot of code): don't guess. List it in the report with the options.

## 3. Remove AI slop

Read the changed lines and remove what a careful human author wouldn't have written:

- Comments that restate the code (`// increment the counter`), narrate the edit (`// Updated to use the new helper`, `// Fixed bug`), or address the reader of the chat rather than the reader of the code.
- Error handling, logging, retries, or validation nobody asked for and nothing needs: `try/catch` that only rethrows or logs, null checks on values that can't be null, fallbacks that hide failures.
- Abstractions with one caller and no second one coming: wrapper functions, single-implementation interfaces, config options nothing sets, "manager"/"helper" classes around one function.
- Leftovers: unused imports, variables and parameters; debug output; commented-out code; placeholder `TODO`s the change introduced; emoji in code or logs.
- Defensive or verbose code where the language has an idiom (manual loops for a `map`/`filter`, redundant type annotations the compiler infers, `if (x) return true; else return false`).

Comments that explain *why* something non-obvious is done stay. When unsure whether a comment earns its place, ask: would a teammate reading this code miss it if it were gone?

## 4. DRY and SOLID, pragmatically

These principles are tools for keeping code easy to change, not goals in themselves. Apply them where they make the diff simpler, and stop there.

- **DRY**: look for the same knowledge written twice, within the diff or between the diff and existing code (a constant, a formula, a parsing rule, a near-copy of an existing helper). Reuse what the project already has before writing something new; search the repo for it. Two similar-looking lines that could change independently are not duplication; don't merge them.
- **SOLID**: check that new functions and modules do one job, that the change didn't make a module depend on details it shouldn't know, and that a new branch or type didn't require editing many unrelated places. Don't add interfaces, factories or layers for flexibility nobody needs yet.

If the fix would be a larger refactor than the change itself, report it instead of doing it.

## 5. Best practices for the languages and tools in the diff

Find out what the changed files use: the language, the frameworks, and the project's own setup (`package.json` scripts, `tsconfig`, linter and formatter configs, `pyproject.toml`, `Cargo.toml`, etc.).

- The project's existing conventions come first. Match the style of the surrounding file and the codebase over any general rule.
- Then the language and framework idioms: use the standard library and platform APIs the project already relies on, follow the type system instead of fighting it, and use the framework's intended patterns.
- Look for the usual pitfalls of that stack: unhandled promises, resource leaks, mutable shared state, injection through string-built queries or shell commands, and blocking calls on hot paths.

## 6. Verify

Run whatever checks the project has for the changed code: typecheck, linter, tests. Fix anything your changes broke. If a check fails for reasons that predate your changes, say so rather than fixing unrelated code.

Don't commit or push.

## 7. Report

Keep it short and plain. Use this structure, and leave out sections with nothing in them:

```
**Fixed** - one line per review finding fixed (file:line, what was wrong)
**Cleaned up** - slop removed, duplication reused, best-practice changes
**Skipped** - findings judged not real, with one line why
**Needs your call** - issues with a design decision attached, with the options
**Checks** - what ran (typecheck, tests, lint) and the result; anything you couldn't run
```
