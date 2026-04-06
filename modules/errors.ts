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

/**
 * Walk an error's `.cause` chain and produce a compact, human-readable
 * string suitable for terminal output.  Avoids dumping every property of
 * ExecaError / FrameworkError and hides duplicate cause repetition that Bun
 * would otherwise dump in full.
 */
export function formatErrorChain(error: unknown): string {
  const lines: string[] = [];
  let current: unknown = error;
  let depth = 0;
  const seen = new Set<unknown>();

  while (current != null && depth < 10) {
    if (seen.has(current)) break;
    seen.add(current);

    const indent = depth === 0 ? '' : '  '.repeat(depth) + '↳ cause: ';

    if (current instanceof Error) {
      const err = current as Error & Record<string, unknown>;
      const code = typeof err['code'] === 'string' ? ` [${err['code']}]` : '';
      lines.push(`${indent}${err.name}: ${err.message}${code}`);

      // Surface subprocess details when present (duck-type ExecaError)
      if (typeof err['exitCode'] === 'number') {
        lines.push(`${indent}  exit code: ${err['exitCode']}`);
      }
      if (typeof err['command'] === 'string' && err['command']) {
        lines.push(`${indent}  command:   ${err['command']}`);
      }
      const stderr = typeof err['stderr'] === 'string' ? err['stderr'].trim() : '';
      const stdout = typeof err['stdout'] === 'string' ? err['stdout'].trim() : '';
      if (stderr) {
        lines.push(`${indent}  stderr:    ${stderr}`);
      } else if (stdout) {
        lines.push(`${indent}  stdout:    ${stdout}`);
      } else if (typeof err['exitCode'] === 'number') {
        lines.push(`${indent}  (no output captured — process may have written directly to the TTY)`);
      }

      current = err.cause;
    } else {
      lines.push(`${indent}${String(current)}`);
      break;
    }

    depth++;
  }

  return lines.join('\n');
}
