import type { OutputAdapter } from '../output/index';

/** A positional argument, in the order declared. */
export interface ArgSpec {
  readonly description: string;
  readonly required?: boolean;
}

export interface BooleanOptionSpec {
  readonly type: 'boolean';
  readonly description: string;
  /** One letter: `-d` for `--dry`. */
  readonly short?: string;
}

export interface StringOptionSpec {
  readonly type: 'string';
  readonly description: string;
  readonly short?: string;
  readonly default?: string;
  /** Name of the value in the help: `--repo <owner/nome>`. */
  readonly value?: string;
}

export type OptionSpec = BooleanOptionSpec | StringOptionSpec;

export type ArgSpecs = Readonly<Record<string, ArgSpec>>;
export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

/** `args` as `run` receives them: required ones are always strings. */
export type ParsedArgs<TArgs extends ArgSpecs> = {
  readonly [K in keyof TArgs]: TArgs[K] extends { readonly required: true }
    ? string
    : string | undefined;
};

/** `options` as `run` receives them: booleans default to false. */
export type ParsedOptions<TOptions extends OptionSpecs> = {
  readonly [K in keyof TOptions]: TOptions[K] extends BooleanOptionSpec
    ? boolean
    : TOptions[K] extends { readonly default: string }
      ? string
      : string | undefined;
};

export interface CommandContext<
  TArgs extends ArgSpecs,
  TOptions extends OptionSpecs,
> {
  readonly args: ParsedArgs<TArgs>;
  readonly options: ParsedOptions<TOptions>;
  /** Aborted on Ctrl+C. */
  readonly signal: AbortSignal;
  /** The only way the command shows or asks something. */
  readonly output: OutputAdapter;
}

export interface CommandDefinition<
  TArgs extends ArgSpecs = ArgSpecs,
  TOptions extends OptionSpecs = OptionSpecs,
> {
  /** How it is called: `bun <name>`. */
  readonly name: string;
  readonly description: string;
  readonly args?: TArgs;
  readonly options?: TOptions;
  run(
    this: void,
    context: CommandContext<TArgs, TOptions>,
  ): Promise<void> | void;
}
