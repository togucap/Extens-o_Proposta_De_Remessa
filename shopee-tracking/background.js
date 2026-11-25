/*
 * Shopee - Status Tracking (service worker)
 *
 * Lê o arquivo JSON "Payload_Tracking" gerado a partir da planilha e salvo numa
 * pasta do Google Drive. A planilha NÃO é acessada: só o arquivo JSON, que deve
 * estar compartilhado com as contas da empresa. O acesso usa o login do Google
 * que já está no Chrome.
 *
 * Formato esperado (campos extras são ignorados):
 *   { "versao": 1, "geradoEm": "2026-11-19T13:43:02-03:00", "totalPedidos": 4573,
 *     "pedidos": { "<ID do pedido>": { "status", "dataOcorrencia", "cidade",
 *                  "dataPrevista", "autorizacao", "assistencia": "Sim" | "Não" } } }
 *
 * Retorno para a base: os pedidos que aparecem como "Não encontrado" (com o Status da
 * solicitação e o prazo "Vence em …" lidos da tela) entram numa
 * fila e são enviados periodicamente (RETORNO_INTERVALO_MINUTOS) ao App da Web
 * intermediário (apps-script/retorno-extensao), que grava o JSON Retorno_Extensao_Shopee
 * no Drive. Cada pedido é enviado uma vez (reenvio só se a situação mudar ou após
 * RETORNO_REENVIO_DIAS).
 */
'use strict';

const CONFIG = {
  // Pasta do Drive onde o arquivo é salvo e nome do arquivo.
  PASTA_ID: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe',
  NOME_ARQUIVO: 'Payload_Tracking',

  // Opcional: ID do próprio arquivo (do link .../file/d/<ID>/...). Se vazio, a
  // extensão procura o arquivo pelo nome dentro da pasta.
  ARQUIVO_ID: '1OBbG1ufaCTdb5lSvcuViTQ1UJUvMdobX',

  // Por quanto tempo o JSON baixado é reaproveitado antes de baixar de novo.
  CACHE_MINUTOS: 5,

  // Contas do Google logadas no Chrome que serão tentadas (0 = primeira conta).
  CONTAS_GOOGLE: [0, 1, 2, 3],

  // App da Web que recebe os pedidos "Não encontrado" (apps-script/retorno-extensao).
  RETORNO_URL: 'https://script.google.com/a/macros/kabum.com.br/s/AKfycbxWBUjOxhiS1LO36L6xF3C9HZu7mQ4nhCn9BhZsCApJDnQWRdPykIMoxSfrL9cwZynY/exec',
  RETORNO_ORIGEM: 'shopee-retornos',
  // De quanto em quanto tempo a fila é enviada.
  RETORNO_INTERVALO_MINUTOS: 10,
  // Um pedido já enviado só é enviado de novo se a situação mudar ou depois deste prazo.
  RETORNO_REENVIO_DIAS: 7,
  // Máximo de pedidos por requisição (o App da Web aceita até 500).
  RETORNO_LOTE: 400,
};

const CAMPOS = ['status', 'dataOcorrencia', 'cidade', 'dataPrevista', 'autorizacao', 'assistencia'];
const normalizarId = (v) => String(v || '').trim().toUpperCase();

const ERRO_ACESSO =
  'Sem acesso ao arquivo de tracking. Entre no Chrome com a sua conta Google da empresa ' +
  '(a mesma com que o arquivo foi compartilhado) e tente de novo.';

