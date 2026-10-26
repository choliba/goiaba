import type { OutputAdapter } from '../output/index';
import type { ApprovalScope } from '../store/index';
import type { CommandApprover } from './broker';

const KEYS = ['u', 's', 'w', 'n'];

const ANSWERS: Readonly<Record<string, ApprovalScope>> = {
  u: 'once',
  uma: 'once',
  s: 'session',
  sessao: 'session',
  sessão: 'session',
  w: 'workspace',
  workspace: 'workspace',
  sempre: 'workspace',
};

/**
 * Asks the person through the output port. Anything but an explicit approval
 * denies, including an aborted question or a closed stdin.
 */
export function humanApprover(
  output: OutputAdapter,
  signal?: AbortSignal,
): CommandApprover {
  return async ({ command, reason, pattern }) => {
    // The command is shown once, in full; the options stay together at the
    // end even when the command is a long heredoc.
    const scope = scopeLabel(command, pattern);
    const question = [
      '',
      '┌─ 🤖 Solicitação de Execução do Agente',
      ...boxed('Comando: ', command),
      `│  Motivo:  ${reason}`,
      '└─────────────────────────────────────────────────────────────',
      '  Escolha uma opção:',
      '    [u] Permitir uma vez',
      `    [s] Permitir nesta sessão      ${scope}`,
      `    [w] Permitir neste workspace   ${scope}`,
      '    [n] Negar (padrão)',
      '',
    ].join('\n');

    output.write(`${question}\n  Permitir? [u/s/w/n]`);

    let answer: string;
    try {
      // One keypress where the terminal allows it; a line otherwise.
      answer =
        output.choose === undefined
          ? await output.ask('Permitir? [u/s/w/n]: ', signal)
          : await output.choose(KEYS, signal);
    } catch {
      return 'deny';
    }

    return ANSWERS[answer.trim().toLowerCase()] ?? 'deny';
  };
}

/** `│  Comando: first line`, then the other lines aligned under it. */
function boxed(label: string, text: string): string[] {
  const indent = ' '.repeat(label.length);
  return text
    .split('\n')
    .map((line, index) => `│  ${index === 0 ? label : indent}${line}`);
}

/** What a session/workspace approval covers, in one line. */
function scopeLabel(command: string, pattern: string): string {
  return pattern === command.trim() ? '(este comando exato)' : `(${pattern})`;
}
