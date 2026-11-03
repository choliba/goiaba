/**
 * Uma rodada de três agentes, do começo ao fim sem perguntar nada: o
 * programador consulta o analista, corrige o que ele apontou e consulta o
 * revisor. Toda rodada parte do mesmo ponto (a tag `rodada-base` do git do
 * workspace), e o git diz o que cada agente mudou de fato. Tudo aparece na
 * tela e vai para o log; a rodada também fica em docs/rodadas/<início>.json,
 * ao lado das páginas, para comparar uma rodada com outra.
 */
import {
  Agent,
  agentConversation,
  ClaudeProvider,
  CursorProvider,
  ensureDirectory,
  getConfig,
  join,
  resolve,
  runScript,
  UsageError,
  Workspace,
  type AgentProvider,
  type Interaction,
} from '../src/index';
import { environment, runProgram } from '../src/execute/process';
import { writeText } from '../src/filesystem/index';

/** O que um agente recebe quando pergunta algo: ninguém responde na rodada. */
const NO_ONE_ANSWERS =
  'Ninguém vai responder nesta rodada. Decida você, escolhendo a opção mais simples, diga qual escolheu e siga.';

/**
 * Para quem não altera arquivos: testar no próprio diretório não conta como
 * alteração (o que o build gera, o git ignora), e o script confere pelo git.
 */
const RUN_IN_PLACE =
  'Você pode compilar e rodar os testes no próprio diretório: o que eles geram (como dist/) o git ignora. Não copie o projeto para outro lugar.';

/** O que se espera de toda correção, nas rodadas que se comparam. */
const EVERY_FIX_TESTED =
  'Todo ponto corrigido ganha um teste que falharia sem a correção.';

/** A tag do git do workspace de onde toda rodada parte. */
const BASE = 'rodada-base';

/** A raiz do Goiaba: os registros das rodadas ficam em docs/rodadas. */
const PROJECT = resolve(import.meta.dir, '..');

/** Variáveis cujo valor é segredo, pelo nome. */
const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASS|AUTH|CREDENTIAL/i;

/** Valores mais curtos que isso não são trocados: casariam com texto comum. */
const MIN_SECRET_LENGTH = 12;

/** Quanto um comando git pode levar, em ms: são todos locais e pequenos. */
const GIT_TIMEOUT_MS = 30_000;

/** O que cada agente fez na rodada, na ordem. */
interface Step {
  readonly agent: string;
  readonly provider: string;
  readonly prompt: string;
  /** Tudo o que o agente disse, na ordem. */
  readonly said: string[];
  /** Perguntas que ele fez mesmo assim, respondidas com `NO_ONE_ANSWERS`. */
  readonly asked: string[];
  /** Arquivos que o git mostra mudados pelo agente (`git status`). */
  changed: string[];
  /** O que ele mudou (`git diff`), quando mudou algo. */
  diff: string;
  /** Mudou arquivos mesmo tendo recebido "não altere nenhum arquivo". */
  brokeReadOnly: boolean;
}

/** O estado do workspace no git, para saber se um agente mudou algo. */
interface Tree {
  /** As linhas do `git status --porcelain`. */
  readonly status: readonly string[];
  readonly diff: string;
  /** Muda quando qualquer arquivo muda, inclusive um que ainda não está no git. */
  readonly key: string;
}

const screen = agentConversation();
const root = getConfig().workspaces.dir;

const git = (...args: string[]): Promise<string> =>
  runProgram('git', ['-C', root, ...args], { timeoutMs: GIT_TIMEOUT_MS });

/** Volta o workspace a `BASE`, sem o que a rodada anterior deixou. */
async function resetWorkspace(): Promise<string> {
  try {
    await git('rev-parse', '--verify', '--quiet', `${BASE}^{commit}`);
  } catch {
    throw new UsageError(
      `O workspace (${root}) não tem a tag ${BASE}. Marque o ponto de partida das rodadas: git -C ${root} tag ${BASE} <commit>`,
    );
  }
  await git('checkout', '--force', '--detach', BASE);
  // Sem -x: o que o .gitignore ignora (node_modules, dist) fica.
  await git('clean', '-fd');
  return (await git('rev-parse', '--short', 'HEAD')).trim();
}

