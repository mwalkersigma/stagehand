import { describe, test, expect } from "bun:test";
import { RegisteredErrors } from "../modules/classes/RegisteredErrors";
import { FrameworkError } from "../modules/errors";

describe("RegisteredErrors", () => {
  test("creates FrameworkError with string registry entry", () => {
    const errors = new RegisteredErrors({ FOO: "foo message" });
    const err = errors.create("FOO");

    expect(err).toBeInstanceOf(FrameworkError);
    expect(err.message).toBe("foo message");
  });

  test("creates error with override message", () => {
    const errors = new RegisteredErrors({ FOO: "foo message" });
    const err = errors.create("FOO", "custom message");

    expect(err).toBeInstanceOf(FrameworkError);
    expect(err.message).toBe("custom message");
  });

  test("creates error with cause", () => {
    const errors = new RegisteredErrors({ FOO: "foo message" });
    const rootCause = new Error("root");
    const err = errors.create("FOO", undefined, rootCause);

    expect(err).toBeInstanceOf(FrameworkError);
    expect(err.message).toBe("foo message");
    expect(err.cause).toBe(rootCause);
  });

  test("creates error with custom error class", () => {
    class MyCustomError extends Error {
      public readonly code?: string;

      public constructor(message: string, options?: { code?: string; cause?: unknown }) {
        super(message);
        this.name = "MyCustomError";
        this.code = options?.code;
        this.cause = options?.cause;
      }
    }

    const errors = new RegisteredErrors({
      BAR: { type: MyCustomError, message: "bar msg" },
    });
    const err = errors.create("BAR");

    expect(err).toBeInstanceOf(MyCustomError);
    expect(err.message).toBe("bar msg");
  });

  test("defaults to FrameworkError when type not specified in object entry", () => {
    const errors = new RegisteredErrors({
      BAZ: { message: "baz msg" },
    });
    const err = errors.create("BAZ");

    expect(err).toBeInstanceOf(FrameworkError);
    expect(err.message).toBe("baz msg");
  });
});
