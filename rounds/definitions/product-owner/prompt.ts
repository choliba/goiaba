const problema = `
Problema:
Alterar o header do site para a cor #5f4e4e
`.trim();

export const prompt = () => {
  return [
    `Você é o Product Owner.
UM especialista em negócio.
Seu trabalho é transformar um problema em um ticket.
Use linguagem livre **Não técnica
Escreva um ticket prefixado pelo número.
Escreva critérios de aceites testáveis, em Gherkin(Dado / Quando / Então).
Escreva o ticket no arquivo ticket.md.
** Este é o único assunto a ser tratado ${problema}***`.trim(),
  ];
};
