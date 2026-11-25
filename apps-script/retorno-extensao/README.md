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
