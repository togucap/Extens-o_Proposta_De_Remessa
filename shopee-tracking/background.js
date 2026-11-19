/*
 * Shopee - Status Tracking da Planilha (service worker)
 *
 * Baixa a aba da planilha em CSV (usando o login do Google que já está no
 * Chrome, ou o link público), monta o mapa Pedido_Parceiro -> Status tracking
 * e responde às consultas da página da Shopee. A planilha não é alterada e
 * nenhum Apps Script é usado.
 */
'use strict';

const CONFIG = {
  // Planilha: https://docs.google.com/spreadsheets/d/<PLANILHA_ID>/edit?gid=<ABA_GID>
  PLANILHA_ID: '1FApiWFY6neQ2yGlhA7adHp7ePL10naqmQJwv7RRHEUM',
  ABA_GID: '1831425043',

  // Nomes das colunas (cabeçalho da planilha).
  COLUNA_PEDIDO: 'Pedido_Parceiro',
  COLUNA_STATUS: 'Status tracking',

  // Colunas exibidas no pop-up (campo -> nome da coluna). Se faltar alguma, o pop-up avisa.
  COLUNAS_DETALHE: {
    dataOcorrencia: 'Data Ocorrencia',
    cidade: 'cidade ultima interação',
    dataPrevista: 'Data Prevista Entrega',
    autorizacao: 'Autorização Postagem',
    assistencia: 'Assistencia_Tecnica',
  },

  // Por quanto tempo os dados baixados são reaproveitados antes de baixar de novo.
  CACHE_MINUTOS: 5,
};

const urlCsv = () =>
  `https://docs.google.com/spreadsheets/d/${CONFIG.PLANILHA_ID}/export?format=csv&gid=${CONFIG.ABA_GID}`;

const normalizarId = (v) => String(v || '').trim().toUpperCase();
const normalizarCabecalho = (v) =>
  String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_]+/g, ' ').trim().toLowerCase();

/** Lê CSV (RFC 4180): campos entre aspas, aspas duplicadas, quebras de linha dentro do campo. */
function lerCsv(texto) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

/** Baixa a planilha e devolve { mapa: { ID: { status, ...detalhes } }, totalLinhas, atualizadoEm, colunasFaltando }. */
async function baixarPlanilha() {
  let resp;
  try {
    resp = await fetch(urlCsv(), { credentials: 'include', cache: 'no-store', redirect: 'follow' });
  } catch (e) {
    throw new Error('Falha de rede ao acessar a planilha.');
  }
  const tipo = resp.headers.get('content-type') || '';
  if (!resp.ok || /text\/html/i.test(tipo)) {
    throw new Error(
      'Sem acesso à planilha. Entre no Chrome com a conta Google que tem acesso a ela ' +
      'ou compartilhe a planilha como "Qualquer pessoa com o link".'
    );
  }

  const linhas = lerCsv(await resp.text());
  const alvoPedido = normalizarCabecalho(CONFIG.COLUNA_PEDIDO);
  const alvoStatus = normalizarCabecalho(CONFIG.COLUNA_STATUS);

  // O cabeçalho normalmente é a 1ª linha; procura nas 10 primeiras por segurança.
  let iCab = -1, iPedido = -1, iStatus = -1;
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const cab = linhas[i].map(normalizarCabecalho);
    if (cab.includes(alvoPedido) && cab.includes(alvoStatus)) {
      iCab = i; iPedido = cab.indexOf(alvoPedido); iStatus = cab.indexOf(alvoStatus);
      break;
    }
  }
  if (iCab < 0) {
    throw new Error(`Colunas "${CONFIG.COLUNA_PEDIDO}" e "${CONFIG.COLUNA_STATUS}" não encontradas na aba da planilha.`);
  }

  const cabecalho = linhas[iCab].map(normalizarCabecalho);
  const iDetalhe = {};
  const colunasFaltando = [];
  for (const [campo, nome] of Object.entries(CONFIG.COLUNAS_DETALHE)) {
    iDetalhe[campo] = cabecalho.indexOf(normalizarCabecalho(nome));
    if (iDetalhe[campo] < 0) colunasFaltando.push(nome);
  }

  const mapa = {};
  let totalLinhas = 0;
  for (let i = iCab + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const id = normalizarId(linha[iPedido]);
    if (!id) continue;
    totalLinhas++;
    const registro = { status: String(linha[iStatus] || '').trim() };
    for (const [campo, indice] of Object.entries(iDetalhe)) {
      registro[campo] = indice >= 0 ? String(linha[indice] || '').trim() : null; // null = coluna não existe
    }
    mapa[id] = registro;
  }
  return { mapa, totalLinhas, colunasFaltando, atualizadoEm: Date.now() };
}

// Cache em memória + chrome.storage.session (o service worker pode ser encerrado pelo Chrome).
let dados = null;
let baixando = null;

async function obterDados(forcar) {
  if (!dados) {
    try {
      const salvo = await chrome.storage.session.get('planilha');
      // Ignora cache salvo por versão anterior da extensão (sem as colunas do pop-up).
      if (salvo.planilha && salvo.planilha.colunasFaltando) dados = salvo.planilha;
    } catch (e) { /* sem cache salvo */ }
  }
  const valido = dados && Date.now() - dados.atualizadoEm < CONFIG.CACHE_MINUTOS * 60000;
  if (valido && !forcar) return dados;

  if (!baixando) {
    baixando = baixarPlanilha()
      .then(async (novo) => {
        dados = novo;
        try { await chrome.storage.session.set({ planilha: novo }); } catch (e) { /* cache opcional */ }
        return novo;
      })
      .finally(() => { baixando = null; });
  }
  return baixando;
}

// Cache salvo por uma versão anterior da extensão guardava só o texto do status.
const normalizarRegistro = (r) => (typeof r === 'string' ? { status: r } : r);

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (!msg || msg.tipo !== 'consultarPedidos') return false;
  obterDados(!!msg.forcar)
    .then((d) => {
      const resultados = {};
      for (const id of msg.ids || []) {
        const chave = normalizarId(id);
        resultados[id] = Object.prototype.hasOwnProperty.call(d.mapa, chave)
          ? { encontrado: true, ...normalizarRegistro(d.mapa[chave]) }
          : { encontrado: false };
      }
      responder({
        ok: true, resultados, atualizadoEm: d.atualizadoEm, totalLinhas: d.totalLinhas,
        colunasFaltando: d.colunasFaltando || [],
      });
    })
    .catch((e) => responder({ ok: false, erro: e.message || String(e) }));
  return true; // resposta assíncrona
});
