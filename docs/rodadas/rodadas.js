// As rodadas do agents/02.ts, em ordem. Toda página desta pasta monta o seu
// menu a partir desta lista: uma rodada nova entra só aqui.
const RODADAS = [
  {
    numero: 1,
    titulo: 'Papéis misturados',
    arquivo: '2026-11-03-rodada-1-papeis-misturados.html',
    resumo:
      'O analista corrigiu o código, o programador recebeu só a última fala, e "fechar o ticket" virou commit com autor inventado.',
  },
  {
    numero: 2,
    titulo: 'Cada um no seu papel',
    arquivo: '2026-11-03-rodada-2-cada-um-no-seu-papel.html',
    resumo:
      'Cada agente sabe o seu papel, recebe tudo o que o anterior disse, e ninguém pergunta nada a você.',
  },
  {
    numero: '3 · 1/2',
    titulo: 'Mesmo ponto de partida',
    arquivo: '2026-11-03-rodada-3-mesmo-ponto-de-partida.html',
    resumo:
      'Toda rodada parte da tag rodada-base, e o git confere o que cada agente mudou.',
  },
  {
    numero: '3 · 2/2',
    titulo: 'Mesma configuração, outro resultado',
    arquivo: '2026-11-03-rodada-3-2-repeticao.html',
    resumo:
      'A rodada 3 rodada de novo, sem mudar nada: o programador corrigiu 4 pontos onde a primeira execução corrigiu 2.',
  },
  {
    numero: '4 · 1/2',
    titulo: 'Uma correção, com teste',
    arquivo: '2026-11-03-rodada-4-uma-correcao-com-teste.html',
    resumo:
      'Testes no próprio diretório e a regra de que toda correção ganha um teste que falha sem ela.',
  },
  {
    numero: '4 · 2/2',
    titulo: 'A mesma correção, de novo',
    arquivo: '2026-11-03-rodada-4-2-repeticao.html',
    resumo:
      'A rodada 4 rodada de novo, sem mudar nada: a mesma correção, com o mesmo tipo de teste.',
  },
];

/** O arquivo aberto agora: no menu, ele não é um link. */
const atual = decodeURIComponent(location.pathname.split('/').pop() || '');

/** `<small>Rodada N</small>título`, sem innerHTML. */
function rotulo(el, rodada) {
  const numero = document.createElement('small');
  numero.textContent = `Rodada ${rodada.numero}`;
  el.append(numero, rodada.titulo);
  return el;
}

// O menu do topo, em toda página que tiver <nav id="rodadas">.
const menu = document.getElementById('rodadas');
if (menu) {
  const lista = document.createElement('ol');
  for (const rodada of RODADAS) {
    const item = document.createElement('li');
    if (rodada.arquivo === atual) {
      const aqui = rotulo(document.createElement('span'), rodada);
      aqui.setAttribute('aria-current', 'page');
      item.append(aqui);
    } else {
      const link = rotulo(document.createElement('a'), rodada);
      link.href = rodada.arquivo;
      item.append(link);
    }
    lista.append(item);
  }
  menu.append(lista);
}

// A lista completa, com o resumo de cada rodada, na página inicial.
const indice = document.getElementById('rodadas-indice');
if (indice) {
  for (const rodada of RODADAS) {
    const item = document.createElement('li');
    const link = rotulo(document.createElement('a'), rodada);
    link.href = rodada.arquivo;
    const resumo = document.createElement('p');
    resumo.textContent = rodada.resumo;
    item.append(link, resumo);
    indice.append(item);
  }
}
