---
name: spec-driven-workflow
description: Execute development strictly from SPEC.md and task files with phase discipline, verification, and session handoff notes.
---

# Spec-Driven Workflow

Use this skill for feature implementation, bugfixes, and phase execution in this repo.

## Source of Truth

- `cursor.md` for project constraints and engineering rules.
- `SPEC.md` for product behavior and phase progress.
- `task1.md` ... `task9.md` for step-by-step execution.

## Workflow

1. Identify active phase from `SPEC.md`.
2. Work only within current `taskN.md`.
3. Make minimal, scoped changes tied to checklist items.
4. Run verification commands relevant to changed area.
5. Update task checkboxes immediately after completion.
6. Add "next session note" before stopping.

## Hard Constraints

- Do not skip phases.
- Do not introduce architecture contradicting `cursor.md`.
- Use host nginx only; never add nginx docker service.
- Keep identifiers/comments in English; user-facing errors/logs may be Russian.

## Completion Criteria

Task step is complete only when:
- implementation is done,
- verification passed,
- docs/checklists are updated.
