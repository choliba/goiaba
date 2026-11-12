/**
 * The form that writes a new round's declaration: what you fill in becomes
 * the file `rounds/definitions/<id>.ts`, shown as you type, ready to copy.
 * The pages only read: nothing runs or is saved from here. The round has
 * its agents (one at a time on screen), the steps that choose among them,
 * and limits for the whole round; pasting a definition fills it all.
 */

import { useState, type ReactNode } from 'react';

import type {
  LimitCriterion,
  RoundCriterion,
  RoundDeclaration,
} from '../../../../src/rounds/types';
import { CodeBlock } from '../components/CodeBlock';
import { TestsNav } from '../components/TestsNav';
import { COMMAND_GROUPS, COPIED_MS } from '../constants';
import { tests } from '../data';
import { declarationSource } from '../declaration';
import { declarationFromSource } from '../load-definition';
import { PROJECT_TOOLS } from '../known-tools';
import {
  actorOf,
  agentFromDeclaration,
  agentProblems,
  criteriaOf,
  limitFields,
  limitInWords,
  limitOf,
  limitProblems,
  lines,
  newAgent,
  noLimits,
  type AgentForm,
  type LimitFields,
} from './create/agent';
import { AgentEditor, LimitsEditor, nextKey } from './create/AgentEditor';

/** A round's id: lowercase letters, digits and `-` (what `defineRound` accepts). */
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One step of the flow as the form holds it: who acts, who consults, the ask. */
interface StepRow {
  readonly key: number;
  /** The agent that acts: one of the round's agents, chosen, not typed. */
  readonly actor: string;
  /** Who consults it (the arrow "X consulta Y"); empty for nobody. */
  readonly by: string;
  readonly prompt: string;
}

/**
 * The commands recorded rounds allowed that no group offers: what was used
 * before, to tick again.
 */
const usedCommandsOf = (): string[] =>
  [
    ...new Set(
      tests.flatMap((test) =>
        test.rounds.flatMap(({ record }) =>
          Object.values(record.actors).flatMap(
            (snapshot) =>
              snapshot.policy?.allow?.execution?.flatMap(
                (rule) => rule.commands,
              ) ?? [],
          ),
        ),
      ),
    ),
  ]
    .filter(
      (command) =>
        !COMMAND_GROUPS.some((group) => group.commands.includes(command)),
    )
    .toSorted();

/** The groups of commands to tick: the offered ones, then the ones used before. */
function commandGroupsOf(): readonly {
  readonly title: string;
  readonly commands: readonly string[];
}[] {
  const used = usedCommandsOf();
  return [
    ...COMMAND_GROUPS,
    ...(used.length === 0
      ? []
      : [{ title: 'Usados em outras rodadas', commands: used }]),
  ];
}

/** The fixtures the recorded rounds started from: suggestions, not a limit. */
const knownFixturesOf = (): string[] =>
  [
    ...new Set(
      tests.flatMap((test) =>
        test.rounds.flatMap(({ record }) =>
          record.start?.fixture === undefined || record.start.fixture === null
            ? []
            : [record.start.fixture],
        ),
      ),
    ),
  ].toSorted();

/** An agent's name in the declaration: what was typed, or a stand-in. */
const nameOf = (agent: AgentForm, index: number): string =>
  agent.name.trim() || `agente-${String(index + 1)}`;

/** What a step's prompt line becomes to bring in what `actor` said. */
const saidMarker = (actor: string): string => `{{said:${actor}}}`;

