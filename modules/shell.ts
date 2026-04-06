import { execa, Options } from 'execa';
import { ShellResult } from './types';

export interface Shell {
  run(command: string, args?: string[], options?: Options): Promise<ShellResult>;
  capture(command: string, args?: string[], options?: Options): Promise<string>;
  /**
   * Run a command with stdio inherited from the parent process.
   * Use for tools like PM2 that write directly to the TTY and cannot be
   * captured via a pipe.  No stdout/stderr is returned.
   */
  passthrough(command: string, args?: string[], options?: Omit<Options, 'stdio'>): Promise<ShellResult>;
  noop(command: string, args?: string[]): Promise<ShellResult>;
}

function normalizeOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOutput(item)).join('\n');
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

export class ExecaShell implements Shell {
  public async run(command: string, args: string[] = [], options?: Options): Promise<ShellResult> {
    const result = await execa(command, args, options);
    return {
      command: `${command} ${args.join(' ')}`.trim(),
      stdout: normalizeOutput(result.stdout),
      stderr: normalizeOutput(result.stderr),
      exitCode: result.exitCode ?? 0,
    };
  }

  public async capture(command: string, args: string[] = [], options?: Options): Promise<string> {
    const result = await execa(command, args, options);
    return normalizeOutput(result.stdout);
  }

  public async passthrough(command: string, args: string[] = [], options?: Omit<Options, 'stdio'>): Promise<ShellResult> {
    await execa(command, args, { ...options, stdio: 'inherit' });
    return {
      command: `${command} ${args.join(' ')}`.trim(),
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }

  public async noop(command: string, args: string[] = []): Promise<ShellResult> {
    return {
      command: `${command} ${args.join(' ')}`.trim(),
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }
}
