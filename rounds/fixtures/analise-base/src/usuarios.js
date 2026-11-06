/**
 * @typedef {object} Usuario
 * @property {number} id
 * @property {string} nome
 * @property {string} email
 * @property {boolean} ativo
 */

/** @type {Usuario[]} */
export const usuariosPadrao = [
  { id: 3, nome: 'Carla', email: 'carla@exemplo.com', ativo: true },
  { id: 1, nome: 'Ana', email: 'ana@exemplo.com', ativo: true },
  { id: 2, nome: 'Bruno', email: 'bruno@exemplo.com', ativo: false },
];

/**
 * Os usuários ativos, em ordem alfabética de nome.
 * @param {Usuario[]} [usuarios]
 * @returns {Usuario[]}
 */
export function listarAtivos(usuarios = usuariosPadrao) {
  return usuarios
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .filter((usuario) => usuario.ativo);
}

/**
 * @param {number} id
 * @param {Usuario[]} [usuarios]
 * @returns {Usuario | undefined}
 */
export function buscarPorId(id, usuarios = usuariosPadrao) {
  return usuarios.find((usuario) => usuario.id === id);
}

/**
 * O usuário com este e-mail; e-mail não diferencia maiúsculas.
 * @param {string} email
 * @param {Usuario[]} [usuarios]
 * @returns {Usuario | undefined}
 */
export function buscarPorEmail(email, usuarios = usuariosPadrao) {
  return usuarios.find((usuario) => usuario.email === email);
}

/**
 * `Usuários ativos: Ana, Carla`, ou `Nenhum usuário ativo`.
 * @param {Usuario[]} [usuarios]
 * @returns {string}
 */
export function descreverAtivos(usuarios = usuariosPadrao) {
  const nomes = listarAtivos(usuarios).map((usuario) => usuario.nome);
  return `Usuários ativos: ${nomes.join(', ')}`;
}
