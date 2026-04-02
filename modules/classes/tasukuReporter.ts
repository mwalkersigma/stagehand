import { type TaskInnerAPI, type Task as TasukuTask, type TaskOptions, type TaskPromise } from "tasuku";
import tasukuTask from "tasuku/inline";
import { ScriptTheme } from "../types";
import { Bold, darkGray, white } from "../textFormatting";

export type ParallelStageOptions = Omit<NonNullable<Parameters<TasukuTask['group']>[1]>, 'stopOnError'>;

/** Step-local tasuku controls exposed on execution context. */
export interface StepTaskContext {
  run<TResult>(title: string, taskFunction: (innerApi: TaskInnerAPI) => Promise<TResult>, options?: TaskOptions): TaskPromise<TResult>;
  group: TasukuTask['group'];
  setTitle(title: string): void;
  setStatus(status?: string): void;
  setWarning(warning?: Error | string | false | null): void;
  setError(error?: Error | string | false | null): void;
  setOutput(output: string | { message: string }): void;
  streamPreview(): TaskInnerAPI['streamPreview'] | undefined;
  startTime(): void;
  stopTime(): number | undefined;
}

export class TasukuReporter {
  /** The themed tasuku task function. Use this for creating and nesting tasks. */
  public readonly task: TasukuTask;
  private readonly theme: ScriptTheme;

  public constructor(theme: ScriptTheme) {
    this.task = tasukuTask;
    this.theme = theme;
  }

  /** Print the processor header and meta information to the console. */
  public async printHeader(args: { title: string; meta: Record<string, string> }): Promise<void> {
    const name = args.title;
    const padding = 7;
    const innerWidth = name.length + padding * 2;
    const totalWidth = innerWidth + 4;
    const border = '*'.repeat(totalWidth);
    const theme = this.theme;
    if (theme.headerStyle === 'fancy') {
      const leftPad = Math.floor((innerWidth - name.length) / 2);
      const rightPad = innerWidth - name.length - leftPad;
      const middle = `${theme.colors.dimmed('**')}${' '.repeat(leftPad)}${theme.colors.primary(Bold(name))}${' '.repeat(rightPad)}${theme.colors.dimmed('**')}`
      console.log('');
      console.log(theme.colors.dimmed(border));
      console.log(middle);
      console.log(theme.colors.dimmed(border));
      const entries = Object.entries(args.meta);
      if (entries.length > 0) {
        for (const [key, value] of entries) {
          const centerSpace = Math.max(1, innerWidth - key.length - String(value).length - 2);
          console.log(`${theme.colors.dimmed('**')}${darkGray(key.toUpperCase())}: ${' '.repeat(centerSpace - 3)} ${white(value)} ${theme.colors.dimmed('**')}`);
        }
      }
      console.log(theme.colors.dimmed(border));
      console.log('');
    } else {
      console.log('');
      console.log(name);
    }


  }
}
