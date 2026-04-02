---
name: theming-and-output
description: "ScriptTheme colors (function refs not strings), gradient hex tuple, CollapseLevel resolution (stage>flag>theme), HeaderStyle, StageStyle/StepStyle TokenFormatString, TasukuReporter.printHeader, ctx.setTaskTitle/setTaskOutput/setTaskStatus/setTaskError/setTaskWarning fallback behavior, Bold/GradientText/ANSI utilities, DEFAULT_THEME"
type: core
library: "@mwalkersigma/stagehand"
library_version: "1.0.0"
sources:
  - modules/types.ts
  - modules/consts.ts
  - modules/textFormatting.ts
  - modules/classes/tasukuReporter.ts
  - modules/classes/executionContext.ts
  - modules/classes/appScript.ts
---

# Theming and Output

Configure terminal appearance, collapse behavior, and in-flight step feedback
for a Stagehand CLI application.

Stagehand is a TypeScript CLI framework (runtime: Bun) for orchestrating
multi-stage, multi-step command processors with typed flags, error registries,
compensation (rollback), and tasuku v3-powered terminal task rendering.

---

## Setup

Theme configuration happens on the `ScriptApp` instance via `.theme()`.
The method shallow-merges your overrides into `DEFAULT_THEME` — you only
supply the properties you want to change.

```ts
import { ScriptApp } from './modules/classes/appScript';
import { blue, red, green, yellow, darkGray, white } from './modules/textFormatting';

const app = new ScriptApp('my-cli')
  .meta({ version: '2.1.0', author: 'eng-team' })
  .theme({
    collapseLevel: 'stage',
    headerStyle: 'fancy',
    colors: {
      primary: blue,
      error: red,
      success: green,
      gradient: ['#00FFFF', '#FF00FF'],
    },
  })
  .command({ /* ... */ });

await app.parseAsync();
```

The merge logic in `appScript.ts` is:

```ts
this.__theme = {
  ...this.__theme,
  ...theme,
  colors: { ...this.__theme.colors, ...(theme.colors ?? {}) },
  stageStyle: { ...this.__theme.stageStyle, ...(theme.stageStyle ?? {}) },
  stepStyle: { ...this.__theme.stepStyle, ...(theme.stepStyle ?? {}) },
};
```

Any color you omit keeps its `DEFAULT_THEME` value.

---

## Core Patterns

### 1 — Define a Complete Custom Theme

When you need full control over every color, header, and format string:

```ts
import { ScriptApp } from './modules/classes/appScript';
import {
  blue, red, green, yellow, white, darkGray,
  blueBackground, grayBackground, greenBackground,
  Bold, GradientText,
} from './modules/textFormatting';

const app = new ScriptApp('deploy-tool')
  .meta({ version: '3.0.0', environment: 'production' })
  .theme({
    collapseLevel: 'tasks',
    headerStyle: 'fancy',
    colors: {
      // Every color property is a FUNCTION: (text: string) => string
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
      // gradient is the ONLY non-function — it is a [string, string] tuple
      gradient: ['#FF6B6B', '#4ECDC4'],
    },
    stageStyle: {
      formatString: '$stage: $message',
      color: green,
    },
    stepStyle: {
      formatString: '$step: $message',
    },
  });
```

**Key facts:**
- All 12 color properties (`primary` through `dimmed`) are functions `(text: string) => string`.
- `gradient` is the sole exception — a `[string, string]` tuple of hex color codes.
- `stageStyle.color` is also a function `(text: string) => string`.
- `formatString` values must start with a `FormatToken` (`$stage`, `$step`, `$message`, `$progress`, `$total`, `$elapsed`, `$remaining`, `$percent`). The type is `` `${FormatToken}${string}` ``.

### 2 — Configure Collapse Behavior

Collapse controls what stays visible in the terminal after a stage completes.
Three levels exist:

| Level | Behavior |
|-------|----------|
| `'none'` | Everything stays visible — all stages and steps remain after completion |
| `'tasks'` | Individual step `TaskPromise`s are `.clear()`-ed after completion; stage titles remain |
| `'stage'` | The entire stage `TaskPromise` is `.clear()`-ed after completion, hiding all children |

**Resolution priority** (first defined wins):

```
stage.collapseLevel  →  runtime.flags.collapseLevel  →  theme.collapseLevel
```

Set it at the theme level (global default):

```ts
.theme({ collapseLevel: 'tasks' })
```

Override per-stage in a `StageBuilder`:

```ts
.stage('deploy', 'Deploy to production', (s) =>
  s
    .collapse('stage')   // this stage collapses entirely
    .step({ /* ... */ })
)
```

Override at runtime via CLI flags (if your command exposes a `collapseLevel` flag):

```ts
// In the command definition's build callback:
build: (cmd) =>
  cmd.addOption(
    new Option('--collapse <level>', 'collapse level')
      .choices(['stage', 'tasks', 'none'] as const)
      .default('tasks' as const),
  ),
```

The `DEFAULT_THEME` sets `collapseLevel: 'none'` — nothing is hidden by default.

### 3 — Use In-Flight Task Feedback Inside Steps

Inside a step `run()` callback, `ctx.task` provides tasuku controls that
update the terminal in real time:

```ts
.step({
  id: 'compile',
  title: 'Compile project',
  effect: 'read',
  compensation: { kind: 'none' },
  run: async (ctx) => {
    ctx.setTaskStatus('scanning files...');

    const result = await ctx.$('tsc', ['--noEmit']);

    ctx.setTaskTitle('Compile project — done');
    ctx.setTaskOutput(`Checked ${result.stdout.split('\n').length} files`);

    return { artifact: null };
  },
})
```

The full `StepTaskContext` API available on `ctx.task` (and as convenience
methods directly on `ctx`):

| Method | ctx shorthand | Purpose |
|--------|--------------|---------|
| `ctx.task.setTitle(title)` | `ctx.setTaskTitle(title)` | Update the task's displayed title |
| `ctx.task.setStatus(status)` | `ctx.setTaskStatus(status)` | Show a status badge next to the title |
| `ctx.task.setOutput(output)` | `ctx.setTaskOutput(output)` | Display output text below the task |
| `ctx.task.setError(error)` | `ctx.setTaskError(error)` | Mark the task with an error indicator |
| `ctx.task.setWarning(warning)` | `ctx.setTaskWarning(warning)` | Mark the task with a warning indicator |
| `ctx.task.startTime()` | — | Start an elapsed-time counter |
| `ctx.task.stopTime()` | — | Stop the timer; returns elapsed ms |
| `ctx.task.streamPreview()` | — | Access tasuku's stream preview handle |
| `ctx.task.run(title, fn)` | — | Create a nested sub-task |
| `ctx.task.group` | — | Access tasuku's group API |

**Fallback behavior:** When there is no bound `TaskInnerAPI` (i.e., outside
a step — in `createShared` or `finalize`), these methods either no-op
(`setTitle`, `startTime`, `stopTime`) or fall back to `runtime.log`:

| Method | Fallback without taskApi |
|--------|------------------------|
| `setStatus(status)` | `runtime.log.info(status)` |
| `setWarning(warning)` | `runtime.log.warn(String(warning))` |
| `setError(error)` | `runtime.log.error(String(error))` |
| `setOutput(output)` | `runtime.log.info(message)` |
| `setTitle(title)` | No-op |
| `startTime()` | No-op |
| `stopTime()` | Returns `undefined` |

### 4 — Header Rendering with TasukuReporter

`TasukuReporter.printHeader()` renders a bordered header box to the console.
It is called automatically by the framework before processor execution, using
the metadata from `.meta()`.

The `headerStyle` theme property controls rendering:

- **`'fancy'`** — bordered box with asterisks, centered bold title using
  `theme.colors.primary`, meta values displayed inside the box with
  uppercase keys in `darkGray` and values in `white`.
- **`'simple'`** — just prints the title text with no decoration.

```ts
// Fancy header output looks like:
// ****************************
// **       My CLI App       **
// ****************************
// ** VERSION:        2.1.0  **
// ** AUTHOR:      eng-team  **
// ****************************

// Simple header output:
// My CLI App
```

You typically do not call `printHeader()` directly — the framework calls it.
But the reporter is available on `runtime.reporter` if needed:

```ts
await runtime.reporter.printHeader({
  title: 'Custom Header',
  meta: { version: '1.0.0', env: 'staging' },
});
```

---

## Text Formatting Utilities

All functions in `modules/textFormatting.ts` are TTY-aware — they return
plain undecorated text when `process.stdout.isTTY` is `false`.

**Style modifiers:**
- `Bold(text)` — bold weight
- `Italic(text)` — italic style

**Foreground colors:**
- `green(text)`, `red(text)`, `blue(text)`, `yellow(text)`
- `white(text)`, `lightGray(text)`, `darkGray(text)`

**Background colors:**
- `greenBackground(text)`, `redBackground(text)`, `blueBackground(text)`
- `yellowBackground(text)`, `grayBackground(text)`