function decodificarHtml(t) {
  return String(t)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

// Registro de cada tentativa (mostrado no pop-up em "Detalhes técnicos" quando dá erro).
let tentativas = [];

function registrar(url, info) {
  const u = new URL(url);
  const destino = info.final ? new URL(info.final) : null;
  const linha = `${u.host}${u.pathname.replace(/\/d\/[\w-]+/, '/d/…')} authuser=${u.searchParams.get('authuser')} → ` +
    (info.erro ? `falha de rede (${info.erro})`
      : `HTTP ${info.status} ${info.tipo.split(';')[0] || 'sem tipo'}` +
        (destino && destino.host !== u.host ? ` via ${destino.host}${destino.pathname}` : '') +
        (info.amostra ? ` "${info.amostra}"` : ''));
  tentativas.push(linha);
  console.info('[Tracking Shopee]', linha);
}

async function baixarTexto(url) {
  let resp;
  try {
    resp = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
  } catch (e) {
    registrar(url, { erro: e.message || String(e) });
    return { ok: false, status: 0, tipo: '', texto: '' };
  }
  const tipo = resp.headers.get('content-type') || '';
  const texto = await resp.text();
  const amostra = texto.replace(/\s+/g, ' ').trim().slice(0, 60);
  registrar(url, { status: resp.status, tipo, final: resp.url, amostra });
  return { ok: resp.ok, status: resp.status, tipo, texto };
}

// ---------------------------------------------------------------------------
// Localiza o arquivo na pasta (pelo nome)
// ---------------------------------------------------------------------------
async function localizarArquivo(conta) {
  const url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(CONFIG.PASTA_ID)}&authuser=${conta}`;
  const r = await baixarTexto(url);
  if (!r.ok || !/flip-entry/.test(r.texto)) return null; // sem acesso à pasta com esta conta

  const alvo = CONFIG.NOME_ARQUIVO.toLowerCase();
  const encontrados = [];
  // Cada arquivo da pasta é um bloco "flip-entry" com link e título.
  for (const trecho of r.texto.split(/<div[^>]*class="flip-entry"/).slice(1)) {
    const titulo = /class="flip-entry-title"[^>]*>([\s\S]*?)<\/div>/.exec(trecho);
    const href = /href="([^"]+)"/.exec(trecho);
    const id = (/id="entry-([\w-]+)"/.exec(trecho) || /\/d\/([\w-]+)/.exec(href ? href[1] : '') || [])[1];
    if (!titulo || !id) continue;
    const nome = decodificarHtml(titulo[1].replace(/<[^>]+>/g, '')).toLowerCase();
    if (nome === alvo || nome === `${alvo}.json` || nome === `${alvo}.txt`) {
      encontrados.push({ id, documento: !!href && /docs\.google\.com\/document\//.test(href[1]) });
    }
  }
  if (!encontrados.length) {
    throw new Error(`Arquivo "${CONFIG.NOME_ARQUIVO}" não encontrado na pasta do Drive.`);
  }
  if (encontrados.length > 1) {
    console.warn(`[Tracking Shopee] ${encontrados.length} arquivos "${CONFIG.NOME_ARQUIVO}" na pasta; usando o primeiro.`);
  }
  return encontrados[0];
}

// ---------------------------------------------------------------------------
// Baixa e interpreta o JSON
// ---------------------------------------------------------------------------
/** Endereços de download tentados, em ordem. */
function urlsDownload(arquivo, conta) {
  const id = encodeURIComponent(arquivo.id);
  if (arquivo.documento) return [`https://docs.google.com/document/d/${id}/export?format=txt&authuser=${conta}`];
  return [
    `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=${conta}`,
    `https://drive.google.com/uc?export=download&id=${id}&authuser=${conta}`,
    `https://docs.google.com/uc?export=download&id=${id}&authuser=${conta}`,
  ];
}

function interpretar(texto) {
  let json;
  try {
    json = JSON.parse(texto.replace(/^﻿/, ''));
  } catch (e) {
    return null;
  }
  if (!json || typeof json.pedidos !== 'object' || json.pedidos === null) return null;

  const mapa = {};
  for (const [id, p] of Object.entries(json.pedidos)) {
    const chave = normalizarId(id);
    if (!chave || !p || typeof p !== 'object') continue;
    const registro = {};
    for (const campo of CAMPOS) registro[campo] = p[campo] === undefined || p[campo] === null ? '' : String(p[campo]).trim();
    mapa[chave] = registro;
  }
  return { mapa, totalLinhas: Object.keys(mapa).length, geradoEm: json.geradoEm || null };
}

/** Tenta baixar o arquivo com as contas do Chrome; devolve os dados ou null se nenhuma tem acesso. */
async function baixarArquivo(arquivo, contas) {
  let formatoInvalido = false;
  for (const conta of contas) {
    for (const url of urlsDownload(arquivo, conta)) {
      const r = await baixarTexto(url);
      if (!r.ok) continue;
      const dados = interpretar(r.texto);
      if (dados) return { dados, conta };
      if (!/text\/html/i.test(r.tipo)) formatoInvalido = true;
    }
  }
  if (formatoInvalido) {
    throw new Error(`O arquivo "${CONFIG.NOME_ARQUIVO}" foi baixado, mas não está no formato JSON esperado (precisa ter "pedidos").`);
  }
  return null;
}

async function carregarPayload() {
  tentativas = [];
  try {
    return await carregarPayloadInterno();
  } catch (e) {
    e.detalhes = tentativas.slice(-16);
    throw e;
  }
}

