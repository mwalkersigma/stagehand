---
name: define-processor
description: >
  Define multi-stage processors using ProcessorBuilder fluent chain. Activate when
  creating a new processor, wiring stages and steps, configuring error registries,
  shared state, parallel execution, collapse levels, step artifacts, stage artifacts,
  finalize handlers, or calling processor.run(). Covers ProcessorBuilder, StageBuilder,
  ExecutionContext, StepRunResult, CompensationPolicy, StepEffectKind, CollapseLevel.
type: core
library: "@mwalkersigma/stagehand"
library_version: "1.0.0"
sources:
  - "mwalkersigma/stagehand:modules/classes/processorBuilder.ts"
  - "mwalkersigma/stagehand:modules/classes/stageBuilder.ts"
  - "mwalkersigma/stagehand:modules/classes/processor.ts"
  - "mwalkersigma/stagehand:modules/classes/executionContext.ts"
  - "mwalkersigma/stagehand:modules/types.ts"
  - "mwalkersigma/stagehand:examples/build.ts"
---

# Define Processor

Build multi-stage, multi-step command processors using the `ProcessorBuilder` fluent chain.
Each method returns a new builder instance with updated generics — the chain is immutable.

## Setup

```ts
import { ProcessorBuilder } from "@mwalkersigma/stagehand/modules/classes/processorBuilder";

// Minimum viable processor — every chain MUST include createShared, at least one stage, and finalize.
const processor = new ProcessorBuilder<
  void,                          // TInput
  { startedAt: string },         // TShared
  { dryRun: boolean },           // TFlags
  {},                            // TRegistry (error codes)
  { message: string },           // TResult
  {}                             // TStages (accumulates as you add stages)
>({
  id: "my-processor",
  title: "My Processor",
})
  .createShared(async () => ({
    startedAt: new Date().toISOString(),
  }))
  .stage("setup", "Setup Environment", (s) =>
    s.step({
      id: "check-node",
      title: "Check Node version",
      effect: "read",
      compensation: { kind: "none" },
      run: async (ctx) => {
        const version = await ctx.runtime.shell.capture("node", ["--version"]);
        ctx.setTaskOutput(`Node: ${version}`);
        return { artifact: version };
      },
    })
  )
  .finalize(async (ctx) => ({
    message: `Done. Node: ${ctx.getStepArtifact("setup", "check-node")}`,
  }))
  .build();
```

## Core Patterns

### Builder Chain Order

The full chain is: `.errors()` → `.createShared()` → `.stage()` (repeatable) → `.finalize()` → `.build()`.
Only `.createShared()`, at least one `.stage()`, and `.finalize()` are required before `.build()`.
`.errors()` is optional — omit it when you have no typed error codes.

```ts
const processor = new ProcessorBuilder<void, {}, { verbose: boolean }, {}, void, {}>({
  id: "minimal",
  title: "Minimal Processor",
})
  .createShared(async () => ({}))
  .stage("only-stage", "Do Work", (s) =>
    s.step({
      id: "work",
      title: "Do the work",
      effect: "read",
      compensation: { kind: "none" },
      run: async () => ({ artifact: null }),
    })
  )
  .finalize(async () => {})
  .build();
```

### Error Registry and ctx.fail()

Register typed error codes with `.errors()`. Use `ctx.fail(code)` inside steps to throw
a typed `FrameworkError` — this halts execution and triggers compensation.

```ts
const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
  id: "with-errors",
  title: "Error-Aware Processor",
})
  .errors({
    DEPLOY_FAILED: "Deployment failed",
    ROLLBACK_FAILED: { type: FrameworkError, message: "Rollback could not complete" },
  })
  .createShared(async () => ({}))
  .stage("deploy", "Deploy Application", (s) =>
    s.step({
      id: "push",
      title: "Push to remote",
      effect: "external",
      compensation: { kind: "best-effort" },
      run: async (ctx) => {
        const result = await ctx.$("git", ["push", "origin", "main"]);
        if (result.exitCode !== 0) {
          ctx.fail("DEPLOY_FAILED", `Push exited with code ${result.exitCode}`);
        }
        return { artifact: { ref: "main" } };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$("git", ["push", "origin", "--delete", artifact.ref]);
      },
    })
  )
  .finalize(async () => {})
  .build();
```

