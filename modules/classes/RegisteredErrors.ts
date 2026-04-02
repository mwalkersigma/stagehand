import { FrameworkError } from "../errors";
import { ErrorRegistryInput, ErrorRegistryNormalized } from "../types";

export class RegisteredErrors<TRegistry extends ErrorRegistryInput> {
  private readonly normalized: ErrorRegistryNormalized<TRegistry>;

  public constructor(input: TRegistry) {
    this.normalized = RegisteredErrors.normalize(input);
  }

  public create<TKey extends keyof TRegistry & string>(
    code: TKey,
    overrideMessage?: string,
    cause?: unknown,
  ): InstanceType<ErrorRegistryNormalized<TRegistry>[TKey]['type']> {
    const entry = this.normalized[code];
    const ErrorType = entry.type;
    const message = overrideMessage ?? entry.message;
    return new ErrorType(message, { code, cause }) as InstanceType<ErrorRegistryNormalized<TRegistry>[TKey]['type']>;
  }

  private static normalize<TRegistry extends ErrorRegistryInput>(input: TRegistry): ErrorRegistryNormalized<TRegistry> {
    const entries = Object.entries(input).map(([code, value]) => {
      if (typeof value === 'string') {
        return [code, { type: FrameworkError, message: value }];
      }
      return [code, { type: value.type ?? FrameworkError, message: value.message }];
    });

    return Object.fromEntries(entries) as ErrorRegistryNormalized<TRegistry>;
  }
}
