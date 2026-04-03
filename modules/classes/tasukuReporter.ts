import { createTasuku, type TaskInnerAPI, type Task as TasukuTask, type TaskOptions, type TaskPromise } from "tasuku";
import { theme } from "tasuku/theme/blink";

const tasukuTask = createTasuku({
  theme: theme,
});
import { ScriptTheme } from "../types";
import { Bold, GradientText } from "../textFormatting";

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
    const theme = this.theme;
    if (theme.headerStyle === 'fancy') {
      const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '');
      const visibleLength = (value: string): number => stripAnsi(value).length;
      const truncate = (value: string, maxLength: number): string => {
        if (value.length <= maxLength) {
          return value;
        }
        if (maxLength <= 3) {
          return '.'.repeat(Math.max(0, maxLength));
        }
        return `${value.slice(0, maxLength - 3)}...`;
      };
      const padVisibleEnd = (value: string, width: number): string => {
        const remaining = Math.max(0, width - visibleLength(value));
        return `${value}${' '.repeat(remaining)}`;
      };
      const centerText = (value: string, width: number): string => {
        const space = Math.max(0, width - visibleLength(value));
        const left = Math.floor(space / 2);
        const right = space - left;
        return `${' '.repeat(left)}${value}${' '.repeat(right)}`;
      };

      const metaEntries = Object.entries(args.meta);
      const labelWidth = Math.max(0, ...metaEntries.map(([key]) => `${key.toUpperCase()}:`.length));
      const metaRawWidths = metaEntries.map(([key, value]) => `${key.toUpperCase()}:`.padEnd(labelWidth) + ` ${String(value)}`);
      const minContentWidth = 56;
      const contentWidth = Math.max(minContentWidth, name.length, ' powered by stagehand '.length, ...metaRawWidths.map((row) => row.length));

      const makeRow = (content: string): string => `| ${padVisibleEnd(content, contentWidth)} |`;
      const border = `+${'-'.repeat(contentWidth + 2)}+`;
      const titleText = GradientText(name, theme.colors.gradient[0], theme.colors.gradient[1]);
      const titleRow = makeRow(centerText(titleText, contentWidth));

      const poweredLabel = ' powered by stagehand ';
      const poweredRemaining = Math.max(0, contentWidth - poweredLabel.length);
      const poweredLeft = '-'.repeat(Math.floor(poweredRemaining / 2));
      const poweredRight = '-'.repeat(poweredRemaining - poweredLeft.length);
      const poweredRow = makeRow(`${poweredLeft}${theme.colors.dimmed(poweredLabel)}${poweredRight}`);

      console.log('');
      console.log(theme.colors.dimmed(border));
      console.log(titleRow);
      console.log(poweredRow);
      for (const [key, value] of Object.entries(args.meta)) {
        const label = `${key.toUpperCase()}:`;
        const valueMax = Math.max(1, contentWidth - labelWidth - 1);
        const safeValue = truncate(String(value), valueMax);
        const labelPart = theme.colors.dimmed(label.padEnd(labelWidth));
        const valuePart = theme.colors.secondary(safeValue.padEnd(valueMax));
        console.log(`| ${labelPart} ${valuePart} |`);
      }
      console.log(theme.colors.dimmed(border));

    } else {
      console.log('');
      console.log(Bold(name));
    }
  }
}
