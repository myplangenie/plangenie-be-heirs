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
  return fields.length ? `Context about the business:\n- ${fields.join('\n- ')}` : '';
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

