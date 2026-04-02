import { execa, Options } from 'execa';
import { ShellResult } from './types';

export interface Shell {
  run(command: string, args?: string[], options?: Options): Promise<ShellResult>;
  capture(command: string, args?: string[], options?: Options): Promise<string>;
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

  public async noop(command: string, args: string[] = []): Promise<ShellResult> {
    return {
      command: `${command} ${args.join(' ')}`.trim(),
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }
}
