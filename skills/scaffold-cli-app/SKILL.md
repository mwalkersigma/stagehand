---
name: scaffold-cli-app
description: >-
  ScriptApp constructor, .command() with CommandDefinition, typed CLI flags via
  @commander-js/extra-typings Option and addOption, .meta() header metadata,
  .theme() with ScriptTheme, parseAsync() entry-point wiring, handler factory
  pattern with defineProcessor.
type: core
library: "@mwalkersigma/stagehand"
library_version: "1.0.0"
sources:
  - modules/classes/appScript.ts
  - modules/types.ts
  - modules/consts.ts
  - examples/build.ts
---

# Scaffold a Stagehand CLI App

## Setup

Every Stagehand app needs these peer dependencies:

```jsonc
// package.json (relevant fields)
{
  "dependencies": {
    "@mwalkersigma/stagehand": "^1.0.0",
    "@commander-js/extra-typings": "^14.0.0",
    "commander": "^14.0.3"
  },
  "devDependencies": {
    "@types/bun": "^1.3.11",
    "typescript": "^5.8.3"
  }
}
```

Minimum `tsconfig.json` settings required by the framework:

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Runtime is **Bun**. Entry point is executed with `bun run main.ts <command>`.

---

## Core Patterns

### 1. Minimal CLI App

The smallest working Stagehand app: one command, one stage, one step, wired to `parseAsync()`.

```ts
// main.ts
import { ScriptApp } from "@mwalkersigma/stagehand";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp("my-tool")
  .meta({
    author: "Your Name",
    version: "1.0.0",
  })
  .command({
    name: "hello",
    description: "A minimal command",
    build: (cmd) => {
      return cmd.addOption(
        new Option("-n, --name <string>", "Who to greet").default(
          "World",
          "World"
        )
      );
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "hello-processor", title: "Hello Processor" })
        .createShared(async () => ({
          startedAt: new Date().toISOString(),
        }))
        .stage("greet", "Greet User", (stage) =>
          stage.step({
            id: "print-greeting",
            title: "Print greeting",
            effect: "read",
            compensation: { kind: "none" },
            run: async (ctx) => {
              const greeting = `Hello, ${ctx.runtime.flags.name}!`;
              ctx.setTaskOutput(greeting);
              return { artifact: { greeting } };
            },
          })
        )
        .finalize(async (ctx) => ({
          greeting: ctx.getStepArtifact("greet", "print-greeting").greeting,
        }))
        .build(),
  })
  .parseAsync();
```

Key points:
- `ScriptApp` constructor takes the CLI program name.
- `.command()` registers a subcommand. The `build` callback receives a bare `Command<[], {}>` and must return the command with options attached.
- `handler` receives `{ defineProcessor }` which returns a `ProcessorBuilder` pre-bound to the command's extracted flag types.
- `.parseAsync()` **must** be called and **must** be awaited. Without it the process exits silently.

### 2. Typed Flags with addOption

Use `@commander-js/extra-typings`'s `Option` class with `.addOption()` to get full type inference on flags. The `build` callback's return type flows through `ExtractCommandOpts<TBuiltCommand>` into every `ctx.runtime.flags` reference.

```ts
import { ScriptApp } from "@mwalkersigma/stagehand";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp("deployer")
  .command({
    name: "deploy",
    description: "Deploy the application",
    build: (cmd) => {
      return cmd
        .addOption(
          new Option("-d, --dry-run", "Run without making changes").default(
            false,
            "false"
          )
        )
        .addOption(
          new Option("-e, --env <environment>", "Target environment")
            .choices(["dev", "staging", "prod"] as const)
            .makeOptionMandatory()
        )
        .addOption(
          new Option("--no-cache", "Disable build cache")
        );
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "deploy-proc", title: "Deploy" })
        .createShared(async () => ({ timestamp: Date.now() }))
        .stage("validate", "Validate Environment", (stage) =>
          stage.step({
            id: "check-env",
            title: "Check target environment",
            effect: "read",
            compensation: { kind: "none" },
            run: async (ctx) => {
              // ctx.runtime.flags is fully typed:
              //   dryRun: boolean
              //   env: "dev" | "staging" | "prod"
              //   cache: boolean  (negatable --no-cache)
              const env = ctx.runtime.flags.env;
              ctx.setTaskOutput(`Deploying to ${env}`);
              return { artifact: { env } };
            },
          })
        )
        .finalize(async (ctx) => ({
          env: ctx.getStepArtifact("validate", "check-env").env,
        }))
        .build(),
  })
  .parseAsync();
```

