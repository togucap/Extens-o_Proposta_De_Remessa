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

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (!msg || msg.tipo !== 'consultarPedidos') return false;
  obterDados(!!msg.forcar)
    .then((d) => {
      const resultados = {};
      for (const id of msg.ids || []) {
        const chave = normalizarId(id);
        resultados[id] = Object.prototype.hasOwnProperty.call(d.mapa, chave)
          ? { encontrado: true, ...d.mapa[chave] }
          : { encontrado: false };
      }
      responder({
        ok: true, resultados, atualizadoEm: d.atualizadoEm, geradoEm: d.geradoEm, totalLinhas: d.totalLinhas,
      });
    })
    .catch((e) => responder({ ok: false, erro: e.message || String(e), detalhes: e.detalhes || [] }));
  return true; // resposta assíncrona
});
