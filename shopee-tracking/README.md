# Shopee – Status Tracking

Extensão do Google Chrome para a tela **Retornos e Pedidos cancelados** do Shopee Seller Center
(`https://seller.shopee.com.br/portal/sale/returnrefundcancel`).

Os dados vêm do arquivo **`Payload_Tracking`** (JSON) gerado a partir da planilha e salvo numa
pasta do Google Drive. **A extensão não acessa a planilha**, só esse arquivo. Por isso ela pode ser
compartilhada sem compartilhar a planilha.

## O que ela faz

1. Lê o **ID do Pedido** de cada bloco da lista (`.order-id .id-content`).
2. Procura esse ID no arquivo `Payload_Tracking`.
3. Mostra um balão ao lado do ID do pedido:

| Balão | Significado |
|---|---|
| **Tracking: _status_** (azul) | ID encontrado: mostra o `status` |
| **Encontrado, sem Status tracking** (amarelo) | ID está no arquivo, mas o status está vazio |
| **Não encontrado** (cinza) | ID não está no arquivo |
| **⚠ Erro ao ler o tracking** (vermelho) | Sem acesso ao arquivo (passe o mouse para ver o motivo) |

- Funciona ao trocar de aba (Todos, Em devolução, Canceladas…) e de página, sem recarregar.
- **Clicar em um balão** abre um pop-up com os detalhes do pedido (sem abrir o pedido na Shopee).

## Pop-up de detalhes

| Campo | Origem (campo do JSON) |
|---|---|
| Status tracking | `status` |
| Data Ocorrência | `dataOcorrencia` |
| Cidade última interação | `cidade` |
| Data Prevista Entrega | `dataPrevista` |
| Método de retorno | **JadLog** quando `autorizacao` começa com `13`; nos demais casos **Correios** |
| Assistência | `assistencia`: **Sim** ou **Não** |

- O rodapé mostra **"Dados gerados em dd/mm às hh:mm"** (campo `geradoEm` do arquivo).
- Fecha no **×**, com **Esc** ou clicando fora.
- O botão **↻ Atualizar dados** baixa o arquivo de novo na hora.

## Arquivo `Payload_Tracking`

Modelo em [`modelo-tracking.json`](modelo-tracking.json). Campos que a extensão usa:

```json
{
  "versao": 1,
  "geradoEm": "2026-11-19T13:43:02-03:00",
  "pedidos": {
    "<ID do pedido>": {
      "status": "", "dataOcorrencia": "", "cidade": "", "dataPrevista": "",
      "autorizacao": "", "assistencia": "Sim | Não"
    }
  }
}
```

Campos extras (ex.: `parceiro`, `totalPedidos`) são ignorados. O ID é comparado sem diferenciar
maiúsculas/minúsculas e sem espaços nas pontas.

### Como a extensão encontra o arquivo

1. Lista a pasta do Drive `PASTA_ID` e procura o arquivo chamado `Payload_Tracking`
   (também aceita `Payload_Tracking.json` / `.txt` e Google Docs com esse nome).
2. Guarda o ID do arquivo encontrado. Se o arquivo for recriado (ID novo), ela procura na pasta de novo.
3. Usa o **login do Google que está no Chrome**. Se houver mais de uma conta logada, ela tenta
   cada uma (até 4) e lembra qual funcionou.

### Compartilhamento (quem usa a extensão)

- Compartilhe a **pasta** (ou o arquivo) como **"Qualquer pessoa da organização com o link" → Leitor**,
  ou com um grupo da empresa.
- Cada usuário precisa estar **logado no Chrome com a conta Google da empresa**.
- A **planilha continua restrita** e não precisa ser compartilhada.
- Recomendado: o script que gera o JSON **atualiza o mesmo arquivo** (em vez de apagar e criar outro)
  e não deixa dois arquivos `Payload_Tracking` na pasta.

## Retorno para a base (pedidos "Não encontrado")

Os pedidos que aparecem como **Não encontrado** são informados à base automaticamente:

1. Ao consultar a tela, a extensão coloca na **fila** os pedidos "Não encontrado" ainda não informados.
2. **A cada 10 minutos** (`RETORNO_INTERVALO_MINUTOS`) a fila é enviada ao App da Web
   [`apps-script/retorno-extensao`](../apps-script/retorno-extensao/), que grava o JSON
   **`Retorno_Extensao`** na pasta do Drive. O botão **↻ Atualizar dados** também envia a fila na hora.
3. **Cada pedido é enviado uma vez.** Ele só é reenviado se a situação mudar ou depois de
   7 dias (`RETORNO_REENVIO_DIAS`), evitando atualizações repetidas quando vários usuários veem
   os mesmos pedidos.
4. Se um pedido informado como "Não encontrado" depois **aparecer na base**, a extensão envia a
   atualização `"situacao": "Encontrado"`.
5. Se o envio falhar, os pedidos **continuam na fila** e são tentados no próximo ciclo.

Cada pedido enviado: `{ "pedido": "2610300TGNX7GR", "situacao": "Não encontrado" }`.
No pop-up de um pedido "Não encontrado" aparece **"📤 Na fila para informar à base"** ou
**"📤 Informado à base em dd/mm, hh:mm"** (e o erro do último envio, se houver).

> A extensão só conhece os pedidos das páginas que os usuários abrem na Shopee.

## Quando o arquivo é baixado

- O arquivo é baixado **uma vez** e reaproveitado por **5 minutos** (`CACHE_MINUTOS`).
  Recarregar a tela, trocar de aba ou de página dentro desse tempo **não** baixa de novo.
- Depois de 5 minutos, a próxima vez que a tela precisar dos dados ela baixa de novo.
- O botão **↻ Atualizar dados** (no pop-up) baixa na hora.
- A cópia fica só na memória do Chrome e é apagada quando o navegador é fechado.

## Instalação ("Carregar sem compactação")

1. Baixe/clone o repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta **`shopee-tracking`**.
4. Abra (ou recarregue) a tela de Retornos e Pedidos cancelados da Shopee.

## Configuração

No início do `background.js`:

| Opção | Padrão | Descrição |
|---|---|---|
| `PASTA_ID` | `1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe` | Pasta do Drive onde está o arquivo |
| `NOME_ARQUIVO` | `Payload_Tracking` | Nome do arquivo na pasta |
| `ARQUIVO_ID` | `1OBbG1ufaCTdb5lSvcuViTQ1UJUvMdobX` | ID do arquivo (do link `.../file/d/<ID>/...`). Usado primeiro; se falhar, a extensão procura pelo nome na pasta |
| `CACHE_MINUTOS` | `5` | Tempo que o arquivo baixado é reaproveitado |
| `CONTAS_GOOGLE` | `[0, 1, 2, 3]` | Contas logadas no Chrome que são tentadas |
| `RETORNO_URL` | URL `/exec` do App da Web | Para onde os "Não encontrado" são enviados |
| `RETORNO_INTERVALO_MINUTOS` | `10` | Intervalo de envio da fila |
| `RETORNO_REENVIO_DIAS` | `7` | Prazo para reenviar um pedido já informado |
| `RETORNO_LOTE` | `400` | Pedidos por requisição |

No início do `content.js`: `CAMINHO_TELA` (tela onde a extensão age) e os seletores dos blocos.

## Problemas

- Balão vermelho: clique nele e abra **Detalhes técnicos** no pop-up: aparece cada endereço
  tentado e o que o Google respondeu (ex.: página de login = conta sem acesso). O motivo também
  aparece passando o mouse. Normalmente é o Chrome sem
  login na conta da empresa, ou a pasta/arquivo não compartilhado com essa conta.
- Teste rápido de acesso: com a mesma conta, abra a pasta no Drive pelo link
  `https://drive.google.com/drive/folders/<PASTA_ID>`.
- Console da página (F12 → Console): mensagens iniciadas por `[Tracking Shopee]`.
- Detalhes da leitura do arquivo: `chrome://extensions` → na extensão, clique em
  **service worker** para abrir o console dela.
