import {
  Agent,
  OllamaProvider,
  Workspace,
  type AgentPolicy,
  type CommandApprover,
  type OutputAdapter,
} from '../src/index';

/**
 * The Instructor: builds and teaches courses about Goiaba's modules. It reads
 * the module's code itself, inside the sandbox, and writes the course to
 * `guides/<module>/curso.md`; it can touch nothing else.
 */
export interface InstructorOptions {
  /** Folder under `src/`: `command`, `logger`, `events`… */
  readonly module: string;
  /**
   * The module's files, relative to `src/<module>`: given in the prompt so the
   * model neither searches for them nor guesses names.
   */
  readonly files: readonly string[];
  /** Root of the Goiaba repository. */
  readonly root: string;
  /** Ollama model. */
  readonly model: string;
  readonly interaction: OutputAdapter;
  readonly signal: AbortSignal;
}

/** Reads the whole repository, writes only the guides. */
export const instructorPermissions: AgentPolicy = {
  default: 'deny',
  allow: {
    filesystem: [
      { operations: ['read'], paths: ['/workspace/**'] },
      { operations: ['write'], paths: ['/workspace/guides/**'] },
    ],
    execution: [
      { commands: ['ls *', 'cat *', 'find *', 'grep *', 'pwd', 'mkdir *'] },
    ],
  },
  // Any other command goes to `approve` (sandboxApprover), not to the
  // default deny, which would wait for a person nobody is.
  requireApproval: {
    execution: [{ commands: ['*'] }],
  },
};

/**
 * Nobody watches the Instructor: what the policy leaves open is decided here,
 * not by a person. The sandbox is the boundary (read-only workspace, writes
 * only in guides/), so a command the gate cannot verify (a pipe, a
 * redirection, any program: requireApproval `*`) runs; a `deny` rule never
 * gets here. The network stays shut: it is what the sandbox would not hold.
 * `once` saves nothing: no approval is left to reopen a finished run.
 */
export const sandboxApprover: CommandApprover = ({ category }) =>
  Promise.resolve(category === 'network' ? 'deny' : 'once');

export function createInstructor({
  module,
  files,
  root,
  model,
  interaction,
  signal,
}: InstructorOptions): Agent {
  return new Agent({
    name: 'instructor',
    prompt: coursePrompt(module, files),
    // As the Modelfile's num_ctx: the CLI compacts by it.
    provider: new OllamaProvider({
      cli: 'claude',
      model,
      contextWindow: 65_536,
    }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root,
    }),
    permissions: instructorPermissions,
    approve: sandboxApprover,
    interaction,
    signal,
    // One course, then it ends.
    conversation: false,
  });
}

function coursePrompt(module: string, files: readonly string[]): string {
  const list = files.map((file) => `   - src/${module}/${file}`).join('\n');

  return `Você é o Instructor do Goiaba: elabora e aplica cursos sobre os módulos do sistema, para quem vai trabalhar no código.

Tarefa: criar o curso do módulo "${module}".

1. Leia estes arquivos, e só estes (são todos os do módulo):
${list}
2. Veja quem usa o módulo: grep -rn "${module}/" src scripts agents
3. Escreva o curso em guides/${module}/curso.md, em português, com:
   - # Módulo ${module}: para que ele existe (o problema que resolve, em linguagem simples)
   - ## Os arquivos (tabela: arquivo, papel)
   - ## Como funciona (o caminho de uma chamada, do começo ao fim)
   - ## Exemplo real (um trecho de quem usa o módulo no projeto, explicado)
   - ## Regras do módulo (o que só ele pode fazer, o que ninguém deve fazer fora dele)
   - ## Exercícios (2 ou 3, do mais simples ao mais difícil, sem a resposta)
4. Cite só o que está no código: nada de arquivos, funções ou opções inventadas.

A rede está bloqueada; para ler o código, use as ferramentas de leitura ou comandos como ls, cat, find e grep.
Não altere nenhum arquivo fora de guides/${module}/.`;
}
