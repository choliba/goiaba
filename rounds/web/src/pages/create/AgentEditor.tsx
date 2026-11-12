/**
 * The fields of one agent of the round: who it is, where it works, what it
 * may do, and how the round knows it did what it was asked. Everything in
 * plain words; the declaration's name of each field shows beside it, small.
 */

import type { ReactNode } from 'react';

import { OLLAMA_CLIS } from '../../../../../src/providers/constants';
import { GOIABA_TOOLS } from '../../../../../src/providers/tools';
import { PROJECT_TOOLS } from '../../known-tools';
import {
  CHECKS,
  CLI_LABELS,
  CLI_TOOL_LABELS,
  CONDITIONS,
  HOST_STATES,
  PROVIDERS,
  SANDBOXES,
  emptyFile,
  isAccess,
  isCheck,
  isConditionCheck,
  isHostState,
  isOllamaCli,
  isProvider,
  isSandbox,
  limitInWords,
  optionsTaken,
  rowInWords,
  rowProblems,
  takesTools,
  type AgentForm,
  type CriterionRow,
  type FileFields,
  type LimitFields,
  type Permission,
} from './agent';

/** The next free key of a list of rows. */
export const nextKey = (rows: readonly { readonly key: number }[]): number =>
  Math.max(0, ...rows.map((row) => row.key)) + 1;

