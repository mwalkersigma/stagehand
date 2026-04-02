---
name: migrate-from-bash
description: >-
  Convert an existing bash script into a Stagehand processor: map each
  command 1:1 to a step using ctx.$(), organize into logical stages,
  replace commands with fs/Bun APIs only when genuinely better, translate
  bash flags to typed Commander options, wire error handling through the
  typed error registry and ctx.fail(), and add compensation handlers for
  every side-effecting command.
type: lifecycle
library: '@mwalkersigma/stagehand'
library_version: '1.0.0'
requires:
  - define-processor
  - compensation-and-rollback
sources:
  - examples/build.ts
  - modules/classes/executionContext.ts
  - modules/classes/processorBuilder.ts
  - modules/shell.ts
---

# Migrate from Bash

> **Dependency note:** This skill builds on **define-processor** (ProcessorBuilder
> chain, stages, steps, artifacts, finalize) and **compensation-and-rollback**
> (CompensationPolicy, effect kinds, compensate handlers, reverse-order execution).
> Read those skills first — this skill assumes fluency with the builder API and
> the compensation model.

## Migration Workflow

Follow these steps in order when converting a bash script into a Stagehand processor.

### Step 1 — Inventory the bash script

Read the entire script and produce a flat list of every command that executes.
Mark each command with its **effect kind**:

| Bash pattern | Effect kind | Needs compensation? |
|---|---|---|
| `cat`, `ls`, `node -v`, `git status` | `read` | No |
| `mkdir -p`, `cp`, `npm ci`, `echo > file` | `create` | Yes |
| `sed -i`, `git pull`, `npm version` | `update` | Yes |
| `rm -rf`, `docker rm` | `delete` | Yes |
| `curl -X POST`, `pm2 restart`, `ssh deploy@` | `external` | Yes |

### Step 2 — Identify stage boundaries

Group commands into logical stages. Look for:

- Comments or section headers in the bash script (`# --- Build ---`)
- Conditional blocks that gate a group of commands (`if [ $changed -eq 1 ]; then`)
- Natural phases: verify environment → fetch updates → build → deploy → cleanup

Each group becomes a `.stage()` call.

### Step 3 — Map each command to one step

**One bash command = one Stagehand step.** Never combine commands.

For each command, decide:
- **`ctx.$()`** — default choice. Preserves the exact shell command.
- **`fs` / Bun API** — only for file existence checks, reading/writing file contents, `mkdir`, or simple file copies within the project.

### Step 4 — Translate flags and arguments

Bash `case`/`getopts` patterns become typed Commander options:

```examples/build.ts#L1-3
import { ScriptApp } from '../modules/classes/appScript';
import { Option } from '@commander-js/extra-typings';
```

```/dev/null/flags.ts#L1-9
// Bash:  --no-git → skip git pull    --build-only → skip module install
// Stagehand:
build: (cmd) => cmd
  .addOption(new Option('-d, --dry-run', 'Run without changes').default(false, 'false'))
  .option('--no-git', 'Skip git pull')
  .option('--no-install', 'Skip module install'),
```

Flags are accessed via `ctx.runtime.flags` inside step callbacks. Use `when()` guards to conditionally skip steps based on flags.

### Step 5 — Translate error handling

| Bash pattern | Stagehand equivalent |
|---|---|
| `set -e` (exit on error) | Default behavior — unhandled throw aborts the processor |
| `command \|\| exit 1` | `ctx.$()` throws on non-zero exit; no extra code needed |
| `if ! command; then echo "failed"; exit 1; fi` | Register an error code, catch in step, call `ctx.fail(code)` |
| `stage_error "message"` | `ctx.fail('ERROR_CODE', 'message')` |

### Step 6 — Wire compensation and assemble

Every step with effect `create`, `update`, `delete`, or `external` needs a `compensate()` handler that receives the step's artifact and reverses the action. Once all steps are wired, assemble into a `ScriptApp` with `.command()` and `.parseAsync()`. Run with `--dry-run` to verify the step tree renders correctly before executing real commands.

---

## Core Patterns

### Pattern: Shell command as a step
Every bash command that should stay as a shell call uses `ctx.$()`.

