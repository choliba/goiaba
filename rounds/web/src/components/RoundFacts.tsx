/**
 * Where a round started and with which configuration, said for a person:
 * what the starting point is (a copy of a fixture, or a tag in an existing
 * repository), in which folder it ran, from which commit; and what the
 * configuration code means, compared with the round before.
 */

import type { ReactNode } from 'react';

import type { RoundRecord } from '../../../../src/rounds/types';

/** The folder the agents worked in: the first actor's workspace. */
const folderOf = (record: RoundRecord): string | undefined =>
  Object.values(record.actors)[0]?.workspace.root;

function Start({ record }: { readonly record: RoundRecord }): ReactNode {
  const { start } = record;
  const folder = folderOf(record);
  if (start === null) {
    return (
      <p>
        Nenhum: a rodada não partiu de um repositório git, então não há como
        saber o que cada agente alterou.
      </p>
    );
  }
  const fixture = start.fixture ?? undefined;
  return (
    <>
      <dl className="fact-list">
        <dt>De onde vieram os arquivos</dt>
        <dd>
          {fixture === undefined ? (
            <>
              de um repositório que já existia
              {folder === undefined ? '' : ', '}
              {folder !== undefined && <code>{folder}</code>}
            </>
          ) : (
            <>
              da pasta <code>rounds/fixtures/{fixture}</code> do projeto
            </>
          )}
        </dd>
        {fixture !== undefined && folder !== undefined && (
          <>
            <dt>Onde os agentes trabalharam</dt>
            <dd>
              <code>{folder}</code>
            </dd>
          </>
        )}
        <dt>Versão de partida</dt>
        <dd>
          o commit <code>{start.commit}</code>, marcado com a tag{' '}
          <code>{start.tag}</code>
        </dd>
      </dl>
      <p className="muted">
        {fixture === undefined
          ? `Antes de cada execução, o repositório volta à tag ${start.tag}: todas partem dos mesmos arquivos.`
          : `Antes de cada execução, a pasta é apagada e recebe uma cópia nova da fixture, num repositório git novo cujo primeiro commit leva a tag ${start.tag}: todas partem dos mesmos arquivos, e o git mostra o que cada agente mudou.`}
      </p>
    </>
  );
}

function Configuration({
  code,
  record,
  previous,
  previousHref,
}: {
  /** The start of the record's `configHash`. */
  readonly code: string;
  readonly record: RoundRecord;
  readonly previous: RoundRecord | undefined;
  readonly previousHref: string | undefined;
}): ReactNode {
  return (
    <>
      <p>
        Código <code>{code}</code>
        {previous !== undefined &&
          previousHref !== undefined &&
          (previous.configHash === record.configHash ? (
            <>
              : o mesmo da <a href={previousHref}>rodada anterior</a>, que rodou
              com a mesma configuração.
            </>
          ) : (
            <>
              : diferente da <a href={previousHref}>rodada anterior</a>; o que
              mudou está no fim de “Configuração de cada agente”.
            </>
          ))}
      </p>
      <p className="muted">
        Um resumo de como a rodada estava montada: o objetivo e, de cada agente,
        o modelo, o CLI, a pasta de trabalho e as permissões. Os pedidos
        (prompts) ficam de fora. Duas rodadas com o mesmo código rodaram com a
        mesma configuração; dá para compará-las.
      </p>
    </>
  );
}

export function RoundFacts({
  record,
  code,
  previous,
  previousHref,
}: {
  readonly record: RoundRecord;
  readonly code: string;
  readonly previous: RoundRecord | undefined;
  readonly previousHref: string | undefined;
}): ReactNode {
  return (
    <dl className="round-facts">
      <div>
        <dt>Ponto de partida</dt>
        <dd>
          <Start record={record} />
        </dd>
      </div>
      <div>
        <dt>Configuração</dt>
        <dd>
          <Configuration
            code={code}
            record={record}
            previous={previous}
            previousHref={previousHref}
          />
        </dd>
      </div>
    </dl>
  );
}
