/*
 * Shopee - Status Tracking (página)
 *
 * Na tela "Retornos e Pedidos cancelados" do Seller Center, lê o "ID do Pedido"
 * de cada bloco e mostra ao lado dele um balão com o "Status tracking" da
 * arquivo Payload_Tracking (gerado a partir da planilha e salvo no Drive), ou
 * "Não encontrado". Clicar no balão abre um pop-up com os detalhes do pedido
 * (datas, cidade, método de retorno Correios/JadLog e assistência técnica).
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

    // Varredura das páginas da aba atual (botão "Verificar todas as páginas").
    SELETOR_PROXIMA_PAGINA: '.eds-pager__button-next',
    SELETOR_PAGINA_ATIVA: '.eds-pager__page.active',
    SELETOR_PAGINAS: '.eds-pager__page',
    PAUSA_ENTRE_PAGINAS_MS: 800, // intervalo entre cliques, para não sobrecarregar a Shopee
    ESPERA_CARREGAR_MS: 15000, // tempo máximo esperando uma página carregar
    MAX_PAGINAS: 500, // limite de segurança
  };

  const CLASSE_BALAO = 'kbm-tracking-balao';
  const resultados = new Map(); // ID do pedido -> { encontrado, status, ...detalhes } | { erro }
  let atualizadoEm = null;
  let versao = 0; // muda sempre que os resultados mudam (força redesenhar os balões)
  let consultando = false;
  let pendenteForcar = false;
  let geradoEm = null;

  /** "2026-11-19T13:43:02-03:00" -> "19/11 às 13:43" (horário como está escrito no arquivo). */
  const dataGeracao = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : String(iso || '');
  };

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
        if (ev === 'click') popup.alternar(host);
      });
    }
    return host;
  }

  function pintar(host, id) {
    const r = resultados.get(id);
    const balao = host.shadowRoot.querySelector('.balao');
    const dica = 'Clique para ver os detalhes';
    let classe, html, titulo;

    if (!r) {
      classe = 'carregando';
      html = '<span class="texto">⏳ Consultando tracking…</span>';
      titulo = 'Consultando o arquivo de tracking';
    } else if (r.erro) {
      classe = 'erro';
      html = '<span class="texto">⚠ Erro ao ler o tracking</span>';
      titulo = `${r.erro}\n\nClique para ver os detalhes e tentar de novo.`;
    } else if (!r.encontrado) {
      classe = 'nao';
      html = '<span class="texto">Não encontrado</span>';
      titulo = `Pedido ${id} não encontrado no arquivo de tracking.\n${dica}`;
    } else if (!r.status) {
      classe = 'vazio';
      html = '<span class="texto">Encontrado, sem Status tracking</span>';
      titulo = `Pedido ${id} está no arquivo de tracking, mas sem status.\n${dica}`;
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
  // Pop-up de detalhes (abre ao clicar no balão)
  // ---------------------------------------------------------------------------
  /** JadLog quando a "Autorização Postagem" começa com 13; os demais casos são Correios. */
  const metodoRetorno = (autorizacao) =>
    /^13/.test(String(autorizacao || '').replace(/\s/g, '')) ? 'JadLog' : 'Correios';

  /** Há assistência quando a coluna tem algum conteúdo (vazio, "-", "#N/A", "0", "Não" = sem assistência). */
  const temAssistencia = (valor) => {
    const v = String(valor || '').trim().toLowerCase();
    return !!v && !['-', '—', '0', '#n/a', 'n/a', 'na', 'não', 'nao', 'false', 'falso'].includes(v);
  };

  const popup = (() => {
    const host = document.createElement('div');
    host.id = 'kbm-tracking-popup';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: none;';
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: Roboto, "Helvetica Neue", Arial, sans-serif; }
        .caixa {
          width: 340px; background: #fff; color: #1f2937; font-size: 13px; line-height: 1.4;
          border: 1px solid #d1d5db; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.22);
          overflow: hidden;
        }
        .topo {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 10px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;
        }
        .topo .pedido { font-weight: 700; font-size: 14px; }
        .topo .pedido small { display: block; font-weight: 400; font-size: 11px; color: #6b7280; }
        .fechar { border: 0; background: none; font-size: 20px; line-height: 1; color: #6b7280; cursor: pointer; padding: 0 2px; }
        .fechar:hover { color: #111827; }
        .corpo { padding: 10px 12px; }
        .status { font-weight: 700; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe;
          border-radius: 8px; padding: 6px 10px; margin-bottom: 10px; }
        .status small { display: block; font-weight: 400; color: #6b7280; font-size: 11px; }
        dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
        dt { color: #6b7280; white-space: nowrap; }
        dd { margin: 0; font-weight: 600; word-break: break-word; }
        .selo { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid; }
        .jadlog   { color: #9a3412; background: #fff7ed; border-color: #fdba74; }
        .correios { color: #854d0e; background: #fefce8; border-color: #fde047; }
        .sim { color: #166534; background: #f0fdf4; border-color: #86efac; }
        .nao { color: #4b5563; background: #f3f4f6; border-color: #d1d5db; }
        .sub { display: block; font-weight: 400; color: #6b7280; font-size: 12px; margin-top: 2px; }
        .vazio { color: #9ca3af; font-weight: 400; }
        .aviso { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
          padding: 6px 10px; margin-top: 10px; font-size: 12px; }
        .erro { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
        .retorno { margin-top: 8px; font-size: 12px; color: #374151; }
        .retorno:empty { display: none; }
        .retorno .falha { display: block; margin-top: 4px; color: #991b1b; }
        .tecnico { margin-top: 8px; font-size: 11px; color: #4b5563; }
        .tecnico summary { cursor: pointer; }
        .tecnico pre {
          margin: 6px 0 0; padding: 6px; max-height: 160px; overflow: auto; background: #f3f4f6;
          border-radius: 6px; white-space: pre-wrap; word-break: break-all; font: 10px/1.4 Consolas, monospace;
          user-select: text;
        }
        .rodape {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 12px; border-top: 1px solid #e5e7eb; background: #f9fafb; font-size: 11px; color: #6b7280;
        }
        .atualizar {
          border: 1px solid #d1d5db; background: #fff; color: #1f2937; border-radius: 6px;
          padding: 4px 10px; font-size: 12px; cursor: pointer;
        }
        .atualizar:hover { background: #f3f4f6; }
        .atualizar:disabled { opacity: .6; cursor: default; }
      </style>
      <div class="caixa" role="dialog" aria-label="Detalhes do pedido"></div>
    `;
    const caixa = raiz.querySelector('.caixa');
    let ancora = null; // balão que abriu o pop-up

    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const valor = (v) => (v === null ? '<span class="vazio">coluna não encontrada</span>'
      : v ? esc(v) : '<span class="vazio">—</span>');

    function conteudo(id) {
      const r = resultados.get(id);
      let corpo;
      if (!r) {
        corpo = '<div class="status">⏳ Consultando tracking…</div>';
      } else if (r.erro) {
        corpo = `<div class="aviso erro">⚠ ${esc(r.erro)}</div>` +
          (r.detalhes && r.detalhes.length
            ? `<details class="tecnico"><summary>Detalhes técnicos</summary><pre>${esc(r.detalhes.join('\n'))}</pre></details>`
            : '');
      } else if (!r.encontrado) {
        corpo = '<div class="aviso">Pedido não encontrado no arquivo de tracking.</div>' +
          `<div class="retorno">${textoRetorno(r.retorno)}</div>`;
      } else {
        const metodo = metodoRetorno(r.autorizacao);
        const assist = temAssistencia(r.assistencia);
        corpo = `
          <div class="status"><small>Status tracking</small>${r.status ? esc(r.status) : '<span class="vazio">sem status</span>'}</div>
          <dl>
            <dt>Data Ocorrência</dt><dd>${valor(r.dataOcorrencia)}</dd>
            <dt>Cidade última interação</dt><dd>${valor(r.cidade)}</dd>
            <dt>Data Prevista Entrega</dt><dd>${valor(r.dataPrevista)}</dd>
            <dt>Método de retorno</dt>
            <dd><span class="selo ${metodo === 'JadLog' ? 'jadlog' : 'correios'}">${metodo}</span>
              <span class="sub">Autorização: ${r.autorizacao ? esc(r.autorizacao) : '—'}</span></dd>
            <dt>Assistência</dt>
            <dd><span class="selo ${assist ? 'sim' : 'nao'}">Assistência: ${assist ? 'Sim' : 'Não'}</span>
              ${assist && !/^sim$/i.test(r.assistencia) ? `<span class="sub">${esc(r.assistencia)}</span>` : ''}</dd>
          </dl>
`;
      }
      const lida = geradoEm ? `Dados gerados em ${esc(dataGeracao(geradoEm))}`
        : atualizadoEm ? `Dados lidos às ${horario(atualizadoEm)}` : '';
      return `
        <div class="topo">
          <div class="pedido"><small>ID do Pedido</small>${esc(id)}</div>
          <button class="fechar" title="Fechar">×</button>
        </div>
        <div class="corpo">${corpo}</div>
        <div class="rodape">
          <span>${lida}</span>
          <button class="atualizar" ${consultando ? 'disabled' : ''}>${consultando ? 'Atualizando…' : '↻ Atualizar dados'}</button>
        </div>`;
    }

    function textoRetorno(ret) {
      if (!ret) return '';
      if (ret.estado === 'enviado') {
        const quando = new Date(ret.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `📤 Informado à base em ${esc(quando)}`;
      }
      return `📤 Na fila para informar à base (envio a cada ${ret.intervalo} min)` +
        (ret.erro ? `<span class="falha">⚠ Último envio falhou: ${esc(ret.erro)}</span>` : '');
    }

    /** Atualiza a linha de envio com a situação atual (pode ter sido enviado depois da consulta). */
    function atualizarRetorno(id) {
      try {
        chrome.runtime.sendMessage({ tipo: 'statusRetorno', id }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok || !ancora || ancora.dataset.pedido !== id) return;
          const el = caixa.querySelector('.retorno');
          const r = resultados.get(id);
          if (el && r) {
            r.retorno = resp.retorno;
            el.innerHTML = textoRetorno(resp.retorno);
          }
        });
      } catch (e) { /* extensão recarregada */ }
    }

    function posicionar() {
      if (!ancora || !ancora.isConnected) return fechar();
      const r = ancora.getBoundingClientRect();
      const larg = caixa.offsetWidth || 340;
      const alt = caixa.offsetHeight || 260;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - larg - 8);
      let top = r.bottom + 6;
      if (top + alt > window.innerHeight - 8) top = Math.max(8, r.top - alt - 6); // sem espaço embaixo: abre em cima
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    }

    function redesenhar() {
      if (!ancora) return;
      const id = ancora.dataset.pedido;
      caixa.innerHTML = conteudo(id);
      const r = resultados.get(id);
      if (r && r.encontrado === false) atualizarRetorno(id);
      caixa.querySelector('.fechar').addEventListener('click', fechar);
      caixa.querySelector('.atualizar').addEventListener('click', () => {
        atualizar(true);
        redesenhar();
      });
      posicionar();
    }

    function abrir(balao) {
      if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
      ancora = balao;
      host.style.display = 'block';
      redesenhar();
    }

    function fechar() {
      ancora = null;
      host.style.display = 'none';
    }

    // Fecha com Esc ou clicando fora (o clique no próprio balão é tratado por ele).
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ancora) fechar(); }, true);
    document.addEventListener('mousedown', (e) => {
      if (!ancora) return;
      const caminho = e.composedPath();
      if (!caminho.includes(host) && !caminho.some((el) => el.classList && el.classList.contains(CLASSE_BALAO))) fechar();
    }, true);
    window.addEventListener('scroll', () => ancora && posicionar(), true);
    window.addEventListener('resize', () => ancora && posicionar());

    return {
      alternar(balao) { if (ancora === balao) fechar(); else abrir(balao); },
      redesenhar,
      fechar,
    };
  })();

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
    popup.fechar();
    const barra = document.getElementById('kbm-tracking-varredura');
    if (barra) barra.remove();
    document.querySelectorAll(`.${CLASSE_BALAO}`).forEach((el) => el.remove());
  }

  // ---------------------------------------------------------------------------
  // Consulta ao arquivo de tracking (feita pelo service worker)
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
        // Se o arquivo foi baixado de novo, os resultados antigos ficam desatualizados.
        if (atualizadoEm && resp.atualizadoEm !== atualizadoEm) resultados.clear();
        atualizadoEm = resp.atualizadoEm;
        geradoEm = resp.geradoEm || null;
        for (const [id, r] of Object.entries(resp.resultados)) resultados.set(id, r);
      } else {
        for (const id of ids) resultados.set(id, { erro: resp.erro, detalhes: resp.detalhes || [] });
        console.warn('[Tracking Shopee]', resp.erro);
      }
    } finally {
      consultando = false;
      versao++;
    }
    aplicarBaloes();
    popup.redesenhar();

    // Pedidos que surgiram durante a consulta, ou clique em "atualizar" no meio dela.
    const faltando = blocosDaTela().some((b) => !resultados.has(b.id));
    if (pendenteForcar || faltando) {
      const f = pendenteForcar;
      pendenteForcar = false;
      atualizar(f);
    }
  }


  // ---------------------------------------------------------------------------
  // Varredura: percorre todas as páginas (1, 2, 3, …) da aba atual
  // ---------------------------------------------------------------------------
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const assinaturaLista = () => blocosDaTela().map((b) => b.id).join(',');
  const paginaAtiva = () => {
    const el = document.querySelector(CONFIG.SELETOR_PAGINA_ATIVA);
    return el ? el.textContent.trim() : '';
  };
  const totalPaginas = () => Math.max(1, ...[...document.querySelectorAll(CONFIG.SELETOR_PAGINAS)]
    .map((li) => parseInt(li.textContent, 10)).filter((n) => !isNaN(n)));

  /** Espera a lista mudar (outra página) e terminar de carregar. */
  async function esperarLista(assinaturaAntes, paginaAntes) {
    const inicio = Date.now();
    let ultima = null;
    let estavelDesde = 0;
    while (Date.now() - inicio < CONFIG.ESPERA_CARREGAR_MS) {
      await dormir(250);
      const atual = assinaturaLista();
      const mudou = atual !== assinaturaAntes || paginaAtiva() !== paginaAntes;
      if (!mudou) continue;
      // Considera carregada quando fica igual por ~600 ms.
      if (atual !== ultima) { ultima = atual; estavelDesde = Date.now(); continue; }
      if (Date.now() - estavelDesde >= 600) return true;
    }
    return false;
  }

  /** Espera a extensão consultar todos os pedidos visíveis (isso coloca os "Não encontrado" na fila). */
  async function esperarConsulta() {
    const inicio = Date.now();
    while (Date.now() - inicio < CONFIG.ESPERA_CARREGAR_MS) {
      atualizar(false);
      const blocos = blocosDaTela();
      if (blocos.every((b) => resultados.has(b.id))) return blocos;
      await dormir(300);
    }
    return blocosDaTela();
  }

  const varredura = (() => {
    let rodando = false;
    let parar = false;
    let barra = null;

    function criarBarra() {
      const host = document.createElement('div');
      host.id = 'kbm-tracking-varredura';
      host.style.cssText = 'all: initial; display: block; margin: 8px 0;';
      const raiz = host.attachShadow({ mode: 'open' });
      raiz.innerHTML = `
        <style>
          :host { all: initial; display: block; }
          .barra {
            display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
            font: 13px/1.4 Roboto, "Helvetica Neue", Arial, sans-serif; color: #374151;
            background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 12px;
          }
          button {
            font: 600 13px Roboto, Arial, sans-serif; border-radius: 6px; padding: 6px 12px; cursor: pointer;
            border: 1px solid #ee4d2d; background: #ee4d2d; color: #fff;
          }
          button:hover { filter: brightness(.95); }
          button.parar { background: #fff; color: #b91c1c; border-color: #fca5a5; }
          .status { flex: 1; min-width: 200px; }
          .status b { color: #111827; }
          .erro { color: #b91c1c; }
        </style>
        <div class="barra">
          <button class="acao">🔎 Verificar todas as páginas</button>
          <span class="status"></span>
        </div>`;
      raiz.querySelector('.acao').addEventListener('click', () => (rodando ? (parar = true) : iniciar()));
      return host;
    }

    function garantirBarra() {
      if (!naTela()) return;
      if (barra && barra.isConnected) return;
      const ref = document.querySelector('.flow-tab-container') || document.querySelector('.return-table-content');
      if (!ref) return;
      barra = barra || criarBarra();
      ref.after(barra);
      if (!rodando) mostrarUltima();
    }

    function status(html, { erro = false } = {}) {
      if (!barra) return;
      const el = barra.shadowRoot.querySelector('.status');
      el.className = `status${erro ? ' erro' : ''}`;
      el.innerHTML = html;
    }

    function botao(textoRodando) {
      if (!barra) return;
      const b = barra.shadowRoot.querySelector('.acao');
      b.textContent = textoRodando ? '⏹ Parar verificação' : '🔎 Verificar todas as páginas';
      b.classList.toggle('parar', textoRodando);
    }

    async function mostrarUltima() {
      try {
        const { ultimaVarredura: u } = await chrome.storage.local.get('ultimaVarredura');
        if (!u || rodando) return;
        const quando = new Date(u.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        status(`Última verificação completa: <b>${quando}</b> — ${u.pedidos} pedidos, <b>${u.naoEncontrados}</b> não encontrados${u.interrompida ? ' (interrompida)' : ''}.`);
      } catch (e) { /* sem histórico */ }
    }

    async function irParaPrimeiraPagina() {
      if (paginaAtiva() === '1' || !document.querySelector(CONFIG.SELETOR_PAGINA_ATIVA)) return;
      const um = [...document.querySelectorAll(CONFIG.SELETOR_PAGINAS)].find((li) => li.textContent.trim() === '1');
      if (!um) return;
      const antes = assinaturaLista();
      const pagAntes = paginaAtiva();
      um.click();
      await esperarLista(antes, pagAntes);
    }

    function proximaDisponivel() {
      const b = document.querySelector(CONFIG.SELETOR_PROXIMA_PAGINA);
      return b && !b.disabled && !b.classList.contains('eds-button--disabled') ? b : null;
    }

    async function iniciar() {
      if (rodando || !naTela()) return;
      rodando = true;
      parar = false;
      botao(true);
      const vistos = new Set();
      const naoEncontrados = new Set();
      let paginas = 0;
      let interrompida = false;

      const contar = (blocos) => {
        for (const b of blocos) {
          vistos.add(b.id);
          const r = resultados.get(b.id);
          if (r && r.encontrado === false) naoEncontrados.add(b.id);
        }
      };

      try {
        status('Indo para a página 1…');
        await irParaPrimeiraPagina();
        for (let n = 0; n < CONFIG.MAX_PAGINAS && !parar; n++) {
          status(`Verificando página <b>${escHtml(paginaAtiva() || '1')}</b> de ${totalPaginas()} · ` +
            `${vistos.size} pedidos lidos, <b>${naoEncontrados.size}</b> não encontrados`);
          const blocos = await esperarConsulta();
          if (blocos.some((b) => (resultados.get(b.id) || {}).erro)) {
            throw new Error('Não foi possível ler o arquivo de tracking (veja o balão vermelho).');
          }
          contar(blocos);
          paginas++;
          const prox = proximaDisponivel();
          if (!prox) break; // última página
          await dormir(CONFIG.PAUSA_ENTRE_PAGINAS_MS);
          const antes = assinaturaLista();
          const pagAntes = paginaAtiva();
          prox.click();
          if (!(await esperarLista(antes, pagAntes))) {
            throw new Error(`A página ${Number(pagAntes) + 1 || 'seguinte'} não carregou.`);
          }
        }
        interrompida = parar;
        status('Voltando para a página 1…');
        await irParaPrimeiraPagina();

        status(`Enviando ${naoEncontrados.size} não encontrados para a base…`);
        const envio = await new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage({ tipo: 'enviarRetornoAgora' }, (r) => resolve(chrome.runtime.lastError ? null : r));
          } catch (e) { resolve(null); }
        });
        await chrome.storage.local.set({
          ultimaVarredura: { em: Date.now(), pedidos: vistos.size, naoEncontrados: naoEncontrados.size, paginas, interrompida },
        }).catch(() => {});
        const falhaEnvio = envio && envio.erro ? ` <span class="erro">Envio à base falhou: ${escHtml(envio.erro)} (fica na fila).</span>` : '';
        status(`${interrompida ? 'Verificação interrompida' : '✔ Verificação concluída'}: <b>${vistos.size}</b> pedidos em ${paginas} páginas, ` +
          `<b>${naoEncontrados.size}</b> não encontrados${envio && !envio.erro ? ' — informados à base' : ''}.${falhaEnvio}`);
      } catch (e) {
        status(`⚠ ${escHtml(e.message || e)} Lidos até aqui: ${vistos.size} pedidos em ${paginas} páginas (os não encontrados já estão na fila).`, { erro: true });
      } finally {
        rodando = false;
        botao(false);
      }
    }

    return { garantirBarra, rodando: () => rodando };
  })();

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
    varredura.garantirBarra();
    atualizar(false);
  }

  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(verificar, 300);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setInterval(verificar, 2000);
  verificar();
})();
