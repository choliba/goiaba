/**
 * Exemplo 4 do curso de output: a saída de uma conversa. A
 * TerminalInteraction (do módulo interaction) ouve o terminal e mostra numa
 * Output: a do terminal por padrão, ou a que você der. Aqui, o que ela
 * mostra vai para a memória; quem lê o stdin continua sendo o terminal.
 */
import { TerminalInteraction } from '../../../src/interaction/index';
import { terminalOutput, type Output } from '../../../src/output/index';

const shown: string[] = [];
const memory: Output = {
  write: (text) => shown.push(text),
};

const interaction = new TerminalInteraction({ output: memory });
interaction.write('olá, do agente');
interaction.status('⏳ pensando…'); // esta Output não tem status: ignorado
interaction.write('pronto');
interaction.close();

terminalOutput.write(`a conversa mostrou: ${JSON.stringify(shown)}`);
