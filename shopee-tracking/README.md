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
- **Clicar em um balão** baixa a planilha de novo (sem abrir o pedido). Passe o mouse para ver a hora da última leitura.
- A planilha é relida automaticamente a cada 5 minutos, no máximo.

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
| `CACHE_MINUTOS` | `5` | Tempo que a planilha baixada é reaproveitada |

No início do `content.js`: `CAMINHO_TELA` (tela onde a extensão age) e os seletores dos blocos.

A comparação do ID ignora espaços nas pontas e maiúsculas/minúsculas.

## Problemas

- Balão vermelho: passe o mouse para ver o motivo. Normalmente é o Chrome sem login na conta
  que tem acesso à planilha.
- Console da página (F12 → Console): mensagens iniciadas por `[Tracking Shopee]`.
- Detalhes da leitura da planilha: `chrome://extensions` → na extensão, clique em
  **service worker** para abrir o console dela.
