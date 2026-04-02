import { type TaskInnerAPI, type TaskOptions, type TaskPromise } from "tasuku";
import { type Options as ExecaOptions } from 'execa';
import { FrameworkError } from "../errors";
import { ErrorRegistryInput, StageMap, Runtime, CommonRuntimeFlags, StepMapOf, ArtifactFor, ShellResult } from "../types";
import { StepTaskContext } from "./tasukuReporter";
import { RegisteredErrors } from "./RegisteredErrors";

export class ExecutionContext<
  TInput,
  TShared,
  TFlags extends Record<string, unknown>,
  TRegistry extends ErrorRegistryInput,
  TStages extends StageMap,
> {
  public readonly input: TInput;
  public readonly shared: TShared;
  public readonly runtime: Runtime<TFlags>;
  public readonly errors: RegisteredErrors<TRegistry>;
  public readonly task: StepTaskContext;
  private readonly processorId: string;
  private readonly stepArtifacts: Map<string, unknown>;
  private readonly stageArtifacts: Map<string, unknown>;
  private readonly taskApi?: TaskInnerAPI;

  public constructor(args: {
    processorId: string;
    input: TInput;
    shared: TShared;
    runtime: Runtime<TFlags>;
    errors: RegisteredErrors<TRegistry>;
    stepArtifacts?: Map<string, unknown>;
    stageArtifacts?: Map<string, unknown>;
    taskApi?: TaskInnerAPI;
  }) {
    this.processorId = args.processorId;
    this.input = args.input;
    this.shared = args.shared;
    this.runtime = args.runtime;
    this.errors = args.errors;
    this.stepArtifacts = args.stepArtifacts ?? new Map<string, unknown>();
    this.stageArtifacts = args.stageArtifacts ?? new Map<string, unknown>();
    this.taskApi = args.taskApi;
    const reporterTask = this.runtime.reporter.task;
    this.task = {
      run: <TResult>(title: string, taskFunction: (innerApi: TaskInnerAPI) => Promise<TResult>, options?: TaskOptions): TaskPromise<TResult> => {
        return reporterTask(title, taskFunction, options);
      },
      group: reporterTask.group,
      setTitle: (title: string) => {
        this.taskApi?.setTitle(title);
      },
      setStatus: (status?: string) => {
        if (this.taskApi) {
          this.taskApi.setStatus(status);
          return;
        }
        if (status) {
          this.runtime.log.info(status);
        }
      },
      setWarning: (warning?: Error | string | false | null) => {
        if (this.taskApi) {
          this.taskApi.setWarning(warning);
          return;
        }
        if (warning) {
          this.runtime.log.warn(String(warning));
        }
      },
      setError: (error?: Error | string | false | null) => {
        if (this.taskApi) {
          this.taskApi.setError(error);
          return;
        }
        if (error) {
          this.runtime.log.error(String(error));
        }
      },
      setOutput: (output: string | { message: string }) => {
        if (this.taskApi) {
          this.taskApi.setOutput(output);
          return;
        }
        this.runtime.log.info(typeof output === 'string' ? output : output.message);
      },
      streamPreview: () => this.taskApi?.streamPreview,
      startTime: () => {
        this.taskApi?.startTime();
      },
      stopTime: () => this.taskApi?.stopTime(),
    };
  }

  public isDryRun(): boolean {
    return Boolean((this.runtime.flags as CommonRuntimeFlags).dryRun);
  }

  public async info(message: string, ids?: { stageId?: string; stepId?: string }): Promise<void> {
    this.runtime.log.info(message, ids);
  }

  public setStepArtifact<TArtifact>(stageId: string, stepId: string, artifact: TArtifact): void {
    this.stepArtifacts.set(this.stepKey(stageId, stepId), artifact);
  }

  public getStepArtifact<
    TStageId extends keyof TStages & string,
    TStepId extends keyof StepMapOf<TStages, TStageId> & string,
  >(stageId: TStageId, stepId: TStepId): ArtifactFor<TStages, TStageId, TStepId> {
    const key = this.stepKey(stageId, stepId);
    if (!this.stepArtifacts.has(key)) {
      throw new FrameworkError(`No artifact recorded for step ${stageId}.${stepId}`);
    }
    return this.stepArtifacts.get(key) as ArtifactFor<TStages, TStageId, TStepId>;
  }

  public hasStepArtifact(stageId: string, stepId: string): boolean {
    return this.stepArtifacts.has(this.stepKey(stageId, stepId));
  }

  public setStageArtifact<TArtifact>(stageId: string, artifact: TArtifact): void {
    this.stageArtifacts.set(stageId, artifact);
  }

  public getStageArtifact<TArtifact>(stageId: string): TArtifact {
    if (!this.stageArtifacts.has(stageId)) {
      throw new FrameworkError(`No artifact recorded for stage ${stageId}`);
    }
    return this.stageArtifacts.get(stageId) as TArtifact;
  }

  public hasStageArtifact(stageId: string): boolean {
    return this.stageArtifacts.has(stageId);
  }

  public fail<TKey extends keyof TRegistry & string>(code: TKey, overrideMessage?: string, cause?: unknown): never {
    throw this.errors.create(code, overrideMessage, cause);
  }

  public setTaskTitle(title: string): void {
    this.task.setTitle(title);
  }

  public setTaskStatus(status?: string): void {
    this.task.setStatus(status);
  }

  public setTaskWarning(warning?: Error | string | false | null): void {
    this.task.setWarning(warning);
  }

  public setTaskError(error?: Error | string | false | null): void {
    this.task.setError(error);
  }

  public setTaskOutput(output: string | { message: string }): void {
    this.task.setOutput(output);
  }

  public withTask(taskApi?: TaskInnerAPI): ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages> {
    return new ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>({
      processorId: this.processorId,
      input: this.input,
      shared: this.shared,
      runtime: this.runtime,
      errors: this.errors,
      stepArtifacts: this.stepArtifacts,
      stageArtifacts: this.stageArtifacts,
      taskApi,
    });
  }

  public async $(command: string, args: string[] = [], options?: ExecaOptions): Promise<ShellResult> {
    if (this.isDryRun()) {
      await this.info(`[dry-run] ${command} ${args.join(' ')}`.trim());
      return this.runtime.shell.noop(command, args);
    }
    return this.runtime.shell.run(command, args, options);
  }

  private stepKey(stageId: string, stepId: string): string {
    return `${stageId}::${stepId}`;
  }
}
