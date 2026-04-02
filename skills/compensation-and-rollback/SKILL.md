---
name: compensation-and-rollback
description: >-
  CompensationPolicy kinds (none, best-effort, required), StepEffectKind to
  compensation mapping, writing compensate() handlers that use the artifact
  parameter, step atomicity principle, reverse-order compensation execution,
  stage-level compensate(), CompensationFailure tracking, ctx.fail() and the
  typed error registry, diagnosing what needs cleanup at any failure point.
type: core
library: '@mwalkersigma/stagehand'
library_version: '1.0.0'
requires:
  - define-processor
sources:
  - modules/classes/processor.ts
  - modules/classes/executionContext.ts
  - modules/classes/RegisteredErrors.ts
  - modules/errors.ts
  - modules/types.ts
---

# Compensation and Rollback

> **Dependency:** This skill builds on **define-processor**. You must understand
> the `ProcessorBuilder` chain, `StepDefinition` shape, `StageBuilder` API, and
> `ExecutionContext` before applying the patterns here. See
> `skills/define-processor/SKILL.md`.

## 1 — Key Types

### CompensationPolicy

```ts
type CompensationPolicyKind = 'none' | 'best-effort' | 'required';
type CompensationPolicy = { kind: CompensationPolicyKind };
```

| Kind | Meaning |
|------|---------|
| `'none'` | No side effects to undo. Processor skips this step during rollback. |
| `'best-effort'` | Calls `compensate()` if provided. If it throws, records a `CompensationFailure` and continues. |
| `'required'` | Must have `compensate()`. Missing handler → `CompensationFailure` with `FrameworkError`. Throwing handler → also recorded. |

### StepEffectKind → CompensationPolicy Mapping

```ts
type StepEffectKind = 'read' | 'create' | 'update' | 'delete' | 'external';
```

| Effect | Recommended Policy | Rationale |
|--------|--------------------|-----------|
| `'read'` | `{ kind: 'none' }` | No side effects to reverse. |
| `'create'` | `{ kind: 'best-effort' }` or `{ kind: 'required' }` | Must delete what was created. |
| `'update'` | `{ kind: 'best-effort' }` or `{ kind: 'required' }` | Must restore original state. |
| `'delete'` | `{ kind: 'required' }` | Destructive — if it can't be undone, fail loudly. |
| `'external'` | `{ kind: 'best-effort' }` | External API calls may not be reversible. |

### CompensationFailure & ProcessorResult

```ts
interface CompensationFailure {
  stageId: string;
  stepId?: string;   // absent for stage-level failures
  error: unknown;
}

type ProcessorResult<TResult> =
  | { ok: true;  value: TResult; completedStages: string[]; completedSteps: string[] }
  | { ok: false; error: unknown; completedStages: string[]; completedSteps: string[];
      compensationFailures: CompensationFailure[] };
```

When `ok` is `false`, always inspect `compensationFailures`. Empty array = all
rollback succeeded. Non-empty = manual cleanup required.

## 2 — How Compensation Executes

Source: `modules/classes/processor.ts` — `compensate()` method.

When any step throws during `processor.run()`:

1. The processor catches the error from the stage `task()` callback.
2. It walks **all previously executed steps** in **reverse** order.
3. For each step:
   - `kind === 'none'` → skip.
   - `compensate()` exists → call `compensate(ctx, artifact)`.
   - `compensate()` missing + `kind === 'required'` → record `CompensationFailure`.
   - `compensate()` throws → record `CompensationFailure`.
4. After step compensation, **stage-level** `compensate()` callbacks run in reverse stage order.
5. Returns `{ ok: false, error, completedStages, completedSteps, compensationFailures }`.

## 3 — Setup: Error Registry

Register error codes so you get typed `ctx.fail()` instead of raw `throw new Error()`.

