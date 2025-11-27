const Onboarding = require('../models/Onboarding');

// Local helper copied to avoid tight coupling to ai.controller internals
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

function buildContextText(ob) {
  if (!ob) return '';
  const bp = ob.businessProfile || {};
  const up = ob.userProfile || {};
  const fields = [
    bp.businessName && `Business Name: ${bp.businessName}`,
    bp.industry && `Industry: ${bp.industry}`,
    bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
    bp.ventureType && `Venture Type: ${bp.ventureType}`,
    bp.teamSize && `Team Size: ${bp.teamSize}`,
    bp.businessStage && `Stage: ${bp.businessStage}`,
    up.role && `User Role: ${up.role}`,
  ].filter(Boolean);
  const base = fields.length ? `Context about the business:\n- ${fields.join('\n- ')}` : '';
  const a = (ob && ob.answers) || {};
  const parts = [];
  if (a.ubp) parts.push(`UBP: ${String(a.ubp).trim()}`);
  if (a.purpose) parts.push(`Purpose: ${String(a.purpose).trim()}`);
  if (a.visionBhag) parts.push(`BHAG: ${String(a.visionBhag).trim()}`);
  if (a.vision1y) parts.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.vision3y) parts.push(`3-Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.valuesCore) parts.push(`Core Values: ${String(a.valuesCore).trim()}`);
  if (a.cultureFeeling) parts.push(`Culture: ${String(a.cultureFeeling).trim()}`);
  // Summarize action assignments (dashboard context)
  try {
    const assignments = a.actionAssignments || {};
    const lines = [];
    Object.entries(assignments).forEach(([dept, arr]) => {
      (arr || []).slice(0, 2).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return;
        const kpi = String(u?.kpi || '').trim();
        const due = String(u?.dueWhen || '').trim();
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const bits = [goal, owner && `Owner: ${owner}`, dept && `Dept: ${dept}`, kpi && `KPI: ${kpi}`, due && `Due: ${due}`].filter(Boolean);
        if (bits.length) lines.push('- ' + bits.join(' | '));
      });
    });
    if (lines.length) parts.push(`Current action plans:\n${lines.join('\n')}`);
  } catch {}
  const tail = parts.length ? `\n\nUser plan context:\n- ${parts.join('\n- ')}` : '';
  return [base, tail].filter(Boolean).join('\n');
}

exports.respond = async (req, res) => {
  try {
    const raw = req.body?.messages;
    const messages = Array.isArray(raw) ? raw : [];
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);

    const system = [
      'You are Plangenie, a helpful business planning copilot.',
      'Be concise, human, and specific. Avoid buzzwords.',
      'Use provided context if relevant; never contradict it.',
    ].join(' ');

    const safeMsgs = messages
      .slice(-20)
      .map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content ?? '').slice(0, 4000),
      }));

    const client = getOpenAI();
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: 'system', content: system },
        ...(contextText ? [{ role: 'system', content: contextText }] : []),
        ...safeMsgs,
      ],
    });

    const reply = String(resp.choices?.[0]?.message?.content || '').trim() || 'I did not find an answer.';
    return res.json({ reply });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to respond';
    return res.status(500).json({ message });
  }
};
