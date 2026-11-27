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

## Verificar todas as páginas

Logo abaixo das abas aparece a barra **🔎 Verificar todas as páginas**. Ao clicar, na **aba que
estiver aberta** (ex.: Todos):

1. A extensão vai para a **página 1** e percorre **todas as páginas** da paginação
   (1, 2, 3 … 34), clicando em "próxima página". **Não troca de aba.**
2. Cada pedido é consultado no `Payload_Tracking`; os **Não encontrado** entram na fila.
3. No fim, volta para a página 1 e **envia a fila para a base na hora**.
   A verificação completa envia **todos** os "Não encontrado" que encontrar, mesmo os já enviados
   antes — use-a para refazer a base (ex.: depois de apagar o `Retorno_Extensao_Shopee`).

- A barra mostra o progresso (página X de Y, pedidos lidos, não encontrados) e o resultado da
  última verificação completa.
- O botão vira **⏹ Parar verificação** durante a varredura; o que já foi lido continua na fila.
- Há uma pausa de 0,8 s entre páginas (`PAUSA_ENTRE_PAGINAS_MS`) para não sobrecarregar a Shopee
  (34 páginas levam cerca de 2 a 3 minutos, conforme a velocidade da Shopee).
- Não mexa na tela da Shopee enquanto a verificação roda (ela clica na paginação).

## Retorno para a base (pedidos "Não encontrado")

Os pedidos que aparecem como **Não encontrado** são informados à base automaticamente:

1. Ao consultar a tela, a extensão coloca na **fila** os pedidos "Não encontrado" ainda não informados.
2. **A cada 10 minutos** (`RETORNO_INTERVALO_MINUTOS`) a fila é enviada ao App da Web
   [`apps-script/retorno-extensao`](../apps-script/retorno-extensao/), que grava o JSON
   **`Retorno_Extensao_Shopee`** na pasta do Drive. O botão **↻ Atualizar dados** também envia a fila na hora.
3. **Cada pedido é enviado uma vez.** Ele só é reenviado se a situação mudar ou depois de
   7 dias (`RETORNO_REENVIO_DIAS`), evitando atualizações repetidas quando vários usuários veem
   os mesmos pedidos.
4. Se um pedido informado como "Não encontrado" depois **aparecer na base**, a extensão envia
   `"situacao": "Encontrado"` e o App da Web **remove** o pedido do arquivo (o arquivo guarda só
   os "Não encontrado").
5. Se o envio falhar, os pedidos **continuam na fila** e são tentados no próximo ciclo.

Cada pedido enviado:

```json
{
  "pedido": "2610300TGNX7GR",
  "situacao": "Não encontrado",
  "statusSolicitacao": "Em análise pela Shopee",
  "prazo": "Vence em 6 horas",
  "venceAprox": "2026-11-25T21:30:00-03:00",
  "contestacao": "Prazo final",
  "link": "https://seller.shopee.com.br/portal/sale/return/248397368137061"
}
```

| Campo | Origem na tela da Shopee |
|---|---|
| `statusSolicitacao` | Coluna **Status da solicitação** (só a 1ª linha, sem o texto de ajuda). Sempre enviado |
| `prazo` | Coluna **Ações**, apenas o texto **"Vence em …"** (ex.: "Vence em 6 horas", "Vence em 1 dias"). Vazio quando não há |
| `venceAprox` | Data/hora aproximada do vencimento, calculada no momento da leitura (`prazo` é relativo e fica desatualizado). Vazio quando não há prazo |
| `contestacao` | Coluna **Ações**: **"Prazo final"** quando há "Enviar evidência"; **"Prazo inicial"** quando há "Não foi possível coletar / Tive um problema com o produto coletado"; vazio nos demais casos |
| `link` | Link do pedido na Shopee (o mesmo do bloco do pedido / número do pedido): página da solicitação |

Um pedido só é reenviado quando muda a situação, o Status da solicitação, a contestação, o link, quando o prazo
aparece/some ou muda de unidade (dias → horas). "Vence em 6 horas" → "5 horas" **não** gera reenvio.
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

No início do `content.js`: `CAMINHO_TELA` (tela onde a extensão age), os seletores dos blocos e da
paginação, e a varredura:

| Opção | Padrão | Descrição |
|---|---|---|
| `PAUSA_ENTRE_PAGINAS_MS` | `800` | Pausa entre uma página e outra |
| `ESPERA_CARREGAR_MS` | `15000` | Tempo máximo esperando uma página carregar |
| `MAX_PAGINAS` | `500` | Limite de segurança de páginas |

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
