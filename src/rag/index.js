const fs = require('fs');
const path = require('path');

let openaiClient = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

let ragState = {
  chunks: [],
  embeddings: [],
  model: 'text-embedding-3-small',
  ready: false,
  error: null,
};

async function readTrainerText() {
  const envPath = process.env.RAG_TRAINER_TEXT_PATH && process.env.RAG_TRAINER_TEXT_PATH.trim();
  const candidates = [];
  if (envPath) candidates.push(envPath);
  // Common fallbacks inside repo
  candidates.push(path.join(process.cwd(), 'data', 'business_trainer.txt'));
  // PDF or pre-extracted text under public/downloads
  candidates.push(path.join(process.cwd(), 'public', 'downloads', 'original-plan-genie-business-trainer.pdf'));
  candidates.push(path.join(process.cwd(), 'public', 'downloads', 'original-plan-genie-business-trainer.pdf.txt'));
  // Also check repo root public path
  candidates.push(path.join(process.cwd(), 'public', 'original-plan-genie-business-trainer.pdf'));
  candidates.push(path.join(process.cwd(), 'public', 'original-plan-genie-business-trainer.pdf.txt'));
  // Monorepo fallback: use frontend public/downloads copy if present (../plangenie/public/downloads)
  candidates.push(path.join(process.cwd(), '..', 'plangenie', 'public', 'downloads', 'original-plan-genie-business-trainer.pdf'));
  candidates.push(path.join(process.cwd(), '..', 'plangenie', 'public', 'downloads', 'original-plan-genie-business-trainer.pdf.txt'));
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const ext = path.extname(p).toLowerCase();
      if (ext === '.pdf') {
        try {
          const buf = fs.readFileSync(p);
          let pdfParse = null;
          try { pdfParse = require('pdf-parse'); } catch (_) { pdfParse = null; }
          if (!pdfParse) {
            const alt = p + '.txt';
            if (fs.existsSync(alt)) {
              const s = fs.readFileSync(alt, 'utf8');
              if (s && s.trim().length) return s;
            }
            continue;
          }
          const data = await pdfParse(buf);
          const t = (data && data.text) ? String(data.text) : '';
          if (t && t.trim().length) return t;
        } catch (_) { continue; }
      } else {
        const s = fs.readFileSync(p, 'utf8');
        if (s && s.trim().length) return s;
      }
    } catch (_) {}
  }
  return null;
}

function chunkText(text, maxChars = 1200, overlap = 160) {
  const out = [];
  const clean = String(text || '').replace(/\r/g, '');
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars);
    const seg = clean.slice(i, end);
    out.push(seg.trim());
    if (end >= clean.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return out.filter(Boolean);
}

async function embedBatch(texts) {
  const client = getOpenAI();
  const resp = await client.embeddings.create({
    model: ragState.model,
    input: texts,
  });
  return resp.data.map((d) => d.embedding);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function initRag() {
  if (ragState.ready || ragState.error) return ragState;
  try {
    // Allow disabling via env
    if (String(process.env.RAG_ENABLE || '').toLowerCase() === 'false') {
      ragState.ready = false;
      ragState.error = new Error('RAG disabled by RAG_ENABLE=false');
      return ragState;
    }
    const text = await readTrainerText();
    if (!text) {
      ragState.ready = false;
      ragState.error = new Error('Business Trainer text not found. Provide RAG_TRAINER_TEXT_PATH or data/business_trainer.txt');
      return ragState;
    }
    ragState.chunks = chunkText(text);
    ragState.embeddings = await embedBatch(ragState.chunks);
    ragState.ready = true;
    return ragState;
  } catch (err) {
    ragState.error = err;
    ragState.ready = false;
    return ragState;
  }
}

async function retrieve(query, k = 3) {
  try {
    const state = await initRag();
    if (!state.ready) return [];
    const [qvec] = await embedBatch([query || '']);
    const scored = state.embeddings.map((v, idx) => ({ idx, score: cosine(qvec, v) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, Math.min(k, scored.length)));
    return top.map(({ idx, score }) => ({ text: state.chunks[idx], score }));
  } catch (_) {
    return [];
  }
}

module.exports = { initRag, retrieve };
