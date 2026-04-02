<div align="center">

# 🎭 Stagehand

**A typed, multi-stage CLI script framework**

Orchestrate complex command-line workflows with sequential & parallel stages, typed error registries, automatic compensation (rollback), and beautiful terminal task rendering powered by [tasuku](https://github.com/privatenumber/tasuku).

[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square)](https://bun.sh)
[![Language: TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

</div>

---

## Table of Contents

- [Why Stagehand?](#why-stagehand)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [ScriptApp](#scriptapp)
  - [ProcessorBuilder](#processorbuilder)
  - [Stages & Steps](#stages--steps)
  - [ExecutionContext](#executioncontext)
  - [Error Registry](#error-registry)
  - [Compensation (Rollback)](#compensation-rollback)
  - [Collapse Behavior](#collapse-behavior)
  - [Theming](#theming)
- [API Reference](#api-reference)
  - [ScriptApp](#scriptapp-api)
  - [ProcessorBuilder](#processorbuilder-api)
  - [StageBuilder](#stagebuilder-api)
  - [ExecutionContext](#executioncontext-api)
  - [RegisteredErrors](#registerederrors-api)
  - [Runtime](#runtime)
  - [Shell](#shell)
  - [Text Formatting](#text-formatting)
- [Examples](#examples)
  - [Minimal Processor](#minimal-processor)
  - [Parallel Steps](#parallel-steps)
  - [Compensation on Failure](#compensation-on-failure)
  - [Conditional Steps with `when`](#conditional-steps-with-when)
  - [Full CLI Application](#full-cli-application)
- [Testing](#testing)
- [License](#license)

---

## Why Stagehand?

Building CLI tools that run multi-step workflows (builds, deployments, migrations) usually means wiring together a mess of sequential async calls, try/catch blocks, and ad-hoc cleanup logic. **Stagehand** gives you:

- **Declarative stage → step pipelines** with a fluent builder API
- **Full TypeScript inference** — step artifacts, error codes, flag shapes, and stage IDs are all statically typed end-to-end
- **Automatic compensation** — if step 5 fails, steps 4 → 3 → 2 → 1 are rolled back in reverse order
- **Parallel & sequential execution** — mark any stage as parallel and its steps run concurrently
- **Beautiful terminal output** — tasuku v3 renders a live task tree with spinners, status, and collapsible groups
- **Typed error registries** — define error codes once, throw them anywhere with `ctx.fail('CODE')`
- **Theming** — fully customizable ANSI colors, gradients, header styles, and collapse defaults

---

## Installation

```sh
bun add @mwalkersigma/stagehand
or
npm install @mwalkersigma/stagehand
```

**Peer dependencies** (installed automatically with Bun):

| Package | Purpose |
|---------|---------|
| [`tasuku`](https://github.com/nickcis/tasuku) `^3.0.0-beta.5` | Terminal task rendering |
| [`commander`](https://github.com/tj/commander.js) `^14.x` | CLI argument parsing |
| [`@commander-js/extra-typings`](https://github.com/tj/commander.js) `^14.x` | Typed Commander integration |
| [`execa`](https://github.com/sindresorhus/execa) `^9.x` | Shell command execution |

---

## Quick Start

```ts
// cli.ts
import { ScriptApp } from "stagehand/classes/appScript";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp("my-tool")
  .meta({ version: "1.0.0", author: "You" })
  .command({
    name: "build",
    description: "Compile the project",
    build: (cmd) =>
      cmd.addOption(
        new Option("-d, --dry-run", "Run without making changes").default(false)
      ),
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "build", title: "Build" })
        .errors({ COMPILE_FAILED: "Compilation failed" })
        .createShared(async () => ({ startedAt: Date.now() }))
        .stage("compile", "Compile Source", (s) =>
          s.step({
            id: "tsc",
            title: "Run TypeScript compiler",
            effect: "create",
            compensation: { kind: "best-effort" },
            run: async (ctx) => {
              const result = await ctx.$("tsc", ["--build"]);
              return { artifact: result };
            },
            compensate: async (ctx) => {
              await ctx.$("rm", ["-rf", "dist"]);
            },
          })
        )
        .finalize(async (ctx) => ({
          output: ctx.getStepArtifact("compile", "tsc"),
        }))
        .build(),
  })
  .parseAsync();
```

```sh
bun run cli.ts build
bun run cli.ts build --dry-run
```

---

## Core Concepts

### ScriptApp

`ScriptApp` is the top-level CLI application builder. It wraps [Commander](https://github.com/tj/commander.js) and provides a fluent API for registering subcommands, each backed by a **Processor**.

```ts
new ScriptApp("my-app")
  .meta({ version: "2.0.0" })        // attach metadata (printed in header)
  .theme(myCustomTheme)               // override the default theme
  .command({ ... })                   // register a subcommand
  .command({ ... })                   // register another
  .parseAsync();                      // parse argv and run
```

Each `.command()` call receives a `handler` that defines a processor pipeline. Stagehand creates the `Runtime` (shell, logger, environment, flags, reporter, theme) and passes it through automatically.

---

### ProcessorBuilder

The `ProcessorBuilder` is the heart of Stagehand. It uses a **fluent, immutable builder pattern** where each method returns a new builder instance with updated generic type parameters — giving you full type inference at every step of the chain.

```ts
defineProcessor({ id: "deploy", title: "Deploy" })
  .errors({ ... })              // 1. Register typed error codes
  .createShared(async () => {}) // 2. Create shared state
  .stage("a", "Stage A", ...)   // 3. Add stages (repeatable)
  .stage("b", "Stage B", ...)
  .finalize(async (ctx) => {})  // 4. Produce final result
  .build();                     // 5. Build the Processor
```

**Required chain order:** `.createShared()` → `.stage()` (1+) → `.finalize()` → `.build()`

`.errors()` is optional and can be called at any point before `.build()` but early in the chain is recommended.

---

### Stages & Steps

A **Processor** is composed of **stages**, and each stage contains **steps**.

| Concept | Description |
|---------|-------------|
| **Stage** | A logical grouping of work (e.g., "Check Environment", "Build", "Deploy"). Stages always run **sequentially**. |
| **Step** | An individual unit of work within a stage. Steps run **sequentially by default**, or **in parallel** if the stage is marked `.parallel()`. |

```ts
.stage("install", "Install Dependencies", (s) =>
  s
    .parallel()                         // steps in this stage run concurrently
    .collapse("tasks")                  // collapse step output after completion
    .step({
      id: "npm",
      title: "npm install",
      effect: "create",
      compensation: { kind: "best-effort" },
      run: async (ctx) => {
        await ctx.$("npm", ["install"]);
        return { artifact: "node_modules" };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$("rm", ["-rf", artifact]);
      },
    })
    .step({
      id: "assets",
      title: "Copy assets",
      effect: "create",
      compensation: { kind: "none" },
      run: async (ctx) => {
        await ctx.$("cp", ["-r", "assets/", "dist/assets/"]);
        return { artifact: null };
      },
    })
)
```

#### Step Definition Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier within the stage |
| `title` | `string` | ✅ | Display title in the terminal |
| `effect` | `StepEffectKind` | ✅ | Side-effect declaration: `'read'`, `'create'`, `'update'`, `'delete'`, or `'external'` |
| `compensation` | `CompensationPolicy` | ✅ | `{ kind: 'none' \| 'best-effort' \| 'required' }` |
| `run` | `(ctx) => Promise<{ artifact: T }>` | ✅ | Main step logic — must return `{ artifact }` |
| `when` | `(ctx) => Awaitable<boolean>` | ❌ | Guard — return `false` to skip this step |
| `compensate` | `(ctx, artifact) => Promise<void>` | ❌ | Rollback logic — receives the artifact from `run` |

---

### ExecutionContext

Every step callback (`run`, `when`, `compensate`) and the `finalize` handler receive an `ExecutionContext`. It's your single point of access to input, shared state, runtime services, error creation, artifact retrieval, shell execution, and tasuku task controls.

```ts
run: async (ctx) => {
  // Access shared state
  const config = ctx.shared.config;

  // Execute shell commands (respects dry-run automatically)
  const result = await ctx.$("node", ["--version"]);

  // Update the terminal task display
  ctx.setTaskTitle("Compiling...");
  ctx.setTaskOutput(`Node ${result.stdout}`);

  // Access flags
  if (ctx.runtime.flags.verbose) {
    await ctx.info("Extra details here");
  }

  // Retrieve an artifact from a previous stage/step
  const prevResult = ctx.getStepArtifact("prev-stage", "prev-step");

  // Throw a typed error
  if (somethingWrong) ctx.fail("COMPILE_FAILED");

  return { artifact: { output: "dist/" } };
}
```

---

### Error Registry

Define your error codes up front and get full type safety when throwing them:

```ts
.errors({
  BUILD_FAILED: "Build failed",                          // shorthand: string message
  DEPLOY_FAILED: {                                       // expanded: custom error class
    type: DeployError,
    message: "Deployment failed",
  },
})
```

Then in any step:

```ts
// Throws a FrameworkError with code "BUILD_FAILED"
ctx.fail("BUILD_FAILED");

// With an override message
ctx.fail("BUILD_FAILED", "Build failed: missing tsconfig.json");

// With a cause
ctx.fail("BUILD_FAILED", undefined, originalError);

// Or create without throwing
const error = ctx.errors.create("BUILD_FAILED");
```

Only registered codes are allowed — TypeScript will error on typos.

---

### Compensation (Rollback)

Stagehand implements the **saga pattern** for automatic rollback. When a step fails, all previously completed steps that have a `compensate` handler are called in **reverse execution order**.

```ts
.step({
  id: "create-db",
  title: "Create database",
  effect: "create",
  compensation: { kind: "required" },  // framework enforces compensation exists
  run: async (ctx) => {
    const dbId = await createDatabase();
    return { artifact: dbId };          // artifact is passed to compensate()
  },
  compensate: async (ctx, dbId) => {
    await deleteDatabase(dbId);         // clean up on failure
  },
})
```

**Compensation policies:**

| Policy | Behavior |
|--------|----------|
| `{ kind: 'none' }` | No compensation needed (read-only steps) |
| `{ kind: 'best-effort' }` | Compensation runs if available; failures are logged but don't halt rollback |
| `{ kind: 'required' }` | Compensation must be defined; failures are collected in the result |

The `ProcessorResult` on failure includes a `compensationFailures` array so you can report which rollbacks succeeded or failed.

---

### Collapse Behavior

Stagehand supports three collapse levels that control how completed tasks appear in the terminal:

| Level | Behavior |
|-------|----------|
| `'stage'` | The entire stage (including all steps) is hidden after completion |
| `'tasks'` | Individual step lines are hidden, but the stage line remains |
| `'none'` | Everything stays visible |

**Resolution priority** (first defined wins):

1. `stage.collapseLevel` — set via `.collapse()` on the `StageBuilder`
2. `runtime.flags.collapseLevel` — passed as a CLI flag
3. `theme.collapseLevel` — the theme default

```ts
// Per-stage override
.stage("install", "Install", (s) =>
  s.collapse("stage")  // hide entire stage after completion
    .step({ ... })
)
```

---

### Theming

Stagehand ships with a default theme, but every aspect is customizable:

```ts
import { Bold, green, blue, GradientText } from "stagehand/textFormatting";

new ScriptApp("my-app")
  .theme({
    collapseLevel: "tasks",
    headerStyle: "fancy",             // 'fancy' (bordered box) or 'simple'
    colors: {
      primary: blue,
      secondary: white,
      accent: green,
      warning: yellow,
      error: red,
      info: blue,
      debug: darkGray,
      success: green,
      dimmed: darkGray,
      primaryBackground: blueBackground,
      secondaryBackground: grayBackground,
      accentBackground: greenBackground,
      gradient: ["#00FFFF", "#FF00FF"],
    },
    stageStyle: {
      formatString: "$stage: $message",
      color: blue,
    },
    stepStyle: {
      formatString: "$step: $message",
    },
  })
```

All `colors` properties are functions with signature `(text: string) => string`. The `gradient` tuple defines start and end hex colors for `GradientText`.

---

## API Reference

### ScriptApp API

```ts
class ScriptApp<TTheme, TCommandFlags, TMeta>
```

| Method | Returns | Description |
|--------|---------|-------------|
| `new ScriptApp(name)` | `ScriptApp` | Create a new CLI application |
| `.meta(data)` | `ScriptApp` | Merge metadata (displayed in processor header) |
| `.theme(theme)` | `ScriptApp` | Deep-merge a custom theme onto the default |
| `.command(definition)` | `ScriptApp` | Register a subcommand with a processor |
| `.parse(argv?)` | `this` | Synchronously parse CLI arguments |
| `.parseAsync(argv?)` | `Promise<this>` | Asynchronously parse CLI arguments |
| `.getFlags(commandName)` | `TFlags` | Retrieve parsed flags for a registered command |

---

### ProcessorBuilder API

```ts
class ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TResult, TStages>
```

| Method | Returns | Description |
|--------|---------|-------------|
| `new ProcessorBuilder({ id, title })` | `ProcessorBuilder` | Create a new builder |
| `.errors(registry)` | `ProcessorBuilder` | Register a typed error registry |
| `.createShared(handler)` | `ProcessorBuilder` | Define shared state factory |
| `.stage(id, title, configure)` | `ProcessorBuilder` | Add a stage via `StageBuilder` callback |
| `.finalize(handler)` | `ProcessorBuilder` | Set the finalization handler |
| `.build()` | `Processor` | Validate and build the processor |

---

### StageBuilder API

```ts
class StageBuilder<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact>
```

| Method | Returns | Description |
|--------|---------|-------------|
| `.step(definition)` | `StageBuilder` | Append a step to the stage |
| `.parallel(options?)` | `this` | Mark the stage for parallel step execution |
| `.collapse(level)` | `this` | Set the per-stage collapse level |
| `.buildArtifact(handler)` | `this` | Define a stage-level artifact builder |
| `.compensate(handler)` | `this` | Define stage-level compensation |
| `.done()` | `StageDefinition` | Finalize and return the stage definition |

> **Note:** `.done()` is called internally by `ProcessorBuilder.stage()` — you don't need to call it yourself.

---

### ExecutionContext API

```ts
class ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `input` | `TInput` | Original processor input |
| `shared` | `TShared` | Shared state from `createShared()` |
| `runtime` | `Runtime<TFlags>` | Shell, logger, env, flags, reporter, theme |
| `errors` | `RegisteredErrors<TRegistry>` | Typed error registry |
| `task` | `StepTaskContext` | Tasuku task controls for the current step |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `$()` | `(cmd, args?, opts?) → Promise<ShellResult>` | Run a shell command (no-ops in dry-run mode) |
| `isDryRun()` | `() → boolean` | Check if `--dry-run` is active |
| `fail()` | `(code, message?, cause?) → never` | Throw a typed error from the registry |
| `info()` | `(message, ids?) → Promise<void>` | Log an info message |
| `getStepArtifact()` | `(stageId, stepId) → TArtifact` | Retrieve a step's artifact (throws if missing) |
| `hasStepArtifact()` | `(stageId, stepId) → boolean` | Check if a step artifact exists |
| `getStageArtifact()` | `(stageId) → TArtifact` | Retrieve a stage's artifact (throws if missing) |
| `hasStageArtifact()` | `(stageId) → boolean` | Check if a stage artifact exists |
| `setTaskTitle()` | `(title) → void` | Update the current task's title |
| `setTaskStatus()` | `(status?) → void` | Set the task status text |
| `setTaskOutput()` | `(output) → void` | Set output text below the task |
| `setTaskError()` | `(error?) → void` | Display an error on the task |
| `setTaskWarning()` | `(warning?) → void` | Display a warning on the task |
| `withTask()` | `(taskApi?) → ExecutionContext` | Clone context with a different tasuku task API |

---

### RegisteredErrors API

```ts
class RegisteredErrors<TRegistry extends ErrorRegistryInput>
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `new RegisteredErrors(input)` | — | Normalize the error registry |
| `.create(code, overrideMessage?, cause?)` | `FrameworkError` | Create a typed error instance |

**`FrameworkError`** extends `Error` with:
- `code?: string` — the error registry key
- `cause?: unknown` — the underlying error (for chaining)

---

### Runtime

The `Runtime<TFlags>` object is available at `ctx.runtime` and provides all framework services:

| Property | Type | Description |
|----------|------|-------------|
| `shell` | `Shell` | Execute shell commands (`run`, `capture`, `noop`) |
| `log` | `Logger` | Structured logging (`debug`, `info`, `warn`, `error`) |
| `env` | `Environment` | Environment variable access + command detection |
| `flags` | `TFlags` | Parsed CLI flags for the current command |
| `reporter` | `TasukuReporter` | Task renderer and header printer |
| `theme` | `ScriptTheme` | Active color/style theme |

---

### Shell

The `Shell` interface provides three methods for command execution:

| Method | Returns | Description |
|--------|---------|-------------|
| `run(cmd, args?, opts?)` | `Promise<ShellResult>` | Execute a command and return full result |
| `capture(cmd, args?, opts?)` | `Promise<string>` | Execute a command and return stdout |
| `noop(cmd, args?)` | `Promise<ShellResult>` | Return a no-op result (empty output, exit code 0) |

`ShellResult` shape:

```ts
interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

The default `ExecaShell` implementation wraps [`execa`](https://github.com/sindresorhus/execa). Use `ctx.$()` in step callbacks for dry-run–aware shell access.

---

### Text Formatting

Stagehand includes TTY-aware ANSI formatting utilities. When `stdout` is not a TTY, all functions pass through plain text.

#### Style Modifiers

| Function | Description |
|----------|-------------|
| `Bold(text)` | **Bold** text |
| `Italic(text)` | *Italic* text |

#### Foreground Colors

`green` · `red` · `blue` · `yellow` · `white` · `lightGray` · `darkGray`

#### Background Colors

`greenBackground` · `redBackground` · `blueBackground` · `yellowBackground` · `grayBackground`

#### Special

| Function | Description |
|----------|-------------|
| `GradientText(text, startHex, endHex)` | Per-character RGB gradient |
| `blueEdges(text)` | Wraps text in blue pipe characters |

---

## Examples

### Minimal Processor

The simplest possible processor — one stage, one step, no errors:

```ts
defineProcessor({ id: "hello", title: "Hello" })
  .createShared(async () => ({}))
  .stage("greet", "Greet", (s) =>
    s.step({
      id: "say-hi",
      title: "Say hello",
      effect: "read",
      compensation: { kind: "none" },
      run: async (ctx) => {
        ctx.setTaskOutput("Hello, world!");
        return { artifact: "hello" };
      },
    })
  )
  .finalize(async (ctx) => ctx.getStepArtifact("greet", "say-hi"))
  .build();
```

---

### Parallel Steps

Mark a stage as `.parallel()` and all steps within it run concurrently:

```ts
.stage("checks", "Environment Checks", (s) =>
  s
    .parallel()
    .step({
      id: "node",
      title: "Check Node",
      effect: "read",
      compensation: { kind: "none" },
      run: async (ctx) => {
        const v = await ctx.$("node", ["--version"]);
        return { artifact: v.stdout.trim() };
      },
    })
    .step({
      id: "bun",
      title: "Check Bun",
      effect: "read",
      compensation: { kind: "none" },
      run: async (ctx) => {
        const v = await ctx.$("bun", ["--version"]);
        return { artifact: v.stdout.trim() };
      },
    })
)
```

If multiple parallel steps fail, the processor wraps all failures in an `AggregateError`.

---

### Compensation on Failure

Steps with compensation handlers are rolled back in reverse order when a later step fails:

```ts
.stage("deploy", "Deploy", (s) =>
  s
    .step({
      id: "upload",
      title: "Upload artifacts",
      effect: "create",
      compensation: { kind: "required" },
      run: async (ctx) => {
        const url = await uploadToS3();
        return { artifact: { url } };
      },
      compensate: async (ctx, { url }) => {
        await deleteFromS3(url);  // rollback: remove uploaded file
      },
    })
    .step({
      id: "activate",
      title: "Activate release",
      effect: "external",
      compensation: { kind: "none" },
      run: async (ctx) => {
        throw new Error("Activation failed!");
        // ↑ "upload" step will be compensated automatically
      },
    })
)
```

The result object tells you exactly what happened:

```ts
const result = await processor.run(input, runtime);

if (!result.ok) {
  console.error("Failed:", result.error);
  console.log("Completed stages:", result.completedStages);
  console.log("Completed steps:", result.completedSteps);
  console.log("Compensation failures:", result.compensationFailures);
}
```

---

### Conditional Steps with `when`

Use the `when` guard to conditionally skip steps based on flags, environment, or prior artifacts:

```ts
.step({
  id: "install",
  title: "Install dependencies",
  effect: "create",
  compensation: { kind: "best-effort" },
  when: (ctx) => !ctx.runtime.flags.noInstall,  // skip with --no-install
  run: async (ctx) => {
    await ctx.$("npm", ["ci"]);
    return { artifact: null };
  },
})
.step({
  id: "seed-db",
  title: "Seed database",
  effect: "create",
  compensation: { kind: "none" },
  when: async (ctx) => {
    // async guards are supported too
    return ctx.runtime.env.get("SEED_DB") === "true";
  },
  run: async (ctx) => {
    await ctx.$("node", ["scripts/seed.js"]);
    return { artifact: null };
  },
})
```

Returning `false` from `when` skips the step entirely. Omitting `when` means the step always runs.

---

### Full CLI Application

```ts
import { ScriptApp } from "stagehand/classes/appScript";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp("deploy-tool")
  .meta({
    company: "Acme Corp",
    author: "Jane Doe",
    version: "2.1.0",
  })
  .command({
    name: "deploy",
    description: "Deploy the application to production",
    build: (cmd) =>
      cmd
        .addOption(
          new Option("-d, --dry-run", "Preview without making changes").default(false)
        )
        .addOption(
          new Option("-e, --environment <env>", "Target environment")
            .choices(["staging", "production"] as const)
            .default("staging" as const)
        )
        .option("--no-backup", "Skip database backup"),
    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: "deploy",
        title: "Production Deploy",
      })
        .errors({
          ENV_CHECK_FAILED: "Environment check failed",
          BUILD_FAILED: "Build step failed",
          DEPLOY_FAILED: "Deployment failed",
        })
        .createShared(async (input, runtime) => ({
          startedAt: Date.now(),
          environment: runtime.flags.environment,
        }))
        .stage("validate", "Validate Environment", (s) =>
          s
            .parallel()
            .collapse("tasks")
            .step({
              id: "check-node",
              title: "Check Node.js",
              effect: "read",
              compensation: { kind: "none" },
              run: async (ctx) => {
                const version = await ctx.runtime.shell.capture("node", ["--version"]);
                ctx.setTaskOutput(`Node ${version.trim()}`);
                return { artifact: version.trim() };
              },
            })
            .step({
              id: "check-aws",
              title: "Check AWS CLI",
              effect: "read",
              compensation: { kind: "none" },
              run: async (ctx) => {
                const hasAws = await ctx.runtime.env.hasCommand("aws");
                if (!hasAws) ctx.fail("ENV_CHECK_FAILED", "AWS CLI not found");
                return { artifact: true };
              },
            })
        )
        .stage("build", "Build Application", (s) =>
          s
            .step({
              id: "compile",
              title: "Compile TypeScript",
              effect: "create",
              compensation: { kind: "best-effort" },
              run: async (ctx) => {
                await ctx.$("bun", ["run", "build"]);
                ctx.setTaskOutput("Build complete");
                return { artifact: "dist/" };
              },
              compensate: async (ctx) => {
                await ctx.$("rm", ["-rf", "dist"]);
              },
            })
        )
        .stage("deploy", "Deploy to Environment", (s) =>
          s
            .step({
              id: "backup-db",
              title: "Backup database",
              effect: "external",
              compensation: { kind: "none" },
              when: (ctx) => ctx.runtime.flags.backup !== false,
              run: async (ctx) => {
                await ctx.$("pg_dump", ["-f", "backup.sql"]);
                return { artifact: "backup.sql" };
              },
            })
            .step({
              id: "push",
              title: "Push to servers",
              effect: "external",
              compensation: { kind: "required" },
              run: async (ctx) => {
                const env = ctx.shared.environment;
                await ctx.$("aws", ["s3", "sync", "dist/", `s3://app-${env}/`]);
                ctx.setTaskOutput(`Deployed to ${env}`);
                return { artifact: env };
              },
              compensate: async (ctx, env) => {
                await ctx.$("aws", ["s3", "rm", `s3://app-${env}/`, "--recursive"]);
              },
            })
        )
        .finalize(async (ctx) => ({
          environment: ctx.shared.environment,
          nodeVersion: ctx.getStepArtifact("validate", "check-node"),
          deployedAt: new Date().toISOString(),
        }))
        .build(),
  })
  .parseAsync();
```

---

## Testing

Stagehand uses [`bun:test`](https://bun.sh/docs/cli/test) for testing. Test utilities are provided in `__tests__/helpers.ts`.

### Running Tests

```sh
bun test                             # Run all tests
bun test __tests__/processor.test.ts # Run a specific test file
bun test --watch                     # Watch mode
```

### Mock Utilities

Since tasuku requires a TTY for rendering, all tests must use mock reporters:

```ts
import { describe, test, expect } from "bun:test";
import { createMockRuntime } from "./__tests__/helpers";
import { ProcessorBuilder } from "stagehand/classes/processorBuilder";

describe("My Processor", () => {
  test("runs stages in order", async () => {
    const order: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, string[], {}>({
      id: "test",
      title: "Test",
    })
      .createShared(async () => ({}))
      .stage("a", "Stage A", (s) =>
        s.step({
          id: "s1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            order.push("a");
            return { artifact: null };
          },
        })
      )
      .stage("b", "Stage B", (s) =>
        s.step({
          id: "s2",
          title: "Step 2",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            order.push("b");
            return { artifact: null };
          },
        })
      )
      .finalize(async () => order)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["a", "b"]);
    }
  });
});
```

### Available Mock Helpers

| Helper | Description |
|--------|-------------|
| `createMockRuntime(flags, overrides?)` | Full mock `Runtime` with mock task, shell, logger, env |
| `createMockTask()` | Mock tasuku `task` function that tracks calls |
| `createMockTaskInnerAPI()` | Mock `TaskInnerAPI` with all bun mock functions |
| `createMockReporter()` | Mock `TasukuReporter` with mock task and header printer |

---

## License

ISC
