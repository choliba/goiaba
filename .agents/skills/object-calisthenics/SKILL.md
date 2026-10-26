---
name: object-calisthenics
description: Apply Object Calisthenics — Jeff Bay's 9 constraint-based rules for better OO/TS design (one indentation level per method, no else, wrap primitives, first-class collections, one dot per line, no abbreviations, small classes/files, max two instance fields, no getters/setters) — adapted to this repo's TypeScript style. Use when writing or reviewing non-trivial domain logic, when a function/class is getting hard to follow, when asked to refactor for readability/testability, or when someone asks what "object calisthenics" means here. Not a `bun run check` gate — a discipline to apply deliberately, not an automated lint rule.
argument-hint: 'The file/function you want reviewed or refactored, or empty to just read the rules.'
user-invocable: true
disable-model-invocation: false
---

# Object Calisthenics

Nine rules from Jeff Bay's original exercise (via
[devdojo-it/workshop-object-calisthenics](https://github.com/devdojo-it/workshop-object-calisthenics)), restated
for this codebase's actual style: mostly functions, interfaces and small modules, not classes with instance
state. They exist to **train judgment**, not to pass automatically — nothing here is wired into `bun run check`
(see the `quality-gates` skill for what is). Apply them on purpose when writing or reviewing logic that will be
read and changed often; do not chase all nine on a one-line script.

## The 9 rules, adapted to TypeScript

| # | Rule (original) | What it means here |
|---|---|---|
| 1 | One level of indentation per method | One level of nesting per function. A second `if`/`for` inside a block means extract a function or return early — see `agent-loader.ts`'s `fail()` helper and `agent-validation.ts`'s early `return` guards for the pattern already in use. |
| 2 | Don't use `else` | Guard clauses and early `return`/`throw` instead of `if/else` chains. Ternaries for a single value are fine; a ternary that hides a second branch of logic is not. |
| 3 | Wrap all primitives and strings | A bare `string`/`number` that carries meaning (an agent name, a tag name, a path) becomes a named type or a validating function at the boundary, not a naked primitive passed around — e.g. `isValidAgentName`/`NAME_PATTERN` in `agent-loader.ts`, not a raw string trusted everywhere. |
| 4 | First-class collections | An array with its own rules (dedup, sort order, "must not be empty") gets a function that owns those rules next to it, instead of every caller re-implementing them — e.g. `listAppFiles`/`parseInstructionSections`'s grouping-into-array logic in `commands/agent.ts`, not inline `.push`/`.sort` scattered at each call site. |
| 5 | One dot per line | No `a.b.c.d` chains reaching into another object's internals (Law of Demeter). One property/method access per expression; if you need the third level down, that's a missing method on the middle object. |
| 6 | Don't abbreviate | `agentsDir`, not `aDir`; `resolveTicketContext`, not `rslvTktCtx`. This repo already does this — keep it that way in Portuguese prose and English identifiers alike. |
| 7 | Keep all entities small | A function that needs `offset`/`limit` comments to stay readable is too long — split it. As a rough ceiling: a function over ~30 lines or a file over ~200 lines is a signal to look for a seam, not a hard limit to enforce mechanically. |
| 8 | No more than two instance variables per class | Rare here since most logic is functions/modules, not classes — when a class or a config object *does* accumulate fields, two-plus that all vary together is a sign it should split into two smaller collaborators instead of one that does two jobs. |
| 9 | No getters/setters/properties | Tell, don't ask. Prefer a function that performs the behavior (`validateAgentYaml(text)`) over exposing raw state for the caller to inspect and branch on. A plain data-carrying `interface` (like `AgentDefinition`) is fine — it's not hiding behavior behind an accessor, it *is* the data. |

## When to apply this

- **Reviewing a PR or writing new domain logic** (validation, parsing, anything with real branching) — read the
  function against this table before calling it done.
- **A function is hard to follow** — work through rules 1, 2 and 7 first; they catch most of the actual pain.
- **Not** for one-off scripts, test fixtures, or glue code whose whole job is to call one library function.
- Conflicts with an existing house rule lose to the house rule — e.g. this repo's own conventions in `AGENTS.md`
  and the `quality-gates` skill (no `any`, strict TypeScript) always win over calisthenics phrasing.

## Related

`quality-gates` — the mechanically enforced gates (`bun run check`). This skill is a complement, not an
overlap: calisthenics is about *shape* (readability, cohesion), quality-gates is about *correctness and typing*.