```/dev/null/shell-step.ts#L1-14
// Bash: git pull
.step({
  id: 'git-pull',
  title: 'Pull latest changes',
  effect: 'update',
  compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('git', ['pull']);
    return { artifact: 'pulled' };
  },
  compensate: async (ctx) => {
    await ctx.$('git', ['reset', '--hard', 'HEAD@{1}']);
  },
})
```
`ctx.$()` automatically uses `shell.noop()` in dry-run mode — no extra guards needed.

### Pattern: File-existence check with fs
Replace `test -f .env` or `[ -f .env ]` with `existsSync`:

```/dev/null/fs-check.ts#L1-13
import { existsSync } from 'fs';

.step({
  id: 'check-env-file',
  title: 'Verify .env file exists',
  effect: 'read',
  compensation: { kind: 'none' },
  run: async (ctx) => {
    if (!existsSync('.env')) {
      ctx.fail('MISSING_ENV', '.env file not found');
    }
    return { artifact: null };
  },
})
```
### Pattern: Conditional step with when() guard
Bash conditionals that gate entire commands become `when()` guards:

```/dev/null/when-guard.ts#L1-14
// Bash: if [ "$skip_module_install" -eq 0 ] && [ $changed -eq 1 ]; then npm ci; fi
.step({
  id: 'npm-install',
  title: 'Install Node modules',
  effect: 'create',
  compensation: { kind: 'best-effort' },
  when: (ctx) => ctx.runtime.flags.install && ctx.getStepArtifact('git', 'git-pull') === 'pulled',
  run: async (ctx) => {
    await ctx.$('npm', ['ci']);
    return { artifact: 'node_modules' };
  },
  compensate: async (ctx) => {
    await ctx.$('rm', ['-rf', 'node_modules']);
  },
})
```

### Pattern: Capturing command output

Bash command substitution (`VERSION=$(node -v)`) becomes `shell.capture()`:

```/dev/null/capture.ts#L1-10
.step({
  id: 'check-node',
  title: 'Check Node version',
  effect: 'read',
  compensation: { kind: 'none' },
  run: async (ctx) => {
    const version = await ctx.runtime.shell.capture('node', ['--version']);
    ctx.setTaskOutput(`Node: ${version}`);
    return { artifact: { version } };
  },
})
```

### Pattern: Error registry for bash failure points

Bash `stage_error` calls and `|| exit 1` patterns map to registered error codes:

```/dev/null/error-registry.ts#L1-14
defineProcessor({ id: 'deploy', title: 'Deploy' })
  .errors({
    MISSING_ENV: '.env file not found',
    GIT_PULL_FAILED: 'Failed to pull latest changes',
    BUILD_FAILED: 'Build step failed',
    DEPLOY_FAILED: 'Deployment to remote host failed',
  })
  // Inside a step:
  run: async (ctx) => {
    try {
      await ctx.$('npm', ['run', 'build']);
    } catch (err) {
      ctx.fail('BUILD_FAILED', undefined, err);
    }
    return { artifact: 'dist/' };
  },
```

> `ctx.$()` throws automatically on non-zero exit codes (execa default).
> Use explicit catch + `ctx.fail()` only when you need a custom error code
> instead of the raw execa error.

### Pattern: Full migration assembly

Complete example converting a bash build/deploy script into a Stagehand processor:

