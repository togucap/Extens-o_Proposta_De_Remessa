# Proposta de Remessa – Verificador de Triagem RMA

Extensão do Google Chrome que roda na tela **Gerar Proposta de Remessa**
(`.../rma/transferencia/proposta_remessa/gerar_proposta_remessa.cgi`).

## O que ela faz

1. Monitora o campo **Etiquetas** (`#form-mercadoria-busca`).
2. Cada etiqueta bipada vai para uma fila e é consultada **uma por vez**, em segundo plano,
   na tela **Estoque de Mercadoria** (`.../recebimento/estoque/estoque_mercadoria.cgi`).
3. Lê a tabela de rastreamento (`#rastreamento`) **de baixo para cima** procurando a interação
   **"RMA - Registrado Triagem"** (a data não é verificada, apenas a existência da interação).
4. Lê os campos **Produto** e **Final** da tela de estoque (o valor que fica à frente do rótulo).
5. Mostra o resultado, com Produto e Final, no painel **Etiquetas verificadas** (topo da tela, à direita).
   Enquanto consulta, o título do painel mostra "⏳ consultando…" e quantas etiquetas estão na fila.
   Não há balão no centro da tela.

| Cor | Resultado |
|---|---|
| 🟢 Verde | Interação encontrada **uma vez** |
| 🟠 Laranja | Interação encontrada **mais de uma vez** (lista as datas de cada uma) |
| 🔴 Vermelho | Sem a interação "RMA - Registrado Triagem", ou etiqueta sem rastreamento |
| ⚪ Cinza | Erro na consulta (ex.: sessão expirada) |

A extensão **não bloqueia** nada. A única alteração no campo é a feita pelo botão **Remover não encontrados**, quando você clica nele.

No topo da tela, à direita, fica um painel com o histórico das últimas etiquetas verificadas.

## Conferência da proposta (botão `#id_submit_button`)

Ao clicar no botão que gera a listagem de produtos, a extensão espera a tabela aparecer em
`#listagem-produtos-filtrado` e compara com as etiquetas bipadas no campo:

- As etiquetas que **não aparecem** na tabela (não atendem aos critérios da proposta) ficam
  **destacadas em vermelho no próprio campo de bipagem**, com o **Produto** e o **Final** ao lado.
- No **topo da tela, à direita**, ficam **dois painéis lado a lado**:
  - **Conferência da proposta** (à esquerda; abre sozinho a cada nova conferência): lista o que **não entrou** (vermelho) e o que **entrou**
    (verde) na proposta, com Produto e Final de cada etiqueta.
  - **Etiquetas verificadas** (à direita): histórico das etiquetas bipadas e a verificação de triagem;
    as que não entraram na proposta recebem o selo **NÃO APARECE NA PROPOSTA**.
  - Cada painel pode ser recolhido clicando no título.
- Se todas aparecerem, o painel de conferência fica verde.

O destaque é uma camada desenhada por cima do campo (não altera o que está escrito nele).

### Botão "Remover não encontrados"

- Aparece **ao lado direito do campo Mercadoria** somente depois da conferência (botão Buscar) e
  enquanto houver etiquetas destacadas em vermelho no campo. Mostra quantas serão removidas.
- Acompanha o campo quando ele é **redimensionado** ou quando a tela rola.
- Ao clicar, tira do campo **apenas** as etiquetas que não entraram na proposta; as demais ficam.
- No painel de conferência, essas etiquetas recebem o selo **REMOVIDA DO CAMPO**.

## Instalação ("Carregar sem compactação")

1. Baixe/clone este repositório para uma pasta do computador.
2. No Chrome, abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta **`proposta-remessa`** dentro do repositório (a que contém `manifest.json`).
5. Abra (ou recarregue) a tela de Gerar Proposta de Remessa. A extensão ativa sozinha.

Depois de alterar algum arquivo, clique no botão ↻ da extensão em `chrome://extensions` e recarregue a tela.

## Como a consulta é feita

- **Consulta direta (padrão):** a extensão abre a tela de estoque em segundo plano, identifica o
  formulário e o campo de etiqueta automaticamente e envia a etiqueta usando a sessão já logada.
  A tela de estoque é montada com `<frameset>` (frame `?funcao=topo_conteudo` + frame `conteudo_meio`);
  a extensão entra nos frames para achar o campo e o rastreamento.
- **Iframe oculto (reserva):** se a tela de estoque carregar o rastreamento via JavaScript, a
  extensão abre a tela num iframe invisível, preenche o campo e aguarda o rastreamento aparecer.

## Leitor de código de barras

Funciona com leitores que enviam **ENTER** ao final da leitura e também com os que não enviam
(nesse caso a etiqueta é considerada completa após 700 ms sem novos caracteres).

## Configuração

No início do `content.js` há o objeto `CONFIG`:

| Opção | Padrão | Descrição |
|---|---|---|
| `NOME_CAMPO_ESTOQUE` | `null` | `name` do campo de etiqueta na tela de estoque (`null` = detecta sozinho) |
| `TEXTO_INTERACAO` | `RMA - Registrado Triagem` | Interação procurada |
| `CAMPOS_EXTRAS` | Produto, Final | Rótulos lidos na tela de estoque e exibidos no resumo |
| `SELETOR_BOTAO_VERIFICAR` | `#id_submit_button` | Botão que gera a listagem da proposta |
| `SELETOR_LISTAGEM` | `#listagem-produtos-filtrado` | Onde a listagem aparece |
| `ESPERA_FIM_LEITURA_MS` | `700` | Espera para leitores sem ENTER |
| `TIMEOUT_CONSULTA_MS` | `20000` | Tempo máximo de cada consulta |

## Problemas

Abra o console da página (F12 → Console) e procure mensagens iniciadas por `[Triagem RMA]`.