```ts
const processor = new ProcessorBuilder<
  { targetDir: string }, { backupPath: string },
  { dryRun: boolean },
  { DEPLOY_FAILED: string; BACKUP_FAILED: string },
  void, {}
>({
  id: 'deploy-processor',
  title: 'Deploy Processor',
})
  .errors({
    DEPLOY_FAILED: 'Deployment failed',
    BACKUP_FAILED: 'Backup creation failed',
  })
  .createShared(async (input) => ({
    backupPath: `${input.targetDir}.backup-${Date.now()}`,
  }))
```

Using errors in step code:

```ts
ctx.fail('DEPLOY_FAILED');                        // throw FrameworkError with code
ctx.fail('DEPLOY_FAILED', 'Custom message');      // override message
ctx.fail('DEPLOY_FAILED', undefined, cause);      // with cause chain
const err = ctx.errors.create('DEPLOY_FAILED');   // create without throwing
```

## 4 — Core Patterns

### Pattern A: Step with Compensation Handler

Every `run()` returns `{ artifact: T }`. The `compensate()` callback receives that artifact.

```ts
.stage('deploy', 'Deploy Application', (s) =>
  s.step({
    id: 'copy-files',
    title: 'Copy build output to deploy directory',
    effect: 'create',
    compensation: { kind: 'best-effort' },
    run: async (ctx) => {
      const dest = ctx.input.targetDir;
      await ctx.$('cp', ['-r', 'dist/', dest]);
      return { artifact: { deployPath: dest } };
    },
    compensate: async (ctx, artifact) => {
      await ctx.$('rm', ['-rf', artifact.deployPath]);
    },
  })
)
```

### Pattern B: Required Compensation for Destructive Steps

Capture everything needed to restore original state in the artifact.

```ts
.stage('migrate', 'Database Migration', (s) =>
  s
    .step({
      id: 'backup-db',
      title: 'Create database backup',
      effect: 'create',
      compensation: { kind: 'best-effort' },
      run: async (ctx) => {
        const backupFile = `/tmp/db-backup-${Date.now()}.sql`;
        await ctx.$('pg_dump', ['-f', backupFile, 'mydb']);
        return { artifact: { backupFile } };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$('rm', ['-f', artifact.backupFile]);
      },
    })
    .step({
      id: 'run-migration',
      title: 'Apply migration scripts',
      effect: 'update',
      compensation: { kind: 'required' },
      run: async (ctx) => {
        const { backupFile } = ctx.getStepArtifact('migrate', 'backup-db');
        await ctx.$('psql', ['-f', 'migrations/001.sql', 'mydb']);
        return { artifact: { backupFile, appliedMigration: '001' } };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$('psql', ['-f', artifact.backupFile, 'mydb']);
      },
    })
)
```

### Pattern C: Read-Only Steps (No Compensation)

```ts
.step({
  id: 'check-disk',
  title: 'Verify disk space',
  effect: 'read',
  compensation: { kind: 'none' },
  run: async (ctx) => {
    const result = await ctx.$('df', ['-h', '/deploy']);
    return { artifact: { diskInfo: result.stdout } };
  },
})
```

### Pattern D: Stage-Level Compensation

Stages can have their own `compensate()` for aggregate cleanup, running after step-level compensation.

```ts
.stage('provision', 'Provision Infrastructure', (s) =>
  s
    .step({
      id: 'create-server',
      title: 'Create server instance',
      effect: 'create',
      compensation: { kind: 'required' },
      run: async (ctx) => {
        const serverId = 'srv-' + Date.now();
        await ctx.$('cloud', ['create', '--id', serverId]);
        return { artifact: { serverId } };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$('cloud', ['destroy', '--id', artifact.serverId]);
      },
    })
    .step({
      id: 'configure-dns',
      title: 'Configure DNS record',
      effect: 'external',
      compensation: { kind: 'best-effort' },
      run: async (ctx) => {
        const { serverId } = ctx.getStepArtifact('provision', 'create-server');
        await ctx.$('dns-cli', ['add', '--target', serverId]);
        return { artifact: { dnsRecord: `${serverId}.example.com` } };
      },
      compensate: async (ctx, artifact) => {
        await ctx.$('dns-cli', ['remove', '--record', artifact.dnsRecord]);
      },
    })
    .buildArtifact(async (ctx) => ({
      serverId: ctx.getStepArtifact('provision', 'create-server').serverId,
    }))
    .compensate(async (ctx, artifact) => {
      if (artifact) {
        ctx.runtime.log.info(`Stage cleanup for server ${artifact.serverId}`);
      }
    })
)
```

