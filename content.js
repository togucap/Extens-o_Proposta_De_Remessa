/*
 * Proposta de Remessa - Verificador de Triagem RMA
 *
 * Roda na tela "Gerar Proposta de Remessa". Cada etiqueta bipada no campo
 * "Etiquetas" (#form-mercadoria-busca) é consultada, uma por vez, na tela de
 * estoque de mercadoria. O rastreamento é lido de baixo para cima procurando a
 * interação "RMA - Registrado Triagem"; a data encontrada é comparada com a
 * data atual e o resultado aparece num balão flutuante no centro da tela.
 */
(() => {
  'use strict';

  if (window.__kbmTriagemCarregado) return;
  window.__kbmTriagemCarregado = true;

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------
  const CONFIG = {
    // Tela consultada em segundo plano.
    URL_ESTOQUE: 'https://manager.kabum.com.br/cgi-local/recebimento/estoque/estoque_mercadoria.cgi',

    // Campo onde as etiquetas são bipadas na tela de proposta de remessa.
    SELETOR_CAMPO_ORIGEM: '#form-mercadoria-busca, textarea[name="form_mercadoria_codigo"]',

    // Nome (atributo name) do campo de etiqueta na tela de estoque.
    // null = detectar automaticamente (procura campos com "etiqueta", "codigo", "mercadoria").
    NOME_CAMPO_ESTOQUE: null,

    // Texto da interação procurada no rastreamento.
    TEXTO_INTERACAO: 'RMA - Registrado Triagem',

    // A data da interação é considerada "recente" quando tem MENOS que este número de dias.
    DIAS_LIMITE: 5,

    // Tempo sem novas teclas para considerar que o leitor terminou de enviar uma etiqueta
    // (usado quando o leitor não envia ENTER no final).
    ESPERA_FIM_LEITURA_MS: 700,

    // Intervalo de leitura do campo de etiquetas.
    INTERVALO_VERIFICACAO_MS: 250,

    // Tempo máximo de uma consulta.
    TIMEOUT_CONSULTA_MS: 20000,

    // Tempo que o balão fica visível após o resultado (0 = só fecha ao clicar).
    TEMPO_BALAO_MS: 6000,

    // Quantidade de etiquetas mantidas no histórico (canto inferior direito).
    MAX_HISTORICO: 30,
  };

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  const normalizar = (texto) =>
    String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const textoLimpo = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

  function escaparHtml(texto) {
    return String(texto).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  /** Dias de calendário entre a data (dd/mm/aaaa) e hoje. */
  function diasDesde(dataBr) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr);
    if (!m) return null;
    const evento = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    const h = new Date();
    const hoje = Date.UTC(h.getFullYear(), h.getMonth(), h.getDate());
    return Math.round((hoje - evento) / 86400000);
  }

  // ---------------------------------------------------------------------------
  // Leitura do rastreamento
  // ---------------------------------------------------------------------------
  /**
   * Lê a tabela #rastreamento de baixo para cima e devolve a última ocorrência
   * de CONFIG.TEXTO_INTERACAO. Retorna null quando a tabela não existe.
   */
  function analisarRastreamento(doc) {
    const tabela = doc.querySelector('#rastreamento');
    if (!tabela) return null;

    const linhas = Array.from(tabela.querySelectorAll('tr')).filter((tr) => {
      const tds = tr.querySelectorAll(':scope > td');
      return tds.length >= 4 && /^\d{2}\/\d{2}\/\d{4}$/.test(textoLimpo(tds[0]));
    });

    const alvo = normalizar(CONFIG.TEXTO_INTERACAO);

    for (let i = linhas.length - 1; i >= 0; i--) {
      const tds = Array.from(linhas[i].querySelectorAll(':scope > td'));
      const operacao = textoLimpo(tds[3]);
      if (normalizar(operacao).includes(alvo)) {
        return {
          encontrado: true,
          data: textoLimpo(tds[0]),
          hora: textoLimpo(tds[1]),
          usuario: textoLimpo(tds[2]),
          operacao,
          totalInteracoes: linhas.length,
        };
      }
    }
    return { encontrado: false, totalInteracoes: linhas.length };
  }

  function montarResultado(codigo, analise) {
    if (!analise) {
      return {
        codigo,
        status: 'sem_rastreamento',
        titulo: 'Rastreamento não encontrado',
        detalhe: 'A tela de estoque não retornou rastreamento para esta etiqueta.',
      };
    }
    if (!analise.encontrado) {
      return {
        codigo,
        status: 'nao_encontrado',
        titulo: `Sem "${CONFIG.TEXTO_INTERACAO}"`,
        detalhe: `Nenhuma interação "${CONFIG.TEXTO_INTERACAO}" nas ${analise.totalInteracoes} interações da mercadoria.`,
      };
    }
    const dias = diasDesde(analise.data);
    const recente = dias !== null && dias < CONFIG.DIAS_LIMITE;
    const quando = dias === null ? '' : dias <= 0 ? ' (hoje)' : dias === 1 ? ' (há 1 dia)' : ` (há ${dias} dias)`;
    return {
      codigo,
      status: recente ? 'recente' : 'antigo',
      titulo: recente
        ? `Triagem há menos de ${CONFIG.DIAS_LIMITE} dias`
        : `Triagem há ${CONFIG.DIAS_LIMITE} dias ou mais`,
      detalhe: `${CONFIG.TEXTO_INTERACAO}: ${analise.data} às ${analise.hora}${quando} — ${analise.usuario}`,
      data: analise.data,
      hora: analise.hora,
      dias,
    };
  }

  // ---------------------------------------------------------------------------
  // Consulta na tela de estoque
  // ---------------------------------------------------------------------------
  async function baixarDocumento(url, opcoes = {}) {
    const resp = await fetch(url, { credentials: 'include', cache: 'no-store', ...opcoes });
    if (!resp.ok) throw new Error(`A tela de estoque respondeu HTTP ${resp.status}`);

    const bytes = await resp.arrayBuffer();
    let charset = (/charset=([^;]+)/i.exec(resp.headers.get('content-type') || '') || [])[1];
    if (!charset) {
      const inicio = new TextDecoder('windows-1252').decode(bytes.slice(0, 4096));
      charset = (/<meta[^>]+charset=["']?([\w-]+)/i.exec(inicio) || [])[1];
    }
    let html;
    try {
      html = new TextDecoder((charset || 'utf-8').trim(), { fatal: !charset }).decode(bytes);
    } catch (e) {
      html = new TextDecoder('windows-1252').decode(bytes);
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.urlOrigem = resp.url || url;
    if (doc.querySelector('input[type="password"]') && !doc.querySelector('#rastreamento')) {
      throw new Error('Sessão expirada: faça login novamente no manager.');
    }
    return doc;
  }

  /** Endereços dos frames/iframes de um documento (a tela de estoque usa <frameset>). */
  function enderecosDosFrames(doc) {
    return Array.from(doc.querySelectorAll('frame[src], iframe[src]'))
      .map((fr) => fr.getAttribute('src'))
      .filter((src) => src && !/^(about|javascript|data):/i.test(src))
      .map((src) => new URL(src, doc.urlOrigem).href);
  }

  /** Encontra o campo de etiqueta na tela de estoque. */
  function encontrarCampoEtiqueta(doc) {
    if (CONFIG.NOME_CAMPO_ESTOQUE) {
      return doc.querySelector(`[name="${CSS.escape(CONFIG.NOME_CAMPO_ESTOQUE)}"]`);
    }
    const candidatos = Array.from(doc.querySelectorAll(
      'textarea, input[type="text"], input[type="search"], input[type="number"], input:not([type])'
    )).filter((el) => el.name || el.id);
    let melhor = null;
    let melhorPontos = 0;
    for (const el of candidatos) {
      const chave = normalizar([el.name, el.id, el.placeholder, el.className].join(' '));
      let pontos = 0;
      if (chave.includes('etiqueta')) pontos += 5;
      if (chave.includes('codigo') || chave.includes('cod')) pontos += 3;
      if (chave.includes('mercadoria')) pontos += 2;
      if (chave.includes('busca') || chave.includes('pesquisa')) pontos += 1;
      if (el.tagName === 'TEXTAREA') pontos += 1;
      if (pontos > melhorPontos) {
        melhor = el;
        melhorPontos = pontos;
      }
    }
    return melhor || candidatos[0] || null;
  }

  function formularioDo(campo) {
    return campo.form || campo.closest('form');
  }

  /** Procura o campo de etiqueta na página e, se for um frameset, dentro dos frames. */
  async function localizarCampoEstoque(url, profundidade = 0) {
    const doc = await baixarDocumento(url);
    const campo = encontrarCampoEtiqueta(doc);
    if (campo && campo.name) return { doc, campo };
    if (profundidade >= 3) return null;
    for (const src of enderecosDosFrames(doc)) {
      try {
        const achou = await localizarCampoEstoque(src, profundidade + 1);
        if (achou) return achou;
      } catch (e) {
        if (/Sessão expirada/.test(e.message)) throw e;
        console.warn('[Triagem RMA] Falha ao abrir frame', src, e);
      }
    }
    return null;
  }

  let formularioCache = null;

  /** Descobre o formulário de busca da tela de estoque (campos, método e action). */
  async function obterFormularioEstoque() {
    if (formularioCache) return formularioCache;

    const achou = await localizarCampoEstoque(CONFIG.URL_ESTOQUE);
    if (!achou) throw new Error('Campo de etiqueta não encontrado na tela de estoque.');
    const { doc, campo } = achou;

    const form = formularioDo(campo);
    const fixos = [];
    if (form) {
      let botaoIncluido = false;
      for (const el of form.querySelectorAll('input, select, textarea, button')) {
        if (el === campo || !el.name || el.disabled) continue;
        const tipo = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : 'text')).toLowerCase();
        if (['file', 'reset', 'button', 'image'].includes(tipo)) continue;
        if (tipo === 'submit') {
          if (!botaoIncluido) { fixos.push([el.name, el.value || '']); botaoIncluido = true; }
          continue;
        }
        if ((tipo === 'checkbox' || tipo === 'radio') && !el.checked) continue;
        if (el.tagName === 'SELECT') {
          const opt = el.querySelector('option[selected]') || el.querySelector('option');
          if (opt) fixos.push([el.name, opt.value]);
          continue;
        }
        fixos.push([el.name, el.value || '']);
      }
    }

    formularioCache = {
      action: new URL((form && form.getAttribute('action')) || doc.urlOrigem, doc.urlOrigem).href,
      method: ((form && form.getAttribute('method')) || 'GET').toUpperCase(),
      multipart: !!form && /multipart/i.test(form.getAttribute('enctype') || ''),
      nomeCampo: campo.name,
      fixos,
    };
    console.info('[Triagem RMA] Formulário da tela de estoque detectado:', formularioCache);
    return formularioCache;
  }

  /** Analisa o documento e, se o rastreamento estiver dentro de frames, abre os frames. */
  async function analisarComFrames(doc, profundidade = 0) {
    const analise = analisarRastreamento(doc);
    if (analise || profundidade >= 3) return analise;
    for (const src of enderecosDosFrames(doc)) {
      try {
        const r = await analisarComFrames(await baixarDocumento(src), profundidade + 1);
        if (r) return r;
      } catch (e) {
        console.warn('[Triagem RMA] Falha ao abrir frame', src, e);
      }
    }
    return null;
  }

  /** Estratégia 1: requisição direta (rápida, sem abrir a tela). */
  async function consultarViaFetch(codigo) {
    const f = await obterFormularioEstoque();
    let doc;
    if (f.method === 'POST') {
      const corpo = f.multipart ? new FormData() : new URLSearchParams();
      for (const [k, v] of f.fixos) corpo.append(k, v);
      corpo.set(f.nomeCampo, codigo);
      doc = await baixarDocumento(f.action, { method: 'POST', body: corpo });
    } else {
      // Em formulários GET o navegador substitui toda a query string da action.
      const url = new URL(f.action);
      url.search = '';
      for (const [k, v] of f.fixos) url.searchParams.append(k, v);
      url.searchParams.set(f.nomeCampo, codigo);
      doc = await baixarDocumento(url.href);
    }
    return analisarComFrames(doc);
  }

  /** Todos os documentos de uma janela, incluindo frames aninhados. */
  function documentosDe(win, lista = []) {
    let doc = null;
    try { doc = win.document; } catch (e) { return lista; }
    if (!doc) return lista;
    lista.push(doc);
    for (let i = 0; i < win.frames.length; i++) documentosDe(win.frames[i], lista);
    return lista;
  }

  /** Estratégia 2: abre a tela de estoque num iframe oculto e preenche o campo. */
  async function consultarViaIframe(codigo) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:1024px;height:768px;opacity:0;pointer-events:none;border:0;';

    try {
      iframe.src = CONFIG.URL_ESTOQUE;
      document.body.appendChild(iframe);

      // Aguarda o campo aparecer (em qualquer frame).
      const inicio = Date.now();
      let campo = null;
      while (!campo) {
        if (Date.now() - inicio > CONFIG.TIMEOUT_CONSULTA_MS) {
          throw new Error('Campo de etiqueta não encontrado na tela de estoque.');
        }
        await dormir(300);
        for (const d of documentosDe(iframe.contentWindow)) {
          if (d.readyState === 'loading' || d.URL === 'about:blank') continue;
          const c = encontrarCampoEtiqueta(d);
          if (c) { campo = c; break; }
        }
      }

      const docsAntes = new Set(documentosDe(iframe.contentWindow));
      const textoAntes = new Map();
      for (const d of docsAntes) {
        const t = d.querySelector('#rastreamento');
        textoAntes.set(d, t ? t.textContent : null);
      }

      campo.value = codigo;
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.dispatchEvent(new Event('change', { bubbles: true }));

      const form = formularioDo(campo);
      const botao = form && form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (botao) botao.click();
      else if (form) (form.requestSubmit ? form.requestSubmit() : form.submit());
      else {
        for (const tipo of ['keydown', 'keypress', 'keyup']) {
          campo.dispatchEvent(new KeyboardEvent(tipo, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      }

      const enviado = Date.now();
      let semTabelaDesde = null;
      while (Date.now() - enviado < CONFIG.TIMEOUT_CONSULTA_MS) {
        await dormir(300);
        const docs = documentosDe(iframe.contentWindow);
        for (const d of docs) {
          const tabela = d.querySelector('#rastreamento');
          if (!tabela || d.readyState === 'loading') continue;
          if (docsAntes.has(d) && tabela.textContent === textoAntes.get(d)) continue;
          const analise = analisarRastreamento(d);
          if (analise && analise.totalInteracoes > 0) return analise;
        }
        // Algum frame carregou uma página nova, tudo terminou de carregar e não há rastreamento.
        const carregando = docs.some((d) => d.readyState !== 'complete');
        const temNovo = docs.some((d) => !docsAntes.has(d) && d.URL !== 'about:blank');
        if (temNovo && !carregando) {
          semTabelaDesde = semTabelaDesde || Date.now();
          if (Date.now() - semTabelaDesde > 3000) return null;
        } else {
          semTabelaDesde = null;
        }
      }
      throw new Error('Tempo esgotado aguardando o rastreamento na tela de estoque.');
    } finally {
      iframe.remove();
    }
  }

  // Estratégia que já funcionou nesta sessão ('fetch' ou 'iframe').
  let estrategia = null;

  async function consultarEtiqueta(codigo) {
    if (estrategia !== 'iframe') {
      try {
        const analise = await consultarViaFetch(codigo);
        if (analise) {
          estrategia = 'fetch';
          return analise;
        }
        // Se o fetch já funcionou antes, a ausência de rastreamento é da etiqueta.
        if (estrategia === 'fetch') return null;
      } catch (e) {
        if (estrategia === 'fetch' || /Sessão expirada/.test(e.message)) throw e;
        console.warn('[Triagem RMA] Consulta direta falhou, tentando via iframe:', e);
      }
    }
    const analise = await consultarViaIframe(codigo);
    if (analise) estrategia = 'iframe';
    return analise;
  }

  // ---------------------------------------------------------------------------
  // Fila (uma etiqueta por vez)
  // ---------------------------------------------------------------------------
  const fila = [];
  let emProcessamento = null;

  function enfileirar(codigo) {
    if (codigo === emProcessamento || fila.includes(codigo)) return;
    fila.push(codigo);
    ui.atualizarFila(fila.length);
    processarFila();
  }

  async function processarFila() {
    if (emProcessamento !== null) return;
    while (fila.length) {
      const codigo = fila.shift();
      emProcessamento = codigo;
      ui.atualizarFila(fila.length);
      ui.mostrarConsultando(codigo);

      let resultado;
      try {
        const consulta = consultarEtiqueta(codigo);
        const limite = dormir(CONFIG.TIMEOUT_CONSULTA_MS + 5000).then(() => {
          throw new Error('Tempo esgotado na consulta.');
        });
        resultado = montarResultado(codigo, await Promise.race([consulta, limite]));
      } catch (e) {
        console.error('[Triagem RMA]', codigo, e);
        resultado = { codigo, status: 'erro', titulo: 'Erro na consulta', detalhe: e.message || String(e) };
      }

      ui.mostrarResultado(resultado, fila.length);
      ui.adicionarHistorico(resultado);
      emProcessamento = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Leitura do campo de etiquetas (leitor de código de barras)
  // ---------------------------------------------------------------------------
  let presentes = new Set(); // etiquetas que estão no campo e já foram enviadas para a fila
  let ultimoValor = '';
  let ultimaMudanca = 0;

  function verificarCampo(forcarUltima = false) {
    const campo = document.querySelector(CONFIG.SELETOR_CAMPO_ORIGEM);
    if (!campo) return;

    const valor = campo.value || '';
    const agora = Date.now();
    if (valor !== ultimoValor) {
      ultimoValor = valor;
      ultimaMudanca = agora;
    }

    const partes = valor.split(/[\r\n\t]+/);
    const ultima = (partes.pop() || '').trim();
    const completas = partes.map((p) => p.trim()).filter(Boolean);

    // Última linha sem ENTER: considera concluída após um tempo sem digitação.
    if (ultima && (forcarUltima || agora - ultimaMudanca >= CONFIG.ESPERA_FIM_LEITURA_MS)) {
      completas.push(ultima);
    }

    for (const codigo of completas) {
      if (!presentes.has(codigo)) enfileirar(codigo);
    }

    const novos = new Set(completas);
    if (ultima && presentes.has(ultima)) novos.add(ultima);
    presentes = novos;
  }

  function campoOrigem(el) {
    return el && el.matches && el.matches(CONFIG.SELETOR_CAMPO_ORIGEM);
  }

  // ENTER no campo: lê o valor antes que a página possa limpá-lo.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && campoOrigem(ev.target)) verificarCampo(true);
  }, true);
  document.addEventListener('input', (ev) => {
    if (campoOrigem(ev.target)) verificarCampo();
  }, true);
  document.addEventListener('paste', (ev) => {
    if (campoOrigem(ev.target)) setTimeout(() => verificarCampo(true), 0);
  }, true);
  setInterval(() => verificarCampo(), CONFIG.INTERVALO_VERIFICACAO_MS);

  // ---------------------------------------------------------------------------
  // Interface (balão central + histórico)
  // ---------------------------------------------------------------------------
  const ui = (() => {
    const ESTILOS = {
      consultando: { cor: '#1d4ed8', fundo: '#eff6ff', icone: '⏳' },
      recente: { cor: '#15803d', fundo: '#f0fdf4', icone: '✔' },
      antigo: { cor: '#b45309', fundo: '#fffbeb', icone: '⚠' },
      nao_encontrado: { cor: '#b91c1c', fundo: '#fef2f2', icone: '✖' },
      sem_rastreamento: { cor: '#b91c1c', fundo: '#fef2f2', icone: '✖' },
      erro: { cor: '#4b5563', fundo: '#f3f4f6', icone: '!' },
    };

    const host = document.createElement('div');
    host.id = 'kbm-triagem-rma';
    host.style.cssText = 'all: initial;';
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
        .balao {
          position: fixed; top: 50%; left: 50%; z-index: 2147483647;
          transform: translate(-50%, -50%) scale(.96);
          width: min(460px, calc(100vw - 32px));
          background: var(--fundo, #fff); color: #111827;
          border: 3px solid var(--cor, #1d4ed8); border-radius: 16px;
          box-shadow: 0 20px 50px rgba(0,0,0,.35);
          padding: 18px 20px 16px; text-align: center;
          opacity: 0; pointer-events: none;
          transition: opacity .15s ease, transform .15s ease;
        }
        .balao.visivel { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
        .fechar {
          position: absolute; top: 6px; right: 10px; border: 0; background: none;
          font-size: 22px; line-height: 1; color: #6b7280; cursor: pointer;
        }
        .cabecalho { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
        .icone { font-size: 42px; line-height: 1.1; color: var(--cor); margin-top: 6px; }
        .titulo { font-size: 20px; font-weight: bold; color: var(--cor); margin-top: 4px; }
        .etiqueta { font-size: 15px; margin-top: 8px; word-break: break-all; }
        .etiqueta b { font-family: Consolas, monospace; }
        .detalhe { font-size: 14px; margin-top: 8px; color: #374151; }
        .fila { font-size: 12px; margin-top: 10px; color: #6b7280; min-height: 14px; }
        .girando { display: inline-block; animation: girar 1s linear infinite; }
        @keyframes girar { to { transform: rotate(360deg); } }

        .historico {
          position: fixed; right: 12px; bottom: 12px; z-index: 2147483646;
          width: 330px; max-height: 45vh; display: none; flex-direction: column;
          background: #fff; border: 1px solid #d1d5db; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.18); overflow: hidden; font-size: 12px; color: #111827;
        }
        .historico.ativo { display: flex; }
        .historico header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 6px 10px; background: #f3f4f6; font-weight: bold; cursor: pointer; user-select: none;
        }
        .historico ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
        .historico.recolhido ul { display: none; }
        .historico li { padding: 6px 10px; border-top: 1px solid #eee; border-left: 4px solid var(--cor); }
        .historico li .cod { font-family: Consolas, monospace; font-weight: bold; }
        .historico li .res { color: var(--cor); }
        .historico li .det { color: #6b7280; }
      </style>
      <div class="balao" role="status" aria-live="polite">
        <button class="fechar" title="Fechar">×</button>
        <div class="cabecalho">Verificação: ${escaparHtml(CONFIG.TEXTO_INTERACAO)}</div>
        <div class="icone"></div>
        <div class="titulo"></div>
        <div class="etiqueta"></div>
        <div class="detalhe"></div>
        <div class="fila"></div>
      </div>
      <div class="historico">
        <header><span>Etiquetas verificadas (<span class="qtd">0</span>)</span><span class="seta">▾</span></header>
        <ul></ul>
      </div>
    `;

    const $ = (s) => raiz.querySelector(s);
    const balao = $('.balao');
    const historico = $('.historico');
    let timerOcultar = null;

    // Não roubar o foco do campo de etiquetas ao clicar nos elementos da extensão.
    raiz.addEventListener('mousedown', (e) => e.preventDefault());
    $('.fechar').addEventListener('click', () => ocultar());
    historico.querySelector('header').addEventListener('click', () => {
      historico.classList.toggle('recolhido');
      $('.seta').textContent = historico.classList.contains('recolhido') ? '▸' : '▾';
    });

    function anexar() {
      if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    }

    function aplicarEstilo(el, status) {
      const s = ESTILOS[status] || ESTILOS.erro;
      el.style.setProperty('--cor', s.cor);
      el.style.setProperty('--fundo', s.fundo);
      return s;
    }

    function mostrar({ status, titulo, codigo, detalhe, restantes }) {
      anexar();
      const s = aplicarEstilo(balao, status);
      $('.icone').innerHTML = status === 'consultando'
        ? `<span class="girando">${s.icone}</span>`
        : s.icone;
      $('.titulo').textContent = titulo;
      $('.etiqueta').innerHTML = `Etiqueta: <b>${escaparHtml(codigo)}</b>`;
      $('.detalhe').textContent = detalhe || '';
      $('.fila').textContent = restantes ? `${restantes} etiqueta(s) aguardando consulta` : '';
      balao.classList.add('visivel');
      clearTimeout(timerOcultar);
    }

    function ocultar() {
      clearTimeout(timerOcultar);
      balao.classList.remove('visivel');
    }

    return {
      mostrarConsultando(codigo) {
        mostrar({
          status: 'consultando',
          titulo: 'Consultando rastreamento…',
          codigo,
          detalhe: 'Buscando na tela de estoque de mercadoria.',
          restantes: fila.length,
        });
      },
      mostrarResultado(r, restantes) {
        mostrar({ ...r, restantes });
        if (CONFIG.TEMPO_BALAO_MS > 0 && !restantes) {
          timerOcultar = setTimeout(ocultar, CONFIG.TEMPO_BALAO_MS);
        }
      },
      atualizarFila(n) {
        if (balao.classList.contains('visivel')) {
          $('.fila').textContent = n ? `${n} etiqueta(s) aguardando consulta` : '';
        }
      },
      adicionarHistorico(r) {
        anexar();
        historico.classList.add('ativo');
        const li = document.createElement('li');
        aplicarEstilo(li, r.status);
        const hora = new Date().toLocaleTimeString('pt-BR');
        li.innerHTML =
          `<div><span class="cod">${escaparHtml(r.codigo)}</span> <span class="det">· ${hora}</span></div>` +
          `<div class="res">${escaparHtml(r.titulo)}</div>` +
          (r.data ? `<div class="det">${escaparHtml(r.data)} ${escaparHtml(r.hora || '')}</div>` : '');
        const ul = historico.querySelector('ul');
        ul.prepend(li);
        while (ul.children.length > CONFIG.MAX_HISTORICO) ul.lastElementChild.remove();
        $('.qtd').textContent = ul.children.length;
      },
    };
  })();

  console.info('[Triagem RMA] Extensão ativa na tela de Proposta de Remessa.');
})();