export function CreatePage(): ReactNode {
  // The records arrive before the pages render: read them here, not when
  // this module loads.
  const [knownFixtures] = useState(knownFixturesOf);
  const [commandGroups] = useState(commandGroupsOf);
  const [id, setId] = useState('minha-rodada');
  const [goal, setGoal] = useState('');
  /** What changed since the last run (`label`), in the user's words. */
  const [label, setLabel] = useState('');
  const [repeat, setRepeat] = useState('1');
  /** The fixture chosen; until then, a new one named after the round. */
  const [fixtureChoice, setFixture] = useState<string | undefined>(undefined);
  const fixture = fixtureChoice ?? id;
  /** The definition pasted to fill the form. */
  const [pasted, setPasted] = useState('');
  /** Whether the declaration is open for pasting a definition over it. */
  const [editing, setEditing] = useState(false);
  /** Rules the form has no reason of its own to add, kept as checked. */
  const [toolCallAsText, setToolCallAsText] = useState(false);
  const [loadNotes, setLoadNotes] = useState<{
    readonly error?: string;
    readonly warnings: readonly string[];
  }>({ warnings: [] });
  const [agents, setAgents] = useState<readonly AgentForm[]>([
    newAgent(1, 'agente'),
  ]);
  /** The agent on screen, by key. */
  const [selected, setSelected] = useState(1);
  const [steps, setSteps] = useState<readonly StepRow[]>([
    { key: 1, actor: 'agente', by: '', prompt: '' },
  ]);
  /** The limits of the whole round (`criteria.round`). */
  const [roundLimits, setRoundLimits] = useState<LimitFields>(noLimits);
  const [copied, setCopied] = useState(false);

  const names = agents.map(nameOf);
  const current = agents.find((agent) => agent.key === selected) ?? agents[0];

  /**
   * Changes one agent. A new name follows into the steps that named the old
   * one, unless another agent already has it.
   */
  const updateAgent = (key: number, change: Partial<AgentForm>): void => {
    const index = agents.findIndex((agent) => agent.key === key);
    const before = agents[index];
    if (before === undefined) return;
    const after = { ...before, ...change };
    const oldName = nameOf(before, index);
    const newName = nameOf(after, index);
    setAgents(agents.map((agent) => (agent.key === key ? after : agent)));
    if (
      oldName !== newName &&
      !names.some((name, i) => i !== index && name === newName)
    ) {
      const rename = (name: string): string =>
        name === oldName ? newName : name;
      setSteps((rows) =>
        rows.map((row) => ({
          ...row,
          actor: rename(row.actor),
          by: rename(row.by),
          prompt: row.prompt.replaceAll(
            saidMarker(oldName),
            saidMarker(newName),
          ),
        })),
      );
    }
  };
  const addAgent = (): void => {
    const key = nextKey(agents);
    let n = agents.length + 1;
    while (names.includes(`agente-${String(n)}`)) n += 1;
    setAgents([...agents, newAgent(key, `agente-${String(n)}`)]);
    setSelected(key);
  };
  const removeAgent = (key: number): void => {
    const rest = agents.filter((agent) => agent.key !== key);
    if (rest.length === 0) return;
    setAgents(rest);
    if (selected === key) setSelected(rest[0]?.key ?? 1);
  };

  const updateStep = (key: number, change: Partial<StepRow>): void => {
    setSteps((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );
  };
  const addStep = (): void => {
    setSteps((rows) => [
      ...rows,
      {
        key: nextKey(rows),
        actor: nameOf(current ?? newAgent(1, 'agente'), 0),
        by: '',
        prompt: '',
      },
    ]);
  };
  const removeStep = (key: number): void => {
    setSteps((rows) => rows.filter((row) => row.key !== key));
  };
  /** Moves a step one place up (-1) or down (+1) in the order. */
  const moveStep = (key: number, by: -1 | 1): void => {
    setSteps((rows) => {
      const from = rows.findIndex((row) => row.key === key);
      const to = from + by;
      if (from === -1 || to < 0 || to >= rows.length) return rows;
      const moved = [...rows];
      const [row] = moved.splice(from, 1);
      if (row !== undefined) moved.splice(to, 0, row);
      return moved;
    });
  };

  /** A step's agent, kept valid when an agent is renamed or removed. */
  const stepActor = (step: StepRow): string =>
    names.includes(step.actor) ? step.actor : (names[0] ?? 'agente');
  /** Who consults a step: another agent of the round, or nobody (''). */
  const consultedBy = (step: StepRow): string =>
    step.by.length > 0 && names.includes(step.by) && step.by !== stepActor(step)
      ? step.by
      : '';

  const repeatCount = Number(repeat.trim());
  const duplicated = names.filter((name, i) => names.indexOf(name) !== i);
  const problems = [
    ...(ID.test(id)
      ? []
      : [
          'O id é o nome do arquivo: só letras minúsculas, números e hífens, como busca-na-web.',
        ]),
    ...(goal.trim().length === 0
      ? ['Diga o que a rodada quer descobrir (o objetivo).']
      : []),
    ...(Number.isInteger(repeatCount) && repeatCount >= 1
      ? []
      : ['Quantas vezes rodar é um número inteiro, a partir de 1.']),
    ...[...new Set(duplicated)].map(
      (name) =>
        `Dois agentes se chamam ${name}: dê um nome diferente a cada um.`,
    ),
    ...agents.flatMap((agent, index) =>
      agentProblems(agent).map(
        (problem) => `${nameOf(agent, index)}: ${problem}.`,
      ),
    ),
    ...(steps.length === 0 ? ['Adicione ao menos um passo.'] : []),
    ...steps.flatMap((step, index) =>
      step.prompt.trim().length === 0
        ? [
            `Passo ${String(index + 1)}: diga o que ${stepActor(step)} deve fazer.`,
          ]
        : [],
    ),
    ...limitProblems(roundLimits).map(
      (problem) => `Rodada inteira: ${problem}.`,
    ),
  ];

  const offered = commandGroups.flatMap((group) => group.commands);
  const roundLimit = limitOf(roundLimits);
  const criteriaEntries: [string, RoundCriterion[]][] = [
    ...agents.flatMap((agent, index): [string, RoundCriterion[]][] => {
      const list = criteriaOf(agent);
      return list.length === 0 ? [] : [[nameOf(agent, index), list]];
    }),
    ...(roundLimit === undefined
      ? []
      : [
          ['round', [{ limit: roundLimit }]] satisfies [
            string,
            RoundCriterion[],
          ],
        ]),
  ];
  const criteria = Object.fromEntries(criteriaEntries);
  const declaration: RoundDeclaration = {
    id,
    goal,
    ...(label.trim().length === 0 ? {} : { label: label.trim() }),
    start: { fixture },
    actors: Object.fromEntries(
      agents.map((agent, index) => [
        nameOf(agent, index),
        actorOf(agent, id, offered),
      ]),
    ),
    flow: steps.map((step) => ({
      actor: stepActor(step),
      by: consultedBy(step) || null,
      prompt: lines(step.prompt),
    })),
    // Asking eliminates (nobody answers in a round); a read-only agent is
    // also checked for not changing anything.
    rules: [
      ...(agents.some((agent) => agent.access === 'read')
        ? ['read-only-respected']
        : []),
      'no-questions',
      ...(toolCallAsText ? ['no-tool-call-as-text'] : []),
    ],
    ...(Object.keys(criteria).length === 0 ? {} : { criteria }),
    repeat: Number.isInteger(repeatCount) && repeatCount >= 1 ? repeatCount : 1,
  };
  const source = declarationSource(declaration, PROJECT_TOOLS);

  /**
   * Fills the form from a declaration read from a pasted definition, and
   * says what of it the form cannot show yet (it is left out).
   */
  const applyDeclaration = (loaded: RoundDeclaration): string[] => {
    const warnings: string[] = [];
    setId(loaded.id);
    setGoal(loaded.goal);
    setLabel(loaded.label ?? '');
    setRepeat(String(loaded.repeat));
    if (loaded.start === null) {
      warnings.push('Sem ponto de partida: o formulário pede uma fixture.');
    } else if ('fixture' in loaded.start) {
      setFixture(loaded.start.fixture);
    } else {
      warnings.push(
        'O ponto de partida é um repositório (start.git): o formulário só mostra fixtures.',
      );
    }

    const entries = Object.entries(loaded.actors);
    if (entries.length === 0) return [...warnings, 'A rodada não tem agentes.'];
    const loadedAgents = entries.map(([name, declared], index) =>
      agentFromDeclaration(
        index + 1,
        name,
        declared,
        loaded.criteria?.[name] ?? [],
        offered,
        warnings,
      ),
    );
    setAgents(loadedAgents);
    setSelected(1);

    setToolCallAsText(loaded.rules.includes('no-tool-call-as-text'));
    const knownRules = new Set([
      'no-questions',
      'read-only-respected',
      'no-tool-call-as-text',
    ]);
    const otherRules = loaded.rules.filter((entry) => !knownRules.has(entry));
    if (otherRules.length > 0) {
      warnings.push(
        `As regras ${otherRules.join(', ')} não estão no formulário.`,
      );
    }

    setSteps(
      loaded.flow.map((step, index) => {
        if (step.prompt === null) {
          warnings.push(
            `O pedido do passo ${String(index + 1)} não pôde ser lido como linhas.`,
          );
        }
        return {
          key: index + 1,
          actor: step.actor,
          by: step.by ?? '',
          prompt: (step.prompt ?? []).join('\n'),
        };
      }),
    );

    const round = loaded.criteria?.['round'] ?? [];
    const limits = round.flatMap((criterion) =>
      'limit' in criterion ? [criterion.limit] : [],
    );
    const merged: LimitCriterion = {};
    for (const limit of limits) Object.assign(merged, limit);
    setRoundLimits(limitFields(merged));
    if (limits.length < round.length) {
      warnings.push(
        'A rodada inteira (round) tem conferências que não são limites: elas não são conferidas, e o formulário as deixa de fora.',
      );
    }
    return warnings;
  };

  /** Reads a pasted definition and fills the form with it. */
  const loadPasted = (text: string): void => {
    if (text.trim().length === 0) return;
    void declarationFromSource(text).then(
      (loaded) => {
        setLoadNotes({ warnings: applyDeclaration(loaded) });
        setEditing(false);
      },
      (error: unknown) =>
        setLoadNotes({
          error: error instanceof Error ? error.message : String(error),
          warnings: [],
        }),
    );
  };

  const copy = (): void => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  };

  const roundWords = limitInWords(roundLimits);

  return (
    <main className="page">
      <TestsNav />
      <header>
        <h1>Criar rodada</h1>
        <p className="note">
          Preencha a rodada e copie a declaração: salve-a em{' '}
          <code>rounds/definitions/{id}.ts</code> e rode{' '}
          <code>bun run rounds {id}</code>. Nada roda nem é salvo por esta
          página.
        </p>
      </header>

      <div className="create">
        <form
          className="create-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset>
            <legend>A rodada</legend>
            <label>
              Id <span className="muted">o nome do arquivo e da pasta</span>
              <input value={id} onChange={(e) => setId(e.target.value)} />
            </label>
            <label>
              O que ela quer descobrir <code>goal</code>
              <textarea
                rows={2}
                value={goal}
                placeholder="Um modelo local consegue … sozinho?"
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label>
              <span>
                De onde todos partem <code>fixture</code>
              </span>
              <span className="muted">
                uma pasta de rounds/fixtures, copiada do zero a cada vez
              </span>
              <input
                list="fixtures"
                value={fixture}
                onChange={(e) => setFixture(e.target.value)}
              />
              <datalist id="fixtures">
                {knownFixtures.map((known) => (
                  <option key={known} value={known} />
                ))}
              </datalist>
            </label>
            {!knownFixtures.includes(fixture) && fixture.trim().length > 0 && (
              <p className="note">
                Fixture nova: crie a pasta{' '}
                <code>rounds/fixtures/{fixture}</code> com os arquivos de
                partida da rodada.
              </p>
            )}
            <div className="step-row-who">
              <label>
                <span>
                  Quantas vezes rodar <code>repeat</code>
                </span>
                <span className="muted">cada vez é uma rodada nas páginas</span>
                <input
                  inputMode="numeric"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
              </label>
              <label>
                <span>
                  O que mudou desta vez <code>label</code>
                </span>
                <span className="muted">opcional; só uma anotação</span>
                <input
                  value={label}
                  placeholder="troquei o modelo"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            </div>
          </fieldset>

          <section className="agents" aria-label="Agentes">
            <div className="agent-tabs" role="tablist">
              {agents.map((agent, index) => (
                <button
                  key={agent.key}
                  type="button"
                  role="tab"
                  aria-selected={agent.key === current?.key}
                  className={
                    agentProblems(agent).length > 0
                      ? 'agent-tab has-problems'
                      : 'agent-tab'
                  }
                  onClick={() => setSelected(agent.key)}
                >
                  {nameOf(agent, index)}
                </button>
              ))}
              <button
                type="button"
                className="agent-tab add"
                onClick={addAgent}
              >
                + Adicionar agente
              </button>
            </div>
            {current !== undefined && (
              <div className="agent-panel" role="tabpanel">
                <AgentEditor
                  key={current.key}
                  agent={current}
                  commandGroups={commandGroups}
                  onChange={(change) => updateAgent(current.key, change)}
                />
                {agents.length > 1 && (
                  <button
                    type="button"
                    className="more-rounds agent-remove"
                    onClick={() => removeAgent(current.key)}
                  >
                    Tirar {current.name.trim() || 'este agente'} da rodada
                  </button>
                )}
              </div>
            )}
          </section>

          <fieldset>
            <legend>
              Os passos <code>flow</code>
            </legend>
            <p className="muted">
              Rodam em ordem, um depois do outro. Em cada passo, um agente
              recebe um pedido e trabalha até terminar.
            </p>
            <ol className="step-rows">
              {steps.map((step, index) => {
                const actor = stepActor(step);
                const earlier = [
                  ...new Set(steps.slice(0, index).map(stepActor)),
                ];
                return (
                  <li key={step.key} className="step-row">
                    <div className="step-row-head">
                      <b>Passo {index + 1}</b>
                      <span className="step-row-actions">
                        <button
                          type="button"
                          className="close"
                          aria-label={`Subir o passo ${String(index + 1)}`}
                          disabled={index === 0}
                          onClick={() => moveStep(step.key, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="close"
                          aria-label={`Descer o passo ${String(index + 1)}`}
                          disabled={index === steps.length - 1}
                          onClick={() => moveStep(step.key, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="close"
                          aria-label={`Tirar o passo ${String(index + 1)}`}
                          disabled={steps.length === 1}
                          onClick={() => removeStep(step.key)}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    <div className="step-row-who">
                      <label>
                        <span>
                          Quem faz <code>actor</code>
                        </span>
                        <select
                          value={actor}
                          onChange={(e) =>
                            updateStep(step.key, { actor: e.target.value })
                          }
                        >
                          {names.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>
                          A pedido de <code>by</code>{' '}
                          <span className="muted">(opcional)</span>
                        </span>
                        <select
                          value={consultedBy(step)}
                          disabled={names.length < 2}
                          onChange={(e) =>
                            updateStep(step.key, { by: e.target.value })
                          }
                        >
                          <option value="">
                            {names.length < 2
                              ? 'ninguém (precisa de outro agente)'
                              : 'ninguém'}
                          </option>
                          {names
                            .filter((name) => name !== actor)
                            .map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>
                        O que {actor} deve fazer <code>prompt</code>
                      </span>
                      <span className="muted">
                        uma linha por instrução
                        {earlier.length > 0 &&
                          `; ${saidMarker(earlier[0] ?? '')} traz o que esse agente respondeu`}
                      </span>
                      <textarea
                        rows={4}
                        value={step.prompt}
                        placeholder={
                          'Leia o README.md\nEscreva um resumo em resumo.md'
                        }
                        onChange={(e) =>
                          updateStep(step.key, { prompt: e.target.value })
                        }
                      />
                    </label>
                    {earlier.length > 0 && (
                      <div className="criterion-add">
                        {earlier.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="more-rounds"
                            onClick={() =>
                              updateStep(step.key, {
                                prompt: `${step.prompt.replace(/\n*$/, '')}${step.prompt.trim().length === 0 ? '' : '\n'}${saidMarker(name)}`,
                              })
                            }
                          >
                            + o que {name} respondeu
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <button type="button" className="more-rounds" onClick={addStep}>
              Adicionar passo
            </button>
          </fieldset>

          <fieldset>
            <legend>A rodada inteira</legend>
            <span className="criterion-branch">
              Quanto a rodada pode gastar, somando todos os agentes{' '}
              <code>criteria.round</code>
            </span>
            <LimitsEditor
              value={roundLimits}
              onChange={(change) =>
                setRoundLimits((limits) => ({ ...limits, ...change }))
              }
            />
            {roundWords !== undefined && (
              <p className="muted">A rodada inteira: {roundWords}</p>
            )}
            <label className="create-check">
              <input
                type="checkbox"
                checked={toolCallAsText}
                onChange={(e) => setToolCallAsText(e.target.checked)}
              />
              <span>
                Zerar a nota de quem escreve a chamada de uma ferramenta como
                texto, em vez de usá-la <code>noToolCallAsText</code>
              </span>
            </label>
            <p className="muted">
              Sempre valem: ninguém pode perguntar nada (numa rodada, ninguém
              responde) e, quem só pode ler, não pode mexer nos arquivos.
            </p>
          </fieldset>
        </form>

        <section className="create-output" aria-labelledby="declaracao">
          <div className="tool-list-head">
            <h2 id="declaracao">rounds/definitions/{id}.ts</h2>
            {!editing && (
              <button type="button" className="more-rounds" onClick={copy}>
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            )}
          </div>
          {loadNotes.error !== undefined && (
            <p className="alert danger">{loadNotes.error}</p>
          )}
          {loadNotes.error === undefined && loadNotes.warnings.length > 0 && (
            <ul className="create-problems">
              {loadNotes.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {problems.length > 0 && (
            <ul className="create-problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {editing ? (
            <div className="create-paste">
              <textarea
                autoFocus
                spellCheck={false}
                value={pasted}
                aria-label="Definição a carregar"
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPasted(e.target.value)}
                onPaste={(e) => {
                  // The whole text is selected on focus: what is pasted is
                  // the definition, read as soon as it lands.
                  e.preventDefault();
                  const text = e.clipboardData.getData('text');
                  setPasted(text);
                  loadPasted(text);
                }}
              />
              <p className="muted">
                Cole o conteúdo de um{' '}
                <code>rounds/definitions/&lt;id&gt;.ts</code> (num arquivo só,
                importando só do Goiaba). Ao colar, o formulário é preenchido
                com ela, e a declaração deve sair igual.
              </p>
              <div className="create-paste-actions">
                <button
                  type="button"
                  className="more-rounds"
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="create-code">
              <button
                type="button"
                className="more-rounds create-paste-open"
                onClick={() => {
                  setPasted(source);
                  setLoadNotes({ warnings: [] });
                  setEditing(true);
                }}
              >
                Colar definição
              </button>
              <CodeBlock code={source} label="Declaração da rodada" />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
