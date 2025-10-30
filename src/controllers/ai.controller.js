const Onboarding = require('../models/Onboarding');

// Lazy-load OpenAI to avoid crashing if not installed during dev
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

async function callOpenAI({ type, input, contextText }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  const userPrompt = [
    contextText || '',
    `Task: Generate exactly 1 option for the ${type}.`,
    'Constraints:',
    '- Keep it to 1-2 sentences.',
    '- Be specific and user-centered.',
    '- Output ONLY the final suggestion as plain text.',
    '- Do NOT include code fences, JSON, lists, bullets, quotes, or explanations.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 400,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();

  // If wrapped in triple backticks, extract inner content
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try to parse JSON array or string if present
  try {
    if (text.startsWith('[')) {
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } else if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('"') && text.endsWith('"'))) {
      const maybe = JSON.parse(text);
      if (typeof maybe === 'string') return maybe;
    }
  } catch (_) {
    // ignore JSON parse errors
  }

  // If we still have bracketed JSON somewhere, try to slice first bracketed block
  const lb = text.indexOf('[');
  const rb = text.lastIndexOf(']');
  if (lb !== -1 && rb !== -1 && rb > lb) {
    try {
      const arr = JSON.parse(text.slice(lb, rb + 1));
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch (_) {}
  }

  // Fallback: pick first non-empty line that's not a fence
  const first = text
    .split('\n')
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter((l) => l && !l.startsWith('```'))[0];
  // Strip surrounding quotes if present
  const unquoted = first && ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'")))
    ? first.slice(1, -1).trim()
    : first;
  return unquoted || '';
}

// New: return an array of n suggestions (default 3)
async function callOpenAIList({ type, input, contextText, n = 3 }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  const userPrompt = [
    contextText || '',
    `Task: Generate exactly ${n} distinct, high-quality options for the ${type}.`,
    'Constraints:',
    '- Each option should be 1-2 sentences.',
    '- Be specific and user-centered.',
    '- Return ONLY a valid JSON array of strings (length exactly ${n}).',
    '- Do NOT include any extra text before or after the JSON.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 600,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();

  // Extract JSON array from fences or raw
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  let arr = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) arr = parsed;
  } catch (_) {}

  if (!Array.isArray(arr) || arr.length === 0) {
    // fallback: split by lines and filter
    arr = text
      .split('\n')
      .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
      .filter(Boolean);
  }

  const unique = Array.from(new Set(arr.map((s) => String(s)))).filter((s) => s && s !== '[object Object]');
  return unique.slice(0, n);
}

// Rewrite a given text preserving meaning, improving clarity and concision
async function callOpenAIRewrite({ type, text, contextText }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Rewrite the provided draft to be clearer and more concise while preserving meaning. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  const userPrompt = [
    contextText || '',
    `Task: Rewrite the user's draft for the ${type}.`,
    'Constraints:',
    '- Keep it to 1-2 sentences.',
    '- Preserve the core meaning; improve clarity and tone.',
    '- Output ONLY the rewritten text as plain text.',
    '',
    text ? `Draft: ${text}` : 'Draft: (none provided)'
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 400,
  });

  let out = resp.choices?.[0]?.message?.content || '';
  out = String(out).trim();
  const fenceMatch = out.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) out = fenceMatch[1].trim();

  // Try to strip quotes or JSON structure
  try {
    if ((out.startsWith('{') && out.endsWith('}')) || (out.startsWith('"') && out.endsWith('"'))) {
      const maybe = JSON.parse(out);
      if (typeof maybe === 'string') out = maybe;
    }
  } catch (_) {}

  const first = out
    .split('\n')
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter((l) => l && !l.startsWith('```'))[0];
  const unquoted = first && ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'")))
    ? first.slice(1, -1).trim()
    : first;
  return unquoted || '';
}

