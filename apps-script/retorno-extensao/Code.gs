/**
 * Retorno da Extensão Shopee  →  JSON no Google Drive
 *
 * App da Web (Apps Script SEPARADO da planilha) que recebe dados enviados pela
 * extensão do Chrome e grava/atualiza o arquivo "Retorno_Extensao_Shopee" numa pasta
 * do Drive. A planilha base lê esse arquivo.
 *
 * Publicação: Implantar → Nova implantação → App da Web
 *   - Executar como: Eu (dono do script)
 *   - Quem pode acessar: Qualquer pessoa em <empresa>   (somente contas do domínio)
 *
 * Envio esperado (POST, corpo JSON):
 *   {
 *     "versao": 1,
 *     "origem": "shopee-retornos",
 *     "pedidos": [ { "pedido": "261103BKH9YCYG" }, ... ]   // outros campos podem vir depois
 *   }
 *
 * Pedidos enviados com "situacao": "Encontrado" (passaram a existir na base) são REMOVIDOS
 * do arquivo, que guarda só os "Não encontrado".
 *
 * Arquivo gerado (um registro por pedido, atualizado a cada envio):
 *   {
 *     "versao": 1,
 *     "atualizadoEm": "2026-11-24T10:15:00-03:00",
 *     "totalPedidos": 2,
 *     "pedidos": {
 *       "261103BKH9YCYG": { "pedido": "261103BKH9YCYG", "origem": "shopee-retornos",
 *         "primeiroEnvio": "...", "ultimoEnvio": "...", "enviadoPor": "usuario@empresa.com.br" }
 *     }
 *   }
 */

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
var CONFIG = {
  // ID da pasta do Drive onde o arquivo será gravado (parte final do link da pasta:
  // https://drive.google.com/drive/folders/<ID>).
  PASTA_ID: 'COLE_AQUI_O_ID_DA_PASTA',

  // Nome do arquivo gerado na pasta.
  NOME_ARQUIVO: 'Retorno_Extensao_Shopee',

  // Limites de segurança por envio.
  MAX_PEDIDOS_POR_ENVIO: 500,
  MAX_CAMPOS_POR_PEDIDO: 30,
  MAX_TAMANHO_VALOR: 500,

  // Campos controlados pelo script (a extensão não consegue sobrescrever).
  CAMPOS_RESERVADOS: ['pedido', 'origem', 'primeiroEnvio', 'ultimoEnvio', 'enviadoPor'],
};

var VERSAO_FORMATO = 1;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET: verificação rápida (abra a URL /exec no navegador para testar o acesso). */
function doGet() {
  return responder_({
    ok: true,
    servico: 'retorno-extensao',
    versao: VERSAO_FORMATO,
    usuario: emailUsuario_(),
    agora: agoraIso_(),
  });
}

/** POST: recebe os pedidos enviados pela extensão e atualiza o arquivo. */
function doPost(e) {
  try {
    var envio = lerEnvio_(e);
    var resultado = gravarPedidos_(envio);
    return responder_(resultado);
  } catch (erro) {
    console.error(erro && erro.stack ? erro.stack : erro);
    return responder_({ ok: false, erro: String(erro && erro.message ? erro.message : erro) });
  }
}

// ---------------------------------------------------------------------------
// Validação do envio
// ---------------------------------------------------------------------------
function lerEnvio_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Envio vazio.');

  var corpo;
  try {
    corpo = JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('O corpo do envio não é um JSON válido.');
  }
  if (!corpo || !Array.isArray(corpo.pedidos)) throw new Error('O envio precisa ter a lista "pedidos".');
  if (corpo.pedidos.length === 0) throw new Error('A lista "pedidos" está vazia.');
  if (corpo.pedidos.length > CONFIG.MAX_PEDIDOS_POR_ENVIO) {
    throw new Error('Máximo de ' + CONFIG.MAX_PEDIDOS_POR_ENVIO + ' pedidos por envio.');
  }

  var origem = texto_(corpo.origem || 'extensao').slice(0, 60);
  var pedidos = [];
  var invalidos = [];

  corpo.pedidos.forEach(function (item, i) {
    // Aceita tanto { "pedido": "ID" } quanto apenas "ID".
    var dados = typeof item === 'string' ? { pedido: item } : item;
    if (!dados || typeof dados !== 'object') { invalidos.push(i); return; }

    var id = normalizarId_(dados.pedido);
    if (!/^[A-Z0-9_-]{4,40}$/.test(id)) { invalidos.push(i); return; }

    var campos = {};
    var qtd = 0;
    Object.keys(dados).forEach(function (chave) {
      if (CONFIG.CAMPOS_RESERVADOS.indexOf(chave) >= 0) return;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(chave)) return;
      if (qtd >= CONFIG.MAX_CAMPOS_POR_PEDIDO) return;
      var valor = dados[chave];
      if (valor === null || valor === undefined) return;
      if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') return;
      campos[chave] = typeof valor === 'string' ? valor.trim().slice(0, CONFIG.MAX_TAMANHO_VALOR) : valor;
      qtd++;
    });

    pedidos.push({ id: id, campos: campos });
  });

  if (!pedidos.length) throw new Error('Nenhum pedido válido no envio.');
  return { origem: origem, pedidos: pedidos, invalidos: invalidos };
}

