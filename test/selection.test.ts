import { describe, expect, test } from 'bun:test';

import { parseSelection } from '../src/approval/selection';

describe('seleção interativa de aprovações', () => {
  test('aceita itens, listas e intervalos sem duplicar', () => {
    expect(parseSelection('1,3,5-7,6', 8)).toEqual([0, 2, 4, 5, 6]);
  });

  test('vazio cancela', () => {
    expect(parseSelection('  ', 3)).toEqual([]);
  });

  test('rejeita índice inexistente e intervalo invertido', () => {
    expect(() => parseSelection('4', 3)).toThrow('Seleção inválida');
    expect(() => parseSelection('3-1', 3)).toThrow('Intervalo invertido');
  });
});
