# @mwalkersigma/stagehand — Skill Spec

Stagehand is a TypeScript CLI framework for building predictable, idempotent
scripts that orchestrate multi-stage, multi-step command processors. It provides
a fluent builder API with typed flags, a compensation (rollback) system,
a typed error registry, shell access via execa, and incremental terminal
task rendering via tasuku v3.

## Domains

| Domain | Description | Skills |
| --- | --- | --- |
| app-setup | Bootstrapping a Stagehand CLI application and configuring its appearance | scaffold-cli-app, theming-and-output |
| processor-authoring | Defining processors, stages, steps, errors, shared state, and artifacts | define-processor, compensation-and-rollback |
| migration | Converting existing scripts into Stagehand processors | migrate-from-bash |

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
| --- | --- | --- | --- | --- |
| scaffold-cli-app | core | app-setup | ScriptApp, .command(), typed flags, .meta(), .theme(), parseAsync() | 3 |
| define-processor | core | processor-authoring | ProcessorBuilder chain, stages, steps, parallel, sequential, collapse, artifacts, error registry, shared state, finalize | 5 |
| compensation-and-rollback | core | processor-authoring | CompensationPolicy, compensate() handlers, reverse-order execution, step atomicity, effect kinds, failure diagnosis | 4 |
| migrate-from-bash | lifecycle | migration | Bash-to-Stagehand conversion, 1:1 command mapping, stage/step organization, fs/Node API replacement, error/compensation wiring | 4 |
| theming-and-output | core | app-setup | ScriptTheme, colors, headerStyle, stageStyle, stepStyle, collapseLevel, ctx.setTaskTitle/setTaskOutput/setTaskStatus, TasukuReporter, text formatting utilities | 3 |

## Failure Mode Inventory

### scaffold-cli-app (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Forgetting to call parseAsync() | HIGH | source: appScript.ts | — |
| 2 | Using program.opts() instead of typed flags from handler | MEDIUM | source: types.ts, appScript.ts | — |
| 3 | Defining options on program instead of subcommand | HIGH | source: appScript.ts | — |

### define-processor (5 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Throwing raw Error instead of using error registry | CRITICAL | maintainer interview | compensation-and-rollback |
| 2 | Putting too much logic in a single step | CRITICAL | maintainer interview | compensation-and-rollback, migrate-from-bash |
| 3 | Calling build() before createShared() or finalize() | HIGH | source: processorBuilder.ts | — |
| 4 | Wrong builder chain order | HIGH | source: processorBuilder.ts | — |
| 5 | Using task.group() instead of direct task() nesting | MEDIUM | AGENT.md execution model | — |

### compensation-and-rollback (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Not providing compensate() for non-read effects | CRITICAL | maintainer interview | define-processor |
| 2 | Using compensation kind 'none' for create/update/delete effects | CRITICAL | source: processor.ts | define-processor |
| 3 | Writing non-idempotent compensation handlers | HIGH | source: processor.ts | — |
| 4 | Missing required compensator causes CompensationFailure | HIGH | source: processor.ts | — |

### migrate-from-bash (4 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Paraphrasing commands instead of copying them 1:1 | CRITICAL | maintainer interview | — |
| 2 | Collapsing multiple bash commands into one step | CRITICAL | maintainer interview | define-processor |
| 3 | Not wiring compensation for side-effecting commands | HIGH | maintainer interview | compensation-and-rollback |
| 4 | Replacing shell commands when they should be preserved | MEDIUM | maintainer interview | — |

### theming-and-output (3 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
| --- | --- | --- | --- | --- |
| 1 | Passing color strings instead of formatter functions | HIGH | source: types.ts | — |
| 2 | Calling ctx.setTaskOutput() without a bound taskApi | MEDIUM | source: executionContext.ts | define-processor |
| 3 | Using hardcoded ANSI codes instead of theme color functions | MEDIUM | source: textFormatting.ts, consts.ts | — |

## Tensions

| Tension | Skills | Agent implication |
| --- | --- | --- |
| Step granularity vs. verbosity | define-processor ↔ compensation-and-rollback | An agent optimizing for fewer lines of code puts too much in one step, making rollback impossible. An agent optimizing for atomicity creates so many steps the processor becomes unreadable. |
| Command fidelity vs. idiomatic TypeScript | migrate-from-bash ↔ define-processor | An agent migrating from bash may rewrite shell commands into TypeScript idioms (losing fidelity), or it may preserve every command verbatim when fs/Bun APIs would be more reliable. |
| Theme customization vs. simplicity | scaffold-cli-app ↔ theming-and-output | An agent may over-configure theming when defaults suffice, or ignore theming entirely and produce bland output. |

## Cross-References

| From | To | Reason |
| --- | --- | --- |
| scaffold-cli-app | define-processor | After scaffolding the app, the developer defines processors inside command handlers |
| define-processor | compensation-and-rollback | Every non-read step should have compensation; understanding rollback informs step design |
| compensation-and-rollback | define-processor | Compensation design depends on step granularity and effect declarations |
| migrate-from-bash | define-processor | Migration produces processors; understanding the builder API is required |
| migrate-from-bash | compensation-and-rollback | Side-effecting bash commands need compensation wiring during migration |
| theming-and-output | scaffold-cli-app | Theme is configured on the ScriptApp before commands are defined |
| define-processor | theming-and-output | Step callbacks use ctx.setTaskTitle/setTaskOutput/setTaskStatus for in-flight feedback |

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
| --- | --- | --- |
| scaffold-cli-app | — | — |
| define-processor | — | StepEffectKind values, CompensationPolicyKind values, CollapseLevel values |
| compensation-and-rollback | — | — |
| migrate-from-bash | — | — |
| theming-and-output | — | ScriptTheme color properties (13 color functions + gradient tuple), format tokens |

## Remaining Gaps

All gaps were resolved during the maintainer interview.

## Recommended Skill File Structure

- **Core skills:** scaffold-cli-app, define-processor, compensation-and-rollback, theming-and-output
- **Framework skills:** None (framework-agnostic)
- **Lifecycle skills:** migrate-from-bash
- **Composition skills:** None (no peer dependencies or required companion libraries)
- **Reference files:** define-processor (effect kinds, compensation policies, collapse levels), theming-and-output (color properties, format tokens)

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
| --- | --- | --- |
| tasuku | TasukuReporter wraps tasuku/theme/claude; task() calls for rendering | No — fully encapsulated by the framework |
| commander | ScriptApp wraps Commander for CLI parsing | No — fully encapsulated by the framework |
| execa | ExecaShell wraps execa for command execution | No — fully encapsulated by the framework |