The resulting `ctx.runtime.flags` type is inferred automatically:
- `.default(false, 'false')` on a boolean flag gives type `boolean` (not `boolean | undefined`).
- `.choices([...] as const)` narrows the type to the union of choices.
- `.makeOptionMandatory()` removes `undefined` from the type.
- `--no-cache` creates a negatable flag; the property name becomes `cache: boolean`.

### 3. Theme Configuration

The `.theme()` method accepts a partial `ScriptTheme`. It merges with the DEFAULT_THEME (blue/green/white palette, `'fancy'` header, `'none'` collapse). Every `colors` property is a function `(text: string) => string`, except `gradient` which is a `[string, string]` tuple of hex color codes.

```ts
import { ScriptApp } from "@mwalkersigma/stagehand";
import {
  green,
  blue,
  yellow,
  red,
  white,
  darkGray,
  lightGray,
  Bold,
  greenBackground,
  blueBackground,
  grayBackground,
  yellowBackground,
} from "@mwalkersigma/stagehand/textFormatting";

await new ScriptApp("themed-app")
  .theme({
    collapseLevel: "tasks",
    headerStyle: "fancy",
    colors: {
      primary: blue,
      secondary: white,
      accent: green,
      warning: yellow,
      error: red,
      info: blue,
      debug: darkGray,
      success: green,
      dimmed: lightGray,
      primaryBackground: blueBackground,
      secondaryBackground: grayBackground,
      accentBackground: greenBackground,
      gradient: ["#00FFFF", "#FF00FF"],
    },
    stageStyle: {
      formatString: "$stage: $message",
      color: (text: string) => Bold(blue(text)),
    },
    stepStyle: {
      formatString: "$step: $message",
    },
  })
  .command({
    name: "build",
    description: "Build the project",
    build: (cmd) => cmd,
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "build-proc", title: "Build" })
        .createShared(async () => ({}))
        .stage("compile", "Compile Source", (stage) =>
          stage.step({
            id: "run-tsc",
            title: "Run TypeScript compiler",
            effect: "create",
            compensation: { kind: "none" },
            run: async (ctx) => {
              await ctx.runtime.shell.run("tsc", ["--build"]);
              return { artifact: { compiled: true } };
            },
          })
        )
        .finalize(async () => ({ success: true }))
        .build(),
  })
  .parseAsync();
```

Key points:
- `collapseLevel` controls post-completion visibility: `'stage'` hides entire stages, `'tasks'` hides individual steps, `'none'` keeps everything visible.
- `headerStyle` is `'simple'` (plain text) or `'fancy'` (box-drawing characters with gradient).
- `stageStyle.formatString` and `stepStyle.formatString` use tokens: `$stage`, `$step`, `$message`, `$progress`, `$total`, `$elapsed`, `$remaining`, `$percent`.
- `.theme()` merges shallowly into `colors`, `stageStyle`, and `stepStyle` — you only need to provide the properties you want to override.

### 4. Multi-Command App with Metadata

A ScriptApp can register multiple commands. Each command gets its own processor with independently typed flags. The `.meta()` data is printed in the header and passed to every processor's `run()` as the third argument.

```ts
import { ScriptApp } from "@mwalkersigma/stagehand";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp("project-cli")
  .meta({
    company: "ACME Corp",
    author: "Jane Doe",
    version: "2.1.0",
  })
  .command({
    name: "build",
    description: "Compile the project",
    build: (cmd) => {
      return cmd.addOption(
        new Option("-d, --dry-run", "Skip actual compilation").default(
          false,
          "false"
        )
      );
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "build-proc", title: "Build Processor" })
        .createShared(async () => ({ startedAt: Date.now() }))
        .stage("compile", "Compile", (stage) =>
          stage.step({
            id: "tsc",
            title: "Run tsc",
            effect: "create",
            compensation: { kind: "none" },
            run: async (ctx) => {
              if (!ctx.runtime.flags.dryRun) {
                await ctx.runtime.shell.run("tsc", ["--build"]);
              }
              return { artifact: { skipped: ctx.runtime.flags.dryRun } };
            },
          })
        )
        .finalize(async (ctx) => ({
          skipped: ctx.getStepArtifact("compile", "tsc").skipped,
        }))
        .build(),
  })
  .command({
    name: "test",
    description: "Run the test suite",
    build: (cmd) => {
      return cmd.addOption(
        new Option("--coverage", "Collect coverage").default(false, "false")
      );
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "test-proc", title: "Test Processor" })
        .createShared(async () => ({}))
        .stage("run-tests", "Run Tests", (stage) =>
          stage.step({
            id: "bun-test",
            title: "Execute bun test",
            effect: "read",
            compensation: { kind: "none" },
            run: async (ctx) => {
              const args = ["test"];
              if (ctx.runtime.flags.coverage) {
                args.push("--coverage");
              }
              const output = await ctx.runtime.shell.capture("bun", args);
              ctx.setTaskOutput(output);
              return { artifact: { output } };
            },
          })
        )
        .finalize(async (ctx) => ({
          testOutput: ctx.getStepArtifact("run-tests", "bun-test").output,
        }))
        .build(),
  })
  .parseAsync();
```

