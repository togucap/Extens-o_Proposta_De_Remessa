/*
 * Proposta de Remessa - Verificador de Triagem RMA
 *
 * Roda na tela "Gerar Proposta de Remessa". Cada etiqueta bipada no campo
 * "Etiquetas" (#form-mercadoria-busca) é consultada, uma por vez, na tela de
 * estoque de mercadoria. O rastreamento é lido de baixo para cima procurando a
 * interação "RMA - Registrado Triagem" (avisando quando houver mais de uma) e o
 * resultado, com Produto e Final, aparece num balão flutuante no centro da tela.
 * A extensão apenas avisa: não bloqueia nem altera nada na tela.
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

    // Campos exibidos no resumo: procura o rótulo na tela de estoque e pega o valor à frente dele.
    CAMPOS_EXTRAS: [
      { titulo: 'Produto', rotulos: ['Produto'] },
      { titulo: 'Final', rotulos: ['Final'] },
    ],

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

    // Botão que gera a listagem de produtos válidos para a proposta.
    SELETOR_BOTAO_VERIFICAR: '#id_submit_button',

    // Área onde a listagem de produtos válidos aparece.
    SELETOR_LISTAGEM: '#listagem-produtos-filtrado',
  };

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  const normalizar = (texto) =>
    String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const textoLimpo = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

  function escaparHtml(texto) {
    return String(texto).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ---------------------------------------------------------------------------
  // Leitura de campos do tipo "Rótulo: valor" (ex.: Produto, Final)
  // ---------------------------------------------------------------------------
  const tiraDoisPontos = (t) => normalizar(t).replace(/[\s:]+$/, '');

  /** Valor de um elemento: campo de formulário dentro dele ou o próprio texto. */
  function valorDoElemento(el) {
    const campo = el.matches('input, select, textarea')
      ? el
      : el.querySelector('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), select, textarea');
    if (campo) {
      if (campo.tagName === 'SELECT') {
        const opt = campo.querySelector('option[selected]') || campo.options[campo.selectedIndex];
        return opt ? textoLimpo(opt) : '';
      }
      return String(campo.value || campo.getAttribute('value') || '').trim();
    }
    return textoLimpo(el);
  }

  /** Primeiro valor não vazio depois do rótulo (próxima célula ou texto logo em seguida). */
  function valorAoLadoDoRotulo(rotulo) {
    const base = rotulo.closest('td, th, dt') || rotulo;
    for (let no = base.nextSibling; no; no = no.nextSibling) {
      if (no.nodeType === Node.TEXT_NODE) {
        const t = no.textContent.replace(/\s+/g, ' ').replace(/^[\s:]+/, '').trim();
        if (t) return t;
      } else if (no.nodeType === Node.ELEMENT_NODE) {
        if (no.tagName === 'BR') continue;
        const v = valorDoElemento(no).replace(/^[\s:]+/, '').trim();
        if (v) return v;
      }
    }
    // Rótulo e valor no mesmo elemento: "Produto: Nome do produto".
    const pai = base.parentElement;
    if (pai) {
      const texto = textoLimpo(pai);
      const rot = textoLimpo(rotulo);
      const i = texto.indexOf(rot);
      if (i >= 0) {
        const resto = texto.slice(i + rot.length).replace(/^[\s:]+/, '').trim();
        if (resto && resto.length < 300) return resto;
      }
    }
    return '';
  }

  /** Procura no documento um rótulo (ex.: "Produto") e devolve o valor ao lado dele. */
  function extrairCampoRotulado(doc, rotulos) {
    const alvos = rotulos.map(tiraDoisPontos);
    const elementos = doc.querySelectorAll('td, th, dt, b, strong, label, font, span, div, p');
    for (const el of elementos) {
      if (el.closest('#rastreamento')) continue;
      const texto = textoLimpo(el);
      if (!texto || texto.length > 40 || !alvos.includes(tiraDoisPontos(texto))) continue;
      const valor = valorAoLadoDoRotulo(el);
      if (valor) return valor;
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Leitura do rastreamento
  // ---------------------------------------------------------------------------
  /**
   * Lê a tabela #rastreamento de baixo para cima e devolve todas as ocorrências
   * de CONFIG.TEXTO_INTERACAO (a mais recente primeiro), além dos campos extras
   * (Produto, Final). Retorna null quando a tabela não existe.
   */
  function analisarRastreamento(doc) {
    const tabela = doc.querySelector('#rastreamento');
    if (!tabela) return null;

    const linhas = Array.from(tabela.querySelectorAll('tr')).filter((tr) => {
      const tds = tr.querySelectorAll(':scope > td');
      return tds.length >= 4 && /^\d{2}\/\d{2}\/\d{4}$/.test(textoLimpo(tds[0]));
    });

    const alvo = normalizar(CONFIG.TEXTO_INTERACAO);
    const ocorrencias = [];
    for (let i = linhas.length - 1; i >= 0; i--) {
      const tds = Array.from(linhas[i].querySelectorAll(':scope > td'));
      const operacao = textoLimpo(tds[3]);
      if (normalizar(operacao).includes(alvo)) {
        ocorrencias.push({
          data: textoLimpo(tds[0]),
          hora: textoLimpo(tds[1]),
          usuario: textoLimpo(tds[2]),
          operacao,
        });
      }
    }

    const extras = CONFIG.CAMPOS_EXTRAS.map((c) => ({
      titulo: c.titulo,
      valor: extrairCampoRotulado(doc, c.rotulos),
    }));

    return { ocorrencias, extras, totalInteracoes: linhas.length };
  }

  function montarResultado(codigo, analise) {
    if (!analise) {
      return {
        codigo,
        status: 'sem_rastreamento',
        titulo: 'Rastreamento não encontrado',
        detalhe: 'A tela de estoque não retornou rastreamento para esta etiqueta.',
        extras: [],
      };
    }
    const { ocorrencias, extras } = analise;
    const quando = (o) => `${o.data} às ${o.hora} — ${o.usuario}`;

    if (!ocorrencias.length) {
      return {
        codigo,
        status: 'nao_encontrado',
        titulo: `Sem "${CONFIG.TEXTO_INTERACAO}"`,
        detalhe: `Nenhuma interação "${CONFIG.TEXTO_INTERACAO}" nas ${analise.totalInteracoes} interações da mercadoria.`,
        extras,
      };
    }
    if (ocorrencias.length === 1) {
      return {
        codigo,
        status: 'encontrado',
        titulo: `"${CONFIG.TEXTO_INTERACAO}" encontrado`,
        detalhe: quando(ocorrencias[0]),
        extras,
        ocorrencias,
      };
    }
    return {
      codigo,
      status: 'multiplo',
      titulo: `"${CONFIG.TEXTO_INTERACAO}" encontrado ${ocorrencias.length} vezes`,
      detalhe: 'Atenção: a mercadoria possui mais de uma triagem registrada.',
      lista: ocorrencias.map(quando),
      extras,
      ocorrencias,
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
  const resultados = new Map(); // etiqueta -> último resultado da consulta
  const silenciosas = new Set(); // etiquetas consultadas sem abrir o balão

  function enfileirar(codigo, { silencioso = false } = {}) {
    if (codigo === emProcessamento || fila.includes(codigo)) return;
    if (silencioso) silenciosas.add(codigo);
    else silenciosas.delete(codigo);
    fila.push(codigo);
    ui.atualizarFila(fila.length);
    processarFila();
  }

  const naFila = (codigo) => codigo === emProcessamento || fila.includes(codigo);

  async function processarFila() {
    if (emProcessamento !== null) return;
    while (fila.length) {
      const codigo = fila.shift();
      emProcessamento = codigo;
      const silencioso = silenciosas.delete(codigo);
      ui.atualizarFila(fila.length);
      if (!silencioso) ui.mostrarConsultando(codigo);

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

      resultados.set(codigo, resultado);
      if (!silencioso) ui.mostrarResultado(resultado, fila.length);
      ui.adicionarHistorico(resultado);
      emProcessamento = null;
      comparacao.atualizar();
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
      encontrado: { cor: '#15803d', fundo: '#f0fdf4', icone: '✔' },
      multiplo: { cor: '#b45309', fundo: '#fffbeb', icone: '⚠' },
      nao_encontrado: { cor: '#b91c1c', fundo: '#fef2f2', icone: '✖' },
      sem_rastreamento: { cor: '#b91c1c', fundo: '#fef2f2', icone: '✖' },
      erro: { cor: '#4b5563', fundo: '#f3f4f6', icone: '!' },
      proposta_ok: { cor: '#15803d', fundo: '#f0fdf4', icone: '✔' },
      proposta_falha: { cor: '#b91c1c', fundo: '#fef2f2', icone: '✖' },
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
        .extras { margin: 10px auto 0; border-collapse: collapse; font-size: 14px; text-align: left; max-width: 100%; }
        .extras th { padding: 2px 8px 2px 0; color: #6b7280; font-weight: normal; white-space: nowrap; vertical-align: top; }
        .extras td { padding: 2px 0; font-weight: bold; color: #111827; word-break: break-word; }
        .extras .vazio { font-weight: normal; color: #9ca3af; font-style: italic; }
        .detalhe { font-size: 14px; margin-top: 8px; color: #374151; }
        .lista { list-style: none; margin: 6px 0 0; padding: 0; font-size: 13px; color: #374151; }
        .lista li { padding: 6px 10px; margin-top: 6px; background: rgba(255,255,255,.7); border-radius: 8px; border-left: 3px solid var(--cor); text-align: left; }
        .fila { font-size: 12px; margin-top: 10px; color: #6b7280; min-height: 14px; }
        .girando { display: inline-block; animation: girar 1s linear infinite; }
        @keyframes girar { to { transform: rotate(360deg); } }

        .paineis {
          position: fixed; right: 12px; bottom: 12px; z-index: 2147483646;
          width: 350px; max-height: calc(100vh - 24px);
          display: flex; flex-direction: column; gap: 18px;
          font-size: 12px; color: #111827;
        }
        .painel {
          display: none; flex-direction: column; min-height: 0;
          background: #fff; border: 1px solid #d1d5db; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.18); overflow: hidden;
        }
        .painel.ativo { display: flex; }
        .painel header {
          display: flex; justify-content: space-between; align-items: center; gap: 8px;
          padding: 8px 12px; font-weight: bold; cursor: pointer; user-select: none;
          background: #f3f4f6; border-bottom: 1px solid #e5e7eb;
        }
        .painel .corpo { overflow-y: auto; padding: 8px; background: #f9fafb; }
        .painel.recolhido .corpo { display: none; }
        .painel.recolhido header { border-bottom: 0; }

        .conferencia { max-height: 45vh; border-width: 2px; }
        .conferencia.falha { border-color: #b91c1c; }
        .conferencia.falha header { background: #fef2f2; color: #b91c1c; }
        .conferencia.ok { border-color: #15803d; }
        .conferencia.ok header { background: #f0fdf4; color: #15803d; }
        .conferencia .secao { font-weight: bold; padding: 4px 2px 6px; }
        .conferencia .secao + .item, .conferencia .item + .item { margin-top: 0; }
        .conferencia .secao.nao { color: #b91c1c; }
        .conferencia .secao.sim { color: #15803d; margin-top: 6px; }
        .conferencia .item {
          padding: 8px 10px; margin-bottom: 8px; line-height: 1.45; background: #fff;
          border: 1px solid #e5e7eb; border-left: 4px solid var(--cor); border-radius: 8px;
        }
        .conferencia .item .cod { font-family: Consolas, monospace; font-weight: bold; color: var(--cor); }
        .conferencia .item .det { color: #374151; }

        .historico { max-height: 45vh; }
        .historico ul { list-style: none; margin: 0; }
        .historico li {
          padding: 8px 10px; margin-bottom: 8px; line-height: 1.45;
          background: #fff; border: 1px solid #e5e7eb; border-left: 4px solid var(--cor); border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0,0,0,.06);
        }
        .historico li:last-child { margin-bottom: 0; }
        .historico li .cod { font-family: Consolas, monospace; font-weight: bold; }
        .historico li .res { color: var(--cor); }
        .historico li .det { color: #6b7280; }
        .historico li .selo {
          display: inline-block; margin-top: 3px; padding: 1px 6px; border-radius: 4px;
          background: #b91c1c; color: #fff; font-size: 11px; font-weight: bold;
        }
      </style>
      <div class="balao" role="status" aria-live="polite">
        <button class="fechar" title="Fechar">×</button>
        <div class="cabecalho"></div>
        <div class="icone"></div>
        <div class="titulo"></div>
        <div class="etiqueta"></div>
        <table class="extras"></table>
        <div class="detalhe"></div>
        <ul class="lista"></ul>
        <div class="fila"></div>
      </div>
      <div class="paineis">
        <section class="painel conferencia">
          <header><span class="tit-conf">Conferência da proposta</span><span class="seta">▾</span></header>
          <div class="corpo"></div>
        </section>
        <section class="painel historico">
          <header><span>Etiquetas verificadas (<span class="qtd">0</span>)</span><span class="seta">▾</span></header>
          <ul class="corpo"></ul>
        </section>
      </div>
    `;

    const $ = (s) => raiz.querySelector(s);
    const balao = $('.balao');
    const historico = $('.historico');
    const conferencia = $('.conferencia');
    let timerOcultar = null;

    // Não roubar o foco do campo de etiquetas ao clicar nos elementos da extensão.
    raiz.addEventListener('mousedown', (e) => e.preventDefault());
    $('.fechar').addEventListener('click', () => ocultar());
    for (const painel of [historico, conferencia]) {
      painel.querySelector('header').addEventListener('click', () => {
        painel.classList.toggle('recolhido');
        painel.querySelector('.seta').textContent = painel.classList.contains('recolhido') ? '▸' : '▾';
      });
    }

    function anexar() {
      if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    }

    function aplicarEstilo(el, status) {
      const s = ESTILOS[status] || ESTILOS.erro;
      el.style.setProperty('--cor', s.cor);
      el.style.setProperty('--fundo', s.fundo);
      return s;
    }

    function htmlExtras(extras) {
      return (extras || []).map((e) =>
        `<tr><th>${escaparHtml(e.titulo)}:</th>` +
        (e.valor ? `<td>${escaparHtml(e.valor)}</td>` : '<td class="vazio">não encontrado</td>') +
        '</tr>'
      ).join('');
    }

    const CABECALHO_PADRAO = `Verificação: ${CONFIG.TEXTO_INTERACAO}`;
    const marcados = new Map(); // etiqueta -> <li> mais recente no histórico
    let modo = null; // 'etiqueta' ou 'comparacao'

    function mostrar({ status, titulo, codigo, detalhe, lista, extras, restantes, cabecalho }) {
      anexar();
      modo = cabecalho ? 'comparacao' : 'etiqueta';
      $('.cabecalho').textContent = cabecalho || CABECALHO_PADRAO;
      const s = aplicarEstilo(balao, status);
      $('.icone').innerHTML = status === 'consultando'
        ? `<span class="girando">${s.icone}</span>`
        : s.icone;
      $('.titulo').textContent = titulo;
      $('.etiqueta').innerHTML = codigo ? `Etiqueta: <b>${escaparHtml(codigo)}</b>` : '';
      $('.extras').innerHTML = htmlExtras(extras);
      $('.detalhe').textContent = detalhe || '';
      $('.lista').innerHTML = (lista || []).map((t, i) => `<li>${i + 1}. ${escaparHtml(t)}</li>`).join('');
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
      mostrarComparacao(r, { atualizarSeVisivel = false } = {}) {
        const visivel = balao.classList.contains('visivel') && modo === 'comparacao';
        if (atualizarSeVisivel && !visivel) return;
        mostrar({ ...r, cabecalho: 'Conferência da proposta de remessa' });
        if (CONFIG.TEMPO_BALAO_MS > 0 && r.status === 'proposta_ok') {
          timerOcultar = setTimeout(ocultar, CONFIG.TEMPO_BALAO_MS);
        }
      },
      atualizarConferencia({ invalidos, validos, total }) {
        anexar();
        const cartao = (i, status) =>
          `<div class="item" style="--cor:${ESTILOS[status].cor}"><span class="cod">${escaparHtml(i.codigo)}</span>` +
          `<div class="det">Produto: ${escaparHtml(i.produto)}</div>` +
          `<div class="det">Final: ${escaparHtml(i.final)}</div></div>`;
        conferencia.classList.add('ativo');
        conferencia.classList.toggle('falha', invalidos.length > 0);
        conferencia.classList.toggle('ok', invalidos.length === 0);
        $('.tit-conf').textContent = invalidos.length
          ? `Conferência da proposta: ${invalidos.length} de ${total} não entraram`
          : `Conferência da proposta: todas as ${total} entraram`;
        conferencia.querySelector('.corpo').innerHTML =
          (invalidos.length
            ? `<div class="secao nao">✖ Não entraram na proposta (${invalidos.length})</div>` +
              invalidos.map((i) => cartao(i, 'proposta_falha')).join('')
            : '') +
          (validos.length
            ? `<div class="secao sim">✔ Entraram na proposta (${validos.length})</div>` +
              validos.map((i) => cartao(i, 'proposta_ok')).join('')
            : '');
        const codigos = new Set(invalidos.map((i) => i.codigo));
        for (const [codigo, li] of marcados) {
          const selo = li.querySelector('.selo');
          if (codigos.has(codigo) && !selo) {
            li.insertAdjacentHTML('beforeend', '<div class="selo">NÃO APARECE NA PROPOSTA</div>');
          } else if (!codigos.has(codigo) && selo) {
            selo.remove();
          }
        }
      },
      atualizarFila(n) {
        if (balao.classList.contains('visivel') && modo === 'etiqueta') {
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
          (r.extras || []).filter((e) => e.valor)
            .map((e) => `<div class="det">${escaparHtml(e.titulo)}: ${escaparHtml(e.valor)}</div>`).join('') +
          (r.ocorrencias || []).map((o) => `<div class="det">Triagem: ${escaparHtml(o.data)} ${escaparHtml(o.hora)}</div>`).join('');
        const anterior = marcados.get(r.codigo);
        if (anterior && anterior.querySelector('.selo')) {
          li.insertAdjacentHTML('beforeend', '<div class="selo">NÃO APARECE NA PROPOSTA</div>');
        }
        marcados.set(r.codigo, li);
        const ul = historico.querySelector('ul');
        ul.prepend(li);
        while (ul.children.length > CONFIG.MAX_HISTORICO) {
          const ultimo = ul.lastElementChild;
          for (const [c, el] of marcados) if (el === ultimo) marcados.delete(c);
          ultimo.remove();
        }
        $('.qtd').textContent = ul.children.length;
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Destaque no campo de etiquetas (camada desenhada por cima do textarea)
  // ---------------------------------------------------------------------------
  const destaque = (() => {
    const host = document.createElement('div');
    host.id = 'kbm-triagem-destaque';
    host.style.cssText = 'all: initial; position: fixed; z-index: 999; pointer-events: none; display: none;';
    const raiz = host.attachShadow({ mode: 'open' });
    raiz.innerHTML = `
      <style>
        :host { all: initial; }
        .camada {
          position: absolute; inset: 0; overflow: hidden; box-sizing: border-box;
          border-style: solid; border-color: transparent; border-radius: 4px;
        }
        .camada.alerta { box-shadow: inset 0 0 0 2px #dc2626; }
        .conteudo { position: relative; }
        .linha { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
        .cod { color: transparent; }
        .invalida .cod { background: rgba(220, 38, 38, .30); box-shadow: 0 0 0 1px rgba(220, 38, 38, .8); border-radius: 2px; }
        .nota { color: #b91c1c; font-weight: bold; font-size: .85em; margin-left: .8em; }
      </style>
      <div class="camada"><div class="conteudo"></div></div>
    `;
    const camada = raiz.querySelector('.camada');
    const conteudo = raiz.querySelector('.conteudo');

    let notas = new Map(); // etiqueta -> texto exibido ao lado dela
    let assinatura = '';
    let rodando = false;

    function copiarEstilo(campo) {
      const cs = getComputedStyle(campo);
      for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textAlign',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']) {
        camada.style[prop] = cs[prop];
      }
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      camada.style.lineHeight = `${lh}px`;
      // Barra de rolagem vertical do textarea.
      const barra = campo.offsetWidth - campo.clientWidth
        - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      camada.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, barra)}px`;
      return lh;
    }

    function desenhar(campo) {
      const lh = copiarEstilo(campo);
      conteudo.style.transform = `translate(${-campo.scrollLeft}px, ${-campo.scrollTop}px)`;
      let algumaInvalida = false;
      conteudo.innerHTML = (campo.value || '').split('\n').map((linha) => {
        const chave = linha.replace(/[\r\t]/g, '').trim();
        const nota = chave && notas.get(chave);
        if (nota) algumaInvalida = true;
        const cod = `<span class="cod">${escaparHtml(linha.replace(/\r/g, '')) || ' '}</span>`;
        return nota
          ? `<div class="linha invalida" style="height:${lh}px">${cod}<span class="nota">⚠ ${escaparHtml(nota)}</span></div>`
          : `<div class="linha" style="height:${lh}px">${cod}</div>`;
      }).join('');
      camada.classList.toggle('alerta', algumaInvalida);
    }

    function quadro() {
      if (!notas.size) {
        rodando = false;
        host.style.display = 'none';
        return;
      }
      const campo = document.querySelector(CONFIG.SELETOR_CAMPO_ORIGEM);
      const r = campo && campo.getBoundingClientRect();
      if (!r || !r.width || !r.height) {
        host.style.display = 'none';
      } else {
        if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
        Object.assign(host.style, {
          display: 'block', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`,
        });
        const nova = [campo.value, campo.scrollTop, campo.scrollLeft, r.width, r.height].join('|');
        if (nova !== assinatura) {
          assinatura = nova;
          desenhar(campo);
        }
      }
      requestAnimationFrame(quadro);
    }

    return {
      definir(mapa) {
        notas = mapa;
        assinatura = '';
        if (notas.size && !rodando) {
          rodando = true;
          requestAnimationFrame(quadro);
        }
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Conferência: etiquetas bipadas x listagem gerada pelo botão #id_submit_button
  // ---------------------------------------------------------------------------
  function codigosDoCampo() {
    const campo = document.querySelector(CONFIG.SELETOR_CAMPO_ORIGEM);
    const lista = ((campo && campo.value) || '').split(/[\r\n\t]+/).map((c) => c.trim()).filter(Boolean);
    return Array.from(new Set(lista));
  }

  /** Etiquetas presentes na listagem, com Produto e Final da própria tabela. */
  function etiquetasDaListagem(container) {
    const validas = new Map(); // ETIQUETA (maiúscula) -> { produto, final }
    const tabela = container.querySelector('table');
    if (tabela) {
      const cabecalhos = Array.from(tabela.querySelectorAll('thead th, thead td')).map((th) => normalizar(th.textContent));
      const iEtiqueta = cabecalhos.indexOf('etiqueta');
      const iProduto = cabecalhos.indexOf('produto');
      const iFinal = cabecalhos.indexOf('final');
      for (const tr of tabela.querySelectorAll('tbody tr')) {
        const tds = tr.querySelectorAll(':scope > td, :scope > th');
        const cb = tr.querySelector('input[name="produto_serie_etiqueta[]"], input.checkbox-produto');
        const codigo = (iEtiqueta >= 0 && tds[iEtiqueta] ? textoLimpo(tds[iEtiqueta]) : '') || (cb && cb.value.trim()) || '';
        if (!codigo) continue;
        validas.set(codigo.toUpperCase(), {
          produto: iProduto >= 0 && tds[iProduto] ? textoLimpo(tds[iProduto]) : '',
          final: iFinal >= 0 && tds[iFinal] ? textoLimpo(tds[iFinal]) : '',
        });
      }
    }
    for (const cb of container.querySelectorAll('input[name="produto_serie_etiqueta[]"], input.checkbox-produto')) {
      const c = cb.value.trim().toUpperCase();
      if (c && !validas.has(c)) validas.set(c, { produto: '', final: '' });
    }
    return validas;
  }

  const valorExtra = (r, titulo) => {
    const e = r && (r.extras || []).find((x) => x.titulo === titulo);
    return (e && e.valor) || '';
  };

  const comparacao = (() => {
    let invalidas = [];
    let aprovadas = []; // [{ codigo, produto, final }] vindos da tabela da proposta
    let total = 0;

    function itensInvalidos() {
      return invalidas.map((codigo) => {
        const r = resultados.get(codigo);
        if (!r) {
          return { codigo, produto: 'consultando…', final: 'consultando…' };
        }
        return {
          codigo,
          produto: valorExtra(r, 'Produto') || 'não encontrado',
          final: valorExtra(r, 'Final') || 'não encontrado',
        };
      });
    }

    function render(apenasAtualizar) {
      const itens = itensInvalidos();
      destaque.definir(new Map(itens.map((i) => [i.codigo, `${i.produto} | Final: ${i.final}`])));
      ui.atualizarConferencia({ invalidos: itens, validos: aprovadas, total });
      if (!total) return;
      const r = itens.length
        ? {
            status: 'proposta_falha',
            titulo: `${itens.length} de ${total} etiqueta(s) não aparecem na proposta`,
            detalhe: 'Não atendem aos critérios da proposta de remessa:',
            lista: itens.map((i) => `${i.codigo} — ${i.produto} — Final: ${i.final}`),
          }
        : {
            status: 'proposta_ok',
            titulo: `Todas as ${total} etiqueta(s) aparecem na proposta`,
            detalhe: '',
          };
      ui.mostrarComparacao(r, { atualizarSeVisivel: apenasAtualizar });
    }

    return {
      comparar(container, bipadas) {
        const validas = etiquetasDaListagem(container);
        total = bipadas.length;
        invalidas = bipadas.filter((c) => !validas.has(c.toUpperCase()));
        aprovadas = bipadas.filter((c) => validas.has(c.toUpperCase())).map((codigo) => {
          const t = validas.get(codigo.toUpperCase());
          const r = resultados.get(codigo);
          return {
            codigo,
            produto: t.produto || valorExtra(r, 'Produto') || 'não encontrado',
            final: t.final || valorExtra(r, 'Final') || 'não encontrado',
          };
        });
        console.info('[Triagem RMA] Conferência da proposta:', { bipadas, validas: [...validas.keys()], invalidas });
        for (const c of invalidas) {
          if (!resultados.has(c) && !naFila(c)) enfileirar(c, { silencioso: true });
        }
        render(false);
      },
      /** Chamado quando chega o resultado de uma consulta (para preencher Produto/Final). */
      atualizar() {
        if (invalidas.length) render(true);
      },
    };
  })();

  // Detecta o clique no botão e o aparecimento/atualização da listagem.
  let aguardandoListagem = false;
  let bipadasNoClique = [];
  let assinaturaNoClique = null;
  let momentoClique = 0;
  let assinaturaListagem = null;
  let timerListagem = null;

  function verificarListagem() {
    const container = document.querySelector(CONFIG.SELETOR_LISTAGEM);
    if (!container) return;
    const texto = textoLimpo(container);
    if (!container.querySelector('table') && !/Exibindo\s+\d+/i.test(texto)) return;
    if (aguardandoListagem) {
      // Ainda é a listagem anterior ao clique: espera a nova (até 3 s; depois aceita a mesma).
      if (texto === assinaturaNoClique && Date.now() - momentoClique < 3000) {
        clearTimeout(timerListagem);
        timerListagem = setTimeout(verificarListagem, 500);
        return;
      }
    } else if (texto === assinaturaListagem) {
      return;
    }
    assinaturaListagem = texto;
    aguardandoListagem = false;
    const bipadas = codigosDoCampo();
    comparacao.comparar(container, bipadas.length ? bipadas : bipadasNoClique);
  }

  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest(CONFIG.SELETOR_BOTAO_VERIFICAR)) {
      const container = document.querySelector(CONFIG.SELETOR_LISTAGEM);
      aguardandoListagem = true;
      bipadasNoClique = codigosDoCampo();
      assinaturaNoClique = container ? textoLimpo(container) : null;
      momentoClique = Date.now();
      clearTimeout(timerListagem);
      timerListagem = setTimeout(verificarListagem, 400);
    }
  }, true);

  new MutationObserver(() => {
    clearTimeout(timerListagem);
    timerListagem = setTimeout(verificarListagem, 400);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Caso a página já abra com a listagem (envio sem AJAX).
  setTimeout(verificarListagem, 1000);

  console.info('[Triagem RMA] Extensão ativa na tela de Proposta de Remessa.');
})();
