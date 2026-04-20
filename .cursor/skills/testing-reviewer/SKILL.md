---
name: testing-reviewer
description: Review test quality and identify missing, weak, or brittle test coverage for changed code.
---

# Testing Reviewer

Use this skill after code changes or before merge.

## What To Check

- Missing tests for new behavior.
- Missing negative/edge-case tests.
- Assertions too weak to catch regressions.
- Tests coupled to implementation details.
- Flaky tests (timing/order/shared state dependence).

## Test Expectations

- Verify behavior, not internals.
- Include happy path + failure path.
- Cover validation boundaries and auth/permission cases.
- Prefer deterministic setup and cleanup.
- Keep tests small and explicit.

## Output Format

Return:
1. Coverage gaps (ordered by impact).
2. Suggested test cases (concise, actionable).
3. Risk summary if tests stay as-is.

## Project Context

- Backend tests: auth/session, API contracts, route guards.
- Frontend tests: user flows, form validation, error states, rendering behavior.