Usage: `bun run main.ts build --dry-run` or `bun run main.ts test --coverage`.

---

## Common Mistakes

### 1. HIGH — Forgetting to call parseAsync at entry point

ScriptApp is constructed and commands are registered, but `parseAsync()` is never called. The process exits silently with no error.

Wrong:

```ts
// main.ts — BROKEN: nothing executes
const app = new ScriptApp("my-cli")
  .command({
    name: "build",
    description: "Build",
    build: (cmd) => cmd,
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "p", title: "P" })
        .createShared(async () => ({}))
        .stage("s", "S", (stage) =>
          stage.step({
            id: "x",
            title: "X",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: null }),
          })
        )
        .finalize(async () => ({}))
        .build(),
  });
// app.parseAsync() is never called — silent exit
```

Correct:

```ts
// main.ts — CORRECT: parseAsync is awaited
await new ScriptApp("my-cli")
  .command({
    name: "build",
    description: "Build",
    build: (cmd) => cmd,
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: "p", title: "P" })
        .createShared(async () => ({}))
        .stage("s", "S", (stage) =>
          stage.step({
            id: "x",
            title: "X",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: null }),
          })
        )
        .finalize(async () => ({}))
        .build(),
  })
  .parseAsync();
```

Source: `modules/classes/appScript.ts` — `parse()` / `parseAsync()` methods.

### 2. CRITICAL — Using plain Commander instead of extra-typings

Importing `Command` or `Option` from `'commander'` instead of `'@commander-js/extra-typings'` compiles without errors but loses all type inference on flags. The `ExtractCommandOpts` type in Stagehand relies on the generic signatures from `@commander-js/extra-typings`. With plain Commander, `ctx.runtime.flags` degrades to `Record<string, unknown>`.

Wrong:

```ts
import { Command, Option } from "commander";
```

Correct:

```ts
import { Command, Option } from "@commander-js/extra-typings";
```

Source: `modules/types.ts` — `ExtractCommandOpts` relies on extra-typings generics.

### 3. MEDIUM — Defining options inline instead of with addOption

Using Commander's `.option()` shorthand for flags that need defaults or are negatable can lose type narrowing. The `.addOption(new Option(...))` form lets you chain `.default()`, `.choices()`, `.makeOptionMandatory()`, and other modifiers that directly affect the inferred type.

Wrong — `dryRun` inferred as `true | undefined` instead of `boolean`:

```ts
build: (cmd) => cmd.option("-d, --dry-run", "Dry run")
```

Correct — `dryRun` inferred as `boolean`:

```ts
build: (cmd) =>
  cmd.addOption(
    new Option("-d, --dry-run", "Dry run").default(false, "false")
  )
```

Source: `examples/build.ts` — option definitions on the build command.

### 4. HIGH Tension: Type strictness vs. quick prototyping

Stagehand enforces type correctness on flags, errors, artifacts, and the builder chain. Agents skip the `errors()` call, use `any` for artifacts, or cast types to avoid compiler errors, defeating the framework's safety guarantees.

The builder chain is intentionally ordered: `.errors()` → `.createShared()` → `.stage()` → `.finalize()` → `.build()`. Each method returns a new builder type with updated generics. Skipping steps or using type assertions (`as any`) to bypass the chain removes the compile-time checks that prevent mismatched artifact access, missing shared state, and unregistered error codes.

See also: `skills/define-processor/SKILL.md` § Common Mistakes

---

## Cross-References

See also: `skills/define-processor/SKILL.md` — After scaffolding the app, define processors inside command handlers.

See also: `skills/theming-and-output/SKILL.md` — Theme configuration happens at the ScriptApp level via `.theme()`.