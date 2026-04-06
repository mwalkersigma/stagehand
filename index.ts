// ── Core Classes ─────────────────────────────────────────────────────────────
export { ScriptApp } from './modules/classes/appScript';
export { ProcessorBuilder } from './modules/classes/processorBuilder';
export { StageBuilder } from './modules/classes/stageBuilder';
export { Processor } from './modules/classes/processor';
export { ExecutionContext } from './modules/classes/executionContext';
export { RegisteredErrors } from './modules/classes/RegisteredErrors';
export { TasukuReporter } from './modules/classes/tasukuReporter';
export { ProcessEnvironment } from './modules/classes/processEnvironment';

// ── Utilities ────────────────────────────────────────────────────────────────
export { FrameworkError, formatErrorChain } from './modules/errors';
export { ExecaShell } from './modules/shell';
export { DEFAULT_THEME } from './modules/consts';

// ── Text Formatting ──────────────────────────────────────────────────────────
export {
  Bold,
  Italic,
  green,
  red,
  blue,
  yellow,
  white,
  lightGray,
  darkGray,
  greenBackground,
  redBackground,
  blueBackground,
  yellowBackground,
  grayBackground,
  blueEdges,
  GradientText,
} from './modules/textFormatting';

// ── Types ────────────────────────────────────────────────────────────────────
export type { Shell } from './modules/shell';
export type { StepTaskContext, ParallelStageOptions } from './modules/classes/tasukuReporter';
export type {
  Awaitable,
  CollapseLevel,
  HeaderStyle,
  FormatToken,
  TokenFormatString,
  ScriptTheme,
  CommandOptions,
  StepEffectKind,
  CompensationPolicyKind,
  CompensationPolicy,
  ErrorClass,
  ErrorRegistryInput,
  ErrorRegistryNormalized,
  ShellResult,
  ShellPreviewMode,
  ShellCommandOptions,
  FileSystem,
  Logger,
  Environment,
  CommonRuntimeFlags,
  Runtime,
  StepRunResult,
  InferStepArtifact,
  StageMap,
  StepMapOf,
  ArtifactFor,
  StepDefinition,
  StageDefinition,
  ExecutedStepRecord,
  ExecutedStageRecord,
  CompensationFailure,
  ProcessorResult,
  ProcessorDefinition,
  ExtractCommandOpts,
  ExtractCommandArgs,
  CommandProcessor,
  CommandProcessorFactoryApi,
  CommandProcessorFactory,
  CommandDefinition,
} from './modules/types';
