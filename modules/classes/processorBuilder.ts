import { FrameworkError } from "../errors";
import { ErrorRegistryInput, StageMap, Runtime, Awaitable, StageDefinition } from "../types";
import { ExecutionContext } from "./executionContext";
import { Processor } from "./processor";
import { RegisteredErrors } from "./RegisteredErrors";
import { StageBuilder } from "./stageBuilder";

export class ProcessorBuilder<
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TResult,
  TStages extends StageMap
> {
  private readonly id: string;
  private readonly title: string;
  public errorsRegistry: RegisteredErrors<TRegistry>;
  private createSharedHandler?: (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
  private finalizeHandler?: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<TResult>;
  private readonly stages: TStages;

  public constructor(args: { id: string; title: string; stages?: TStages }) {
    this.id = args.id;
    this.title = args.title;
    this.errorsRegistry = new RegisteredErrors({} as TRegistry);
    this.stages = (args.stages ?? {}) as TStages;
  }

  public errors<TNextRegistry extends ErrorRegistryInput>(
    registry: TNextRegistry,
  ): ProcessorBuilder<TInput, TShared, TFlags, TNextRegistry, TResult, TStages> {
    const next = new ProcessorBuilder<TInput, TShared, TFlags, TNextRegistry, TResult, TStages>({
      id: this.id,
      title: this.title,
      stages: this.stages,
    });
    next.errorsRegistry = new RegisteredErrors(registry);
    next.createSharedHandler = this.createSharedHandler as unknown as (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
    next.finalizeHandler = this.finalizeHandler as unknown as (ctx: ExecutionContext<TInput, TShared, TFlags, TNextRegistry, TStages>) => Awaitable<TResult>;
    return next;
  }

  public runtime(): ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TResult, TStages> {
    const next = new ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TResult, TStages>({
      id: this.id,
      title: this.title,
      stages: this.stages,
    });
    next.errorsRegistry = this.errorsRegistry as unknown as RegisteredErrors<TRegistry>;
    next.createSharedHandler = this.createSharedHandler as unknown as (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
    next.finalizeHandler = this.finalizeHandler as unknown as (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<TResult>;
    return next;
  }

  public createShared<TNextShared>(
    handler: (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TNextShared>,
  ): ProcessorBuilder<TInput, TNextShared, TFlags, TRegistry, TResult, TStages> {
    const next = new ProcessorBuilder<TInput, TNextShared, TFlags, TRegistry, TResult, TStages>({
      id: this.id,
      title: this.title,
      stages: this.stages,
    });
    next.errorsRegistry = this.errorsRegistry as unknown as RegisteredErrors<TRegistry>;
    next.createSharedHandler = handler;
    next.finalizeHandler = this.finalizeHandler as unknown as (ctx: ExecutionContext<TInput, TNextShared, TFlags, TRegistry, TStages>) => Awaitable<TResult>;
    return next;
  }

  public stage<
    TStageId extends string,
    TStageArtifact,
    TConfiguredStage extends StageBuilder<
      TStageId,
      TInput,
      TShared,
      TFlags,
      TRegistry,
      any,
      TStageArtifact,
      TStages
    >,
  >(
    id: TStageId,
    title: string,
    configure: (builder: StageBuilder<TStageId, TInput, TShared, TFlags, TRegistry, readonly [], TStageArtifact, TStages>) => TConfiguredStage,
  ): ProcessorBuilder<
    TInput,
    TShared,
    TFlags,
    TRegistry,
    TResult,
    TStages & {
      [K in TStageId]: TConfiguredStage extends StageBuilder<
        TStageId,
        TInput,
        TShared,
        TFlags,
        TRegistry,
        infer TConfiguredSteps,
        TStageArtifact,
        TStages
      >
      ? StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TConfiguredSteps, TStageArtifact>
      : never
    }
  > {
    const builder = new StageBuilder<TStageId, TInput, TShared, TFlags, TRegistry, readonly [], TStageArtifact, TStages>({ id, title, steps: [] as const });
    const stage = configure(builder).done();
    const nextStages = {
      ...this.stages,
      [id]: stage,
    } as TStages & {
      [K in TStageId]: TConfiguredStage extends StageBuilder<
        TStageId,
        TInput,
        TShared,
        TFlags,
        TRegistry,
        infer TConfiguredSteps,
        TStageArtifact,
        TStages
      >
      ? StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TConfiguredSteps, TStageArtifact>
      : never
    };

    const next = new ProcessorBuilder<
      TInput,
      TShared,
      TFlags,
      TRegistry,
      TResult,
      TStages & {
        [K in TStageId]: TConfiguredStage extends StageBuilder<
          TStageId,
          TInput,
          TShared,
          TFlags,
          TRegistry,
          infer TConfiguredSteps,
          TStageArtifact,
          TStages
        >
        ? StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TConfiguredSteps, TStageArtifact>
        : never
      }
    >({
      id: this.id,
      title: this.title,
      stages: nextStages,
    });
    next.errorsRegistry = this.errorsRegistry;
    next.createSharedHandler = this.createSharedHandler as unknown as (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
    next.finalizeHandler = this.finalizeHandler as unknown as (ctx: ExecutionContext<
      TInput,
      TShared,
      TFlags,
      TRegistry,
      TStages & {
        [K in TStageId]: TConfiguredStage extends StageBuilder<
          TStageId,
          TInput,
          TShared,
          TFlags,
          TRegistry,
          infer TConfiguredSteps,
          TStageArtifact,
          TStages
        >
        ? StageDefinition<TStageId, TInput, TShared, TFlags, TRegistry, TConfiguredSteps, TStageArtifact>
        : never
      }
    >) => Awaitable<TResult>;
    return next;
  }

  public finalize<TNextResult>(
    handler: (ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>) => Awaitable<TNextResult>,
  ): ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TNextResult, TStages> {
    const next = new ProcessorBuilder<TInput, TShared, TFlags, TRegistry, TNextResult, TStages>({
      id: this.id,
      title: this.title,
      stages: this.stages,
    });
    next.errorsRegistry = this.errorsRegistry;
    next.createSharedHandler = this.createSharedHandler as unknown as (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TShared>;
    next.finalizeHandler = handler;
    return next;
  }

  public build(): Processor<TInput, TShared, TFlags, TRegistry, TResult, TStages> {
    if (!this.createSharedHandler) {
      throw new FrameworkError('ProcessorBuilder requires createShared() before build()');
    }
    if (!this.finalizeHandler) {
      throw new FrameworkError('ProcessorBuilder requires finalize() before build()');
    }
    return new Processor<TInput, TShared, TFlags, TRegistry, TResult, TStages>({
      id: this.id,
      title: this.title,
      errors: this.errorsRegistry,
      createShared: this.createSharedHandler,
      stages: this.stages,
      finalize: this.finalizeHandler,
    });
  }
}