async function tree(): Promise<Tree> {
  const status = (await git('status', '--porcelain=v1', '-uall'))
    .split('\n')
    .filter((line) => line.length > 0);
  const diff = await git('diff', 'HEAD');
  const untracked = (await git('ls-files', '--others', '--exclude-standard'))
    .split('\n')
    .filter((line) => line.length > 0);
  const hashes =
    untracked.length === 0 ? '' : await git('hash-object', '--', ...untracked);
  return { status, diff, key: `${status.join('\n')}\n${diff}\n${hashes}` };
}

/** `analista` → `Analista`. */
const title = (name: string): string =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

interface Consult {
  readonly name: string;
  readonly prompt: string;
  readonly provider: AgentProvider;
  /** Quem o consulta, mostrado antes dele. */
  readonly by?: string;
  /** Recebeu "não altere nenhum arquivo": o git confere. */
  readonly readOnly?: boolean;
}

/**
 * Roda um agente até o fim, na tela, e devolve tudo o que ele disse. Depois,
 * o git diz o que ele mudou. Sem resposta (Ctrl+C, por exemplo), `undefined`:
 * a rodada para, e o próximo não recebe um pedido vazio.
 */
async function ask(
  steps: Step[],
  { name, prompt, provider, by, readOnly = false }: Consult,
): Promise<string | undefined> {
  const described = provider.describe?.();
  const step: Step = {
    agent: name,
    provider:
      described === undefined
        ? provider.id
        : `${described.name} · ${described.model}`,
    prompt,
    said: [],
    asked: [],
    changed: [],
    diff: '',
    brokeReadOnly: false,
  };
  steps.push(step);

  if (by !== undefined) screen.write(`\n${title(by)} consulta ${name}`);
  screen.write(`${title(name)}…`);
  const before = await tree();

  // A tela da conversa, sem ler o teclado: uma pergunta do agente é
  // respondida aqui, e a resposta aparece como se alguém tivesse digitado.
  const interaction: Interaction = {
    ask: (question) => {
      step.asked.push(question);
      screen.write(`› ${NO_ONE_ANSWERS}`);
      return Promise.resolve(NO_ONE_ANSWERS);
    },
    write: (value) => screen.write(value),
    stream: (text) => screen.stream(text),
    reasoning: (text) => screen.reasoning(text),
    status: (text) => screen.status(text),
    error: (text) => screen.error(text),
  };

  await new Agent({
    name,
    prompt,
    // Trabalha até terminar e encerra; não retoma uma tarefa antiga.
    conversation: false,
    resume: false,
    provider,
    workspace: new Workspace({
      type: 'docker',
      image: 'FROM busybox:latest',
      root,
      hostState: 'none',
    }),
    interaction,
    subscribe: [
      (event) => {
        // Só o que o modelo disse: o stderr da CLI chega como `stderr`.
        const { value } = event.data();
        if (event.type() === 'output' && typeof value === 'string') {
          step.said.push(value);
        }
      },
    ],
  }).run();

  const after = await tree();
  if (after.key !== before.key) {
    const added = after.status.filter((line) => !before.status.includes(line));
    // Um arquivo que já estava mudado e mudou de novo não muda a linha.
    step.changed = added.length > 0 ? added : [...after.status];
    step.diff = after.diff;
    step.brokeReadOnly = readOnly;
    screen.write(
      readOnly
        ? `⚠ O ${name} alterou arquivos, mesmo com o pedido de não alterar:\n${step.changed.join('\n')}`
        : `O ${name} alterou:\n${step.changed.join('\n')}`,
    );
  } else if (readOnly) {
    screen.write(`✓ O ${name} não alterou nenhum arquivo.`);
  }

  const said = step.said.join('\n\n').trim();
  if (said.length === 0) {
    screen.write(`O ${name} terminou sem responder: a rodada parou.`);
    return undefined;
  }
  return said;
}

/**
 * O registro vai para o git: sai sem o caminho do projeto (`<projeto>`), sem o
 * home de quem rodou (`~`) e sem o valor de nenhuma credencial do ambiente
 * (fica o nome dela, `<CURSOR_API_KEY>`).
 */
