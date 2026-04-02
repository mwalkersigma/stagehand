export class FrameworkError extends Error {
  public readonly code?: string;
  public override cause?: unknown;

  public constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message);
    this.name = 'FrameworkError';
    this.code = options?.code;
    this.cause = options?.cause;
  }
}
