/**
 * One tool call as the round recorded it: its name, time and how it ended,
 * opening to what it was called with (the command, when there is one, or
 * its arguments) and what came back that says how it ended (the error
 * message, the exit code).
 */

import type { ReactNode } from 'react';

import type {
  CommandPolicyRecord,
  ToolRecord,
} from '../../../../src/rounds/types';
import { duration } from '../format';

/** A string field of a tool's detail, when the CLI reported it. */
function text(record: unknown, key: string): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  const value: unknown = Object.entries(record).find(([k]) => k === key)?.[1];
  return typeof value === 'string' ? value : undefined;
}

const Code = ({ children }: { readonly children: string }): ReactNode => (
  <code>{children}</code>
);

/** Why no rule lets a complex line through, and that a round has no one to approve it. */
const COMPLEX =
  'o comando tem redirecionamento, substituição ou script (como 2>/dev/null ou $(…)), e o efeito disso nenhuma regra lê: ele pede aprovação, e numa rodada ninguém aprova.';

/**
 * What to change in the actor's policy (`policy` in the definition)
 * to allow or deny a command the gate denied, from the gate's decision.
 */
function PolicyAdvice({
  policy,
}: {
  readonly policy: CommandPolicyRecord;
}): ReactNode {
  if (policy.decision === 'allow') return null;
  const part = policy.part ?? '';
  const pattern = policy.pattern ?? part;
  const allow = (
    <>
      Para liberar, acrescente <Code>{`'${pattern}'`}</Code> em{' '}
      <Code>allow.execution</Code>.
    </>
  );
  const deny = (
    <>
      Para negar sem o agente esperar aprovação, acrescente{' '}
      <Code>{`'${pattern}'`}</Code> em <Code>deny.execution</Code>.
    </>
  );
  if (policy.decidedBy === 'policy') {
    return (
      <p className="tool-advice">
        Negado por uma regra de <Code>deny.execution</Code>, que casou com{' '}
        <Code>{part}</Code>. Para liberar, tire essa regra do <Code>deny</Code>{' '}
        e acrescente <Code>{`'${pattern}'`}</Code> em{' '}
        <Code>allow.execution</Code>.
      </p>
    );
  }
  if (policy.decidedBy === 'default') {
    return (
      <p className="tool-advice">
        Negado pela política: <Code>{part}</Code> não casa com nenhuma regra de{' '}
        <Code>allow.execution</Code>. {allow} {deny}
        {policy.complex && <> Mesmo liberado, {COMPLEX}</>}
      </p>
    );
  }
  if (policy.source === 'requireApproval') {
    return (
      <p className="tool-advice">
        <Code>{part}</Code> casa com <Code>requireApproval.execution</Code>, e
        numa rodada ninguém aprova. Para liberar, passe{' '}
        <Code>{`'${pattern}'`}</Code> para <Code>allow.execution</Code>; para
        negar, para <Code>deny.execution</Code>.
        {policy.complex && <> Mesmo liberado, {COMPLEX}</>}
      </p>
    );
  }
  if (policy.complex && policy.source !== 'default') {
    return (
      <p className="tool-advice">
        Cada parte casa com <Code>allow.execution</Code>, mas {COMPLEX} Nenhuma
        regra libera esta linha; a mesma sem o redirecionamento passa. Para
        negar, acrescente <Code>{`'${pattern}'`}</Code> em{' '}
        <Code>deny.execution</Code>.
      </p>
    );
  }
  return (
    <p className="tool-advice">
      Nenhuma regra casa com <Code>{part}</Code> e o <Code>default</Code> pede
      aprovação, que numa rodada ninguém dá. {allow} {deny}
      {policy.complex && <> Mesmo liberado, {COMPLEX}</>}
    </p>
  );
}

function ToolDetail({
  detail,
  policy,
}: {
  readonly detail: ToolRecord['detail'];
  readonly policy: ToolRecord['policy'];
}): ReactNode {
  const { args, exitCode } = detail;
  const command = text(args, 'command') ?? text(detail, 'command');
  const message = text(detail, 'message');
  const call =
    command ??
    (typeof args === 'object' && args !== null
      ? JSON.stringify(args, null, 2)
      : undefined);
  return (
    <div className="tool-detail">
      {call === undefined ? (
        <span className="muted">O CLI não registrou com o que chamou.</span>
      ) : (
        <pre>{call}</pre>
      )}
      {typeof exitCode === 'number' && <span>código de saída {exitCode}</span>}
      {message !== undefined && <pre className="tool-message">{message}</pre>}
      {policy !== undefined && <PolicyAdvice policy={policy} />}
    </div>
  );
}

export function ToolCall({ tool }: { readonly tool: ToolRecord }): ReactNode {
  return (
    <details>
      <summary>
        <code>{tool.name}</code> {duration(tool.span.durationMs)}
        {tool.outcome === 'result'
          ? ''
          : ` · ${tool.outcome === 'error' ? 'falhou' : 'não terminou'}`}
      </summary>
      <ToolDetail detail={tool.detail} policy={tool.policy} />
    </details>
  );
}