**Special:**
- `GradientText(text, startHex, endHex)` — per-character RGB gradient
- `blueEdges(text)` — wraps text in blue pipe characters: `| text |`

Use these functions as theme color values or directly in step output:

```ts
import { Bold, GradientText, green } from './modules/textFormatting';

// In a step's run callback:
run: async (ctx) => {
  ctx.setTaskOutput(Bold(green('Build succeeded!')));
  ctx.setTaskStatus(GradientText('compiling', '#00FF00', '#0000FF'));
  return { artifact: null };
},
```

---

## DEFAULT_THEME Reference

The built-in theme from `modules/consts.ts`:

```ts
import * as printutils from './modules/textFormatting';

const DEFAULT_THEME: ScriptTheme = {
  collapseLevel: 'none',
  colors: {
    primary: printutils.blue,
    secondary: printutils.white,
    accent: printutils.green,
    dimmed: printutils.darkGray,
    primaryBackground: printutils.blueBackground,
    secondaryBackground: printutils.grayBackground,
    accentBackground: printutils.greenBackground,
    gradient: ['#00FFFF', '#FF00FF'],
    warning: printutils.yellow,
    error: printutils.red,
    info: printutils.blue,
    debug: printutils.darkGray,
    success: printutils.green,
  },
  headerStyle: 'fancy',
  stageStyle: { formatString: '$stage: $message', color: printutils.blue },
  stepStyle: { formatString: '$step: $message' },
};
```

---

## Common Mistakes

### 1. Passing color strings instead of color functions

**Priority: CRITICAL** — Source: `modules/types.ts`

Every color property in `ScriptTheme.colors` (except `gradient`) is typed as
`(text: string) => string`. Passing a string causes a runtime crash when the
framework tries to call it as a function.

Wrong:

```ts
.theme({
  colors: {
    primary: '#0000FF',
    error: 'red',
  },
})
// TypeError: theme.colors.primary is not a function
```

Correct:

```ts
import { blue, red } from './modules/textFormatting';

.theme({
  colors: {
    primary: blue,
    error: red,
  },
})
```

If you need a custom color not provided by the utilities, write a function:

```ts
const magenta = (text: string) => `\u001b[35m${text}\u001b[39m`;

.theme({
  colors: { primary: magenta },
})
```

### 2. Setting gradient as a function instead of a hex tuple

**Priority: HIGH** — Source: `modules/types.ts`

The `gradient` property is the ONE color property that is NOT a function. It
is typed as `[string, string]` — a tuple of two hex color strings. The
framework passes these to `GradientText()` internally.

Wrong:

```ts
colors: {
  gradient: (text) => GradientText(text, '#00FFFF', '#FF00FF'),
}
// Type error: [string, string] is not assignable to (text: string) => string
```

Correct:

```ts
colors: {
  gradient: ['#00FFFF', '#FF00FF'],
}
```

### 3. Calling task API methods outside of a step context

**Priority: MEDIUM** — Source: `modules/classes/executionContext.ts`

`ctx.setTaskTitle()`, `ctx.setTaskOutput()`, and friends delegate to the
bound `TaskInnerAPI`. In `createShared` or `finalize`, there is no bound
task — these calls silently no-op or fall back to `runtime.log`.

Wrong expectation:

```ts
// In createShared — these will NOT render as tasuku task updates
.createShared(async (input, runtime) => {
  const ctx = /* ... */;
  ctx.setTaskTitle('Loading config...');   // No-op — no bound task
  ctx.setTaskOutput('Found 12 modules');   // Falls back to runtime.log.info
  return { config: {} };
})
```

Correct — use `runtime.log` directly when outside step context:

```ts
.createShared(async (input, runtime) => {
  runtime.log.info('Loading config...');
  runtime.log.info('Found 12 modules');
  return { config: {} };
})
```

Task controls work correctly inside step `run()`, `when()`, and
`compensate()` callbacks where the framework binds a `TaskInnerAPI` via
`ctx.withTask(taskApi)`.

---

## Cross-References

- **skills/scaffold-cli-app/SKILL.md** — Theme configuration happens at the `ScriptApp` level via `.theme()`. Header metadata is set via `.meta()`.
- **skills/define-processor/SKILL.md** — Step callbacks use `ctx.setTaskTitle()`, `ctx.setTaskOutput()`, `ctx.setTaskStatus()` for in-flight feedback. Collapse is set per-stage via `StageBuilder.collapse()`.