/*
 * Shopee - Status Tracking da Planilha (página)
 *
 * Na tela "Retornos e Pedidos cancelados" do Seller Center, lê o "ID do Pedido"
 * de cada bloco e mostra ao lado dele um balão com o "Status tracking" da
 * planilha (linha cuja coluna Pedido_Parceiro tem o mesmo ID), ou
 * "Não encontrado". Clicar em qualquer balão baixa a planilha de novo.
 */
(() => {
  'use strict';

  if (window.__kbmShopeeTracking) return;
  window.__kbmShopeeTracking = true;

  const CONFIG = {
    // A extensão só age nesta tela (o Seller Center troca de tela sem recarregar).
    CAMINHO_TELA: '/portal/sale/returnrefundcancel',
    SELETOR_BLOCO: '.return-row-item',
    SELETOR_ID_PEDIDO: '.order-id .id-content',
    SELETOR_CABECALHO_BLOCO: '.return-row-item-head',
  };

  const CLASSE_BALAO = 'kbm-tracking-balao';
  const resultados = new Map(); // ID do pedido -> { encontrado, status } | { erro }
  let atualizadoEm = null;
  let versao = 0; // muda sempre que os resultados mudam (força redesenhar os balões)
  let consultando = false;
  let pendenteForcar = false;

  const naTela = () => location.pathname.startsWith(CONFIG.CAMINHO_TELA);
  const horario = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // ---------------------------------------------------------------------------
  // Balão
  // ---------------------------------------------------------------------------
  const ESTILO = `
    :host { all: initial; display: inline-flex; align-items: center; margin-left: 16px; vertical-align: middle; }
    .balao {
      display: inline-flex; align-items: center; gap: 6px; max-width: 380px;
      font: 600 12px/1.3 Roboto, "Helvetica Neue", Arial, sans-serif;
      padding: 4px 10px; border-radius: 999px; border: 1px solid; cursor: pointer;
      white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,.08);
    }
    .balao .rotulo { font-weight: 400; opacity: .8; }
    .balao .texto { overflow: hidden; text-overflow: ellipsis; }
    .status   { color: #1e40af; background: #eff6ff; border-color: #93c5fd; }
    .vazio    { color: #92400e; background: #fffbeb; border-color: #fcd34d; }
    .nao      { color: #4b5563; background: #f3f4f6; border-color: #d1d5db; }
    .carregando { color: #6b7280; background: #fff; border-color: #e5e7eb; font-weight: 400; }
    .erro     { color: #991b1b; background: #fef2f2; border-color: #fca5a5; }
  `;

  function criarBalao() {
    const host = document.createElement('span');
    host.className = CLASSE_BALAO;
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `<style>${ESTILO}</style><span class="balao"></span>`;
    // O bloco inteiro é um link: o clique no balão não pode abrir o pedido.
    for (const ev of ['click', 'mousedown', 'mouseup', 'auxclick']) {
      host.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (ev === 'click') atualizar(true);
      });
    }
    return host;
  }

  function pintar(host, id) {
    const r = resultados.get(id);
    const balao = host.shadowRoot.querySelector('.balao');
    const dica = atualizadoEm ? `Planilha lida às ${horario(atualizadoEm)} — clique para atualizar` : '';
    let classe, html, titulo;

    if (!r) {
      classe = 'carregando';
      html = '<span class="texto">⏳ Consultando planilha…</span>';
      titulo = 'Consultando a planilha';
    } else if (r.erro) {
      classe = 'erro';
      html = '<span class="texto">⚠ Erro ao ler a planilha</span>';
      titulo = `${r.erro}\n\nClique para tentar de novo.`;
    } else if (!r.encontrado) {
      classe = 'nao';
      html = '<span class="texto">Não encontrado</span>';
      titulo = `Pedido ${id} não encontrado na coluna Pedido_Parceiro.\n${dica}`;
    } else if (!r.status) {
      classe = 'vazio';
      html = '<span class="texto">Encontrado, sem Status tracking</span>';
      titulo = `Pedido ${id} está na planilha, mas a coluna Status tracking está vazia.\n${dica}`;
    } else {
      classe = 'status';
      html = `<span class="rotulo">Tracking:</span><span class="texto"></span>`;
      titulo = `Status tracking: ${r.status}\n${dica}`;
    }

    balao.className = `balao ${classe}`;
    balao.innerHTML = html;
    if (classe === 'status') balao.querySelector('.texto').textContent = r.status;
    balao.title = titulo;
  }

  // ---------------------------------------------------------------------------
  // Leitura dos blocos e aplicação dos balões
  // ---------------------------------------------------------------------------
  function blocosDaTela() {
    const itens = [];
    for (const bloco of document.querySelectorAll(CONFIG.SELETOR_BLOCO)) {
      const elId = bloco.querySelector(CONFIG.SELETOR_ID_PEDIDO);
      const id = elId && elId.textContent.trim();
      if (id) itens.push({ bloco, elId, id });
    }
    return itens;
  }

  function aplicarBaloes() {
    for (const { bloco, elId, id } of blocosDaTela()) {
      let host = bloco.querySelector(`.${CLASSE_BALAO}`);
      if (!host) {
        host = criarBalao();
        const alvo = elId.closest('.order-id') || elId;
        const cabecalho = bloco.querySelector(CONFIG.SELETOR_CABECALHO_BLOCO);
        // Ao lado do "ID do Pedido" (ou no fim do cabeçalho do bloco).
        if (alvo.parentElement) alvo.after(host);
        else if (cabecalho) cabecalho.appendChild(host);
        else bloco.prepend(host);
      }
      // A tela pode reaproveitar o mesmo bloco para outro pedido (troca de página/aba).
      if (host.dataset.pedido !== id || host.dataset.versao !== String(versao)) {
        host.dataset.pedido = id;
        host.dataset.versao = String(versao);
        pintar(host, id);
      }
    }
  }

  function removerBaloes() {
    document.querySelectorAll(`.${CLASSE_BALAO}`).forEach((el) => el.remove());
  }

  // ---------------------------------------------------------------------------
  // Consulta à planilha (feita pelo service worker)
  // ---------------------------------------------------------------------------
  function pedirAoServiceWorker(ids, forcar) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ tipo: 'consultarPedidos', ids, forcar }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, erro: 'Extensão recarregada: atualize a página (F5).' });
          } else {
            resolve(resp || { ok: false, erro: 'Sem resposta da extensão.' });
          }
        });
      } catch (e) {
        resolve({ ok: false, erro: 'Extensão recarregada: atualize a página (F5).' });
      }
    });
  }

  async function atualizar(forcar = false) {
    if (!naTela()) return;
    if (consultando) {
      pendenteForcar = pendenteForcar || forcar;
      return;
    }

    if (forcar) {
      resultados.clear();
      atualizadoEm = null;
      versao++;
    }
    const ids = [...new Set(blocosDaTela().map((b) => b.id))].filter((id) => !resultados.has(id));
    aplicarBaloes();
    if (!ids.length) return;

    consultando = true;
    try {
      const resp = await pedirAoServiceWorker(ids, forcar);
      if (resp.ok) {
        // Se a planilha foi baixada de novo, os resultados antigos ficam desatualizados.
        if (atualizadoEm && resp.atualizadoEm !== atualizadoEm) resultados.clear();
        atualizadoEm = resp.atualizadoEm;
        for (const [id, r] of Object.entries(resp.resultados)) resultados.set(id, r);
      } else {
        for (const id of ids) resultados.set(id, { erro: resp.erro });
        console.warn('[Tracking Shopee]', resp.erro);
      }
    } finally {
      consultando = false;
      versao++;
    }
    aplicarBaloes();

    // Pedidos que surgiram durante a consulta, ou clique em "atualizar" no meio dela.
    const faltando = blocosDaTela().some((b) => !resultados.has(b.id));
    if (pendenteForcar || faltando) {
      const f = pendenteForcar;
      pendenteForcar = false;
      atualizar(f);
    }
  }

  // ---------------------------------------------------------------------------
  // Observa a tela (lista carregada depois, troca de aba/página, navegação interna)
  // ---------------------------------------------------------------------------
  let timer = null;
  let estavaNaTela = false;

  function verificar() {
    if (!naTela()) {
      if (estavaNaTela) removerBaloes();
      estavaNaTela = false;
      return;
    }
    estavaNaTela = true;
    atualizar(false);
  }

  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(verificar, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setInterval(verificar, 2000);
  verificar();
})();