### Parallel Stages with Artifact Collection

Call `.parallel()` on a stage builder to run its steps concurrently. Access individual
step artifacts in later stages or in `.finalize()` via `ctx.getStepArtifact(stageId, stepId)`.

```ts
const processor = new ProcessorBuilder<void, {}, {}, {}, { node: string; bun: string }, {}>({
  id: "parallel-check",
  title: "Parallel Checks",
})
  .createShared(async () => ({}))
  .stage("check-env", "Check Environment", (s) =>
    s
      .parallel()
      .collapse("tasks")
      .step({
        id: "check-node",
        title: "Check Node",
        effect: "read",
        compensation: { kind: "none" },
        run: async (ctx) => {
          const version = await ctx.runtime.shell.capture("node", ["--version"]);
          return { artifact: version };
        },
      })
      .step({
        id: "check-bun",
        title: "Check Bun",
        effect: "read",
        compensation: { kind: "none" },
        run: async (ctx) => {
          const version = await ctx.runtime.shell.capture("bun", ["--version"]);
          return { artifact: version };
        },
      })
  )
  .finalize(async (ctx) => ({
    node: ctx.getStepArtifact("check-env", "check-node"),
    bun: ctx.getStepArtifact("check-env", "check-bun"),
  }))
  .build();
```

### Multi-Stage with when Guards, Stage Artifacts, and Collapse

Stages can produce their own artifacts via `.buildArtifact()`. Steps can be conditionally
skipped via `when`. Collapse controls terminal output cleanup after completion.

```ts
const processor = new ProcessorBuilder<
  { target: string },
  { config: Record<string, string> },
  { dryRun: boolean; skipTests: boolean },
  { BUILD_ERROR: string },
  { deployedTo: string },
  {}
>({
  id: "full-deploy",
  title: "Full Deploy Pipeline",
})
  .errors({ BUILD_ERROR: "Build step failed" })
  .createShared(async (input, runtime) => {
    runtime.log.info(`Deploying to ${input.target}`);
    return { config: { target: input.target } };
  })
  .stage("build", "Build Application", (s) =>
    s
      .collapse("stage")
      .step({
        id: "compile",
        title: "Compile TypeScript",
        effect: "create",
        compensation: { kind: "best-effort" },
        run: async (ctx) => {
          const result = await ctx.$("tsc", ["--build"]);
          if (result.exitCode !== 0) {
            ctx.fail("BUILD_ERROR", result.stderr);
          }
          return { artifact: { outDir: "./dist" } };
        },
        compensate: async (ctx, artifact) => {
          await ctx.$("rm", ["-rf", artifact.outDir]);
        },
      })
      .step({
        id: "test",
        title: "Run Tests",
        effect: "read",
        compensation: { kind: "none" },
        when: (ctx) => !ctx.runtime.flags.skipTests,
        run: async (ctx) => {
          await ctx.$("bun", ["test"]);
          return { artifact: null };
        },
      })
      .buildArtifact(async (ctx) => ({
        outDir: ctx.getStepArtifact("build", "compile").outDir,
      }))
  )
  .stage("deploy", "Deploy to Target", (s) =>
    s
      .collapse("none")
      .step({
        id: "upload",
        title: "Upload artifacts",
        effect: "external",
        compensation: { kind: "required" },
        run: async (ctx) => {
          const buildArtifact = ctx.getStageArtifact<{ outDir: string }>("build");
          await ctx.$("rsync", ["-az", buildArtifact.outDir, ctx.shared.config.target]);
          return { artifact: { destination: ctx.shared.config.target } };
        },
        compensate: async (ctx, artifact) => {
          await ctx.$("ssh", [artifact.destination, "rollback"]);
        },
      })
  )
  .finalize(async (ctx) => ({
    deployedTo: ctx.getStepArtifact("deploy", "upload").destination,
  }))
  .build();
```