async function carregarPayloadInterno() {
  const { descoberta } = await chrome.storage.local.get('descoberta').catch(() => ({}));
  const contaSalva = descoberta && Number.isInteger(descoberta.conta) ? descoberta.conta : null;
  const contas = contaSalva === null ? CONFIG.CONTAS_GOOGLE : [contaSalva, ...CONFIG.CONTAS_GOOGLE.filter((c) => c !== contaSalva)];

  // 1) Arquivo já conhecido (configurado ou descoberto antes).
  const conhecido = CONFIG.ARQUIVO_ID
    ? { id: CONFIG.ARQUIVO_ID, documento: false }
    : descoberta && descoberta.arquivo;
  if (conhecido) {
    const r = await baixarArquivo(conhecido, contas);
    if (r) {
      await chrome.storage.local.set({ descoberta: { arquivo: conhecido, conta: r.conta } }).catch(() => {});
      return r.dados;
    }
  }

  // 2) Procura na pasta (o arquivo pode ter sido recriado com outro ID).
  for (const conta of contas) {
    const arquivo = await localizarArquivo(conta);
    if (!arquivo) continue;
    const r = await baixarArquivo(arquivo, [conta, ...contas.filter((c) => c !== conta)]);
    if (r) {
      await chrome.storage.local.set({ descoberta: { arquivo, conta: r.conta } }).catch(() => {});
      return r.dados;
    }
  }
  throw new Error(ERRO_ACESSO);
}

// ---------------------------------------------------------------------------
// Cache em memória + chrome.storage.session (o service worker pode ser encerrado)
// ---------------------------------------------------------------------------
let dados = null;
let baixando = null;

async function obterDados(forcar) {
  if (!dados) {
    try {
      const salvo = await chrome.storage.session.get('payload');
      if (salvo.payload) dados = salvo.payload;
    } catch (e) { /* sem cache salvo */ }
  }
  const valido = dados && Date.now() - dados.atualizadoEm < CONFIG.CACHE_MINUTOS * 60000;
  if (valido && !forcar) return dados;

  if (!baixando) {
    baixando = carregarPayload()
      .then(async (novo) => {
        dados = { ...novo, atualizadoEm: Date.now() };
        try { await chrome.storage.session.set({ payload: dados }); } catch (e) { /* cache opcional */ }
        return dados;
      })
      .finally(() => { baixando = null; });
  }
  return baixando;
}


// ---------------------------------------------------------------------------
// Retorno para a base: fila de pedidos "Não encontrado" enviada periodicamente
// ---------------------------------------------------------------------------
const SITUACAO_NAO = 'Não encontrado';
const SITUACAO_SIM = 'Encontrado';
const DIA = 86400000;

// Serializa leituras/gravações do estado (várias abas podem consultar ao mesmo tempo).
let travaRetorno = Promise.resolve();
function comTravaRetorno(fn) {
  const r = travaRetorno.then(fn, fn);
  travaRetorno = r.catch(() => {});
  return r;
}

// Versão do conteúdo enviado. Ao mudar (ex.: novos campos), a memória de "já enviados" é
// zerada e todos os pedidos são enviados de novo com os campos novos.
const FORMATO_RETORNO = 2;

async function lerRetorno() {
  const { retorno } = await chrome.storage.local.get('retorno').catch(() => ({}));
  if (retorno && retorno.formato === FORMATO_RETORNO) return retorno;
  return { formato: FORMATO_RETORNO, pendentes: {}, enviados: {}, ultimoEnvio: null, ultimoErro: null };
}
const salvarRetorno = (estado) => chrome.storage.local.set({ retorno: estado }).catch(() => {});

const doisDigitos = (n) => String(n).padStart(2, '0');