```/dev/null/full-assembly.ts#L1-76
import { ScriptApp } from '../modules/classes/appScript';
import { Option } from '@commander-js/extra-typings';
import { existsSync } from 'fs';

await new ScriptApp('deploy-tool')
  .meta({ company: 'Acme', author: 'Dev Team', version: '1.0.0' })
  .command({
    name: 'deploy',
    description: 'Build and deploy the application',
    build: (cmd) => cmd
      .addOption(new Option('-d, --dry-run', 'Run without changes').default(false, 'false'))
      .option('--no-git', 'Skip git pull')
      .option('--no-install', 'Skip npm install'),
    handler: ({ defineProcessor }) =>
      defineProcessor({ id: 'deploy-proc', title: 'Deploy' })
        .errors({
          MISSING_ENV: '.env file not found',
          BUILD_FAILED: 'Build failed',
        })
        .createShared(async () => ({ startedAt: new Date().toISOString() }))

        // Stage 1: read-only checks (parallel, collapse after completion)
        .stage('verify', 'Verify Environment', (s) => s
          .parallel().collapse('tasks')
          .step({
            id: 'check-env', title: 'Check .env file',
            effect: 'read', compensation: { kind: 'none' },
            run: async (ctx) => {
              if (!existsSync('.env')) ctx.fail('MISSING_ENV');
              return { artifact: null };
            },
          })
          .step({
            id: 'check-node', title: 'Check Node version',
            effect: 'read', compensation: { kind: 'none' },
            run: async (ctx) => {
              const version = await ctx.runtime.shell.capture('node', ['--version']);
              ctx.setTaskOutput(`Node: ${version}`);
              return { artifact: { version } };
            },
          })
        )

        // Stage 2: side-effecting updates (sequential, with compensation)
        .stage('update', 'Pull Updates', (s) => s
          .step({
            id: 'git-pull', title: 'Git pull',
            effect: 'update', compensation: { kind: 'best-effort' },
            when: (ctx) => ctx.runtime.flags.git,
            run: async (ctx) => {
              await ctx.$('git', ['pull']);
              return { artifact: 'pulled' };
            },
            compensate: async (ctx) => {
              await ctx.$('git', ['reset', '--hard', 'HEAD@{1}']);
            },
          })
          .step({
            id: 'npm-install', title: 'Install dependencies',
            effect: 'create', compensation: { kind: 'best-effort' },
            when: (ctx) => ctx.runtime.flags.install,
            run: async (ctx) => {
              await ctx.$('npm', ['ci']);
              return { artifact: 'node_modules' };
            },
            compensate: async (ctx) => {
              await ctx.$('rm', ['-rf', 'node_modules']);
            },
          })
        )

        .finalize(async (ctx) => ({
          node: ctx.getStepArtifact('verify', 'check-node').version,
        }))
        .build()
  })
  .parseAsync();
```

---

## Common Mistakes

### 1. HIGH — Combining multiple bash commands into one step

Agents merge related bash commands into a single step, violating atomicity and making compensation impossible for partial completion.

**Wrong — three commands in one step:**

```/dev/null/mistake1-wrong.ts#L1-11
.step({
  id: 'update-and-build',
  title: 'Update and build',
  effect: 'update',
  compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('git', ['pull']);
    await ctx.$('npm', ['ci']);        // If this fails, git pull can't be rolled back
    await ctx.$('npm', ['run', 'build']);
    return { artifact: null };
  },
})
```

**Correct — one command per step, each with its own effect and compensator:**

```/dev/null/mistake1-correct.ts#L1-22
.step({
  id: 'git-pull', title: 'Pull latest changes',
  effect: 'update', compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('git', ['pull']);
    return { artifact: 'pulled' };
  },
  compensate: async (ctx) => { await ctx.$('git', ['reset', '--hard', 'HEAD@{1}']); },
})
.step({
  id: 'npm-install', title: 'Install dependencies',
  effect: 'create', compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('npm', ['ci']);
    return { artifact: 'node_modules' };
  },
  compensate: async (ctx) => { await ctx.$('rm', ['-rf', 'node_modules']); },
})
.step({
  id: 'build', title: 'Build project',
  effect: 'create', compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('npm', ['run', 'build']);
    return { artifact: 'dist/' };
  },
  compensate: async (ctx) => { await ctx.$('rm', ['-rf', 'dist/']); },
})
```

If `npm ci` fails, only `git pull` is compensated — exactly the commands that ran.

*Source: maintainer interview*

### 2. HIGH — Rewriting shell commands unnecessarily

Agents replace working bash commands with Node.js equivalents when `ctx.$()` is the correct translation.

**Wrong:**

```/dev/null/mistake2-wrong.ts#L1-10
// Using child_process directly
import { execSync } from 'child_process';
run: async () => {
  execSync('git pull', { stdio: 'inherit' });
  return { artifact: null };
},

// Or pulling in a library
import simpleGit from 'simple-git';
run: async () => { await simpleGit().pull(); return { artifact: 'pulled' }; },
```

**Correct:**

```/dev/null/mistake2-correct.ts#L1-4
run: async (ctx) => {
  await ctx.$('git', ['pull']);
  return { artifact: 'pulled' };
},
```

`ctx.$()` wraps execa, respects dry-run mode, and preserves the exact command the bash script used. Only replace with TypeScript APIs for the `fs` categories listed in the table below.

*Source: maintainer interview*

### 3. MEDIUM — Ignoring bash error handling patterns during migration

Bash `|| exit 1`, `set -e`, and `if ! command; then stage_error "..."; fi` patterns are dropped instead of being translated.

