# Shopee – Status Tracking da Planilha

Extensão do Google Chrome para a tela **Retornos e Pedidos cancelados** do Shopee Seller Center
(`https://seller.shopee.com.br/portal/sale/returnrefundcancel`).

## O que ela faz

1. Lê o **ID do Pedido** de cada bloco da lista (`.order-id .id-content`).
2. Procura esse ID na coluna **`Pedido_Parceiro`** da planilha.
3. Mostra um balão ao lado do ID do pedido:

| Balão | Significado |
|---|---|
| **Tracking: _status_** (azul) | ID encontrado: mostra a coluna **`Status tracking`** |
| **Encontrado, sem Status tracking** (amarelo) | ID está na planilha, mas o status está vazio |
| **Não encontrado** (cinza) | ID não está na coluna `Pedido_Parceiro` |
| **⚠ Erro ao ler a planilha** (vermelho) | Sem acesso à planilha (passe o mouse para ver o motivo) |

- Funciona ao trocar de aba (Todos, Em devolução, Canceladas…) e de página, sem recarregar.
- **Clicar em um balão** abre um pop-up com os detalhes do pedido (sem abrir o pedido na Shopee).

## Pop-up de detalhes

| Campo | Origem |
|---|---|
| Status tracking | coluna `Status tracking` |
| Data Ocorrência | coluna `Data Ocorrencia` |
| Cidade última interação | coluna `cidade ultima interação` |
| Data Prevista Entrega | coluna `Data Prevista Entrega` |
| Método de retorno | **JadLog** quando `Autorização Postagem` começa com `13`; nos demais casos **Correios** |
| Assistência | **Sim** quando `Assistencia_Tecnica` tem conteúdo (o conteúdo aparece abaixo); **Não** quando está vazia ou com `-`, `#N/A`, `0`, `Não` |

- Fecha no **×**, com **Esc** ou clicando fora.
- O botão **↻ Atualizar planilha** baixa a planilha de novo na hora.

## Quando a planilha é baixada

- A planilha é baixada **uma vez** e reaproveitada por **5 minutos** (`CACHE_MINUTOS`).
  Recarregar a tela, trocar de aba ou de página dentro desse tempo **não** baixa de novo.
- Depois de 5 minutos, a próxima vez que a tela precisar dos dados ela baixa de novo.
- O botão **↻ Atualizar planilha** (no pop-up) baixa na hora, sem esperar os 5 minutos.
- A cópia fica só na memória do Chrome e é apagada quando o navegador é fechado.

## Como a planilha é lida

A extensão baixa a aba da planilha em CSV
(`docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<aba>`). Ela **só lê**: não altera a
planilha e **não usa nem modifica Apps Script**.

Para ter acesso, uma das duas opções:

- **Recomendado:** usar o Chrome com a conta Google (corporativa) que tem acesso à planilha,
  logada no navegador. A planilha pode continuar **restrita**.
- **Alternativa:** compartilhar a planilha como **"Qualquer pessoa com o link" → Leitor**.
  Atenção: assim qualquer pessoa com o link vê todos os dados da planilha.

## Instalação ("Carregar sem compactação")

1. Baixe/clone o repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta **`shopee-tracking`**.
4. Abra (ou recarregue) a tela de Retornos e Pedidos cancelados da Shopee.

## Configuração

No início do `background.js`:

| Opção | Padrão | Descrição |
|---|---|---|
| `PLANILHA_ID` | `1FApiWFY6neQ2yGlhA7adHp7ePL10naqmQJwv7RRHEUM` | ID da planilha (parte do link) |
| `ABA_GID` | `1831425043` | Aba da planilha (`gid=` no link) |
| `COLUNA_PEDIDO` | `Pedido_Parceiro` | Coluna onde o ID do pedido é procurado |
| `COLUNA_STATUS` | `Status tracking` | Coluna exibida no balão |
| `COLUNAS_DETALHE` | Data Ocorrencia, cidade ultima interação, Data Prevista Entrega, Autorização Postagem, Assistencia_Tecnica | Colunas lidas para o pop-up |
| `CACHE_MINUTOS` | `5` | Tempo que a planilha baixada é reaproveitada |

No início do `content.js`: `CAMINHO_TELA` (tela onde a extensão age) e os seletores dos blocos.

A comparação do ID ignora espaços nas pontas e maiúsculas/minúsculas.

## Problemas

- Balão vermelho: passe o mouse para ver o motivo. Normalmente é o Chrome sem login na conta
  que tem acesso à planilha.
- Console da página (F12 → Console): mensagens iniciadas por `[Tracking Shopee]`.
- Detalhes da leitura da planilha: `chrome://extensions` → na extensão, clique em
  **service worker** para abrir o console dela.
