import { buscarPorId, descreverAtivos } from './usuarios.js';

const usuario = buscarPorId(1);
if (usuario !== undefined) {
  console.log(`Olá, ${usuario.nome}!`);
}
console.log(descreverAtivos());
