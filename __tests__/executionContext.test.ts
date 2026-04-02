import { describe, test, expect } from "bun:test";
import { ExecutionContext } from "../modules/classes/executionContext";
import { RegisteredErrors } from "../modules/classes/RegisteredErrors";
import { FrameworkError } from "../modules/errors";
import { createMockRuntime, createMockTaskInnerAPI } from "./helpers";

describe("ExecutionContext", () => {
  test("exposes input, shared, and runtime", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const input = { foo: "bar" };
    const shared = { data: 42 };

    const ctx = new ExecutionContext({
      processorId: "test",
      input,
      shared,
      runtime,
      errors,
    });

    expect(ctx.input).toBe(input);
    expect(ctx.shared).toBe(shared);
    expect(ctx.runtime).toBe(runtime);
    expect(ctx.errors).toBe(errors);
  });

  test("withTask creates new context with TaskInnerAPI bound", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    const mockInnerApi = createMockTaskInnerAPI();
    const childCtx = ctx.withTask(mockInnerApi);

    childCtx.setTaskTitle("hello");

    expect(mockInnerApi.setTitle).toHaveBeenCalledWith("hello");
  });

  test("withTask shares artifact maps with parent context", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    // Set artifact on parent
    ctx.setStepArtifact("stage-1", "step-1", "parent-artifact");

    // Create child via withTask
    const mockInnerApi = createMockTaskInnerAPI();
    const childCtx = ctx.withTask(mockInnerApi);

    // Child should see parent's artifact
    expect(childCtx.getStepArtifact("stage-1" as never, "step-1" as never)).toBe("parent-artifact");

    // Set artifact on child
    childCtx.setStepArtifact("stage-2", "step-2", "child-artifact");

    // Parent should see child's artifact
    expect(ctx.getStepArtifact("stage-2" as never, "step-2" as never)).toBe("child-artifact");
  });

  test("setTaskTitle delegates to taskApi when bound", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const taskApi = createMockTaskInnerAPI();

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
      taskApi,
    });

    ctx.setTaskTitle("hello");

    expect(taskApi.setTitle).toHaveBeenCalledWith("hello");
  });

  test("setTaskTitle is a no-op without taskApi", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    // Should not throw
    expect(() => ctx.setTaskTitle("hello")).not.toThrow();
  });

  test("setTaskOutput delegates to taskApi", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const taskApi = createMockTaskInnerAPI();

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
      taskApi,
    });

    ctx.setTaskOutput("some output");

    expect(taskApi.setOutput).toHaveBeenCalledWith("some output");
  });

  test("setTaskStatus delegates to taskApi", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});
    const taskApi = createMockTaskInnerAPI();

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
      taskApi,
    });

    ctx.setTaskStatus("working");

    expect(taskApi.setStatus).toHaveBeenCalledWith("working");
  });

  test("setTaskStatus logs to runtime.log.info when no taskApi", () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    ctx.task.setStatus("working");

    expect(runtime.log.info).toHaveBeenCalledWith("working");
  });

  test("isDryRun returns true when dryRun flag is set", () => {
    const runtime = createMockRuntime({ dryRun: true });
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    expect(ctx.isDryRun()).toBe(true);
  });

  test("isDryRun returns false when dryRun flag is not set", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    expect(ctx.isDryRun()).toBe(false);
  });

  test("setStepArtifact and getStepArtifact round-trip", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    const artifact = { result: "some-data", count: 7 };
    ctx.setStepArtifact("my-stage", "my-step", artifact);

    const retrieved = ctx.getStepArtifact("my-stage" as never, "my-step" as never);
    expect(retrieved).toBe(artifact);
  });

  test("getStepArtifact throws FrameworkError for missing artifact", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    expect(() => ctx.getStepArtifact("nonexistent-stage" as never, "nonexistent-step" as never)).toThrow(FrameworkError);
    expect(() => ctx.getStepArtifact("nonexistent-stage" as never, "nonexistent-step" as never)).toThrow(
      "No artifact recorded for step nonexistent-stage.nonexistent-step",
    );
  });

  test("hasStepArtifact returns true/false correctly", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    ctx.setStepArtifact("s1", "step-a", "value");

    expect(ctx.hasStepArtifact("s1", "step-a")).toBe(true);
    expect(ctx.hasStepArtifact("s1", "step-missing")).toBe(false);
    expect(ctx.hasStepArtifact("s-missing", "step-a")).toBe(false);
  });

  test("setStageArtifact and getStageArtifact round-trip", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    const artifact = { built: true, files: ["a.js", "b.js"] };
    ctx.setStageArtifact("build-stage", artifact);

    const retrieved = ctx.getStageArtifact("build-stage");
    expect(retrieved).toBe(artifact);
  });

  test("getStageArtifact throws FrameworkError for missing artifact", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    expect(() => ctx.getStageArtifact("nonexistent")).toThrow(FrameworkError);
    expect(() => ctx.getStageArtifact("nonexistent")).toThrow(
      "No artifact recorded for stage nonexistent",
    );
  });

  test("fail() throws a registered error", () => {
    const runtime = createMockRuntime({});
    const errors = new RegisteredErrors({ MY_ERR: "something failed" });

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    expect(() => ctx.fail("MY_ERR")).toThrow(FrameworkError);
    expect(() => ctx.fail("MY_ERR")).toThrow("something failed");
  });

  test("$() calls shell.run in normal mode", async () => {
    const runtime = createMockRuntime({ dryRun: false });
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    await ctx.$("echo", ["hello"]);

    expect(runtime.shell.run).toHaveBeenCalledWith("echo", ["hello"], undefined);
    expect(runtime.shell.noop).not.toHaveBeenCalled();
  });

  test("$() calls shell.noop in dry-run mode", async () => {
    const runtime = createMockRuntime({ dryRun: true });
    const errors = new RegisteredErrors({});

    const ctx = new ExecutionContext({
      processorId: "test",
      input: undefined,
      shared: {},
      runtime,
      errors,
    });

    await ctx.$("echo", ["hello"]);

    expect(runtime.shell.noop).toHaveBeenCalledWith("echo", ["hello"]);
    expect(runtime.shell.run).not.toHaveBeenCalled();
  });
});