### Pattern E: Handling the Result

```ts
const result = await processor.run(input, runtime);

if (!result.ok) {
  console.error('Processor failed:', result.error);
  if (result.compensationFailures.length > 0) {
    console.error('Compensation failures — manual cleanup required:');
    for (const f of result.compensationFailures) {
      const loc = f.stepId ? `${f.stageId}.${f.stepId}` : f.stageId;
      console.error(`  ${loc}: ${f.error}`);
    }
  }
}
```

### Pattern F: Dry-Run Aware Compensation

```ts
.step({
  id: 'write-config',
  title: 'Write configuration file',
  effect: 'create',
  compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    const configPath = '/etc/myapp/config.json';
    if (ctx.isDryRun()) {
      ctx.runtime.log.info(`[dry-run] Would write ${configPath}`);
      return { artifact: { configPath, dryRun: true } };
    }
    await ctx.$('cp', ['config.json', configPath]);
    return { artifact: { configPath, dryRun: false } };
  },
  compensate: async (ctx, artifact) => {
    if (artifact.dryRun) return;
    await ctx.$('rm', ['-f', artifact.configPath]);
  },
})
```

## 5 — Complete Example

```ts
import { ProcessorBuilder } from '@mwalkersigma/stagehand';

const deployProcessor = new ProcessorBuilder<
  { appName: string; version: string },
  { buildDir: string; deployDir: string },
  { dryRun: boolean },
  { BUILD_FAILED: string; DEPLOY_FAILED: string },
  { deployedVersion: string },
  {}
>({
  id: 'deploy',
  title: 'Deploy Application',
})
  .errors({
    BUILD_FAILED: 'Build step failed',
    DEPLOY_FAILED: 'Deployment step failed',
  })
  .createShared(async (input) => ({
    buildDir: `/tmp/build-${input.appName}-${Date.now()}`,
    deployDir: `/opt/${input.appName}`,
  }))
  .stage('build', 'Build Application', (s) =>
    s
      .step({
        id: 'compile',
        title: 'Compile source code',
        effect: 'create',
        compensation: { kind: 'best-effort' },
        run: async (ctx) => {
          await ctx.$('mkdir', ['-p', ctx.shared.buildDir]);
          await ctx.$('tsc', ['--outDir', ctx.shared.buildDir]);
          return { artifact: { outputDir: ctx.shared.buildDir } };
        },
        compensate: async (ctx, artifact) => {
          await ctx.$('rm', ['-rf', artifact.outputDir]);
        },
      })
      .step({
        id: 'test',
        title: 'Run test suite',
        effect: 'read',
        compensation: { kind: 'none' },
        run: async (ctx) => {
          await ctx.$('bun', ['test']);
          return { artifact: null };
        },
      })
  )
  .stage('deploy', 'Deploy to Server', (s) =>
    s
      .step({
        id: 'backup-current',
        title: 'Backup current deployment',
        effect: 'create',
        compensation: { kind: 'best-effort' },
        run: async (ctx) => {
          const backupDir = `${ctx.shared.deployDir}.bak`;
          await ctx.$('cp', ['-r', ctx.shared.deployDir, backupDir]);
          return { artifact: { backupDir } };
        },
        compensate: async (ctx, artifact) => {
          await ctx.$('rm', ['-rf', artifact.backupDir]);
        },
      })
      .step({
        id: 'copy-build',
        title: 'Copy build to deploy directory',
        effect: 'update',
        compensation: { kind: 'required' },
        run: async (ctx) => {
          const { backupDir } = ctx.getStepArtifact('deploy', 'backup-current');
          await ctx.$('rsync', ['-a', '--delete', `${ctx.shared.buildDir}/`, ctx.shared.deployDir]);
          return { artifact: { deployDir: ctx.shared.deployDir, backupDir } };
        },
        compensate: async (ctx, artifact) => {
          await ctx.$('rsync', ['-a', '--delete', `${artifact.backupDir}/`, artifact.deployDir]);
        },
      })
      .buildArtifact(async (ctx) => ({ deployDir: ctx.shared.deployDir }))
      .compensate(async (ctx, artifact) => {
        if (artifact) {
          ctx.runtime.log.info(`Stage rollback: deploy dir was ${artifact.deployDir}`);
        }
      })
  )
  .finalize(async (ctx) => ({ deployedVersion: ctx.input.version }))
  .build();
```

