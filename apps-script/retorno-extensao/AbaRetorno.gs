/**
 * Abastece a aba "Retorno_Extensão" da planilha base com os pedidos do JSON
 * Retorno_Extensao_Shopee (colunas: pedido | situacao | prazo | origem).
 *
 * - Roda automaticamente logo após cada envio da extensão (doPost), com os mesmos dados
 *   gravados no JSON.
 * - Também pode ser rodada manualmente: selecione "sincronizarAbaRetorno" e clique em Executar
 *   (lê o JSON do Drive e reescreve a aba).
 *
 * Só as colunas A:D da aba são escritas; outras colunas (ex.: fórmulas suas) não são tocadas.
 */

var CONFIG_ABA = {
  // Planilha base (parte do link: https://docs.google.com/spreadsheets/d/<ID>/edit).
  PLANILHA_ID: '1FApiWFY6neQ2yGlhA7adHp7ePL10naqmQJwv7RRHEUM',
  NOME_ABA: 'Retorno_Extensão',

  // Campos do JSON levados para a aba, na ordem das colunas (o cabeçalho usa os mesmos nomes).
  COLUNAS: ['pedido', 'situacao', 'prazo', 'origem'],

  // Atualiza a aba automaticamente a cada envio da extensão.
  ATUALIZAR_NO_ENVIO: true,
};

/** Execução manual: lê o JSON do Drive e reescreve a aba. */
function sincronizarAbaRetorno() {
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(30000)) throw new Error('Outro envio está em andamento, tente de novo em instantes.');
  try {
    var dados = lerArquivo_(obterArquivo_());
    var total = escreverAbaRetorno_(dados);
    console.log('Aba "' + CONFIG_ABA.NOME_ABA + '" atualizada com ' + total + ' pedido(s).');
    return total;
  } finally {
    trava.releaseLock();
  }
}

/** Escreve os pedidos na aba (cabeçalho na linha 1, um pedido por linha). Devolve a quantidade. */
function escreverAbaRetorno_(dados) {
  var aba = obterAbaRetorno_();
  var colunas = CONFIG_ABA.COLUNAS;
  var pedidos = (dados && dados.pedidos) || {};

  var linhas = Object.keys(pedidos).map(function (id) {
    var p = pedidos[id] || {};
    return colunas.map(function (campo) {
      var v = campo === 'pedido' ? (p.pedido || id) : p[campo];
      return v === null || v === undefined ? '' : String(v);
    });
  });

  // Cabeçalho.
  aba.getRange(1, 1, 1, colunas.length).setValues([colunas]).setFontWeight('bold');

  // Limpa os dados antigos só das colunas usadas.
  var ultimaLinha = aba.getLastRow();
  if (ultimaLinha > 1) aba.getRange(2, 1, ultimaLinha - 1, colunas.length).clearContent();

  if (linhas.length) {
    var faixa = aba.getRange(2, 1, linhas.length, colunas.length);
    // Texto puro: impede que IDs como "2611034E123" virem número/notação científica.
    faixa.setNumberFormat('@');
    faixa.setValues(linhas);
  }
  return linhas.length;
}

/** Encontra a aba pelo nome (aceita também sem acento: "Retorno_Extensao"). */
function obterAbaRetorno_() {
  var planilha = SpreadsheetApp.openById(CONFIG_ABA.PLANILHA_ID);
  var aba = planilha.getSheetByName(CONFIG_ABA.NOME_ABA);
  if (aba) return aba;
  var alvo = semAcento_(CONFIG_ABA.NOME_ABA);
  var abas = planilha.getSheets();
  for (var i = 0; i < abas.length; i++) {
    if (semAcento_(abas[i].getName()) === alvo) return abas[i];
  }
  throw new Error('Aba "' + CONFIG_ABA.NOME_ABA + '" não encontrada na planilha base.');
}

function semAcento_(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
