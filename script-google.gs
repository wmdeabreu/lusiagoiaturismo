/**
 * Lusia Goia Turismo — cópia automática no Google Drive + assistente de voz.
 * Cole este código em script.google.com e implante como "App da Web".
 */

// 1) Esta chave precisa ser IGUAL à chave que aparece no app (Mais > Cópia na nuvem).
const CHAVE = 'TROQUE-ESTA-CHAVE';

// 2) IA GRÁTIS (recomendado) para o assistente de voz e o flyer: cole aqui a chave do Google AI Studio
//    (aistudio.google.com > Get API key > Create API key). É grátis, com limite de uso por dia.
const CHAVE_GEMINI = '';
// Modelos tentados em ordem (se o Google aposentar um, o próximo é usado).
const MODELOS_GEMINI = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

// 3) Opcional e PAGO: chave da API da Anthropic (console.anthropic.com). Só é usada se CHAVE_GEMINI estiver vazia.
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
      case 'ping': return resposta({ ok: true, ia: !!provedor(), provedor: provedor() });
      case 'backup': return resposta(salvarCopia(pedido));
      case 'restaurar': return resposta(ultimaCopia());
      case 'assistente':
        if (provedor() === 'gemini') return resposta(perguntarAoGemini(pedido.prompt, pedido.imagens));
        return resposta(perguntarAoClaude(pedido.prompt, pedido.imagens, pedido.esforco));
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

function chaveGemini() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || CHAVE_GEMINI;
}

function provedor() {
  if (chaveGemini()) return 'gemini';
  if (chaveIA()) return 'claude';
  return '';
}

// IA grátis do Google (Gemini). Fotos vão junto do texto.
function perguntarAoGemini(prompt, imagens) {
  const chave = chaveGemini();
  if (!chave) return { ok: false, erro: 'sem_ia' };
  const partes = [];
  (Array.isArray(imagens) ? imagens : []).slice(0, 5).forEach(function (b64) {
    if (typeof b64 === 'string' && b64.length > 100) partes.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  partes.push({ text: String(prompt || '') });
  let ultimo = { ok: false, erro: 'ia_404' };
  for (let i = 0; i < MODELOS_GEMINI.length; i++) {
    const modelo = MODELOS_GEMINI[i];
    const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-goog-api-key': chave },
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: partes }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }
      })
    });
    const codigo = r.getResponseCode();
    let j = {};
    try { j = JSON.parse(r.getContentText()); } catch (e) {}
    if (codigo === 404) { ultimo = { ok: false, erro: 'ia_404', detalhe: modelo }; continue; }
    if (codigo !== 200) return { ok: false, erro: 'ia_' + codigo, detalhe: j.error && j.error.message };
    const c = (j.candidates || [])[0];
    if (!c || !c.content || !c.content.parts) return { ok: false, erro: 'ia_recusou' };
    const texto = c.content.parts.map(function (p) { return p.text || ''; }).join('');
    return { ok: true, texto: texto, modelo: modelo };
  }
  return ultimo;
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
