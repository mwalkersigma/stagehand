import { describe, test, expect } from "bun:test";
import { ProcessorBuilder } from "../modules/classes/processorBuilder";
import { FrameworkError } from "../modules/errors";
import { createMockRuntime } from "./helpers";

describe("ProcessorBuilder", () => {
  test("throws if build() called without createShared()", () => {
    const builder = new ProcessorBuilder<void, never, Record<string, unknown>, {}, void, {}>({
      id: "no-shared",
      title: "No Shared",
    }).finalize(async () => { });

    expect(() => builder.build()).toThrow(FrameworkError);
    expect(() => builder.build()).toThrow(/createShared/);
  });

  test("throws if build() called without finalize()", () => {
    const builder = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, void, {}>({
      id: "no-finalize",
      title: "No Finalize",
    }).createShared(async () => ({}));

    expect(() => builder.build()).toThrow(FrameworkError);
    expect(() => builder.build()).toThrow(/finalize/);
  });

  test("builds a valid Processor with minimal configuration", () => {
    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, string, {}>({
      id: "minimal",
      title: "Minimal Processor",
    })
      .createShared(async () => ({}))
      .finalize(async () => "done")
      .build();

    expect(processor).toBeTruthy();
    expect(typeof processor.run).toBe("function");
  });

  test("preserves stages through the builder chain", async () => {
    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, void, {}>({
      id: "two-stages",
      title: "Two Stages",
    })
      .createShared(async () => ({}))
      .stage("stage-a", "Stage A", (s) =>
        s.step({
          id: "step-a1",
          title: "Step A1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: null }),
        })
      )
      .stage("stage-b", "Stage B", (s) =>
        s.step({
          id: "step-b1",
          title: "Step B1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: null }),
        })
      )
      .finalize(async () => { })
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.completedStages).toEqual(["stage-a", "stage-b"]);
    }
  });

  test("errors() creates a RegisteredErrors instance", async () => {
    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, string, {}>({
      id: "with-errors",
      title: "With Errors",
    })
      .errors({ MY_ERR: "test error" })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s.step({
          id: "step-1",
          title: "Step 1",
          effect: "read",
          compensation: { kind: "none" },
          run: async () => ({ artifact: null }),
        })
      )
      .finalize(async () => "ok")
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("ok");
    }
  });

  test("stage builder adds steps correctly", async () => {
    const executionOrder: string[] = [];

    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, string[], {}>({
      id: "multi-step",
      title: "Multi Step",
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
      )
      .finalize(async () => executionOrder)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["step-1", "step-2"]);
    }
  });

  test("stage builder sets parallel mode", async () => {
    const executed: string[] = [];

    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, string[], {}>({
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
              executed.push("p-step-1");
              return { artifact: "r1" };
            },
          })
          .step({
            id: "p-step-2",
            title: "Parallel Step 2",
            effect: "read",
            compensation: { kind: "none" },
            run: async () => {
              executed.push("p-step-2");
              return { artifact: "r2" };
            },
          })
      )
      .finalize(async () => executed)
      .build();

    const runtime = createMockRuntime({});
    const result = await processor.run(undefined as void, runtime);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("p-step-1");
      expect(result.value).toContain("p-step-2");
      expect(result.completedSteps).toEqual(
        expect.arrayContaining(["ps.p-step-1", "ps.p-step-2"])
      );
    }
  });

  test("stage builder sets collapse level", async () => {
    const processor = new ProcessorBuilder<void, {}, Record<string, unknown>, {}, void, {}>({
      id: "collapse-proc",
      title: "Collapse Processor",
    })
      .createShared(async () => ({}))
      .stage("s", "Stage", (s) =>
        s
          .collapse("stage")
          .step({
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
    const result = await processor.run(undefined as void, runtime);

    // Just verify it doesn't throw — collapse behavior is tested in processor.test.ts
    expect(result.ok).toBe(true);
  });
});