/** The fields of one file check: the file, what of it, what it contains. */
function FileFieldsEditor({
  value,
  onChange,
}: {
  readonly value: FileFields;
  readonly onChange: (change: Partial<FileFields>) => void;
}): ReactNode {
  return (
    <>
      <label>
        O arquivo
        <input
          value={value.name}
          placeholder="resumo.md"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label>
        deve
        <select
          value={value.check}
          onChange={(e) => {
            if (isCheck(e.target.value)) onChange({ check: e.target.value });
          }}
        >
          {Object.entries(CHECKS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        e conter{' '}
        <span className="muted">
          trechos separados por vírgula; maiúsculas não importam
        </span>
        <input
          value={value.contains}
          disabled={value.check === 'absent'}
          onChange={(e) => onChange({ contains: e.target.value })}
        />
      </label>
    </>
  );
}

/** Allowed / not allowed, for a command or a tool. */
function PermissionToggle({
  name,
  value,
  onDecide,
}: {
  readonly name: string;
  readonly value: Permission | undefined;
  readonly onDecide: (permission: Permission) => void;
}): ReactNode {
  return (
    <span
      className="permission-toggle"
      role="group"
      aria-label={`Permissão de ${name}`}
    >
      <button
        type="button"
        className="allow"
        aria-pressed={value === 'allow'}
        onClick={() => onDecide('allow')}
      >
        Pode
      </button>
      <button
        type="button"
        className="deny"
        aria-pressed={value === 'deny'}
        onClick={() => onDecide('deny')}
      >
        Não pode
      </button>
    </span>
  );
}

/** A map with `item` marked as `permission`; marking it again unmarks it. */
function toggled(
  map: ReadonlyMap<string, Permission>,
  item: string,
  permission: Permission,
): ReadonlyMap<string, Permission> {
  const next = new Map(map);
  if (next.get(item) === permission) next.delete(item);
  else next.set(item, permission);
  return next;
}

/** Time, tokens and cost, each optional. */
export function LimitsEditor({
  value,
  onChange,
}: {
  readonly value: LimitFields;
  readonly onChange: (change: Partial<LimitFields>) => void;
}): ReactNode {
  return (
    <div className="criterion-limits">
      <label>
        Tempo, no máximo <span className="muted">como 90s ou 2min</span>
        <input
          value={value.time}
          onChange={(e) => onChange({ time: e.target.value })}
        />
      </label>
      <label>
        Tokens novos, no máximo{' '}
        <span className="muted">um número, como 20000</span>
        <input
          value={value.tokens}
          inputMode="numeric"
          onChange={(e) => onChange({ tokens: e.target.value })}
        />
      </label>
      <label>
        Custo, no máximo <span className="muted">em US$, como 0.05</span>
        <input
          value={value.cost}
          inputMode="decimal"
          onChange={(e) => onChange({ cost: e.target.value })}
        />
      </label>
    </div>
  );
}

export function AgentEditor({
  agent,
  commandGroups,
  onChange,
}: {
  readonly agent: AgentForm;
  readonly commandGroups: readonly {
    readonly title: string;
    readonly commands: readonly string[];
  }[];
  readonly onChange: (change: Partial<AgentForm>) => void;
}): ReactNode {
  const who = agent.name.trim() || 'o agente';

  /** Changes one criterion row, given what it is now. */
  const changeRow = (
    key: number,
    change: (row: CriterionRow) => CriterionRow,
  ): void => {
    onChange({
      criteria: agent.criteria.map((row) =>
        row.key === key ? change(row) : row,
      ),
    });
  };
  const changeIf = (
    key: number,
    change: (row: Extract<CriterionRow, { kind: 'if' }>) => CriterionRow,
  ): void => {
    changeRow(key, (row) => (row.kind === 'if' ? change(row) : row));
  };
  const addFileCriterion = (): void => {
    onChange({
      criteria: [
        ...agent.criteria,
        { key: nextKey(agent.criteria), kind: 'file', file: emptyFile() },
      ],
    });
  };
  const addConditional = (): void => {
    onChange({
      criteria: [
        ...agent.criteria,
        {
          key: nextKey(agent.criteria),
          kind: 'if',
          when: { name: '', check: 'absent', contains: '' },
          checkFile: emptyFile(),
          hasElse: false,
          elseFile: { name: '', check: 'unchanged', contains: '' },
        },
      ],
    });
  };
  const removeRow = (key: number): void => {
    onChange({ criteria: agent.criteria.filter((row) => row.key !== key) });
  };
  const toggleTool = (tool: string): void => {
    const next = new Set(agent.tools);
    if (!next.delete(tool)) next.add(tool);
    onChange({ tools: next });
  };

  const sentences = [
    ...agent.criteria
      .filter((row) => rowProblems(row).length === 0)
      .map(rowInWords),
    ...[limitInWords(agent.limits)].filter((s) => s !== undefined),
  ];

  return (
    <>
      <fieldset>
        <legend>Quem é</legend>
        <label>
          Nome <span className="muted">o papel dele, como analista ou dev</span>
          <input
            value={agent.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label>
          <span>
            Quem fornece o modelo <code>provider</code>
          </span>
          <select
            value={agent.provider}
            onChange={(e) => {
              const next = e.target.value;
              if (isProvider(next)) {
                onChange({ provider: next, model: PROVIDERS[next].model });
              }
            }}
          >
            {Object.entries(PROVIDERS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {agent.provider === 'ollama' && (
          <label>
            <span>
              Quem conduz o modelo <code>cli</code>
            </span>
            <select
              value={agent.cli}
              onChange={(e) => {
                if (isOllamaCli(e.target.value)) {
                  onChange({ cli: e.target.value });
                }
              }}
            >
              {OLLAMA_CLIS.map((option) => (
                <option key={option} value={option}>
                  {CLI_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>
            Modelo <code>model</code>
          </span>
          <input
            value={agent.model}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </label>
        {agent.provider === 'ollama' && (
          <label>
            <span>
              Memória do modelo, em tokens <code>contextWindow</code>
            </span>
            <span className="muted">
              quanto texto ele consegue ter em mente de uma vez, como o{' '}
              <code>ollama ps</code> mostra; vazio usa o padrão do modelo
            </span>
            <input
              inputMode="numeric"
              value={agent.contextWindow}
              onChange={(e) => onChange({ contextWindow: e.target.value })}
            />
          </label>
        )}
        {agent.provider === 'ollama' && agent.cli === 'claude' && (
          <label className="create-check">
            <input
              type="checkbox"
              checked={agent.think}
              onChange={(e) => onChange({ think: e.target.checked })}
            />
            <span>
              Ele pensa antes de responder <code>think</code>
            </span>
          </label>
        )}
        <details className="create-more">
          <summary>Mais opções de {who}</summary>
          <label>
            <span>
              Programa do CLI <code>executable</code>
            </span>
            <span className="muted">
              vazio usa o de sempre (claude, codex, agent); um caminho, se
              estiver em outro lugar
            </span>
            <input
              value={agent.executable}
              onChange={(e) => onChange({ executable: e.target.value })}
            />
          </label>
          {optionsTaken.baseUrl(agent) && (
            <label>
              <span>
                Servidor do Ollama <code>baseUrl</code>
              </span>
              <span className="muted">
                vazio usa o desta máquina (http://127.0.0.1:11434)
              </span>
              <input
                value={agent.baseUrl}
                placeholder="http://127.0.0.1:11434"
                onChange={(e) => onChange({ baseUrl: e.target.value })}
              />
            </label>
          )}
          {optionsTaken.compactAt(agent) && (
            <label>
              <span>
                Quando resumir a conversa <code>compactAt</code>
              </span>
              <span className="muted">
                a parte da memória que, cheia, faz o Codex resumir o que já foi
                dito; vazio usa 0.8 (80%)
              </span>
              <input
                inputMode="decimal"
                value={agent.compactAt}
                placeholder="0.8"
                onChange={(e) => onChange({ compactAt: e.target.value })}
              />
            </label>
          )}
          {optionsTaken.rulesOnce(agent) && (
            <label className="create-check">
              <input
                type="checkbox"
                checked={agent.rulesOnce}
                onChange={(e) => onChange({ rulesOnce: e.target.checked })}
              />
              <span>
                Mandar as regras de conversa só na primeira mensagem{' '}
                <code>rulesOnce</code>
              </span>
            </label>
          )}
          {optionsTaken.login(agent) && (
            <label className="create-check">
              <input
                type="checkbox"
                checked={agent.login}
                onChange={(e) => onChange({ login: e.target.checked })}
              />
              <span>
                Usar o seu login do Codex <code>login</code>
              </span>
            </label>
          )}
          {Object.keys(agent.otherOptions).length > 0 && (
            <p className="muted">
              Vieram da definição e ficam como estão:{' '}
              {Object.entries(agent.otherOptions)
                .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                .join(', ')}
              .
            </p>
          )}
        </details>
        {takesTools(agent) ? (
          <>
            <label className="create-check">
              <input
                type="checkbox"
                checked={agent.chooseTools}
                onChange={(e) => onChange({ chooseTools: e.target.checked })}
              />
              <span>
                Escolher as ferramentas que {who} enxerga <code>tools</code>
              </span>
            </label>
            {agent.chooseTools ? (
              <fieldset className="tool-picker">
                <legend>Ferramentas que {who} enxerga</legend>
                {GOIABA_TOOLS.map((tool) => (
                  <label key={tool} className="create-check">
                    <input
                      type="checkbox"
                      checked={agent.tools.has(tool)}
                      onChange={() => toggleTool(tool)}
                    />
                    <code>{tool}</code>
                    <span className="muted">{CLI_TOOL_LABELS[tool]}</span>
                  </label>
                ))}
                {PROJECT_TOOLS.map((tool) => (
                  <label key={tool.name} className="create-check">
                    <input
                      type="checkbox"
                      checked={agent.tools.has(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                    />
                    <code>{tool.name}</code>
                    <span className="muted">
                      do projeto ({tool.from.replace('../../', '')}):{' '}
                      {tool.description}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="muted">
                Sem escolher, {who} enxerga todas as ferramentas do CLI e
                nenhuma do projeto.
              </p>
            )}
          </>
        ) : (
          <p className="muted">
            Escolher as ferramentas (<code>tools</code>) só vale com o Claude
            Code: o Claude, ou o Ollama conduzido pelo Claude Code.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>
          Onde trabalha <code>workspace</code>
        </legend>
        <p className="muted">
          Na pasta da rodada, isolado do resto da máquina por uma sandbox.
        </p>
        <label>
          <span>
            Sandbox <code>type</code>
          </span>
          <select
            value={agent.sandbox}
            onChange={(e) => {
              if (isSandbox(e.target.value)) {
                onChange({ sandbox: e.target.value });
              }
            }}
          >
            {Object.entries(SANDBOXES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {agent.sandbox === 'docker' && (
          <label>
            <span>
              Imagem <code>image</code>
            </span>{' '}
            <span className="muted">
              FROM nome:tag baixa do Docker Hub; nome:tag é uma imagem desta
              máquina
            </span>
            <input
              value={agent.image}
              onChange={(e) => onChange({ image: e.target.value })}
            />
          </label>
        )}
        <label>
          <span>
            Desta máquina, ele vê <code>hostState</code>
          </span>
          <select
            value={agent.hostState}
            onChange={(e) => {
              if (isHostState(e.target.value)) {
                onChange({ hostState: e.target.value });
              }
            }}
          >
            {Object.entries(HOST_STATES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>
            Outras pastas onde pode escrever <code>writable</code>
          </span>
          <span className="muted">
            um caminho por linha, além da pasta da rodada; vazio, só ela
          </span>
          <textarea
            rows={2}
            value={agent.writable}
            onChange={(e) => onChange({ writable: e.target.value })}
          />
        </label>
        <label>
          <span>
            Portas que você abre desta máquina <code>ports</code>
          </span>
          <span className="muted">
            separadas por vírgula, como 5173: para ver um servidor que ele
            subir, em 127.0.0.1:porta
          </span>
          <input
            value={agent.ports}
            inputMode="numeric"
            onChange={(e) => onChange({ ports: e.target.value })}
          />
        </label>
        <details className="create-more">
          <summary>Mais opções do lugar de trabalho</summary>
          <label>
            <span>
              Onde guardar a pasta pessoal (home) dele <code>homes</code>
            </span>
            <span className="muted">
              vazio usa o workspaces.homes do goiaba.config.ts
            </span>
            <input
              value={agent.homes}
              onChange={(e) => onChange({ homes: e.target.value })}
            />
          </label>
        </details>
      </fieldset>

      <fieldset>
        <legend>
          O que pode fazer <code>policy</code>
        </legend>
        <p className="muted">
          O que não estiver liberado aqui é negado sem perguntar: numa rodada,
          ninguém responde.
        </p>
        <label>
          Na pasta da rodada, ele pode
          <select
            value={agent.access}
            onChange={(e) => {
              if (isAccess(e.target.value))
                onChange({ access: e.target.value });
            }}
          >
            <option value="write">ler e escrever</option>
            <option value="read">
              só ler (e a rodada confere que não mexeu)
            </option>
          </select>
        </label>
        <div className="command-picker">
          <span>
            Comandos que ele pode rodar{' '}
            <span className="muted">
              “não pode” vale mesmo que outra regra libere; sem marcar, não pode
            </span>
          </span>
          {commandGroups.map((group) => (
            <fieldset key={group.title} className="command-group">
              <legend>{group.title}</legend>
              {group.commands.map((command) => (
                <div key={command} className="command-option">
                  <code>{command}</code>
                  <PermissionToggle
                    name={command}
                    value={agent.decided.get(command)}
                    onDecide={(permission) =>
                      onChange({
                        decided: toggled(agent.decided, command, permission),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          ))}
          <div className="command-more">
            <label>
              Outros que pode{' '}
              <span className="muted">um por linha (make *, cargo test)</span>
              <textarea
                rows={2}
                value={agent.moreAllowed}
                onChange={(e) => onChange({ moreAllowed: e.target.value })}
              />
            </label>
            <label>
              Outros que não pode{' '}
              <span className="muted">um por linha (git push *)</span>
              <textarea
                rows={2}
                value={agent.moreDenied}
                onChange={(e) => onChange({ moreDenied: e.target.value })}
              />
            </label>
          </div>
        </div>
        <label>
          Sites e endereços que pode acessar{' '}
          <span className="muted">
            um por linha (registry.npmjs.org, *.github.com); vazio, sem internet
          </span>
          <textarea
            rows={2}
            value={agent.hosts}
            onChange={(e) => onChange({ hosts: e.target.value })}
          />
        </label>
        {PROJECT_TOOLS.length > 0 && (
          <fieldset className="command-group tool-group">
            <legend>Ferramentas do projeto que pode usar</legend>
            {PROJECT_TOOLS.map((tool) => (
              <div key={tool.name} className="command-option">
                <code>{tool.name}</code>
                <PermissionToggle
                  name={tool.name}
                  value={agent.toolDecided.get(tool.name)}
                  onDecide={(permission) =>
                    onChange({
                      toolDecided: toggled(
                        agent.toolDecided,
                        tool.name,
                        permission,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </fieldset>
        )}
      </fieldset>

      <fieldset>
        <legend>
          Como saber se {who} fez o que foi pedido <code>criteria</code>
        </legend>
        <p className="muted">
          A rodada confere sozinha, olhando os arquivos no fim de cada passo
          dele, sem ler o que ele respondeu. É o que conta na nota de eficácia.
          Uma conferência para cada coisa pedida.
        </p>
        {agent.criteria.map((row) =>
          row.kind === 'file' ? (
            <div className="criterion-row" key={row.key}>
              <FileFieldsEditor
                value={row.file}
                onChange={(change) =>
                  changeRow(row.key, (current) =>
                    current.kind === 'file'
                      ? { ...current, file: { ...current.file, ...change } }
                      : current,
                  )
                }
              />
              <button
                type="button"
                className="close"
                aria-label="Tirar esta conferência"
                onClick={() => removeRow(row.key)}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="criterion-if" key={row.key}>
              <div className="criterion-if-head">
                <b>
                  Depende de como ele encontra a pasta <code>if</code>
                </b>
                <button
                  type="button"
                  className="close"
                  aria-label="Tirar esta conferência"
                  onClick={() => removeRow(row.key)}
                >
                  ×
                </button>
              </div>
              <div className="criterion-row">
                <label>
                  Se, quando ele começa, o arquivo
                  <input
                    value={row.when.name}
                    placeholder="ticket.md"
                    onChange={(e) =>
                      changeIf(row.key, (current) => ({
                        ...current,
                        when: { ...current.when, name: e.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  &nbsp;
                  <select
                    value={row.when.check}
                    onChange={(e) => {
                      const check = e.target.value;
                      if (!isConditionCheck(check)) return;
                      changeIf(row.key, (current) => ({
                        ...current,
                        when: { ...current.when, check },
                      }));
                    }}
                  >
                    {Object.entries(CONDITIONS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {row.when.check === 'contains' ? 'o trecho' : <>&nbsp;</>}
                  <input
                    value={row.when.contains}
                    disabled={row.when.check !== 'contains'}
                    onChange={(e) =>
                      changeIf(row.key, (current) => ({
                        ...current,
                        when: { ...current.when, contains: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <span className="criterion-branch">
                então, no fim do passo, <code>check</code>
              </span>
              <div className="criterion-row">
                <FileFieldsEditor
                  value={row.checkFile}
                  onChange={(change) =>
                    changeIf(row.key, (current) => ({
                      ...current,
                      checkFile: { ...current.checkFile, ...change },
                    }))
                  }
                />
              </div>
              <label className="criterion-else">
                <input
                  type="checkbox"
                  checked={row.hasElse}
                  onChange={(e) =>
                    changeIf(row.key, (current) => ({
                      ...current,
                      hasElse: e.target.checked,
                    }))
                  }
                />
                Se não, conferir outra coisa <code>else</code>
              </label>
              {row.hasElse ? (
                <div className="criterion-row">
                  <FileFieldsEditor
                    value={row.elseFile}
                    onChange={(change) =>
                      changeIf(row.key, (current) => ({
                        ...current,
                        elseFile: { ...current.elseFile, ...change },
                      }))
                    }
                  />
                </div>
              ) : (
                <p className="muted">Se não, nada é cobrado dele.</p>
              )}
            </div>
          ),
        )}
        <div className="criterion-add">
          <button
            type="button"
            className="more-rounds"
            onClick={addFileCriterion}
          >
            Conferir um arquivo
          </button>
          <button
            type="button"
            className="more-rounds"
            onClick={addConditional}
          >
            Conferir só se…
          </button>
        </div>
        <span className="criterion-branch">
          Quanto {who} pode gastar, somando os passos dele <code>limit</code>
        </span>
        <LimitsEditor
          value={agent.limits}
          onChange={(change) =>
            onChange({ limits: { ...agent.limits, ...change } })
          }
        />
        <div className="criteria-words">
          <b>Em palavras</b>
          {sentences.length === 0 ? (
            <p className="muted">
              Nada é conferido ainda: sem conferências, a rodada sabe quanto{' '}
              {who} gastou, mas não se fez o que foi pedido.
            </p>
          ) : (
            <ul>
              {sentences.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>
    </>
  );
}
