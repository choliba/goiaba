/**
 * The project's own tool in use: the agent sees `goiaba/fetch_web_content`
 * (agents/tools/fetch-web-content.ts) because its provider's `tools` names
 * it, and may call it because the policy allows it. Everything else of the
 * web stays off: the page is opened by the tool, in the Goiaba's process.
 */

import {
  Agent,
  OllamaProvider,
  Workspace,
  getConfig,
  runScript,
} from '../src/index';
import { FETCH_WEB_CONTENT } from './tools/fetch-web-content';

await runScript(async () => {
  await new Agent({
    name: 'solicitante',
    resume: false,
    prompt:
      'Use a ferramenta fetch_web_content para abrir https://bun.sh e diga, em poucas linhas, o título e os principais cabeçalhos da página.',
    provider: new OllamaProvider({
      cli: 'claude',
      model: 'qwen3.5:4b',
      contextWindow: 32768,
      think: false,
      tools: ['file_read', 'file_write', FETCH_WEB_CONTENT],
    }),
    workspace: new Workspace({
      type: 'bubblewrap',
      root: getConfig().workspaces.dir,
      hostState: 'none',
    }),
    policy: {
      default: 'deny',
      allow: {
        filesystem: [{ operations: ['*'], paths: ['/workspace/**'] }],
        // The tool, by its name: the same one the provider's tools gives.
        // tools: [{ operations: ['call'], tools: [FETCH_WEB_CONTENT] }],
      },
      deny: {
        tools: [{ operations: ['*'], tools: [FETCH_WEB_CONTENT] }],
      },
    },
  }).run();
});
