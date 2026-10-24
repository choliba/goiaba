# Goiaba

Agente que analisa a pasta `app/` com o Codex.

O fluxo é dividido em três responsabilidades:

- `Executor` inicia programas e envia comandos;
- providers descrevem cada programa e interpretam suas respostas;
- `OutputDispatcher<T>` distribui resultados por execução e para assinantes
  globais.

```bash
bun run arquiteto
```

```ts
import {
  Agent,
  CodexProvider,
  Executor,
  OutputDispatcher,
  Workspace,
} from './src/index.js';

const output = new OutputDispatcher<string>();
const executor = new Executor({ output });
const agent = new Agent({
  prompt: 'Analise o projeto.',
  provider: new CodexProvider({ model: 'gpt-6.1-sol' }),
  workspace: new Workspace({
    type: 'unrestricted',
    root: '/home/dev/dev/goiaba',
  }),
  executor,
});

void (async () => {
  for await (const event of output.subscribe()) {
    console.log(event.executionId, event.programId, event.value);
  }
})();

await agent.run();
```
