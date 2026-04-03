import { describe, test, expect, mock } from "bun:test";
import { ProcessorBuilder } from "../modules/classes/processorBuilder";
import { FrameworkError } from "../modules/errors";
import { createMockRuntime } from "./helpers";

describe("Processor", () => {
  test("runs stages sequentially in order", async () => {
    const executionOrder: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, string[], {}>({
      id: "seq-stages-proc",
      title: "Sequential Stages",
    })
      .createShared(async () => ({}))
      .stage("stage-a", "Stage A", (s) =>
        s.step({
          id: "step-1",
          title: "Step A1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            executionOrder.push("stage-a");
            return { artifact: null };
          },
        })
      )
      .stage("stage-b", "Stage B", (s) =>
        s.step({
          id: "step-1",
          title: "Step B1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            executionOrder.push("stage-b");
            return { artifact: null };
          },
        })
      )
      .finalize(async () => executionOrder)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["stage-a", "stage-b"]);
      expect(result.completedStages).toEqual(["stage-a", "stage-b"]);
      expect(result.completedSteps).toEqual(["stage-a.step-1", "stage-b.step-1"]);
    }
  });

  test("runs sequential steps in order within a stage", async () => {
    const executionOrder: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, string[], {}>({
      id: "seq-steps-proc",
      title: "Sequential Steps",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "step-1",
            title: "Step 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              executionOrder.push("step-1");
              return { artifact: null };
            },
          })
          .step({
            id: "step-2",
            title: "Step 2",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              executionOrder.push("step-2");
              return { artifact: null };
            },
          })
          .step({
            id: "step-3",
            title: "Step 3",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              executionOrder.push("step-3");
              return { artifact: null };
            },
          })
      )
      .finalize(async () => executionOrder)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["step-1", "step-2", "step-3"]);
    }
  });

  test("calls setStatus('complete') on successful stage", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "status-proc",
      title: "Status Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "My Stage", (s) =>
        s.step({
          id: "step-1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: null }),
        })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    await processor.run(undefined as void, runtime);

    const stageCall = runtime.mockTask.calls.find(
      (c) => c.title === "My Stage"
    );
    expect(stageCall).toBeDefined();
    expect(stageCall!.innerApi.setStatus).toHaveBeenCalledWith("complete");
  });

  test("calls setError on stage failure", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "error-proc",
      title: "Error Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Failing Stage", (s) =>
        s.step({
          id: "fail-step",
          title: "Failing Step",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            throw new Error("boom");
          },
        })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(false);

    const stageCall = runtime.mockTask.calls.find(
      (c) => c.title === "Failing Stage"
    );
    expect(stageCall).toBeDefined();
    expect(stageCall!.innerApi.setError).toHaveBeenCalled();
  });

  test("prints header before running stages", async () => {
    const order: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "header-proc",
      title: "Header Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s.step({
          id: "step-1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => {
            order.push("stage-ran");
            return { artifact: null };
          },
        })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const meta = { version: "1.0", env: "test" };

    // Replace printHeader to track ordering
    (runtime.reporter as any).printHeader = mock(async () => {
      order.push("header-printed");
    });

    await processor.run(undefined as void, runtime, meta);

    // Header was printed before stage ran
    expect(order).toEqual(["header-printed", "stage-ran"]);
    expect(runtime.reporter.printHeader).toHaveBeenCalledWith({
      title: "Header Processor",
      meta,
    });
  });

  test("runs parallel steps concurrently", async () => {
    const ran: string[] = [];

    const processor = new ProcessorBuilder<
      void,
      {},
      {},
      {},
      { r1: unknown; r2: unknown },
      {}
    >({
      id: "parallel-proc",
      title: "Parallel Processor",
    })
      .createShared(async () => ({}))
      .stage("ps", "Parallel Stage", (s) =>
        s
          .parallel()
          .step({
            id: "p-step-1",
            title: "Parallel Step 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              ran.push("p-step-1");
              return { artifact: "result-1" };
            },
          })
          .step({
            id: "p-step-2",
            title: "Parallel Step 2",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              ran.push("p-step-2");
              return { artifact: "result-2" };
            },
          })
      )
      .finalize(async (ctx) => ({
        r1: ctx.getStepArtifact("ps", "p-step-1"),
        r2: ctx.getStepArtifact("ps", "p-step-2"),
      }))
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    expect(ran).toContain("p-step-1");
    expect(ran).toContain("p-step-2");
    if (result.ok) {
      expect(result.value).toEqual({ r1: "result-1", r2: "result-2" });
    }
  });

  test("skips steps where when() returns false", async () => {
    const ran: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, string[], {}>({
      id: "when-false-proc",
      title: "When False Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "always",
            title: "Always Runs",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              ran.push("always");
              return { artifact: null };
            },
          })
          .step({
            id: "skipped",
            title: "Skipped Step",
            effect: "read",
            compensation: { kind: "none" },
            when: () => false,
            run: async () => {
              ran.push("skipped");
              return { artifact: null };
            },
          })
      )
      .finalize(async () => ran)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["always"]);
    }
  });

  test("skips steps where when() uses runtime flags", async () => {
    const ran: string[] = [];

    const processor = new ProcessorBuilder<
      void,
      {},
      { skipSecond: boolean },
      {},
      string[],
      {}
    >({
      id: "flags-when-proc",
      title: "Flags When Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "first",
            title: "First Step",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              ran.push("first");
              return { artifact: null };
            },
          })
          .step({
            id: "second",
            title: "Second Step",
            effect: "read",
            compensation: { kind: "none" },
            when: (ctx) => !ctx.runtime.flags.skipSecond,
            run: async () => {
              ran.push("second");
              return { artifact: null };
            },
          })
      )
      .finalize(async () => ran)
      .build();

    const runtime = createMockRuntime({ skipSecond: true });
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["first"]);
    }
  });

  test("compensates executed steps in reverse order on failure", async () => {
    const compensated: string[] = [];

    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "comp-proc",
      title: "Compensation Processor",
    })
      .createShared(async () => ({}))
      .stage("stage-a", "Stage A", (s) =>
        s
          .step({
            id: "ok-step-1",
            title: "OK Step 1",
            effect: "create",
            compensation: { kind: "best-effort" },
            run: async () => ({ artifact: "first" }),
            compensate: async (_ctx, artifact) => {
              compensated.push(`compensated:${artifact}`);
            },
          })
          .step({
            id: "ok-step-2",
            title: "OK Step 2",
            effect: "create",
            compensation: { kind: "best-effort" },
            run: async () => ({ artifact: "second" }),
            compensate: async (_ctx, artifact) => {
              compensated.push(`compensated:${artifact}`);
            },
          })
      )
      .stage("stage-b", "Stage B", (s) =>
        s.step({
          id: "fail-step",
          title: "Failing Step",
          effect: "create",
          compensation: { kind: "none" },
          run: async () => {
            throw new Error("boom");
          },
        })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(false);
    // Steps are compensated in reverse execution order
    expect(compensated).toEqual(["compensated:second", "compensated:first"]);
  });

  test("reports compensation failures for required compensator without compensate function", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "comp-fail-proc",
      title: "Missing Compensator Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "no-comp-step",
            title: "No Compensator",
            effect: "create",
            compensation: { kind: "required" },
            run: async () => ({ artifact: "data" }),
            compensate: async () => {
              throw new FrameworkError("Compensation failed");
            },
          })
          .step({
            id: "fail-step",
            title: "Failing Step",
            effect: "create",
            compensation: { kind: "none" },
            run: async () => {
              throw new Error("boom");
            },
          })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.compensationFailures).toHaveLength(1);
      expect(result.compensationFailures[0]!.stageId).toBe("s");
      expect(result.compensationFailures[0]!.stepId).toBe("no-comp-step");
      expect(result.compensationFailures[0]!.error).toBeInstanceOf(
        FrameworkError
      );
    }
  });

  test("records step artifacts accessible via getStepArtifact", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, unknown, {}>({
      id: "step-artifact-proc",
      title: "Step Artifact Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s.step({
          id: "data-step",
          title: "Data Step",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: { data: 42 } }),
        })
      )
      .finalize(async (ctx) => ctx.getStepArtifact("s", "data-step"))
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ data: 42 });
    }
  });

  test("records stage artifacts accessible via getStageArtifact", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, unknown, {}>({
      id: "stage-artifact-proc",
      title: "Stage Artifact Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "step-1",
            title: "Step 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: "step-result" }),
          })
          .buildArtifact(async () => ({ summary: "stage done" }))
      )
      .finalize(async (ctx) => ctx.getStageArtifact("s"))
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ summary: "stage done" });
    }
  });

  test("applies stage-level collapse by calling clear()", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "collapse-stage-proc",
      title: "Collapse Stage Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .step({
            id: "step-1",
            title: "Step 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: null }),
          })
          .collapse("stage")
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});

    await processor.run(undefined as void, runtime);

    const stageEntry = runtime.mockTask.calls.find((call) => call.title === "Stage");
    expect(stageEntry).toBeDefined();
    expect(stageEntry!.clear).toHaveBeenCalled();
  });

  test("applies task-level collapse by clearing the step task group", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "collapse-tasks-proc",
      title: "Collapse Tasks Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .collapse("tasks")
          .step({
            id: "step-1",
            title: "Step 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: null }),
          })
          .step({
            id: "step-2",
            title: "Step 2",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => ({ artifact: null }),
          })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});

    await processor.run(undefined as void, runtime);

    const stepGroup = runtime.mockTask.groups.find(
      (group) => group.titles.includes("Step 1") && group.titles.includes("Step 2"),
    );
    expect(stepGroup).toBeDefined();
    expect(stepGroup!.clear).toHaveBeenCalled();

    const stageEntry = runtime.mockTask.calls.find((call) => call.title === "Stage");
    expect(stageEntry).toBeDefined();
    expect(stageEntry!.clear).not.toHaveBeenCalled();
  });

  test("parallel step failures create FrameworkError", async () => {
    const processor = new ProcessorBuilder<void, {}, {}, {}, void, {}>({
      id: "parallel-fail-proc",
      title: "Parallel Failure Processor",
    })
      .createShared(async () => ({}))
      .stage("ps", "Parallel Stage", (s) =>
        s
          .parallel()
          .step({
            id: "fail-1",
            title: "Fail 1",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              throw new Error("error-1");
            },
          })
          .step({
            id: "fail-2",
            title: "Fail 2",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              throw new Error("error-2");
            },
          })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(FrameworkError);
      expect((result.error as FrameworkError).cause).toBeInstanceOf(
        AggregateError
      );
    }
  });

  test("finalize receives correct context with all artifacts", async () => {
    const processor = new ProcessorBuilder<
      void,
      {},
      {},
      {},
      { combined: string },
      {}
    >({
      id: "finalize-proc",
      title: "Finalize Processor",
    })
      .createShared(async () => ({}))
      .stage("stage-a", "Stage A", (s) =>
        s.step({
          id: "step-a1",
          title: "Step A1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: "alpha" }),
        })
      )
      .stage("stage-b", "Stage B", (s) =>
        s.step({
          id: "step-b1",
          title: "Step B1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: "beta" }),
        })
      )
      .finalize(async (ctx) => {
        const a = ctx.getStepArtifact("stage-a", "step-a1") as string;
        const b = ctx.getStepArtifact("stage-b", "step-b1") as string;
        return { combined: `${a}+${b}` };
      })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ combined: "alpha+beta" });
      expect(result.completedStages).toEqual(["stage-a", "stage-b"]);
      expect(result.completedSteps).toEqual([
        "stage-a.step-a1",
        "stage-b.step-b1",
      ]);
    }
  });
});