## Common Mistakes

### CRITICAL — Calling build() without createShared or finalize

Wrong:

```ts
const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
  id: "broken",
  title: "Broken",
})
  .stage("s", "Stage", (s) =>
    s.step({
      id: "step",
      title: "Step",
      effect: "read",
      compensation: { kind: "none" },
      run: async () => ({ artifact: null }),
    })
  )
  .build();
```

Correct:

```ts
const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
  id: "fixed",
  title: "Fixed",
})
  .createShared(async () => ({}))
  .stage("s", "Stage", (s) =>
    s.step({
      id: "step",
      title: "Step",
      effect: "read",
      compensation: { kind: "none" },
      run: async () => ({ artifact: null }),
    })
  )
  .finalize(async () => {})
  .build();
```

`ProcessorBuilder.build()` throws `FrameworkError('ProcessorBuilder requires createShared() before build()')` or `FrameworkError('ProcessorBuilder requires finalize() before build()')` at runtime if either is missing.

Source: modules/classes/processorBuilder.ts — `build()` method

### CRITICAL — Returning wrong shape from step run function

Wrong:

```ts
run: async (ctx) => {
  const version = await ctx.runtime.shell.capture("node", ["--version"]);
  return version;
}
```

Correct:

```ts
run: async (ctx) => {
  const version = await ctx.runtime.shell.capture("node", ["--version"]);
  return { artifact: version };
}
```

Every `run()` must return `{ artifact: T }`. The processor destructures `.artifact` from the result. Returning a plain value stores `undefined` as the artifact — `ctx.getStepArtifact()` will silently return `undefined` instead of the expected value.

Source: modules/types.ts — `StepRunResult<TArtifact>`

### HIGH — Using task.group() for stage orchestration instead of direct task() nesting

Wrong:

```ts
// Attempting to use task.group() for stages — this is not how the processor works
await task.group(task => stages.map(stage =>
  task(stage.title, async () => { /* ... */ })
));
```

Correct:

```ts
// Stages run sequentially via a for loop with direct task() calls.
// Steps auto-nest under the parent stage via tasuku v3 context detection.
for (const stage of stages) {
  await task(stage.title, async ({ setStatus }) => {
    await task("Step 1", async () => { /* ... */ });
    await task("Step 2", async () => { /* ... */ });
    setStatus("complete");
  });
}
```

The `Processor` class uses direct `task()` calls in a `for` loop for stages. Steps are individual `task()` calls inside the stage callback that tasuku v3 auto-nests. Do not use `task.group()` for stage-level orchestration — it changes concurrency and error-handling semantics.

Source: modules/classes/processor.ts — `run()` method

### HIGH — Putting too much logic in a single step

Wrong:

```ts
s.step({
  id: "setup-all",
  title: "Setup everything",
  effect: "create",
  compensation: { kind: "best-effort" },
  run: async (ctx) => {
    await ctx.$("npm", ["install"]);
    await ctx.$("npm", ["run", "build"]);
    await ctx.$("docker", ["build", "-t", "myapp", "."]);
    await ctx.$("docker", ["push", "myapp"]);
    return { artifact: { image: "myapp" } };
  },
  compensate: async (ctx, artifact) => {
    // Which operations succeeded? Can't partially roll back.
    await ctx.$("docker", ["rmi", artifact.image]);
  },
})
```

Correct:

```ts
s.step({
  id: "install",
  title: "Install dependencies",
  effect: "create",
  compensation: { kind: "best-effort" },
  run: async (ctx) => {
    await ctx.$("npm", ["install"]);
    return { artifact: { nodeModules: "./node_modules" } };
  },
  compensate: async (ctx, artifact) => {
    await ctx.$("rm", ["-rf", artifact.nodeModules]);
  },
})
.step({
  id: "build",
  title: "Build application",
  effect: "create",
  compensation: { kind: "best-effort" },
  run: async (ctx) => {
    await ctx.$("npm", ["run", "build"]);
    return { artifact: { outDir: "./dist" } };
  },
  compensate: async (ctx, artifact) => {
    await ctx.$("rm", ["-rf", artifact.outDir]);
  },
})
.step({
  id: "docker-push",
  title: "Build and push Docker image",
  effect: "external",
  compensation: { kind: "required" },
  run: async (ctx) => {
    await ctx.$("docker", ["build", "-t", "myapp", "."]);
    await ctx.$("docker", ["push", "myapp"]);
    return { artifact: { image: "myapp" } };
  },
  compensate: async (ctx, artifact) => {
    await ctx.$("docker", ["rmi", artifact.image]);
  },
})
```

Steps should be atomic — one logical operation each. Combining operations makes compensation impossible to reason about: if the third command fails, you cannot know which prior commands need rollback. Split into individual steps so each has a precise compensator.

Source: framework design — compensation model

### MEDIUM — Awaiting parallel steps individually (serializing them)

Wrong:

```ts
s.parallel().step({
  id: "a",
  title: "Step A",
  effect: "read",
  compensation: { kind: "none" },
  run: async (ctx) => {
    // If someone manually awaits inside the stage callback instead of letting
    // the processor fire tasks without await, steps run serially.
    return { artifact: null };
  },
})
```

The above step definition is fine on its own — the mistake happens when agents try to manually orchestrate parallel stages by writing their own `for` loop with `await` inside the stage callback. The `Processor` class handles parallelism automatically: when `stage.parallel` is truthy, it fires all step `task()` calls without individual `await` and collects results with `Promise.allSettled`. Call `.parallel()` on the `StageBuilder` and the processor does the rest.

Source: modules/classes/processor.ts — `runParallelSteps()`

### MEDIUM — Omitting effect kind on step definitions

Wrong:

```ts
s.step({
  id: "fetch-data",
  title: "Fetch data",
  // effect is missing — TypeScript will error but agents sometimes cast around it
  compensation: { kind: "none" },
  run: async () => ({ artifact: null }),
})
```

Correct:

```ts
s.step({
  id: "fetch-data",
  title: "Fetch data",
  effect: "read",
  compensation: { kind: "none" },
  run: async () => ({ artifact: null }),
})
```

Every step requires an `effect` field of type `StepEffectKind`: `'read'`, `'create'`, `'update'`, `'delete'`, or `'external'`. This drives compensation decisions — `'read'` steps typically use `{ kind: 'none' }` compensation, while `'create'`/`'delete'`/`'external'` steps should have compensators.

Source: modules/types.ts — `StepEffectKind`, `StepDefinition`

## Cross-References

- **skills/compensation-and-rollback/SKILL.md** — Every non-read step should have a compensation handler. Covers `CompensationPolicy`, reverse-order execution, `AggregateError` wrapping for parallel failures, and the `compensate` callback signature.
- **skills/scaffold-cli-app/SKILL.md** — Processors are wired to CLI commands via `ScriptApp.command()` and the `handler: ({ defineProcessor }) => ...` factory pattern. The factory preserves typed flags from Commander options through to the processor's `TFlags` generic.

## Tension Notes

1. **Step atomicity vs. implementation convenience** — Steps should be atomic (one operation each) for clean compensation, but agents tend to combine operations into a single step to reduce code. Prefer atomicity: the compensation model only works when each step artifact represents exactly one reversible action.

2. **Type strictness vs. quick prototyping** — The `ProcessorBuilder` enforces precise generics across the entire chain (`TInput`, `TShared`, `TFlags`, `TRegistry`, `TResult`, `TStages`). When prototyping, it is tempting to skip `.errors()` or use `{}` for all type parameters. This works for building, but weakens `ctx.fail()` type safety and `ctx.getStepArtifact()` inference. Start with explicit types — the compiler catches wiring mistakes at the stage/step boundary that are hard to debug at runtime.