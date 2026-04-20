---
name: api-contract-checker
description: Check and align frontend/backend API contracts. Use when adding/changing endpoints, request/response DTOs, validation, auth requirements, or error formats.
---

# API Contract Checker

Use this skill whenever API behavior changes or when frontend/backend integration issues appear.

## Goals

- Prevent contract drift between backend and frontend.
- Detect breaking API changes early.
- Keep validation, auth, and error formats consistent.

## Contract Checklist

For each changed endpoint, verify all items:

1. Route and method
   - Path and HTTP method are unchanged or intentionally versioned.
   - Query/path/body parameter names and types match docs and consumers.

2. Auth and security
   - Required auth/session behavior is explicit.
   - CSRF requirements are explicit for mutating methods.
   - Permission/role requirements are documented.

3. Request DTO
   - Required vs optional fields are clear.
   - Validation constraints are clear (min/max, enum, format).
   - Defaults and coercion rules are explicit.

4. Response DTO
   - Success shape is stable and typed.
   - Error shape is stable and typed.
   - Nullability/empty states are explicit.

5. Behavior and semantics
   - Status codes are documented and consistent.
   - Pagination/filter/sort semantics are documented.
   - Backward compatibility impact is called out.

## Required Outputs

When asked to run this skill, return:

1. `Contract changes`: endpoint-by-endpoint diff summary.
2. `Breaking risks`: concrete consumer breakages (frontend/tests/integrations).
3. `Alignment actions`: exact backend/frontend/doc/test updates needed.
4. `Final check`: pass/fail with unresolved gaps.

## Project-Specific Alignment

- Keep recommendations aligned with `cursor.md`, `SPEC.md`, and current `taskN.md`.
- Use English identifiers and schema keys.
- Keep user-facing error text in Russian where product requires it.
- Do not propose infrastructure changes conflicting with project constraints.

## Practical Rules

- Prefer additive changes over breaking changes.
- If breaking change is required, require explicit migration note:
  - old behavior
  - new behavior
  - impacted consumers
  - rollout plan
- Ensure tests cover both happy path and failure path for contract changes.
