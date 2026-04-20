---
name: code-reviewer
description: Review code changes for correctness, regressions, security risks, maintainability, and missing tests.
---

# Code Reviewer

Use this skill when reviewing implemented changes, pull requests, or local diffs.

## Review Goals

- Find functional bugs and regressions first.
- Identify security and data-handling risks.
- Check architecture and maintainability issues.
- Validate test coverage for changed behavior.

## Review Process

1. Understand intent from `SPEC.md`, `task*.md`, and changed files.
2. Inspect full diff context (not only latest hunk).
3. List findings by severity:
   - `high`: data loss, auth/security, broken behavior
   - `medium`: logic edge cases, missing validation, risky assumptions
   - `low`: readability, naming, minor cleanups
4. For each finding include:
   - affected file/symbol
   - why this is a problem
   - concrete fix direction
5. If no findings, state "no critical issues found" and note residual risks.

## Project-Specific Constraints

- Respect host nginx only; no docker nginx suggestions.
- Respect session-cookie auth model used in project docs.
- Keep recommendations aligned with `cursor.md` and current task phase.
