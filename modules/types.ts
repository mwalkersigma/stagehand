import { Command } from "@commander-js/extra-typings";
import { ExecutionContext } from "./classes/executionContext";
import { RegisteredErrors } from "./classes/RegisteredErrors";
import { ParallelStageOptions, TasukuReporter } from "./classes/tasukuReporter";
import { FrameworkError } from "./errors";
import { Shell } from "./shell";
import { ProcessorBuilder } from "./classes/processorBuilder";

export type Awaitable<T> = T | Promise<T>;

export type CollapseLevel = 'stage' | 'tasks' | 'none';

export type HeaderStyle = 'simple' | 'fancy';

export type FormatToken = '$stage' | '$step' | '$message' | '$progress' | '$total' | '$elapsed' | '$remaining' | '$percent';

export type TokenFormatString = `${FormatToken}${string}`;

export interface ScriptTheme {
  collapseLevel: CollapseLevel;
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
  headerStyle: HeaderStyle;
  stageStyle: {
    formatString: TokenFormatString;
    color: (text: string) => string;
  };
  stepStyle: {
    formatString: TokenFormatString;
  };
}

export interface CommandOptions {
  allowUnknownOption?: boolean;
  enablePositionalOptions?: boolean;
  passThroughOptions?: boolean;
}

export type StepEffectKind = 'read' | 'create' | 'update' | 'delete' | 'external';

export type CompensationPolicyKind = 'none' | 'best-effort' | 'required';

export type CompensationPolicy = { kind: CompensationPolicyKind }

export type ErrorClass<T extends Error = Error> = new (message: string, options?: { code?: string; cause?: unknown }) => T;

export type ErrorRegistryInput = Record<
  string,
  | string
  | {
    type?: ErrorClass;
    message: string;
  }
>;

export type ErrorRegistryNormalized<TRegistry extends ErrorRegistryInput> = {
  [K in keyof TRegistry]: TRegistry[K] extends string
  ? { type: typeof FrameworkError; message: TRegistry[K] }
  : TRegistry[K] extends { type?: infer TType extends ErrorClass; message: infer TMessage extends string }
  ? { type: TType extends ErrorClass ? TType : typeof FrameworkError; message: TMessage }
  : never;
};

export interface ShellResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** File-system contract. */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string): Promise<void>;
  writeFile?(path: string, content: string): Promise<void>;
  readFile?(path: string): Promise<string>;
}

/** Logger abstraction. */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Environment abstraction. */
export interface Environment {
  get(name: string): string | undefined;
  hasCommand(commandName: string): Promise<boolean>;
}



/** Common runtime flags. */
export interface CommonRuntimeFlags {
  dryRun?: boolean;
  collapseLevel?: CollapseLevel;
  verbose?: boolean;
}

/** Full runtime object. Users can extend this with fs or anything else they want. */
export type Runtime<TFlags extends Record<string, unknown> = Record<string, never>> = {
  shell: Shell;
  log: Logger;
  env: Environment;
  flags: TFlags;
  reporter: TasukuReporter;
  theme: ScriptTheme;
}

/** Tasuku group execution options used for parallel stage execution. */


/** Step execution result. */
export interface StepRunResult<TArtifact> {
  artifact: TArtifact;
}

/** Helper for extracting step artifact type. */
export type InferStepArtifact<TStep> = TStep extends StepDefinition<any, any, any, any, any, infer TArtifact, any>
  ? TArtifact
  : never;

/** Map of stage IDs to stage definitions. */
export type StageMap = Record<string, StageDefinition<string, any, any, any, any, readonly StepDefinition<string, any, any, any, any, any>[], any>>;

/** Step map extracted from a stage map. */
export type StepMapOf<TStages extends StageMap, TStageId extends keyof TStages> = {
  [TStep in TStages[TStageId] extends StageDefinition<any, any, any, any, any, infer TSteps, any>
  ? TSteps[number]
  : never as TStep['id']]: TStep;
};

