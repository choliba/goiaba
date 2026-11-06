import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buscarPorEmail,
  buscarPorId,
  descreverAtivos,
  listarAtivos,
} from './usuarios.js';

test('listarAtivos devolve só os ativos, por nome', () => {
  assert.deepEqual(
    listarAtivos().map((usuario) => usuario.nome),
    ['Ana', 'Carla'],
  );
});

test('buscarPorId acha o usuário', () => {
  assert.equal(buscarPorId(2)?.nome, 'Bruno');
});

test('buscarPorId devolve undefined para um id que não existe', () => {
  assert.equal(buscarPorId(99), undefined);
});

test('buscarPorEmail acha o usuário', () => {
  assert.equal(buscarPorEmail('ana@exemplo.com')?.id, 1);
});

test('descreverAtivos lista os nomes', () => {
  assert.equal(descreverAtivos(), 'Usuários ativos: Ana, Carla');
});
