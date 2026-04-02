import { Command } from "@commander-js/extra-typings";
import { DEFAULT_THEME } from "../consts";
import { ExecaShell } from "../shell";
import { ScriptTheme, CommandDefinition, ExtractCommandOpts, ExtractCommandArgs, Runtime, CommandProcessorFactoryApi } from "../types";
import { ProcessorBuilder } from "./processorBuilder";
import { TasukuReporter } from "./tasukuReporter";
import { ProcessEnvironment } from "./processEnvironment";

export class ScriptApp<
  TTheme extends ScriptTheme = ScriptTheme,
  TCommandFlags extends Record<string, any> = Record<string, never>,
  TMeta extends Record<string, string> = Record<string, never>,
> {
  public readonly name: string;
  public __theme: TTheme;
  public __meta: TMeta;
  public readonly program: Command;

  private readonly _commands: Record<string, Command> = {};

  public constructor(name: string) {
    this.name = name;
    this.program = new Command().name(name);
    this.__theme = DEFAULT_THEME as TTheme;
    this.__meta = {} as TMeta;
  }

  public meta<TNewMeta extends Record<string, string>>(
    meta: TNewMeta,
  ): ScriptApp<TTheme, TCommandFlags, TMeta & TNewMeta> {
    Object.assign(this.__meta, meta);
    return this as unknown as ScriptApp<TTheme, TCommandFlags, TMeta & TNewMeta>;
  }

  public theme<TNewTheme extends ScriptTheme>(
    theme: TNewTheme,
  ): ScriptApp<TNewTheme, TCommandFlags, TMeta> {
    this.__theme = {
      ...this.__theme,
      ...theme,
      colors: { ...this.__theme.colors, ...(theme.colors ?? {}) },
      stageStyle: { ...this.__theme.stageStyle, ...(theme.stageStyle ?? {}) },
      stepStyle: { ...this.__theme.stepStyle, ...(theme.stepStyle ?? {}) },
    } satisfies TNewTheme;
    return this as unknown as ScriptApp<TNewTheme, TCommandFlags, TMeta>;
  }

  public command<
    TNewCommandName extends string,
    TBuiltCommand extends Command = Command,
  >(definition: CommandDefinition<TNewCommandName, TBuiltCommand>): ScriptApp<
    TTheme,
    TCommandFlags & Record<TNewCommandName, ExtractCommandOpts<TBuiltCommand>>,
    TMeta
  > {
    const sub = new Command(definition.name) as Command<[], {}>;
    if (definition.description) {
      sub.description(definition.description);
    }

    if (definition.configOptions?.allowUnknownOption) {
      sub.allowUnknownOption(true);
    }
    if (definition.configOptions?.enablePositionalOptions) {
      sub.enablePositionalOptions(true);
    }
    if (definition.configOptions?.passThroughOptions) {
      sub.passThroughOptions(true);
    }

    const built = (definition.build ? definition.build(sub) : sub) as unknown as TBuiltCommand;
    const factoryApi: CommandProcessorFactoryApi<TBuiltCommand> = {
      command: built,
      defineProcessor: <TInput = ExtractCommandArgs<TBuiltCommand>>(args: { id: string; title: string }) => {
        return new ProcessorBuilder<TInput, never, ExtractCommandOpts<TBuiltCommand>, {}, void, {}>(args);
      },
    };
    const handler = definition.handler(factoryApi);

    built.action(async () => {
      const flags = built.opts() as ExtractCommandOpts<TBuiltCommand>;
      const args = built.processedArgs as ExtractCommandArgs<TBuiltCommand>;
      const reporter = new TasukuReporter(this.__theme);

      const runtime = await this.createDefaultRuntime({
        flags,
        command: built,
        theme: this.__theme,
        meta: this.__meta,
        reporter,
      });

      const result = await handler.run(args, runtime, this.__meta);
      if (!result.ok) {
        throw result.error;
      }
    });

    this.program.addCommand(built);
    this._commands[definition.name] = built;
    return this as unknown as ScriptApp<
      TTheme,
      TCommandFlags & Record<TNewCommandName, ExtractCommandOpts<TBuiltCommand>>,
      TMeta
    >;
  }

  public getFlags<TName extends keyof TCommandFlags & string>(
    commandName: TName,
  ): TCommandFlags[TName] {
    const cmd = this._commands[commandName];
    if (!cmd) {
      throw new Error(`Command "${commandName}" not found. Did you register it with .command()?`);
    }
    return cmd.opts() as TCommandFlags[TName];
  }

  public parse(argv: string[] = process.argv): this {
    this.program.parse(argv);
    return this;
  }

  public async parseAsync(argv: string[] = process.argv): Promise<this> {
    await this.program.parseAsync(argv);
    return this;
  }

  /** Default runtime contains only framework-owned pieces. */
  private async createDefaultRuntime<TCmd extends Command>(args: {
    flags: ExtractCommandOpts<TCmd>;
    command: TCmd;
    theme: TTheme;
    meta: TMeta;
    reporter: TasukuReporter;
  }): Promise<Runtime<ExtractCommandOpts<TCmd>>> {
    return {
      shell: new ExecaShell(),
      log: {
        info: (message: string) => console.log(args.theme.colors.info(message)),
        warn: (message: string) => console.warn(args.theme.colors.warning(message)),
        error: (message: string) => console.error(args.theme.colors.error(message)),
        debug: (message: string) => console.debug(args.theme.colors.debug(message)),
      },
      env: new ProcessEnvironment(),
      flags: args.flags,
      reporter: args.reporter,
      theme: args.theme,
    };
  }
}