function sanitize(text: string): string {
  const env = environment();
  let clean = text;
  for (const [name, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      value.length >= MIN_SECRET_LENGTH &&
      CREDENTIAL_NAME.test(name)
    ) {
      clean = clean.replaceAll(value, `<${name}>`);
    }
  }
  clean = clean.replaceAll(PROJECT, '<projeto>');
  const home = env['HOME'];
  return home === undefined ? clean : clean.replaceAll(home, '~');
}

/** Guarda a rodada ao lado das páginas, em docs/rodadas. */
function record(
  startedAt: Date,
  base: string | undefined,
  steps: readonly Step[],
): string {
  const dir = join(PROJECT, 'docs', 'rodadas');
  ensureDirectory(dir);
  const file = join(
    dir,
    `${startedAt.toISOString().replaceAll(':', '-')}.json`,
  );
  writeText(
    file,
    sanitize(
      `${JSON.stringify(
        {
          inicio: startedAt.toISOString(),
          fim: new Date().toISOString(),
          partida: base === undefined ? null : { tag: BASE, commit: base },
          etapas: steps.map((step) => ({
            agente: step.agent,
            provider: step.provider,
            pedido: step.prompt,
            disse: step.said,
            perguntou: step.asked,
            alterou: step.changed,
            desobedeceuSomenteLeitura: step.brokeReadOnly,
            diff: step.diff,
          })),
        },
        null,
        2,
      )}\n`,
    ),
  );
  return file;
}

await runScript(async () => {
  const startedAt = new Date();
  const steps: Step[] = [];
  let base: string | undefined;

  try {
    base = await resetWorkspace();
    screen.write(`Workspace no ponto de partida: ${BASE} (${base})`);

    const analysis = await ask(steps, {
      name: 'analista',
      by: 'programador',
      readOnly: true,
      provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
      prompt: [
        'Você é o analista de uma equipe de três agentes: analista, programador e revisor.',
        'O programador pediu esta análise.',
        'Analise o projeto do diretório atual.',
        'Não altere nenhum arquivo do projeto e não faça perguntas: ninguém vai responder.',
        RUN_IN_PLACE,
        'Responda só com a lista de problemas, do mais importante para o menos importante, cada um com o arquivo e a linha.',
      ].join('\n'),
    });
    if (analysis === undefined) return;

    const changes = await ask(steps, {
      name: 'programador',
      provider: new ClaudeProvider({ model: 'claude-opus-5-5' }),
      prompt: [
        'Você é o programador de uma equipe de três agentes: analista, programador e revisor.',
        'O analista entregou a análise abaixo.',
        'Corrija os problemas que valem a pena corrigir.',
        EVERY_FIX_TESTED,
        'Não faça perguntas: ninguém vai responder. Quando houver uma decisão, escolha a opção mais simples e diga qual escolheu.',
        'Não faça commits.',
        'No fim, diga o que mudou, arquivo por arquivo, qual teste cobre cada correção, e o que deixou de fora e por quê.',
        '',
        'Análise do analista:',
        analysis,
      ].join('\n'),
    });
    if (changes === undefined) return;

    await ask(steps, {
      name: 'revisor',
      by: 'programador',
      readOnly: true,
      provider: new CursorProvider({ model: 'gpt-5.6-terra' }),
      prompt: [
        'Você é o revisor de uma equipe de três agentes: analista, programador e revisor.',
        'O programador fez as mudanças abaixo, a partir da análise do analista.',
        'Confira no código (git diff) se as mudanças estão certas e completas.',
        `Regra da equipe: ${EVERY_FIX_TESTED} Confira, ponto por ponto, se cada correção tem esse teste.`,
        'Não altere nenhum arquivo do projeto e não faça perguntas: ninguém vai responder.',
        RUN_IN_PLACE,
        'Responda com o que está certo, o que está errado e o que falta, do mais importante para o menos importante.',
        '',
        'Análise do analista:',
        analysis,
        '',
        'O que o programador diz que mudou:',
        changes,
      ].join('\n'),
    });
  } finally {
    screen.write(`\nRodada guardada em ${record(startedAt, base, steps)}`);
  }
});