/** Artifact type extracted for a stage + step pair. */
export type ArtifactFor<
  TStages extends StageMap,
  TStageId extends keyof TStages,
  TStepId extends keyof StepMapOf<TStages, TStageId>,
> = InferStepArtifact<StepMapOf<TStages, TStageId>[TStepId]>;

export interface StepDefinition<
  TId extends string,
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TArtifact,
  TStages extends StageMap = StageMap,
> {
  id: TId;
  title: string;
  effect: StepEffectKind;
  compensation: CompensationPolicy;
  when?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<boolean>;
  run: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Promise<StepRunResult<TArtifact>>;
  compensate?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>, artifact: TArtifact) => Promise<void>;
}

/** Stage definition. */
export interface StageDefinition<
  TStageId extends string,
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TSteps extends readonly StepDefinition<string, TInput, TShared, TFlags, TRegistry, any, any>[],
  TStageArtifact,
  TStages extends StageMap = StageMap,
> {
  id: TStageId;
  title: string;
  collapseLevel?: CollapseLevel;
  parallel?: ParallelStageOptions;
  steps: TSteps;
  buildArtifact?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<TStageArtifact>;
  compensate?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>, artifact: TStageArtifact | undefined) => Promise<void>;
}
/** Step record used for compensation. */
export interface ExecutedStepRecord<TArtifact = unknown> {
  stageId: string;
  stepId: string;
  title: string;
  artifact: TArtifact;
  compensation: CompensationPolicy;
}

/** Stage record used for compensation. */
export interface ExecutedStageRecord<TArtifact = unknown> {
  stageId: string;
  title: string;
  artifact?: TArtifact;
}

/** Compensation failure. */
export interface CompensationFailure {
  stageId: string;
  stepId?: string;
  error: unknown;
}

/** Structured processor result. */
export type ProcessorResult<TResult> =
  | {
    ok: true;
    value: TResult;
    completedStages: string[];
    completedSteps: string[];
  }
  | {
    ok: false;
    error: unknown;
    completedStages: string[];
    completedSteps: string[];
    compensationFailures: CompensationFailure[];
  };

/** Processor definition. */
export interface ProcessorDefinition<
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TResult,
  TStages extends StageMap,
> {
  id: string;
  title: string;
  errors: RegisteredErrors<TRegistry>;
  createShared: (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
  stages: TStages;
  finalize: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<TResult>;
}

/** Extract typed Commander pieces. */
export type ExtractCommandOpts<TCmd> = TCmd extends Command<any[], infer O> ? O : never;
export type ExtractCommandArgs<TCmd> = TCmd extends Command<infer A, any> ? A : never;

/** Command-bound processor type. */
export interface CommandProcessor<TCmd extends Command> {
  run(
    input: ExtractCommandArgs<TCmd>,
    runtime: Runtime<ExtractCommandOpts<TCmd>>,
    meta?: Record<string, string>,
  ): Promise<ProcessorResult<unknown>>;
}

/** Factory API that binds a processor builder to a specific command's typed args/flags. */
export interface CommandProcessorFactoryApi<TCmd extends Command> {
  command: TCmd;
  defineProcessor<TInput = ExtractCommandArgs<TCmd>>(
    args: { id: string; title: string },
  ): ProcessorBuilder<TInput, never, ExtractCommandOpts<TCmd>, {}, void, {}>;
}

/** Factory callback used to preserve command option types inside processor builder callbacks. */
export type CommandProcessorFactory<TCmd extends Command> = (
  api: CommandProcessorFactoryApi<TCmd>,
) => CommandProcessor<TCmd>;

/** Command registration definition. */
export type CommandDefinition<
  TNewCommandName extends string,
  TBuiltCommand extends Command<[], {}, {}>,
> = {
  name: TNewCommandName;
  description?: string;
  configOptions?: CommandOptions;
  build?: (cmd: Command<[], {}>) => TBuiltCommand;
  handler: CommandProcessorFactory<TBuiltCommand>;
};