/** Data/hora local no formato 2026-11-25T21:30:00-03:00. */
function isoLocal(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}T` +
    `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:00` +
    `${sinal}${doisDigitos(Math.floor(Math.abs(off) / 60))}:${doisDigitos(Math.abs(off) % 60)}`;
}

/** "Vence em 6 horas" -> { unidade: 'horas', venceAprox: agora + 6 h }. */
function lerPrazo(prazo, agora) {
  const m = /vence em\s+(\d+)\s*(minuto|minutos|min|hora|horas|h|dia|dias|d)\b/i.exec(String(prazo || ''));
  if (!m) return { unidade: prazo ? 'outro' : '', venceAprox: '' };
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const ms = u.startsWith('d') ? n * DIA : u.startsWith('h') ? n * 3600000 : n * 60000;
  return { unidade: u.startsWith('d') ? 'dias' : u.startsWith('h') ? 'horas' : 'minutos', venceAprox: isoLocal(agora + ms) };
}

/**
 * Coloca na fila os "Não encontrado" (com Status da solicitação e prazo "Vence em …") e
 * corrige os que passaram a existir na base.
 * itens: [{ id, encontrado, statusSolicitacao, prazo }]
 *
 * Um pedido só volta para a fila se mudar a situação, o Status da solicitação, se o prazo
 * aparecer/sumir ou mudar de unidade (dias -> horas), ou após RETORNO_REENVIO_DIAS.
 * Assim "Vence em 6 horas" -> "5 horas" não gera um novo envio (a planilha usa venceAprox).
 */
function registrarParaRetorno(itens) {
  return comTravaRetorno(async () => {
    const estado = await lerRetorno();
    const agora = Date.now();
    let mudou = false;
    for (const it of itens) {
      const chave = normalizarId(it.id);
      if (!chave) continue;
      const enviado = estado.enviados[chave];
      const pendente = estado.pendentes[chave];

      let situacao;
      if (!it.encontrado) situacao = SITUACAO_NAO;
      else if ((enviado && enviado.situacao === SITUACAO_NAO) || (pendente && pendente.situacao === SITUACAO_SIM)) situacao = SITUACAO_SIM;
      else {
        if (pendente) { delete estado.pendentes[chave]; mudou = true; } // entrou na base antes de ser enviado
        continue;
      }

      const statusSolicitacao = String(it.statusSolicitacao || '').trim();
      const prazo = String(it.prazo || '').trim();
      const { unidade, venceAprox } = lerPrazo(prazo, agora);
      const impressao = [situacao, statusSolicitacao, unidade].join('|');
      const precisa = !enviado || enviado.impressao !== impressao ||
        // Verificação completa (botão "Verificar todas as páginas"): envia todos os não encontrados.
        (situacao === SITUACAO_NAO && it.forcar) ||
        (situacao === SITUACAO_NAO && agora - enviado.em > CONFIG.RETORNO_REENVIO_DIAS * DIA);

      if (!precisa) {
        if (pendente) { delete estado.pendentes[chave]; mudou = true; }
        continue;
      }
      if (!pendente || pendente.impressao !== impressao || pendente.prazo !== prazo || it.forcar) {
        estado.pendentes[chave] = {
          situacao, statusSolicitacao, prazo,
          // Mantém a estimativa anterior se só o número mudou (evita oscilar a cada leitura).
          venceAprox: pendente && pendente.impressao === impressao && pendente.venceAprox ? pendente.venceAprox : venceAprox,
          impressao, vistoEm: agora,
        };
        mudou = true;
      }
    }
    if (mudou) await salvarRetorno(estado);
    return estado;
  });
}

/** Situação de envio de um pedido (mostrada no pop-up). */
function situacaoRetorno(estado, id) {
  const chave = normalizarId(id);
  const p = estado.pendentes[chave];
  const e = estado.enviados[chave];
  const base = { intervalo: CONFIG.RETORNO_INTERVALO_MINUTOS, erro: estado.ultimoErro ? estado.ultimoErro.mensagem : null };
  if (p) return { ...base, estado: 'pendente' };
  if (e) return { ...base, estado: 'enviado', em: e.em, erro: null };
  return null;
}

async function postarRetorno(pedidos) {
  const { descoberta } = await chrome.storage.local.get('descoberta').catch(() => ({}));
  const salva = descoberta && Number.isInteger(descoberta.conta) ? descoberta.conta : null;
  const contas = salva === null ? CONFIG.CONTAS_GOOGLE : [salva, ...CONFIG.CONTAS_GOOGLE.filter((c) => c !== salva)];
  const corpo = JSON.stringify({ versao: 1, origem: CONFIG.RETORNO_ORIGEM, pedidos });
  let ultimo = 'sem resposta';

  for (const conta of contas) {
    const url = `${CONFIG.RETORNO_URL}${CONFIG.RETORNO_URL.includes('?') ? '&' : '?'}authuser=${conta}`;
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: corpo,
      });
    } catch (e) {
      throw new Error('Falha de rede ao enviar para a base.');
    }
    const texto = await resp.text();
    let json = null;
    try { json = JSON.parse(texto); } catch (e) { /* página HTML (login/sem permissão) */ }
    if (json && json.ok) return json;
    if (json && json.erro) throw new Error(`App da Web: ${json.erro}`); // chegou ao app, mas ele recusou
    ultimo = `HTTP ${resp.status} ${texto.replace(/\s+/g, ' ').slice(0, 60)}`;
    console.info('[Tracking Shopee] envio com authuser', conta, '→', ultimo);
  }
  throw new Error(`Sem acesso ao App da Web (entre no Chrome com a conta da empresa). Última resposta: ${ultimo}`);
}

/** Envia a fila ao App da Web (em lotes). Pedidos que falharem continuam na fila. */
function enviarPendentes() {
  return comTravaRetorno(async () => {
    const estado = await lerRetorno();
    const ids = Object.keys(estado.pendentes);
    if (!ids.length) return { enviados: 0 };

    let total = 0;
    try {
      for (let i = 0; i < ids.length; i += CONFIG.RETORNO_LOTE) {
        const lote = ids.slice(i, i + CONFIG.RETORNO_LOTE);
        await postarRetorno(lote.map((id) => {
          const p = estado.pendentes[id];
          return {
            pedido: id,
            situacao: p.situacao,
            statusSolicitacao: p.statusSolicitacao || '',
            prazo: p.prazo || '',
            venceAprox: p.venceAprox || '',
          };
        }));
        const agora = Date.now();
        for (const id of lote) {
          estado.enviados[id] = { situacao: estado.pendentes[id].situacao, impressao: estado.pendentes[id].impressao, em: agora };
          delete estado.pendentes[id];
        }
        total += lote.length;
        estado.ultimoEnvio = agora;
        estado.ultimoErro = null;
        await salvarRetorno(estado);
      }
    } catch (e) {
      estado.ultimoErro = { mensagem: e.message || String(e), em: Date.now() };
      console.warn('[Tracking Shopee] Falha ao enviar retorno:', estado.ultimoErro.mensagem);
    }

    // Esquece envios antigos (serão reenviados se o pedido aparecer de novo como não encontrado).
    const limite = Date.now() - Math.max(30, CONFIG.RETORNO_REENVIO_DIAS * 2) * DIA;
    for (const [id, e] of Object.entries(estado.enviados)) if (e.em < limite) delete estado.enviados[id];
    await salvarRetorno(estado);
    if (total) console.info(`[Tracking Shopee] ${total} pedido(s) enviados para a base.`);
    return { enviados: total };
  });
}

// Envio periódico.
const ALARME_RETORNO = 'enviarRetorno';
function garantirAlarme() {
  chrome.alarms.get(ALARME_RETORNO, (a) => {
    if (!a || a.periodInMinutes !== CONFIG.RETORNO_INTERVALO_MINUTOS) {
      chrome.alarms.create(ALARME_RETORNO, { periodInMinutes: CONFIG.RETORNO_INTERVALO_MINUTOS });
    }
  });
}
chrome.runtime.onInstalled.addListener(garantirAlarme);
chrome.runtime.onStartup.addListener(garantirAlarme);
garantirAlarme();
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARME_RETORNO) enviarPendentes(); });

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg && msg.tipo === 'enviarRetornoAgora') {
    enviarPendentes()
      .then(async (r) => {
        const estado = await lerRetorno();
        responder({ ok: true, ...r, erro: estado.ultimoErro && Object.keys(estado.pendentes).length ? estado.ultimoErro.mensagem : null });
      })
      .catch((e) => responder({ ok: false, erro: e.message || String(e) }));
    return true;
  }
  if (msg && msg.tipo === 'registrarRetorno') {
    registrarParaRetorno(Array.isArray(msg.itens) ? msg.itens : [])
      .then(() => responder({ ok: true }))
      .catch((e) => responder({ ok: false, erro: e.message || String(e) }));
    return true;
  }
  if (msg && msg.tipo === 'statusRetorno') {
    lerRetorno().then((estado) => responder({ ok: true, retorno: situacaoRetorno(estado, msg.id) }));
    return true;
  }
  if (!msg || msg.tipo !== 'consultarPedidos') return false;
  if (msg.forcar) enviarPendentes(); // "Atualizar dados" também envia a fila na hora
  obterDados(!!msg.forcar)
    .then(async (d) => {
      const resultados = {};
      for (const id of msg.ids || []) {
        const chave = normalizarId(id);
        resultados[id] = Object.prototype.hasOwnProperty.call(d.mapa, chave)
          ? { encontrado: true, ...d.mapa[chave] }
          : { encontrado: false };
      }
      try {
        const estado = await lerRetorno();
        for (const [id, r] of Object.entries(resultados)) {
          if (!r.encontrado) r.retorno = situacaoRetorno(estado, id);
        }
      } catch (e) { /* situação de envio é opcional */ }
      responder({
        ok: true, resultados, atualizadoEm: d.atualizadoEm, geradoEm: d.geradoEm, totalLinhas: d.totalLinhas,
      });
    })
    .catch((e) => responder({ ok: false, erro: e.message || String(e), detalhes: e.detalhes || [] }));
  return true; // resposta assíncrona
});
