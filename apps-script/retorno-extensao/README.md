# App intermediário – Retorno da Extensão → Drive (JSON)

Apps Script **separado da planilha** (não altera os scripts que já existem nela), publicado como
**App da Web**. A extensão do Chrome envia os dados da tela da Shopee para ele, e ele grava/atualiza
o arquivo **`Retorno_Extensao_Shopee`** (JSON) numa pasta do Google Drive. A planilha base lê esse arquivo.

```
Extensão (Shopee) ──POST JSON──► App da Web (executa como o dono) ──► Retorno_Extensao_Shopee (JSON no Drive)
                                                                            │
                                                          Planilha base ◄───┘ (lê o arquivo)
```

- Roda com as **permissões do dono do script**: os usuários da extensão **não** precisam de acesso
  de edição à pasta nem à planilha.
- Só contas do **domínio da empresa** conseguem enviar.
- Registra **quem enviou** (`enviadoPor`) e quando (`primeiroEnvio` / `ultimoEnvio`).
- Um registro por pedido: reenviar o mesmo pedido **atualiza** o registro, não duplica.
- Envios simultâneos não se sobrescrevem (trava `LockService`).

## Formato

**Envio (extensão → app):**

```json
{
  "versao": 1,
  "origem": "shopee-retornos",
  "pedidos": [
    { "pedido": "261103BKH9YCYG" },
    { "pedido": "261024EJNF43RG" }
  ]
}
```

A extensão `shopee-tracking` envia, para cada pedido "Não encontrado" (ou `"Encontrado"` quando um
pedido informado passa a existir na base):

```json
{ "pedido": "...", "situacao": "Não encontrado", "statusSolicitacao": "Em análise pela Shopee",
  "prazo": "Vence em 6 horas", "venceAprox": "2026-11-25T21:30:00-03:00" }
```

Campos vazios (`""`) também são gravados, para limpar um valor antigo (ex.: o prazo sumiu). Campos novos podem ser incluídos depois em cada pedido
(ex.: `"motivo": "Mudei de ideia"`) **sem mudar o script**: ele aceita até 30 campos simples
(texto, número, sim/não) por pedido.

**Arquivo gerado no Drive (`Retorno_Extensao_Shopee`):**

```json
{
  "versao": 1,
  "atualizadoEm": "2026-11-24T10:15:00-03:00",
  "totalPedidos": 2,
  "pedidos": {
    "261103BKH9YCYG": {
      "pedido": "261103BKH9YCYG",
      "primeiroEnvio": "2026-11-24T10:15:00-03:00",
      "origem": "shopee-retornos",
      "ultimoEnvio": "2026-11-24T10:15:00-03:00",
      "enviadoPor": "usuario@empresa.com.br"
    }
  }
}
```

Mesma estrutura do `Payload_Tracking` (pedidos indexados pelo ID).

**Resposta do app para a extensão:**

```json
{ "ok": true, "recebidos": 2, "novos": 1, "atualizados": 1, "ignorados": 0, "totalPedidos": 3 }
```

Em caso de erro: `{ "ok": false, "erro": "mensagem" }`.

## Aba "Retorno_Extensão" na planilha base

O arquivo [`AbaRetorno.gs`](AbaRetorno.gs) abastece a aba **`Retorno_Extensão`** da planilha base
com os pedidos do JSON:

| pedido | situacao | prazo | origem |
|---|---|---|---|
| 261025GYNGW6WE | Não encontrado | Vence em 1 dias | shopee-retornos |

- **Automático:** a cada envio da extensão, depois de gravar o JSON, o app reescreve a aba com os
  mesmos dados (`CONFIG_ABA.ATUALIZAR_NO_ENVIO`). A aba fica sempre igual ao JSON.
- **Manual:** no editor, rode **`sincronizarAbaRetorno`** — lê o JSON do Drive e reescreve a aba
  (use depois de editar/limpar o JSON à mão).
- Escreve só as colunas **A:D** (cabeçalho na linha 1). Outras colunas da aba não são tocadas.
- A coluna `pedido` é gravada como **texto** (evita IDs virarem número).
- A planilha base é aberta pelo ID (`CONFIG_ABA.PLANILHA_ID`); os scripts que já existem nela
  **não são alterados**.
- Se a aba não existir, o envio da extensão continua funcionando (o JSON é gravado) e a resposta
  traz `"aba": { "atualizada": false, "erro": "…" }`.

### Como ativar (projeto já publicado)

1. No projeto do App da Web (script.google.com), clique em **+ → Script** e crie o arquivo
   **`AbaRetorno`**. Cole o conteúdo de [`AbaRetorno.gs`](AbaRetorno.gs) e salve.
2. Abra `appsscript.json` e substitua pelo [`appsscript.json`](appsscript.json) desta pasta
   (inclui a permissão de planilhas).
3. Selecione a função **`sincronizarAbaRetorno`** → **Executar**. O Google pede a nova autorização
   (planilhas) → **Permitir**. A aba é preenchida com o que já está no JSON.
4. **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar** (a URL não muda).

## Passo a passo para publicar

1. Acesse **https://script.google.com** com a conta dona da pasta → **Novo projeto**.
   Renomeie para, por exemplo, **"Retorno Extensão Shopee"**.
2. **Manifesto:** ⚙️ **Configurações do projeto** → marque **"Mostrar arquivo de manifesto
   'appsscript.json' no editor"**. Volte ao **Editor**, abra `appsscript.json` e substitua o conteúdo
   pelo arquivo [`appsscript.json`](appsscript.json) desta pasta.
3. **Código:** abra `Código.gs`, apague o conteúdo e cole o arquivo [`Code.gs`](Code.gs).
4. Em `CONFIG.PASTA_ID`, troque `COLE_AQUI_O_ID_DA_PASTA` pelo **ID da pasta do Drive**
   (o final do link `https://drive.google.com/drive/folders/<ID>`). Salve (Ctrl+S).
5. **Autorizar e testar:** no topo, selecione a função **`testarGravacao`** → **Executar**.
   O Google pede autorização (acesso ao Drive e ao seu e-mail) → **Permitir**.
   Confira na pasta do Drive que o arquivo **`Retorno_Extensao_Shopee`** foi criado com o pedido `TESTE123456`.
6. **Publicar:** **Implantar** → **Nova implantação** → ⚙️ tipo **App da Web**:
   - **Descrição:** `v1`
   - **Executar como:** **Eu**
   - **Quem pode acessar:** **Qualquer pessoa em <sua empresa>**
   → **Implantar** → copie a **URL do app da Web** (termina em `/exec`).
7. **Teste de acesso:** abra a URL `/exec` no Chrome. Deve aparecer algo como
   `{"ok":true,"servico":"retorno-extensao",...,"usuario":"seu.email@empresa.com.br"}`.
8. Envie a URL `/exec` para configurar na extensão.

### Ao alterar o código depois

Use **Implantar → Gerenciar implantações → ✏️ editar → Versão: Nova versão → Implantar**.
Assim a **URL continua a mesma**. ("Nova implantação" gera uma URL diferente.)

## Observações

- O arquivo `TESTE123456` criado no passo 5 pode ser apagado do JSON depois (ou o arquivo inteiro,
  ele é recriado no próximo envio).
- Se o arquivo JSON estiver corrompido, o script guarda uma cópia (`Retorno_Extensao_Shopee_corrompido_…`)
  e começa um novo.
- Limites por envio: 500 pedidos, 30 campos por pedido, 500 caracteres por valor.
- Logs de execução: no editor do Apps Script, menu **Execuções**.
