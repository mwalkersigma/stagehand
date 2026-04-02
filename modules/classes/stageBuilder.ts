import { ErrorRegistryInput, StepDefinition, CollapseLevel, Awaitable, StepRunResult, StepEffectKind, CompensationPolicy, StageDefinition, StageMap } from "../types";
import { ExecutionContext } from "./executionContext";
import { ParallelStageOptions } from "./tasukuReporter";

type VisibleStages<
  TStageId extends string,
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TSteps extends readonly StepDefinition<string, any, any, any, any, any>[],
  TStageArtifact,
  TStages extends StageMap,
> = TStages & Record<TStageId, StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact>>;

export class StageBuilder<
  TStageId extends string,
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TSteps extends readonly StepDefinition<string, any, any, any, any, any>[],
  TStageArtifact,
  TStages extends StageMap = {},
> {
  private readonly id: TStageId;
  private readonly title: string;
  private collapseLevel?: CollapseLevel;
  private parallelOptions?: ParallelStageOptions;
  private readonly steps: TSteps;
  private buildArtifactHandler?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>) => Awaitable<TStageArtifact>;
  private compensateHandler?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>, artifact: TStageArtifact | undefined) => Promise<void>;

  public constructor(args: { id: TStageId; title: string; steps?: TSteps }) {
    this.id = args.id;
    this.title = args.title;
    this.steps = (args.steps ?? []) as TSteps;
  }

  public collapse(level: CollapseLevel): this {
    this.collapseLevel = level;
    return this;
  }

  public parallel(options: ParallelStageOptions = {}): this {
    this.parallelOptions = options;
    return this;
  }

  public step<
    TStepId extends string,
    TRun extends (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>) => Promise<StepRunResult<any>>,
    TArtifact = Awaited<ReturnType<TRun>>['artifact'],
  >(definition: {
    id: TStepId;
    title: string;
    effect: StepEffectKind;
    compensation: CompensationPolicy;
    when?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>) => Awaitable<boolean>;
    run: TRun;
    compensate?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>, artifact: TArtifact) => Promise<void>;
  }): StageBuilder<
    TStageId,
    TInput,
    TShared,
    TFlags,
    TRegistry,
    readonly [...TSteps, StepDefinition<TStepId, TInput, TShared, TFlags, TRegistry, TArtifact>],
    TStageArtifact,
    TStages
  > {
    const next = new StageBuilder<
      TStageId,
      TInput,
      TShared,
      TFlags,
      TRegistry,
      readonly [...TSteps, StepDefinition<TStepId, TInput, TShared, TFlags, TRegistry, TArtifact>],
      TStageArtifact,
      TStages
    >({
      id: this.id,
      title: this.title,
      steps: [...this.steps, definition] as readonly [...TSteps, StepDefinition<TStepId, TInput, TShared, TFlags, TRegistry, TArtifact>],
    });
    next.collapseLevel = this.collapseLevel;
    next.parallelOptions = this.parallelOptions;
    next.buildArtifactHandler = this.buildArtifactHandler as any;
    next.compensateHandler = this.compensateHandler as any;
    return next;
  }

  public buildArtifact(handler: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>) => Awaitable<TStageArtifact>): this {
    this.buildArtifactHandler = handler;
    return this;
  }

  public compensate(handler: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, VisibleStages<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact, TStages>>, artifact: TStageArtifact | undefined) => Promise<void>): this {
    this.compensateHandler = handler;
    return this;
  }

  public done(): StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TSteps, TStageArtifact> {
    return {
      id: this.id,
      title: this.title,
      collapseLevel: this.collapseLevel,
      parallel: this.parallelOptions,
      steps: this.steps,
      buildArtifact: this.buildArtifactHandler,
      compensate: this.compensateHandler,
    };
  }
}
