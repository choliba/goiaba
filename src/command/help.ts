import { usageLine } from './parse';
import type { CommandDefinition } from './types';

/** `--help`, built from the declaration. */
export function helpText(definition: CommandDefinition): string {
  const args = Object.entries(definition.args ?? {}).map(([name, spec]) => [
    spec.required === true ? `<${name}>` : `[${name}]`,
    spec.description,
  ]);
  const options = [
    ...Object.entries(definition.options ?? {}).map(([name, spec]) => {
      const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
      const value = spec.type === 'string' ? ` <${spec.value ?? 'valor'}>` : '';
      const fallback =
        spec.type === 'string' && spec.default !== undefined
          ? ` (padrão: ${spec.default})`
          : '';
      return [`${short}--${name}${value}`, `${spec.description}${fallback}`];
    }),
    ['-h, --help', 'Mostra esta ajuda'],
  ];

  return [
    `Uso: ${usageLine(definition)}`,
    '',
    definition.description,
    ...section('Argumentos', args),
    ...section('Opções', options),
  ].join('\n');
}

function section(title: string, rows: readonly string[][]): string[] {
  if (rows.length === 0) return [];

  const width = Math.max(...rows.map(([name = '']) => name.length));
  return [
    '',
    `${title}:`,
    ...rows.map(
      ([name = '', description = '']) =>
        `  ${name.padEnd(width)}  ${description}`,
    ),
  ];
}
