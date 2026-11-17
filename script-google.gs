/**
 * Lusia Goia Turismo — cópia automática no Google Drive + assistente de voz.
 * Cole este código em script.google.com e implante como "App da Web".
 */

// 1) Esta chave precisa ser IGUAL à chave que aparece no app (Mais > Cópia na nuvem).
const CHAVE = 'TROQUE-ESTA-CHAVE';

// 2) Opcional, para ligar o assistente de voz: cole aqui sua chave da API da Anthropic
//    (console.anthropic.com > API Keys). Sem ela, só a cópia de segurança funciona.
const CHAVE_ANTHROPIC = '';

const MODELO = 'claude-opus-5-5';
const NOME_PASTA = 'Lusia Goia Turismo - Cópias de segurança';
const MANTER_COPIAS = 90; // quantos dias de cópia guardar no Drive

function doGet() {
  return resposta({ ok: true, app: 'lusia-viagens' });
}

function doPost(e) {
  let pedido;
  try { pedido = JSON.parse(e.postData.contents); } catch (err) { return resposta({ ok: false, erro: 'pedido_invalido' }); }
  if (!pedido || CHAVE === 'TROQUE-ESTA-CHAVE' || CHAVE.length < 8 || pedido.chave !== CHAVE) {
    return resposta({ ok: false, erro: 'chave_errada' });
  }
  try {
    switch (pedido.acao) {
      case 'ping': return resposta({ ok: true, ia: !!chaveIA() });
      case 'backup': return resposta(salvarCopia(pedido));
      case 'restaurar': return resposta(ultimaCopia());
      case 'assistente': return resposta(perguntarAoClaude(pedido.prompt, pedido.imagens, pedido.esforco));
      default: return resposta({ ok: false, erro: 'acao_desconhecida' });
    }
  } catch (err) {
    return resposta({ ok: false, erro: 'erro_script', detalhe: String(err) });
  }
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function pasta() {
  const it = DriveApp.getFoldersByName(NOME_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOME_PASTA);
}

function arquivosDaPasta(p) {
  const lista = [];
  const it = p.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^lusia-viagens-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName())) lista.push(f);
  }
  lista.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  return lista;
}

function salvarCopia(pedido) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.dia || '') || !pedido.copia) return { ok: false, erro: 'copia_invalida' };
  const p = pasta();
  const nome = 'lusia-viagens-' + pedido.dia + '.json';
  const conteudo = JSON.stringify(pedido.copia);
  const existentes = p.getFilesByName(nome);
  if (existentes.hasNext()) existentes.next().setContent(conteudo);
  else p.createFile(nome, conteudo, 'application/json');
  arquivosDaPasta(p).slice(MANTER_COPIAS).forEach(function (f) { f.setTrashed(true); });
  return { ok: true, arquivo: nome };
}

function ultimaCopia() {
  const fs = arquivosDaPasta(pasta());
  if (!fs.length) return { ok: false, erro: 'sem_copia' };
  return { ok: true, arquivo: fs[0].getName(), copia: JSON.parse(fs[0].getBlob().getDataAsString('UTF-8')) };
}

function chaveIA() {
  return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || CHAVE_ANTHROPIC;
}

function perguntarAoClaude(prompt, imagens, esforco) {
  const chave = chaveIA();
  if (!chave) return { ok: false, erro: 'sem_ia' };
  // Fotos (do flyer) vão antes do texto; cada uma é um JPEG em base64.
  const conteudo = [];
  (Array.isArray(imagens) ? imagens : []).slice(0, 5).forEach(function (b64) {
    if (typeof b64 === 'string' && b64.length > 100) {
      conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    }
  });
  conteudo.push({ type: 'text', text: String(prompt || '') });
  const nivel = ['low', 'medium', 'high'].indexOf(esforco) >= 0 ? esforco : 'low';
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': chave,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: nivel },
      fallbacks: 'default',
      messages: [{ role: 'user', content: conteudo }]
    })
  });
  const codigo = r.getResponseCode();
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (codigo !== 200) return { ok: false, erro: 'ia_' + codigo, detalhe: j.error && j.error.message };
  if (j.stop_reason === 'refusal') return { ok: false, erro: 'ia_recusou' };
  const texto = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return { ok: true, texto: texto };
}
