import { mock } from "bun:test";
import type { Runtime, ScriptTheme, Logger, Environment } from "../modules/types";
import type { TasukuReporter } from "../modules/classes/tasukuReporter";
import type { Task as TasukuTask, TaskInnerAPI } from "tasuku";
import type { Shell } from "../modules/shell";

/**
 * Create a mock TaskInnerAPI that tracks calls to setTitle, setStatus, etc.
 * Each method is a bun mock function so you can assert on calls.
 */
export function createMockTaskInnerAPI(): TaskInnerAPI {
  return {
    signal: new AbortController().signal,
    setTitle: mock(() => { }),
    setStatus: mock(() => { }),
    setWarning: mock(() => { }),
    setError: mock(() => { }),
    setOutput: mock(() => { }),
    skip: mock(() => {
      throw new Error("skipped");
    }) as unknown as TaskInnerAPI["skip"],
    streamPreview: {
      write: mock(() => true),
      clear: mock(() => { }),
    } as unknown as TaskInnerAPI["streamPreview"],
    startTime: mock(() => { }),
    stopTime: mock(() => 0),
  };
}

/**
 * Create a mock tasuku `task` function that executes callbacks immediately.
 *
 * - `mockTask(title, fn)` calls `fn(mockInnerAPI)` synchronously and returns
 *   a fake TaskPromise with `.clear()` that returns itself (chainable).
 * - `mockTask.group(createTasks)` calls `createTasks` with a mock creator,
 *   then runs each registered task sequentially.
 *
 * This mirrors tasuku v3 behavior without requiring a TTY.
 *
 * The returned task function also exposes a `calls` array that records
 * every `(title, innerApi)` pair for assertions on execution ordering
 * and inner API usage.
 */
export interface MockTaskCall {
  title: string;
  innerApi: TaskInnerAPI;
}

export interface MockTaskFn extends TasukuTask {
  /** Recorded calls in invocation order. Useful for asserting execution flow. */
  calls: MockTaskCall[];
}

export function createMockTask(): MockTaskFn {
  const calls: MockTaskCall[] = [];

  const wrappedTask = ((
    title: string,
    fn: (api: TaskInnerAPI) => Promise<unknown>,
    _options?: unknown,
  ) => {
    const innerApi = createMockTaskInnerAPI();
    calls.push({ title, innerApi });

    const promise = fn(innerApi);

    // Build a TaskPromise-like object: a thenable with .clear(), .state, etc.
    const taskPromise: Promise<unknown> & {
      state: "pending";
      warning: unknown;
      error: unknown;
      skipped: unknown;
      clear: ReturnType<typeof mock>;
    } = Object.assign(promise, {
      state: "pending" as const,
      warning: undefined as unknown,
      error: undefined as unknown,
      skipped: undefined as unknown,
      clear: mock(function clearFn(): unknown {
        return taskPromise;
      }),
    });

    return taskPromise;
  }) as unknown as MockTaskFn;

  // Attach the calls tracker
  (wrappedTask as MockTaskFn).calls = calls;

  // task.group implementation for any custom usage in step callbacks
  (wrappedTask as unknown as Record<string, unknown>).group = mock(
    async (
      createTasks: (creator: (...args: unknown[]) => unknown) => unknown[],
      _options?: unknown,
    ) => {
      const registeredTasks: Array<{ run: () => Promise<unknown> }> = [];

      const creator = (
        title: string,
        fn: (api: TaskInnerAPI) => Promise<unknown>,
      ) => {
        const innerApi = createMockTaskInnerAPI();
        calls.push({ title, innerApi });

        const registered: {
          run: () => Promise<unknown>;
          task: { title: string; state: string; children: never[] };
          clear: ReturnType<typeof mock>;
        } = {
          run: async () => fn(innerApi),
          task: { title, state: "pending", children: [] },
          clear: mock((): unknown => registered),
        };
        registeredTasks.push(registered);
        return registered;
      };

      const tasks = createTasks(creator as (...args: unknown[]) => unknown);
      const results: unknown[] = [];
      for (const t of tasks as Array<{ run: () => Promise<unknown> }>) {
        results.push(await t.run());
      }
      return results;
    },
  );

  return wrappedTask;
}

/**
 * Create a mock TasukuReporter backed by a mock task function.
 * Returns both the reporter and the underlying mock task so tests
 * can inspect recorded calls.
 */
export function createMockReporter(): {
  reporter: TasukuReporter;
  mockTask: MockTaskFn;
} {
  const mockTask = createMockTask();
  const reporter = {
    task: mockTask,
    printHeader: mock(async () => { }),
  } as unknown as TasukuReporter;
  return { reporter, mockTask };
}

/**
 * Create a full mock Runtime suitable for processor tests.
 *
 * The shell, logger, and environment are all bun mocks.
 * The reporter uses a mock task function (see `createMockTask`).
 * The theme uses identity functions for all colors.
 *
 * @param flags  The typed flags object to use as `runtime.flags`.
 * @param overrides  Optional partial overrides for individual runtime fields.
 */
export function createMockRuntime<TFlags extends Record<string, unknown>>(
  flags: TFlags,
  overrides?: {
    shell?: Partial<Shell>;
    log?: Partial<Logger>;
    env?: Partial<Environment>;
    theme?: Partial<ScriptTheme>;
    reporter?: TasukuReporter;
  },
): Runtime<TFlags> & { mockTask: MockTaskFn } {
  const { reporter, mockTask } = createMockReporter();

  const defaultShell: Shell = {
    run: mock(async (cmd: string, args?: string[]) => ({
      command: `${cmd} ${(args ?? []).join(" ")}`.trim(),
      stdout: "",
      stderr: "",
      exitCode: 0,
    })),
    capture: mock(async () => ""),
    noop: mock(async (cmd: string, args?: string[]) => ({
      command: `${cmd} ${(args ?? []).join(" ")}`.trim(),
      stdout: "",
      stderr: "",
      exitCode: 0,
    })),
  };

  const defaultLog: Logger = {
    debug: mock(() => { }),
    info: mock(() => { }),
    warn: mock(() => { }),
    error: mock(() => { }),
  };

  const defaultEnv: Environment = {
    get: mock(() => undefined),
    hasCommand: mock(async () => true),
  };

  const identityColor = (t: string) => t;

  const defaultTheme: ScriptTheme = {
    collapseLevel: "none",
    colors: {
      primary: identityColor,
      secondary: identityColor,
      accent: identityColor,
      warning: identityColor,
      error: identityColor,
      info: identityColor,
      debug: identityColor,
      success: identityColor,
      dimmed: identityColor,
      primaryBackground: identityColor,
      secondaryBackground: identityColor,
      accentBackground: identityColor,
      gradient: ["#00FFFF", "#FF00FF"],
    },
    headerStyle: "simple",
    stageStyle: {
      formatString: "$stage: $message",
      color: identityColor,
    },
    stepStyle: {
      formatString: "$step: $message",
    },
  };

  return {
    shell: { ...defaultShell, ...overrides?.shell } as Shell,
    log: { ...defaultLog, ...overrides?.log } as Logger,
    env: { ...defaultEnv, ...overrides?.env } as Environment,
    flags,
    reporter: overrides?.reporter ?? reporter,
    theme: overrides?.theme
      ? ({
        ...defaultTheme,
        ...overrides.theme,
        colors: {
          ...defaultTheme.colors,
          ...(overrides.theme.colors ?? {}),
        },
      } as ScriptTheme)
      : defaultTheme,
    mockTask,
  };
}