**Wrong — empty error registry, raw errors propagate:**

```/dev/null/mistake3-wrong.ts#L1-5
.errors({})  // No error codes registered
// ...
run: async (ctx) => {
  await ctx.$('npm', ['run', 'build']);  // raw execa error on failure — no context
  return { artifact: null };
},
```

**Correct — register error codes, catch and rethrow with ctx.fail():**

```/dev/null/mistake3-correct.ts#L1-10
.errors({
  BUILD_FAILED: 'Build step failed',
  DEPLOY_FAILED: 'Deployment failed',
})
// ...
run: async (ctx) => {
  try {
    await ctx.$('npm', ['run', 'build']);
  } catch (err) {
    ctx.fail('BUILD_FAILED', undefined, err);
  }
  return { artifact: 'dist/' };
},
```

Every `stage_error` call and every `|| exit 1` in the bash script should map to a registered error code.

*Source: build.bash — stage_error function and conditional checks*

### 4. MEDIUM — Not wiring compensation for side-effecting commands

Commands like `npm ci` (creates `node_modules/`), `cp -r` (creates files), and `pm2 restart` (changes service state) are migrated without compensation handlers.

**Wrong — create effect with no compensator:**

```/dev/null/mistake4-wrong.ts#L1-8
.step({
  id: 'npm-install', title: 'Install dependencies',
  effect: 'create',
  compensation: { kind: 'none' },  // Wrong: 'create' needs compensation
  run: async (ctx) => {
    await ctx.$('npm', ['ci']);
    return { artifact: null };      // No meaningful artifact for compensation
  },
})
```

**Correct — compensation reverses the side effect using the artifact:**

```/dev/null/mistake4-correct.ts#L1-10
.step({
  id: 'npm-install', title: 'Install dependencies',
  effect: 'create',
  compensation: { kind: 'best-effort' },
  run: async (ctx) => {
    await ctx.$('npm', ['ci']);
    return { artifact: 'node_modules' };
  },
  compensate: async (ctx, artifact) => {
    await ctx.$('rm', ['-rf', artifact]);
  },
})
```

Review every step's `effect` field. If it is anything other than `read`, it needs a `compensate()` handler and a compensation policy of `best-effort` or `required`.

*Source: maintainer interview*

---

## When to Use fs Instead of ctx.$()

Use `fs` or Node/Bun APIs **only** for these categories:

| Operation | Bash | Stagehand replacement |
|---|---|---|
| File existence | `test -f .env` | `existsSync('.env')` |
| Read file | `cat config.json` | `await Bun.file('config.json').text()` |
| Write file | `echo "data" > out.txt` | `await Bun.write('out.txt', 'data')` |
| Create directory | `mkdir -p dist` | `mkdirSync('dist', { recursive: true })` |
| Simple copy | `cp file.txt backup.txt` | `await Bun.write('backup.txt', Bun.file('file.txt'))` |

Keep `ctx.$()` for everything else — git, npm, service management, rsync, complex shell pipelines, and any command where exact shell behavior matters.

---

## Cross-References

- **define-processor** — Processor builder chain, stage/step structure, artifacts, finalize. Required prerequisite.
- **compensation-and-rollback** — CompensationPolicy kinds, effect-to-compensation mapping, reverse-order execution, artifact usage in compensate handlers. Required prerequisite.
- **scaffold-cli-app** — ScriptApp setup, `.command()`, `.meta()`, `.parseAsync()`. Needed when assembling the final CLI entry point.

---

## Tension: Command Fidelity vs. Idiomatic Node

**Priority: HIGH**

Migration should preserve bash commands 1:1 via `ctx.$()`, but some operations are genuinely better handled by `fs` or Bun APIs. Agents fall into two failure modes:

1. **Over-rewrite** — replace every shell command with TypeScript equivalents, losing fidelity and introducing reimplementation bugs (especially for git, npm, and service management commands).
2. **Over-preserve** — keep every command as `ctx.$()` even when `existsSync()` or `Bun.file()` would be simpler and more reliable (especially for file existence checks and content reads).

**Resolution:** Default to `ctx.$()`. Switch to fs/Bun APIs only for the five categories in the "When to Use fs" table above. When in doubt, preserve the original command.

See also: **define-processor** § Common Mistakes — "Putting too much logic in a single step"