exports.suggestUbp = async (req, res) => {
  try {
    const { input } = req.body || {};
    // If user is authenticated, use onboarding context; otherwise proceed without it
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Unique Business Proposition (UBP)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteUbp = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Unique Business Proposition (UBP)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestPurpose = async (req, res) => {
  try {
    const { input } = req.body || {};
    // If user is authenticated, use onboarding context; otherwise proceed without it
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Purpose statement', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewritePurpose = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Purpose statement', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestValuesCore = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Core values statement', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteValuesCore = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Core values statement', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestCultureFeeling = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Culture/brand experience feeling statement', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteCultureFeeling = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Culture/brand experience feeling statement', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketCustomer = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Target market and ideal customer profile summary', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketPartners = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Go-to-market partners and channels plan', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteMarketPartners = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Go-to-market partners and channels plan', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketCompetitors = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: 'Competitive differentiation notes', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteMarketCompetitors = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'Competitive differentiation notes', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// New: competitor names (2–3) based on prior inputs
exports.suggestCompetitorNames = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    // Try provider-backed search first for real companies
    async function providerSearch(query) {
      const out = [];
      try {
        if (process.env.SERPAPI_API_KEY) {
          const url = new URL('https://serpapi.com/search.json');
          url.searchParams.set('engine', 'google');
          url.searchParams.set('q', query);
          url.searchParams.set('num', '10');
          url.searchParams.set('api_key', process.env.SERPAPI_API_KEY);
          const r = await fetch(url, { method: 'GET' });
          const j = await r.json();
          const org = j.organic_results || [];
          for (const it of org) {
            const t = (it.title || '').replace(/\s*[|\-].*$/, '').trim();
            if (t && !/top|best|vs|compare|review|blog|news|wikipedia/i.test(t)) out.push(t);
          }
        } else if (process.env.BING_SUBSCRIPTION_KEY) {
          const r = await fetch('https://api.bing.microsoft.com/v7.0/search?q=' + encodeURIComponent(query), {
            headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SUBSCRIPTION_KEY },
          });
          const j = await r.json();
          const web = j.webPages?.value || [];
          for (const it of web) {
            const t = (it.name || '').replace(/\s*[|\-].*$/, '').trim();
            if (t && !/top|best|vs|compare|review|blog|news|wikipedia/i.test(t)) out.push(t);
          }
        }
      } catch (_) {}
      return Array.from(new Set(out));
    }

    const bp = ob?.businessProfile || {};
    const q = [
      'competitors',
      bp.industry || '',
      [bp.city, bp.country].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || 'top competitors';

    let suggestions = await providerSearch(q);
    if (!suggestions || suggestions.length === 0) {
      // Fallback to AI list if provider not configured or no results
      suggestions = await callOpenAIList({
        type: 'top 2–3 competitor company names (no URLs, no descriptors)',
        input,
        contextText,
        n: 3,
      });
    }
    suggestions = suggestions.slice(0, 3);
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestFinancialForecast = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: '12-month financial snapshot (revenue streams and costs) summary', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteFinancialForecast = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: '12-month financial snapshot (revenue streams and costs) summary', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Suggest a single numeric value for financial inputs
// Returns { value: string } containing only digits and optional decimal point, no symbols/words
exports.suggestFinancialNumber = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);

    // Use a very strict system prompt and small max tokens for numeric-only responses
    const client = getOpenAI();
    const system = 'You are a calculator. Always respond with only a number. No text, no units, no symbols.';
    const userPrompt = [
      contextText || '',
      'Task: Suggest a single numeric estimate for the requested finance input.',
      'Return ONLY a plain number (digits with optional decimal point). No currency symbols, no commas, no percent signs, and no words.',
      input ? `User input/context: ${input}` : 'User input/context: (none)',
    ].filter(Boolean).join('\n');

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    });

    let text = resp.choices?.[0]?.message?.content || '';
    text = String(text).trim();
    const m = text.match(/-?\d+(?:\.\d+)?/);
    let value = m ? m[0] : '';

    // Fallback: if empty, try a second pass via generic helper, then regex
    if (!value) {
      const fallback = await callOpenAI({
        type: 'single numeric estimate (plain number only)',
        input: userPrompt,
        contextText: '',
      });
      const mf = String(fallback || '').match(/-?\d+(?:\.\d+)?/);
      value = mf ? mf[0] : '';
    }

    // Final guard: default to 0 if still empty
    if (!value) value = '0';
    return res.json({ value });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate number';
    return res.status(500).json({ message });
  }
};

