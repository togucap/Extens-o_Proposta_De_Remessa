# Extensões do Chrome

Cada pasta é uma extensão independente, carregada no Chrome por **Carregar sem compactação**
(`chrome://extensions` → ativar **Modo do desenvolvedor** → **Carregar sem compactação** → escolher a pasta).

| Pasta | Extensão | Onde funciona |
|---|---|---|
| [`proposta-remessa/`](proposta-remessa/) | Verificador de Triagem RMA e conferência da proposta de remessa | `manager.kabum.com.br` – Gerar Proposta de Remessa |
| [`shopee-tracking/`](shopee-tracking/) | Status tracking (arquivo Payload_Tracking no Drive) em cada pedido | `seller.shopee.com.br` – Retornos e Pedidos cancelados |

> Ao carregar, selecione a **pasta da extensão** (a que contém o `manifest.json`), não a raiz do repositório.

## Apps Script (Google)

Projetos de Apps Script **separados** (não mexem nos scripts que já existem na planilha), para colar
em https://script.google.com.

| Pasta | O que faz |
|---|---|
| [`apps-script/retorno-extensao/`](apps-script/retorno-extensao/) | App da Web que recebe os dados enviados pela extensão, grava o JSON `Retorno_Extensao_Shopee` na pasta do Drive e abastece a aba `Retorno_Extensão` da planilha base |
