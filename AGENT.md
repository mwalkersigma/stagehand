# Script Framework — Agent Context

## Project Overview

This is a **TypeScript CLI script framework** that orchestrates multi-stage, multi-step command processors with typed flags, error registries, compensation (rollback), and tasuku-powered terminal task rendering.

**Runtime:** Bun (uses `bun:test` for testing, `@types/bun` in devDependencies)
**Module system:** ESNext modules (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
**Strict TypeScript:** `strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`

## File Structure

```
Script Framework/
├── main.ts                          # Entry point — imports examples/build.ts
├── package.json
├── tsconfig.json
├── AGENT.md                         # This file
├── examples/
│   └── build.ts                     # Example CLI app using the framework
├── __tests__/
│   ├── helpers.ts                   # Shared test mock utilities
│   ├── typeTests.ts                 # Compile-time type assertions
│   ├── processor.test.ts            # Processor execution tests
│   ├── processorBuilder.test.ts     # ProcessorBuilder API tests
│   ├── registeredErrors.test.ts     # Error registry tests
│   └── executionContext.test.ts     # ExecutionContext tests
└── modules/
    ├── consts.ts                    # DEFAULT_THEME constant
    ├── errors.ts                    # FrameworkError class
    ├── shell.ts                     # Shell interface + ExecaShell (wraps execa)
    ├── textFormatting.ts            # ANSI text formatting utilities (Bold, colors, gradients)
    ├── types.ts                     # All core type definitions
    └── classes/
        ├── appScript.ts             # ScriptApp — CLI app builder (commander integration)
        ├── executionContext.ts       # ExecutionContext — passed to step/stage callbacks
        ├── processEnvironment.ts    # ProcessEnvironment — env variable + command lookup
        ├── processor.ts             # Processor — runs stages/steps via tasuku task tree
        ├── processorBuilder.ts      # ProcessorBuilder — fluent builder for Processor
        ├── RegisteredErrors.ts      # RegisteredErrors — typed error registry
        ├── stageBuilder.ts          # StageBuilder — fluent builder for stages
        └── tasukuReporter.ts        # TasukuReporter — tasuku integration + header printing
```

## Key Architecture

### Execution Model (tasuku v3)

The processor builds a **task tree** using tasuku v3's automatic nesting detection.
Stages are run sequentially using direct `task()` calls in a `for` loop.
Inside each stage callback, steps are individual `task()` calls that v3 auto-nests
under the parent stage. This gives incremental rendering — each stage and step
appears in the terminal as soon as it starts.

#### Sequential stages with sequential steps

```ts
// Stages run sequentially in a for loop
for (const stage of stages) {
  await task(stage.title, async ({ setStatus }) => {
    // Each step is awaited → runs one after another
    await task("Check Node", async (stepApi) => { ... });
    await task("Check Bun", async (stepApi) => { ... });
    setStatus('complete');
  });
}
```

#### Parallel steps within a stage

```ts
await task("Install", async ({ setStatus }) => {
  // Steps fired WITHOUT await → run in parallel
  // v3 auto-nests them under the parent stage
  task("npm install", async (stepApi) => { ... })
  task("Copy assets", async (stepApi) => { ... })
  setStatus('complete');
});
```

The processor collects the `TaskPromise` values from parallel steps and uses
`Promise.allSettled` to gather artifacts and handle per-step failures, but the
tasks themselves start immediately when `task()` is called.

#### Collapse behavior

Collapse uses the `.clear()` method on task promises:

- **`'stage'` collapse** — `.clear()` on the stage `TaskPromise`. Hides the entire stage including all children after completion. Pattern: `await task('Stage', ...).clear()`
- **`'tasks'` collapse** — `.clear()` on each individual step `TaskPromise`. Pattern: `task('Step', ...).clear()` inside the stage callback
- **`'none'`** — everything stays visible.

Collapse level is resolved per-stage with the priority:
`stage.collapseLevel → runtime.flags.collapseLevel → theme.collapseLevel`

#### Inner API usage

The stage callback destructures `TaskInnerAPI` methods:

```ts
await task(stage.title, async ({ setStatus, setError }) => {
  try {
    // ... run steps ...
    setStatus('complete');
  } catch (error) {
    setError(error instanceof Error ? error : String(error));
    throw error;
  }
});
```

Step callbacks receive their own `TaskInnerAPI` via `ctx.withTask(stepApi)`,
so step code can call `ctx.task.setTitle()`, `ctx.task.setStatus()`,
`ctx.task.setOutput()`, `ctx.task.setError()`, `ctx.task.setWarning()`, etc.

### Core Classes

#### `Processor<TInput, TShared, TFlags, TRegistry, TResult, TStages>`
- Entry point: `processor.run(input, runtime, meta)`
- Returns `ProcessorResult<TResult>` — either `{ ok: true, value }` or `{ ok: false, error, compensationFailures }`
- Uses direct `runtime.reporter.task()` calls for stages and steps (no `task.group` for stages)
- Handles compensation (rollback) on failure by walking executed steps in reverse
- Resolves collapse level per-stage and applies `.clear()` accordingly

#### `ProcessorBuilder`
- Fluent API: `.errors()` → `.createShared()` → `.stage()` → `.finalize()` → `.build()`
- Each method returns a new builder with updated generics (immutable chain)
- `.stage(id, title, configure)` takes a callback that receives a `StageBuilder`

#### `StageBuilder`
- Fluent API: `.step()` → `.step()` → `.parallel()` → `.collapse()` → `.buildArtifact()` → `.done()`
- `.parallel(options?)` marks the stage for parallel step execution
- `.collapse(level)` sets the stage-specific collapse level
- `.step({id, title, effect, compensation, run, when?, compensate?})` adds a step

#### `ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>`
- Passed to every step's `run()`, `when()`, and `compensate()` callbacks
- Properties: `input`, `shared`, `runtime`, `errors`, `task` (StepTaskContext)
- Methods: `getStepArtifact(stageId, stepId)`, `getStageArtifact(stageId)`, `fail(code)`, `$(command, args)`, `isDryRun()`, `info()`, `withTask(taskApi)`
- `ctx.task` exposes tasuku controls: `run()`, `group()`, `setTitle()`, `setStatus()`, `setOutput()`, `setError()`, `setWarning()`, `streamPreview()`, `startTime()`, `stopTime()`

#### `TasukuReporter`
- `reporter.task` — the themed tasuku `Task` function (from `tasuku/theme/claude`)
- `reporter.printHeader({ title, meta })` — prints the processor header box and metadata

#### `RegisteredErrors<TRegistry>`
- Wraps an `ErrorRegistryInput` (e.g. `{ BUILD_ERROR: "Build failed" }`)
- `.create(code, overrideMessage?, cause?)` — instantiates a typed error

### Key Types (from `modules/types.ts`)

```ts
// Runtime passed to processors — contains shell, logger, env, flags, reporter, theme
type Runtime<TFlags> = {
  shell: Shell;
  log: Logger;
  env: Environment;
  flags: TFlags;
  reporter: TasukuReporter;
  theme: ScriptTheme;
}

// ScriptTheme — colors are ANSI formatter functions (text: string) => string
interface ScriptTheme {
  collapseLevel: CollapseLevel;               // 'stage' | 'tasks' | 'none'
  colors: {
    primary: (text: string) => string;
    secondary: (text: string) => string;
    accent: (text: string) => string;
    warning: (text: string) => string;
    error: (text: string) => string;
    info: (text: string) => string;
    debug: (text: string) => string;
    success: (text: string) => string;
    dimmed: (text: string) => string;
    primaryBackground: (text: string) => string;
    secondaryBackground: (text: string) => string;
    accentBackground: (text: string) => string;
    gradient: [string, string];
  };
  headerStyle: HeaderStyle;                    // 'simple' | 'fancy'
  stageStyle: { formatString: TokenFormatString; color: (text: string) => string };
  stepStyle: { formatString: TokenFormatString };
}

// Processor result — discriminated union
type ProcessorResult<TResult> =
  | { ok: true;  value: TResult; completedStages: string[]; completedSteps: string[] }
  | { ok: false; error: unknown; completedStages: string[]; completedSteps: string[]; compensationFailures: CompensationFailure[] }

// Step definition
interface StepDefinition<TId, TInput, TShared, TFlags, TRegistry, TArtifact, TStages> {
  id: TId;
  title: string;
  effect: StepEffectKind;              // 'read' | 'create' | 'update' | 'delete' | 'external'
  compensation: CompensationPolicy;     // { kind: 'none' | 'best-effort' | 'required' }
  when?: (ctx: ExecutionContext<...>) => Awaitable<boolean>;
  run: (ctx: ExecutionContext<...>) => Promise<StepRunResult<TArtifact>>;
  compensate?: (ctx: ExecutionContext<...>, artifact: TArtifact) => Promise<void>;
}

// Stage definition
interface StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages> {
  id: TStageId;
  title: string;
  collapseLevel?: CollapseLevel;
  parallel?: ParallelStageOptions;      // truthy = parallel execution
  steps: TSteps;
  buildArtifact?: (ctx) => Awaitable<TStageArtifact>;
  compensate?: (ctx, artifact) => Promise<void>;
}
```

### Text Formatting (`modules/textFormatting.ts`)

Provides ANSI escape-code helpers that are TTY-aware (pass through plain text when not in a TTY):

- `Bold(text)`, `Italic(text)` — style modifiers
- `green(text)`, `red(text)`, `blue(text)`, `yellow(text)`, `white(text)`, `lightGray(text)`, `darkGray(text)` — foreground colors
- `greenBackground(text)`, `redBackground(text)`, `blueBackground(text)`, `yellowBackground(text)`, `grayBackground(text)` — background colors
- `GradientText(text, startHexColor, endHexColor)` — per-character RGB gradient
- `blueEdges(text)` — wraps text in blue pipe characters

All color properties in `ScriptTheme.colors` are functions with signature `(text: string) => string` that use these utilities.

## Testing with bun:test

### Running Tests

```bash
bun test                          # Run all tests
bun test __tests__/someFile.ts    # Run specific test file
bun test --watch                  # Watch mode
```

### Test File Convention

Place test files in `__tests__/` directory with `.test.ts` extension.

### Mocking Strategy

Test mocks are centralized in `__tests__/helpers.ts`. The helpers provide:

1. **`createMockTaskInnerAPI()`** — returns a `TaskInnerAPI` with all bun mock functions
2. **`createMockTask()`** — returns a `MockTaskFn` that:
   - Calls the callback immediately with a mock `TaskInnerAPI`
   - Returns a `TaskPromise`-like object with `.clear()` (also a mock)
   - Tracks all calls via `.calls` array of `{ title, innerApi }` pairs
   - Has a `.group` method for any custom usage in step callbacks
3. **`createMockReporter()`** — returns `{ reporter, mockTask }`
4. **`createMockRuntime<TFlags>(flags, overrides?)`** — returns `Runtime<TFlags> & { mockTask: MockTaskFn }`

```ts
import { createMockRuntime } from "./helpers";

const runtime = createMockRuntime({ dryRun: false });
// runtime.mockTask.calls — array of { title, innerApi } for assertion
// runtime.reporter.printHeader — mock function
// runtime.shell.run / .capture / .noop — mock functions
// runtime.log.debug / .info / .warn / .error — mock functions
```

### Example Test Patterns

#### Testing Processor execution order

```ts
import { describe, test, expect } from "bun:test";
import { ProcessorBuilder } from "../modules/classes/processorBuilder";
import { createMockRuntime } from "./helpers";

describe("Processor", () => {
  test("runs stages sequentially in order", async () => {
    const executionOrder: string[] = [];

    const processor = new ProcessorBuilder<void, { started: boolean }, { dryRun: boolean }, {}, void, {}>({
      id: "test-proc",
      title: "Test Processor",
    })
      .createShared(async () => ({ started: true }))
      .stage("stage-a", "Stage A", (s) =>
        s.step({
          id: "step-1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            executionOrder.push("stage-a:step-1");
            return { artifact: null };
          },
        })
      )
      .stage("stage-b", "Stage B", (s) =>
        s.step({
          id: "step-2",
          title: "Step 2",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            executionOrder.push("stage-b:step-2");
            return { artifact: null };
          },
        })
      )
      .finalize(async () => executionOrder)
      .build();

    const runtime = createMockRuntime({ dryRun: false });
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["stage-a:step-1", "stage-b:step-2"]);
      expect(result.completedStages).toEqual(["stage-a", "stage-b"]);
    }
  });
});
```

#### Testing parallel stage execution

```ts
test("parallel stage runs steps in parallel", async () => {
  const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
    id: "parallel-proc",
    title: "Parallel Processor",
  })
    .createShared(async () => ({}))
    .stage("parallel-stage", "Parallel Stage", (s) =>
      s
        .parallel()
        .step({
          id: "p-step-1",
          title: "Parallel Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: "result-1" }),
        })
        .step({
          id: "p-step-2",
          title: "Parallel Step 2",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: "result-2" }),
        })
    )
    .finalize(async (ctx) => ({
      r1: ctx.getStepArtifact("parallel-stage", "p-step-1"),
      r2: ctx.getStepArtifact("parallel-stage", "p-step-2"),
    }))
    .build();

  const runtime = createMockRuntime({});
  const result = await processor.run(undefined as void, runtime);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual({ r1: "result-1", r2: "result-2" });
  }
});
```

#### Testing compensation on failure

```ts
test("compensates executed steps on failure", async () => {
  const compensated: string[] = [];

  const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
    id: "comp-proc",
    title: "Compensation Processor",
  })
    .createShared(async () => ({}))
    .stage("stage-a", "Stage A", (s) =>
      s
        .step({
          id: "ok-step",
          title: "OK Step",
          effect: "create",
          compensation: { kind: "best-effort" },
          run: async () => ({ artifact: "created-thing" }),
          compensate: async (_ctx, artifact) => {
            compensated.push(`compensated:${artifact}`);
          },
        })
        .step({
          id: "fail-step",
          title: "Failing Step",
          effect: "create",
          compensation: { kind: "none" },
          run: async () => {
            throw new Error("boom");
          },
        })
    )
    .finalize(async () => {})
    .build();

  const runtime = createMockRuntime({});
  const result = await processor.run(undefined as void, runtime);

  expect(result.ok).toBe(false);
  expect(compensated).toEqual(["compensated:created-thing"]);
});
```

#### Testing `when` guards

```ts
test("skips steps where when() returns false", async () => {
  const ran: string[] = [];

  const processor = new ProcessorBuilder<void, {}, { skipSecond: boolean }, {}, void, {}>({
    id: "when-proc",
    title: "When Processor",
  })
    .createShared(async () => ({}))
    .stage("s", "Stage", (s) =>
      s
        .step({
          id: "always",
          title: "Always runs",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => { ran.push("always"); return { artifact: null }; },
        })
        .step({
          id: "conditional",
          title: "Conditional",
          effect: "read",
          compensation: { kind: "none" },
          when: (ctx) => !ctx.runtime.flags.skipSecond,
          run: async () => { ran.push("conditional"); return { artifact: null }; },
        })
    )
    .finalize(async () => ran)
    .build();

  const runtime = createMockRuntime({ skipSecond: true });
  const result = await processor.run(undefined as void, runtime);

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value).toEqual(["always"]);
  }
});
```

#### Testing inner API usage (setStatus, setError)

```ts
test("stage calls setStatus on success and setError on failure", async () => {
  // The mock task function passes TaskInnerAPI to each stage callback.
  // After running, you can inspect the mock calls on the inner API to verify
  // setStatus('complete') was called on success, or setError(...) on failure.
  // The processor handles this automatically — no user code needed.
});
```

#### Testing collapse behavior

```ts
test("stage-level collapse calls clear() on stage task promise", async () => {
  const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
    id: "collapse-proc",
    title: "Collapse Processor",
  })
    .createShared(async () => ({}))
    .stage("s", "Stage", (s) =>
      s
        .collapse('stage')
        .step({
          id: "step-1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: null }),
        })
    )
    .finalize(async () => {})
    .build();

  const runtime = createMockRuntime({});
  await processor.run(undefined as void, runtime);

  // Verify that clear() was called on the stage task promise
  // by inspecting runtime.mockTask.calls for the stage entry
});
```

### Important Testing Notes

1. **Always mock tasuku** — the real tasuku requires a TTY for rendering. Tests run without a TTY, so always use a mock reporter with a mock `task` function.

2. **Mock `task()` must return a `.clear()`-able promise** — the processor calls `.clear()` on stage and step `TaskPromise` objects for collapse. The mock returns an object with `.clear()` that returns itself (chainable).

3. **ProcessorBuilder generics** — when creating a builder in tests, you often need to supply explicit type parameters to match the `TFlags` shape: `new ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TResult, TStages>(...)`.

4. **Artifact access** — `ctx.getStepArtifact(stageId, stepId)` throws `FrameworkError` if the artifact hasn't been set. Test both the happy path and missing-artifact error cases.

5. **`StepRunResult` shape** — every step `run()` must return `{ artifact: T }`. The framework destructures `.artifact` from the result.

6. **Compensation order** — steps are compensated in **reverse** execution order. Stages are compensated in reverse after all step compensations.

7. **The `when` guard** — returning `false` skips the step. Returning `undefined` (no guard) means the step runs. Only an explicit `false` skips.

8. **Parallel step errors** — when multiple parallel steps fail, the processor throws a `FrameworkError` wrapping an `AggregateError` with all individual failures.

9. **ScriptTheme colors are functions** — all color properties in `ScriptTheme.colors` are `(text: string) => string`. In test mocks, use identity functions: `(t: string) => t`.

10. **Test helpers are in `__tests__/helpers.ts`** — All mock utilities (`createMockRuntime`, `createMockTask`, `createMockTaskInnerAPI`, `createMockReporter`) are in the shared helpers file. Import from there instead of inlining mocks.

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `tasuku` | `3.0.0-beta.5` | Terminal task rendering (themed via `tasuku/theme/claude`) |
| `commander` | `^14.0.3` | CLI argument parsing |
| `@commander-js/extra-typings` | `^14.0.0` | Typed Commander integration |
| `execa` | `^9.6.1` | Shell command execution |
| `@types/bun` | `^1.3.11` | Bun runtime types |
| `@types/node` | `^25.5.0` | Node.js types |