// ---------------------------------------------------------------------------
// Gravação no Drive
// ---------------------------------------------------------------------------
function gravarPedidos_(envio) {
  // Evita que dois envios simultâneos sobrescrevam um ao outro.
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(30000)) throw new Error('Servidor ocupado, tente de novo em instantes.');

  try {
    var arquivo = obterArquivo_();
    var atual = lerArquivo_(arquivo);
    var agora = agoraIso_();
    var usuario = emailUsuario_();
    var novos = 0;
    var atualizados = 0;

    var removidos = 0;

    // O arquivo guarda só pedidos "Não encontrado": registros "Encontrado" antigos são removidos.
    Object.keys(atual.pedidos).forEach(function (id) {
      if (ehEncontrado_(atual.pedidos[id] && atual.pedidos[id].situacao)) {
        delete atual.pedidos[id];
        removidos++;
      }
    });

    envio.pedidos.forEach(function (p) {
      // Pedido que passou a existir na base: sai do arquivo.
      if (ehEncontrado_(p.campos.situacao)) {
        if (atual.pedidos[p.id]) {
          delete atual.pedidos[p.id];
          removidos++;
        }
        return;
      }
      var registro = atual.pedidos[p.id];
      if (!registro) {
        registro = { pedido: p.id, primeiroEnvio: agora };
        atual.pedidos[p.id] = registro;
        novos++;
      } else {
        atualizados++;
      }
      Object.keys(p.campos).forEach(function (chave) { registro[chave] = p.campos[chave]; });
      registro.origem = envio.origem;
      registro.ultimoEnvio = agora;
      registro.enviadoPor = usuario;
    });

    atual.versao = VERSAO_FORMATO;
    atual.atualizadoEm = agora;
    atual.totalPedidos = Object.keys(atual.pedidos).length;

    // Atualiza o MESMO arquivo (o ID não muda).
    arquivo.setContent(JSON.stringify(atual, null, 2));

    return {
      ok: true,
      recebidos: envio.pedidos.length,
      novos: novos,
      atualizados: atualizados,
      removidos: removidos,
      ignorados: envio.invalidos.length,
      totalPedidos: atual.totalPedidos,
      arquivoId: arquivo.getId(),
      atualizadoEm: agora,
    };
  } finally {
    trava.releaseLock();
  }
}

/** Encontra o arquivo na pasta pelo nome; cria se não existir. */
function obterArquivo_() {
  if (!CONFIG.PASTA_ID || CONFIG.PASTA_ID === 'COLE_AQUI_O_ID_DA_PASTA') {
    throw new Error('Configure CONFIG.PASTA_ID no script com o ID da pasta do Drive.');
  }
  var pasta = DriveApp.getFolderById(CONFIG.PASTA_ID);
  var nomes = [CONFIG.NOME_ARQUIVO, CONFIG.NOME_ARQUIVO + '.json'];
  for (var i = 0; i < nomes.length; i++) {
    var it = pasta.getFilesByName(nomes[i]);
    if (it.hasNext()) return it.next();
  }
  var vazio = { versao: VERSAO_FORMATO, atualizadoEm: agoraIso_(), totalPedidos: 0, pedidos: {} };
  return pasta.createFile(Utilities.newBlob(JSON.stringify(vazio, null, 2), 'application/json', CONFIG.NOME_ARQUIVO));
}

function lerArquivo_(arquivo) {
  var texto = arquivo.getBlob().getDataAsString('UTF-8').replace(/^﻿/, '');
  if (!texto.trim()) return { pedidos: {} };
  try {
    var json = JSON.parse(texto);
    if (!json || typeof json.pedidos !== 'object' || Array.isArray(json.pedidos)) json = { pedidos: {} };
    return json;
  } catch (err) {
    // Não apaga um arquivo corrompido: guarda uma cópia e começa de novo.
    arquivo.makeCopy(CONFIG.NOME_ARQUIVO + '_corrompido_' + Date.now());
    return { pedidos: {} };
  }
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** "Encontrado" (pedido que existe na base). */
function ehEncontrado_(situacao) {
  return texto_(situacao).toLowerCase() === 'encontrado';
}

function normalizarId_(v) {
  return texto_(v).toUpperCase();
}

function texto_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function agoraIso_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function emailUsuario_() {
  try {
    return Session.getActiveUser().getEmail() || 'desconhecido';
  } catch (err) {
    return 'desconhecido';
  }
}

// ---------------------------------------------------------------------------
// Teste manual (rode no editor: selecione "testarGravacao" e clique em Executar)
// Na primeira execução o Google pede autorização de acesso ao Drive.
// ---------------------------------------------------------------------------
function testarGravacao() {
  var resposta = doPost({
    postData: {
      contents: JSON.stringify({ versao: 1, origem: 'teste-editor', pedidos: [{ pedido: 'TESTE123456' }] }),
    },
  });
  console.log(resposta.getContent());
}
