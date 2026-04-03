import {FrameworkError} from "../errors";
import {
    ErrorRegistryInput,
    StageMap,
    ProcessorDefinition,
    Runtime,
    ProcessorResult,
    ExecutedStepRecord,
    ExecutedStageRecord,
    CompensationFailure,
    CommonRuntimeFlags,
    CollapseLevel
} from "../types";
import {ExecutionContext} from "./executionContext";

export class Processor<
    TInput,
    TShared,
    TFlags extends Record<string, unknown>,
    TRegistry extends ErrorRegistryInput,
    TResult,
    TStages extends StageMap,
> {
    private readonly definition: ProcessorDefinition<TInput, TShared, TFlags, TRegistry, TResult, TStages>;

    public constructor(definition: ProcessorDefinition<TInput, TShared, TFlags, TRegistry, TResult, TStages>) {
        this.definition = definition;
    }

    public async run(input: TInput, runtime: Runtime<TFlags>, meta: Record<string, string> = {}): Promise<ProcessorResult<TResult>> {
        const shared = await this.definition.createShared(input, runtime);
        const ctx = new ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>({
            processorId: this.definition.id,
            input,
            shared,
            runtime,
            errors: this.definition.errors,
        });

        const completedStages: string[] = [];
        const completedSteps: string[] = [];
        const executedSteps: ExecutedStepRecord[] = [];
        const executedStages: ExecutedStageRecord[] = [];
        const compensationFailures: CompensationFailure[] = [];

        await runtime.reporter.printHeader({
            title: this.definition.title,
            meta,
        });

        const stageKeys = Object.keys(this.definition.stages) as Array<keyof TStages & string>;
        const task = runtime.reporter.task;

        try {
            await task.group(stageTask => stageKeys.map(
                    stageKey => {
                        let stage = this.definition.stages[stageKey]!;
                        const collapseLevel = this.resolveCollapseLevel(stage, runtime);
                        const s = stageTask(stage.title, async ({setError, setStatus}) => {
                            try {


                                const runnableSteps = await this.resolveRunnableSteps(stage, ctx);
                                const isParallel = stage.parallel ?? false;

                                const stepCount = runnableSteps.length;

                                const stepTasks = task.group(
                                    sub => runnableSteps.map(step => sub(
                                        step.title,
                                        async (stepApi) => {
                                            const record = await this.executeStep(stage, step, ctx.withTask(stepApi));
                                            executedSteps.push(record);
                                            completedSteps.push(`${record.stageId}.${record.stepId}`);
                                            return record;
                                        })
                                    ),
                                    {
                                        concurrency: isParallel ? stepCount : 1,
                                        stopOnError: !isParallel,
                                    }
                                );
                                try {
                                    if (collapseLevel === 'tasks') {
                                        await stepTasks.clear();
                                    } else {
                                        await stepTasks;
                                    }
                                } catch (error) {
                                    if (isParallel) {
                                        throw new FrameworkError(`Parallel steps failed in stage ${stage.id}`, {cause: error});
                                    }
                                    throw error;
                                }


                                const stageArtifact = stage.buildArtifact ? await stage.buildArtifact(ctx) : undefined;
                                if (typeof stageArtifact !== 'undefined') {
                                    ctx.setStageArtifact(stage.id, stageArtifact);
                                }
                                setStatus('complete');
                                executedStages.push({stageId: stage.id, title: stage.title, artifact: stageArtifact});
                                completedStages.push(stage.id);
                            } catch (error) {
                                setError(error instanceof Error ? error : String(error));
                                throw error;
                            }
                        })
                        if (collapseLevel === 'stage') {
                            s.clear();
                        }
                        return s
                    }
                )
            );
        } catch (error) {
            await this.compensate(runtime, ctx, executedSteps, executedStages, compensationFailures);
            return {ok: false, error, completedStages, completedSteps, compensationFailures};
        }
        const value = await this.definition.finalize(ctx);
        return {ok: true, value, completedStages, completedSteps};

    }


    // Run stages sequentially using direct task() calls.
    // Each stage is a top-level task(); steps inside auto-nest via tasuku v3
    // context detection. This gives incremental rendering — each stage and
    // step appears in the terminal as soon as it starts.
    //
    // This matches the working tasuku v3 pattern:
    //   await task('Stage', async ({ setStatus }) => {
    //     await task('Step 1', async () => { ... });
    //     await task('Step 2', async () => { ... });
    //     setStatus('complete');
    //   });
    //   for (const stageKey of stageKeys) {
    //     const stage = this.definition.stages[stageKey]!;
    //     const collapseLevel = this.resolveCollapseLevel(stage, runtime);

    //     const stagePromise = task(stage.title, async ({ setStatus, setError }) => {
    //       const runnableSteps = await this.resolveRunnableSteps(stage, ctx);

    //       try {
    //         if (stage.parallel && runnableSteps.length > 0) {
    //           // Parallel: fire task() calls without individual awaits.
    //           // v3 auto-detects the nesting context so each task()
    //           // appears as a child of this stage task.
    //           await this.runParallelSteps({
    //             stage,
    //             steps: runnableSteps,
    //             ctx,
    //             executedSteps,
    //             completedSteps,
    //             collapseLevel,
    //           });
    //         } else if (runnableSteps.length > 0) {
    //           // Sequential: await each task() one at a time inside the
    //           // stage callback — matches the v3 nested-sequential pattern.
    //           await this.runSequentialSteps({
    //             stage,
    //             steps: runnableSteps,
    //             ctx,
    //             executedSteps,
    //             completedSteps,
    //             collapseLevel,
    //           });
    //         }

    //         // Build the stage artifact (if configured)
    //         const stageArtifact = stage.buildArtifact ? await stage.buildArtifact(ctx) : undefined;
    //         if (typeof stageArtifact !== 'undefined') {
    //           ctx.setStageArtifact(stage.id, stageArtifact);
    //         }
    //         executedStages.push({ stageId: stage.id, title: stage.title, artifact: stageArtifact });
    //         completedStages.push(stage.id);

    //         // setStatus('complete');
    //       } catch (error) {
    //         setError(error instanceof Error ? error : String(error));
    //         throw error;
    //       }
    //     });

    //     // Stage-level collapse: clear the entire stage (hides children too)
    //     // This matches: await task('Stage', ...).clear()
    //     if (collapseLevel === 'stage') {
    //       await stagePromise.clear();
    //     } else {
    //       await stagePromise;
    //     }
    //   }

    //   const value = await this.definition.finalize(ctx);
    //   return { ok: true, value, completedStages, completedSteps };
    // } catch (error) {
    //   await this.compensate(runtime, ctx, executedSteps, executedStages, compensationFailures);
    //   return { ok: false, error, completedStages, completedSteps, compensationFailures };
    // }
    // }

    /**
     * Sequential steps: await each task() one at a time inside the stage.
     * v3 auto-nests each step under the parent stage task.
     *
     * ```
     * await task('Stage', async ({ setStatus }) => {
     *   await task('Step 1', async () => { ... });
     *   await task('Step 2', async () => { ... });
     *   setStatus('complete')
     * })
     * ```
     */
    // private async runSequentialSteps(args: {
    //     stage: TStages[keyof TStages];
    //     steps: Array<TStages[keyof TStages]['steps'][number]>;
    //     ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>;
    //     executedSteps: ExecutedStepRecord[];
    //     completedSteps: string[];
    //     collapseLevel: CollapseLevel;
    // }): Promise<void> {
    //     const {stage, steps, ctx, executedSteps, completedSteps, collapseLevel} = args;
    //     const task = ctx.runtime.reporter.task;
    //
    //     for (const step of steps) {
    //         const stepPromise = task(step.title, async (stepApi) => {
    //             const record = await this.executeStep(stage, step, ctx.withTask(stepApi));
    //             executedSteps.push(record);
    //             completedSteps.push(`${record.stageId}.${record.stepId}`);
    //             return record;
    //         });
    //
    //         // Step-level collapse: clear individual step tasks
    //         // This matches: task('Step', ...).clear()
    //         if (collapseLevel === 'tasks') {
    //             await stepPromise.clear();
    //         } else {
    //             await stepPromise;
    //         }
    //     }
    // }

    /**
     * Parallel steps: fire task() calls without awaiting individually.
     * v3 auto-nests them under the parent stage task.
     *
     * ```
     * await task('Stage', async ({ setStatus }) => {
     *   task('Step 1', async () => { ... })
     *   task('Step 2', async () => { ... })
     *   setStatus('complete')
     * })
     * ```
     *
     * We still collect the promises with Promise.allSettled so we can
     * gather artifacts and handle per-step failures.
     */
    // private async runParallelSteps(args: {
    //     stage: TStages[keyof TStages];
    //     steps: Array<TStages[keyof TStages]['steps'][number]>;
    //     ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>;
    //     executedSteps: ExecutedStepRecord[];
    //     completedSteps: string[];
    //     collapseLevel: CollapseLevel;
    // }): Promise<void> {
    //     const {stage, steps, ctx, executedSteps, completedSteps, collapseLevel} = args;
    //     const task = ctx.runtime.reporter.task;
    //
    //     // Fire off all step tasks at once — no individual awaits (parallel)
    //     const promises = steps.map(step => {
    //         const p = task(step.title, async (stepApi) => {
    //             const result = await step.run(ctx.withTask(stepApi));
    //             ctx.setStepArtifact(stage.id, step.id, result.artifact);
    //             return {
    //                 stageId: stage.id,
    //                 stepId: step.id,
    //                 title: step.title,
    //                 artifact: result.artifact,
    //                 compensation: step.compensation,
    //             } as ExecutedStepRecord;
    //         });
    //
    //         // Step-level collapse: clear individual step tasks
    //         return collapseLevel === 'tasks' ? p.clear() : p;
    //     });
    //
    //     // Wait for all to settle so we can collect successes and failures
    //     const settled = await Promise.allSettled(promises);
    //     const failures: Array<{ step: (typeof steps)[number]; error: unknown }> = [];
    //
    //     for (const [i, result] of settled.entries()) {
    //         const step = steps[i]!;
    //         if (result.status === 'fulfilled') {
    //             executedSteps.push(result.value);
    //             completedSteps.push(`${stage.id}.${step.id}`);
    //         } else {
    //             failures.push({step, error: result.reason});
    //         }
    //     }
    //
    //     if (failures.length > 0) {
    //         if (failures.length === 1) {
    //             throw new FrameworkError(`Step failed: ${stage.id}.${failures[0]!.step.id}`, {cause: failures[0]!.error});
    //         }
    //         throw new FrameworkError(`Parallel steps failed in stage ${stage.id}`, {
    //             cause: new AggregateError(failures.map(f => f.error), `Parallel step failures in stage ${stage.id}`),
    //         });
    //     }
    // }

    /**
     * Execute a single step and return the execution record.
     * The provided `ctx` should already have the step's TaskInnerAPI applied via `withTask()`.
     */
    private async executeStep(
        stage: TStages[keyof TStages],
        step: TStages[keyof TStages]['steps'][number],
        ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>,
    ): Promise<ExecutedStepRecord> {
        try {
            const result = await step.run(ctx);
            ctx.setStepArtifact(stage.id, step.id, result.artifact);
            return {
                stageId: stage.id,
                stepId: step.id,
                title: step.title,
                artifact: result.artifact,
                compensation: step.compensation,
            };
        } catch (error) {
            throw new FrameworkError(`Step failed: ${stage.id}.${step.id}`, {cause: error});
        }
    }

    /**
     * Filter steps by their `when` guard, returning only those that should run.
     */
    private async resolveRunnableSteps(
        stage: TStages[keyof TStages],
        ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>,
    ): Promise<Array<TStages[keyof TStages]['steps'][number]>> {
        const runnableSteps: Array<TStages[keyof TStages]['steps'][number]> = [];
        for (const step of stage.steps) {
            const shouldRun = await step.when?.(ctx);
            if (shouldRun === false) continue;
            runnableSteps.push(step);
        }
        return runnableSteps;
    }

    /**
     * Resolve the effective collapse level for a stage.
     * Priority: stage-specific → runtime flag → theme default.
     */
    private resolveCollapseLevel(
        stage: TStages[keyof TStages],
        runtime: Runtime<TFlags>,
    ): CollapseLevel {
        return stage.collapseLevel
            ?? (runtime.flags as CommonRuntimeFlags).collapseLevel
            ?? runtime.theme.collapseLevel;
    }

    /**
     * Walk executed steps and stages in reverse order, running compensator functions.
     */
    private async compensate(
        runtime: Runtime<TFlags>,
        ctx: ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages>,
        executedSteps: ExecutedStepRecord[],
        executedStages: ExecutedStageRecord[],
        compensationFailures: CompensationFailure[],
    ): Promise<void> {
        // Compensate steps in reverse execution order
        for (const record of [...executedSteps].reverse()) {
            const stage = this.definition.stages[record.stageId as keyof TStages];
            const step = stage?.steps.find((item: { id: string }) => item.id === record.stepId);
            if (!stage || !step) continue;
            if (record.compensation.kind === 'none') continue;
            if (!step.compensate) {
                if (record.compensation.kind === 'required') {
                    compensationFailures.push({
                        stageId: record.stageId,
                        stepId: record.stepId,
                        error: new FrameworkError(`Missing required compensator for ${record.stageId}.${record.stepId}`),
                    });
                }
                continue;
            }
            try {
                await step.compensate(ctx, record.artifact);
                runtime.log.info(`Compensated step: ${record.stageId}.${record.stepId}`);
            } catch (error) {
                compensationFailures.push({stageId: record.stageId, stepId: record.stepId, error});
            }
        }

        // Compensate stages in reverse execution order
        for (const record of [...executedStages].reverse()) {
            const stage = this.definition.stages[record.stageId as keyof TStages];
            if (!stage?.compensate) continue;
            try {
                await stage.compensate(ctx, record.artifact);
                runtime.log.info(`Compensated stage: ${record.stageId}`);
            } catch (error) {
                compensationFailures.push({stageId: record.stageId, error});
            }
        }
    }
}
