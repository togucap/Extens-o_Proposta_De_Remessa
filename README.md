# Proposta de Remessa – Verificador de Triagem RMA

Extensão do Google Chrome que roda na tela **Gerar Proposta de Remessa**
(`.../rma/transferencia/proposta_remessa/gerar_proposta_remessa.cgi`).

## O que ela faz

1. Monitora o campo **Etiquetas** (`#form-mercadoria-busca`).
2. Cada etiqueta bipada vai para uma fila e é consultada **uma por vez**, em segundo plano,
   na tela **Estoque de Mercadoria** (`.../recebimento/estoque/estoque_mercadoria.cgi`).
3. Lê a tabela de rastreamento (`#rastreamento`) **de baixo para cima** e pega a ocorrência
   mais recente de **"RMA - Registrado Triagem"** com a data da coluna à esquerda.
4. Compara a data com hoje e mostra um **balão no centro da tela**:

| Cor | Resultado |
|---|---|
| 🟢 Verde | Triagem registrada há **menos de 5 dias** |
| 🟠 Laranja | Triagem registrada há **5 dias ou mais** |
| 🔴 Vermelho | Sem a interação "RMA - Registrado Triagem", ou etiqueta sem rastreamento |
| ⚪ Cinza | Erro na consulta (ex.: sessão expirada) |

No canto inferior direito fica um histórico das últimas etiquetas verificadas.

## Instalação ("Carregar sem compactação")

1. Baixe/clone este repositório para uma pasta do computador.
2. No Chrome, abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e selecione a pasta do repositório (a que contém `manifest.json`).
5. Abra (ou recarregue) a tela de Gerar Proposta de Remessa. A extensão ativa sozinha.

Depois de alterar algum arquivo, clique no botão ↻ da extensão em `chrome://extensions` e recarregue a tela.

## Como a consulta é feita

- **Consulta direta (padrão):** a extensão abre a tela de estoque em segundo plano, identifica o
  formulário e o campo de etiqueta automaticamente e envia a etiqueta usando a sessão já logada.
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
| `DIAS_LIMITE` | `5` | Limite de dias da verificação |
| `ESPERA_FIM_LEITURA_MS` | `700` | Espera para leitores sem ENTER |
| `TEMPO_BALAO_MS` | `6000` | Tempo do balão na tela (`0` = só fecha no ×) |
| `TIMEOUT_CONSULTA_MS` | `20000` | Tempo máximo de cada consulta |

## Problemas

Abra o console da página (F12 → Console) e procure mensagens iniciadas por `[Triagem RMA]`.