// Suggest all essential financial inputs in a single response
// Returns numeric fields as plain numbers (stringified) and month as YYYY-MM
exports.suggestFinancialAll = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);

    const client = getOpenAI();

    async function askNumber(prompt) {
      const system = 'You are a calculator. Always respond with only a number. No text, no units, no symbols.';
      const userPrompt = [
        contextText || '',
        'Task: Suggest a single numeric estimate for the requested finance input.',
        'Return ONLY a plain number (digits with optional decimal point). No currency symbols, no commas, no percent signs, and no words.',
        input ? `User input/context: ${input}` : 'User input/context: (none)',
        `Specific request: ${prompt}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 16,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      let out = String(resp.choices?.[0]?.message?.content || '').trim();
      const m = out.match(/\d+(?:\.\d+)?/);
      return m ? m[0] : '';
    }

    async function askMonth(prompt) {
      const system = 'Respond with only a month in YYYY-MM format. No extra text.';
      const userPrompt = [
        contextText || '',
        'Task: Provide a realistic expected month for the requested finance event.',
        'Constraints: Return only YYYY-MM. No day, no words.',
        input ? `User input/context: ${input}` : 'User input/context: (none)',
        `Specific request: ${prompt}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const out = String(resp.choices?.[0]?.message?.content || '').trim();
      const m = out.match(/\d{4}-\d{2}/);
      return m ? m[0] : '';
    }

    const [
      salesVolume,
      salesGrowthPct,
      avgUnitCost,
      fixedOperatingCosts,
      marketingSalesSpend,
      payrollCost,
      startingCash,
      additionalFundingAmount,
      additionalFundingMonth,
      paymentCollectionDays,
      targetProfitMarginPct,
    ] = await Promise.all([
      askNumber('Projected first-month sales volume (or funding per source if nonprofit).'),
      askNumber('Monthly sales growth rate percentage (enter just the number).'),
      askNumber('Average direct cost per unit to deliver.'),
      askNumber('Total monthly fixed operating costs.'),
      askNumber('Monthly marketing and sales spend.'),
      askNumber('Total team or payroll cost per month.'),
      askNumber('Starting cash or bank balance.'),
      askNumber('Additional funding or grants expected amount.'),
      askMonth('Expected month when additional funding arrives.'),
      askNumber('Typical payment collection time in days.'),
      askNumber('Desired profit margin percentage (enter just the number).'),
    ]);

    return res.json({
      salesVolume,
      salesGrowthPct,
      avgUnitCost,
      fixedOperatingCosts,
      marketingSalesSpend,
      payrollCost,
      startingCash,
      additionalFundingAmount,
      additionalFundingMonth,
      paymentCollectionDays,
      targetProfitMarginPct,
    });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestVision1y = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: '1-year success outcome', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteVision1y = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: '1-year success outcome', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestVision3y = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestions = await callOpenAIList({ type: '3-year thriving vision', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

// Action plan field suggestions and rewrites
exports.suggestActionGoal = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'action plan goal (1-2 sentences)', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionGoal = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'action plan goal (1-2 sentences)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionMilestone = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'concise milestone phrase', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionMilestone = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'concise milestone phrase', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionResources = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'resources/tools/budget summary (short phrase)', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionResources = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'resources/tools/budget summary (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionKpi = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'KPI metric specification (short phrase)', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionKpi = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'KPI metric specification (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// New: Action cost suggestion + rewrite
exports.suggestActionCost = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'estimated cost/budget (short phrase, e.g., "$2,000 for design and ads")', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionCost = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'estimated cost/budget (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// New: Single endpoint to suggest all action fields at once
exports.suggestActionAll = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);

    const [goal, milestone, resources, cost, kpi] = await Promise.all([
      callOpenAI({ type: 'action plan goal (1-2 sentences)', input, contextText }),
      callOpenAI({ type: 'concise deliverable/milestone phrase', input, contextText }),
      callOpenAI({ type: 'resources/tools/budget summary (short phrase)', input, contextText }),
      callOpenAI({ type: 'estimated cost/budget (short phrase, e.g., "$2,000 for design and ads")', input, contextText }),
      callOpenAI({ type: 'KPI metric specification (short phrase)', input, contextText }),
    ]);
    return res.json({ goal, milestone, resources, cost, kpi });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

// New: Bulk suggest 1-2 high-level goals for multiple sections at once
// Body: { sections: [{ key, label }], context?: string }
// Returns: { goals: { [key]: string[] } }
exports.suggestDeptGoalsBulk = async (req, res) => {
  try {
    const { sections = [], context = '' } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.json({ goals: {} });
    }
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = [buildContextText(ob), context].filter(Boolean).join('\n');

    const out = {};
    for (const sec of sections) {
      const label = (sec && sec.label) ? String(sec.label) : '';
      const key = (sec && sec.key) ? String(sec.key) : label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const input = `${contextText}\nSection: ${label}\nTask: Provide 2 concise high-level departmental goals.`;
      const suggestions = await callOpenAIList({ type: 'high-level departmental goals', input, contextText, n: 2 });
      out[key] = (suggestions || []).filter(Boolean);
    }
    return res.json({ goals: out });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate goals';
    return res.status(500).json({ message });
  }
};

exports.suggestActionDue = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob) + '\nConstraints: Return only ISO date (YYYY-MM-DD)';
    const suggestion = await callOpenAI({ type: 'due date in ISO format', input, contextText });
    // basic sanitize for date-like
    const iso = String(suggestion || '').trim().slice(0, 10);
    return res.json({ suggestion: iso });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionDue = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob) + '\nConstraints: Return only ISO date (YYYY-MM-DD)';
    const rewrite = await callOpenAIRewrite({ type: 'due date in ISO format', text, contextText });
    const iso = String(rewrite || '').trim().slice(0, 10);
    return res.json({ rewrite: iso });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.rewriteVision3y = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: '3-year thriving vision', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Strategic Identity Summary (UBP + Purpose + 1y + 3y)
exports.suggestIdentitySummary = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const suggestion = await callOpenAI({ type: 'strategic identity summary (1–3 sentences, polished narrative)', input, contextText });
    return res.json({ suggestion, suggestions: suggestion ? [suggestion] : [] });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate summary';
    return res.status(500).json({ message });
  }
};

exports.rewriteIdentitySummary = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = buildContextText(ob);
    const rewrite = await callOpenAIRewrite({ type: 'strategic identity summary (1–3 sentences, polished narrative)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};