## 6 — Common Mistakes

### Mistake 1 — CRITICAL: Throwing plain `Error` instead of using the error registry

Agents throw `new Error('msg')` instead of `ctx.fail('CODE')`. This bypasses
the typed error registry and loses the error code.

**Wrong:** `throw new Error('Build failed')`

**Correct:** Register with `.errors({ BUILD_FAILED: 'Build failed' })`, then call
`ctx.fail('BUILD_FAILED')` which throws a `FrameworkError` with the code.

### Mistake 2 — CRITICAL: Not providing compensation for non-read effects

Steps with effect `'create'`/`'update'`/`'delete'`/`'external'` need cleanup.
Agents set `{ kind: 'none' }` for everything, leaving dirty state after failure.

**Wrong:**
```ts
{ id: 'deploy', effect: 'create', compensation: { kind: 'none' }, run: ... }
// no compensate() — created files are never cleaned up
```

**Correct:**
```ts
{ id: 'deploy', effect: 'create', compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('cp', ['-r', 'dist/', '/deploy/']);
    return { artifact: { path: '/deploy/' } };
  },
  compensate: async (ctx, artifact) => {
    await ctx.$('rm', ['-rf', artifact.path]);
  },
}
```

### Mistake 3 — HIGH: Compensation handler ignoring the artifact parameter

`compensate()` receives the artifact from `run()`. Agents hardcode values instead
of using the artifact, making rollback fragile.

**Wrong:** `compensate: async (ctx) => { await ctx.$('rm', ['-rf', '/deploy/']); }`

**Correct:** `compensate: async (ctx, artifact) => { await ctx.$('rm', ['-rf', artifact.deployPath]); }`

### Mistake 4 — HIGH: Missing required compensator silently records failure

When `kind` is `'required'` but no `compensate()` is provided, the processor
does **not** throw. It silently records a `CompensationFailure`. Agents miss this
because they only check `result.ok` and ignore `result.compensationFailures`.

Source: `modules/classes/processor.ts` — pushes `CompensationFailure` with
`FrameworkError("Missing required compensator for {stageId}.{stepId}")`.

**Fix:** Always provide a `compensate()` function when using `{ kind: 'required' }`,
and always inspect `result.compensationFailures` when `result.ok` is `false`.

## 7 — Cross-References

- **`skills/define-processor/SKILL.md`** — Processor authoring: `ProcessorBuilder`
  chain, `StepDefinition` shape, parallel vs. sequential, artifact access.
  Compensation design depends on step granularity and effect declarations.
- **`skills/migrate-from-bash/SKILL.md`** — Side-effecting bash commands need
  compensation wiring during migration. Every `ctx.$()` call that creates,
  modifies, or deletes something should have a corresponding `compensate()`.

## 8 — Tension: Step Atomicity vs. Implementation Convenience

**Priority: HIGH**

Making steps atomic produces clean compensation but increases boilerplate. Agents
optimizing for fewer lines put too much in one step (create dir + copy files +
set permissions), making `compensate()` impossible to write correctly because you
don't know which sub-operation succeeded before the failure.

**Guideline:** Each step should do exactly ONE side-effecting operation. The
artifact captures what was done. The `compensate()` handler reverses that one
operation. If a step does multiple things, split it.

See also: `skills/define-processor/SKILL.md` § Common Mistakes.