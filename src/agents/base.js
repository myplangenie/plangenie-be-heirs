/**
 * Base Agent Infrastructure
 * Provides shared utilities for all AI agents including:
 * - OpenAI client management
 * - Caching with TTL
 * - Context building from user data
 * - Rate limiting awareness
 */

const crypto = require('crypto');
const AgentCache = require('../models/AgentCache');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');

// Cache TTL configurations (in milliseconds)
const CACHE_TTL = {
  'plan-guidance': 30 * 60 * 1000,      // 30 minutes - changes frequently
  'financial-validation': 60 * 60 * 1000, // 1 hour - recalculate after edits
  'financial-insights': 30 * 60 * 1000, // 30 minutes - scenario-aware insights
  'strategy-suggestion': 2 * 60 * 60 * 1000, // 2 hours - strategic advice is stable
  'progress-status': 15 * 60 * 1000,    // 15 minutes - quick status checks
};

// Lazy-load OpenAI to avoid crashing if not installed
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

/**
 * Generate a hash of input data for cache invalidation
 */
function hashInput(data) {
  const str = JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

/**
 * Check cache for existing response
 */
async function getFromCache(userId, agentType, inputHash, workspaceId = null) {
  try {
    const filter = {
      user: userId,
      agentType,
      inputHash,
      expiresAt: { $gt: new Date() }
    };
    if (workspaceId) filter.workspace = workspaceId;
    const cached = await AgentCache.findOne(filter).lean();
    return cached?.response || null;
  } catch (err) {
    console.error('[AgentCache] Get error:', err.message);
    return null;
  }
}

/**
 * Store response in cache
 */
async function setCache(userId, agentType, inputHash, response, generationTimeMs = 0, workspaceId = null) {
  try {
    const ttl = CACHE_TTL[agentType] || 60 * 60 * 1000;
    const filter = { user: userId, agentType };
    if (workspaceId) filter.workspace = workspaceId;

    const update = {
      user: userId,
      agentType,
      inputHash,
      response,
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl),
      generationTimeMs,
    };
    if (workspaceId) update.workspace = workspaceId;

    await AgentCache.findOneAndUpdate(filter, update, { upsert: true, new: true });
  } catch (err) {
    console.error('[AgentCache] Set error:', err.message);
  }
}

/**
 * Invalidate cache for a user's agent
 */
async function invalidateCache(userId, agentType, workspaceId = null) {
  try {
    const filter = { user: userId };
    if (agentType) filter.agentType = agentType;
    if (workspaceId) filter.workspace = workspaceId;
    await AgentCache.deleteMany(filter);
  } catch (err) {
    console.error('[AgentCache] Invalidate error:', err.message);
  }
}

/**
 * Build comprehensive context for agents from user data
 */
async function buildAgentContext(userId, workspaceId = null) {
  const obFilter = { user: userId };
  if (workspaceId) obFilter.workspace = workspaceId;

  const deptFilter = { user: userId };
  if (workspaceId) deptFilter.workspace = workspaceId;

  const tmFilter = { user: userId, status: 'Active' };
  if (workspaceId) tmFilter.workspace = workspaceId;

  const [ob, user, departments, teamMembers] = await Promise.all([
    Onboarding.findOne(obFilter).lean(),
    User.findById(userId).lean(),
    Department.find(deptFilter).select('name status owner dueDate progress').limit(50).lean(),
    TeamMember.find(tmFilter).select('name role department').limit(100).lean(),
  ]);

  const bp = ob?.businessProfile || {};
  const up = ob?.userProfile || {};
  const answers = ob?.answers || {};

  return {
    // User profile
    fullName: up.fullName || user?.fullName || '',
    role: up.role || '',

    // Business profile
    businessName: bp.businessName || user?.companyName || 'Unknown Business',
    industry: bp.industry || 'Unknown',
    ventureType: bp.ventureType || '',
    teamSize: bp.teamSize || '',
    businessStage: bp.businessStage || '',
    location: [bp.city, bp.country].filter(Boolean).join(', '),

    // Vision & Strategy
    ubp: answers.ubp || '',
    purpose: answers.purpose || '',
    vision1y: answers.vision1y || '',
    vision3y: answers.vision3y || '',
    visionBhag: answers.visionBhag || '',
    valuesCore: answers.valuesCore || '',
    cultureFeeling: answers.cultureFeeling || '',

    // Market
    marketCustomer: answers.marketCustomer || '',
    marketPartners: answers.marketPartners || '',
    marketCompetitors: answers.marketCompetitors || '',
    competitorAdvantages: answers.competitorAdvantages || '',

    // Products
    products: answers.products || [],

    // Financial data
    financial: answers.financial || {},
    financialForecast: answers.financialForecast || {},

    // Projects & Action Plans
    coreProjectDetails: answers.coreProjectDetails || [],
    actionAssignments: answers.actionAssignments || {},

    // Team
    departments,
    teamMembers,
    teamMemberCount: teamMembers.length,

    // SWOT
    swot: {
      strengths: answers.swotStrengths || '',
      weaknesses: answers.swotWeaknesses || '',
      opportunities: answers.swotOpportunities || '',
      threats: answers.swotThreats || '',
    },

    // Raw answers for advanced use
    _rawAnswers: answers,
    _user: user,
  };
}

/**
 * Call OpenAI with retry logic and timeout
 */
async function callOpenAI(prompt, options = {}) {
  const {
    model = 'gpt-4o-mini',
    temperature = 0.7,
    maxTokens = 1500,
    systemPrompt = 'You are an expert business advisor helping entrepreneurs build and execute their business plans.',
  } = options;

  const openai = getOpenAI();

  const startTime = Date.now();
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
  });

  const generationTimeMs = Date.now() - startTime;
  const content = response.choices?.[0]?.message?.content || '';

  return { content, generationTimeMs };
}

/**
 * Call OpenAI and parse JSON response
 */
async function callOpenAIJSON(prompt, options = {}) {
  const { content, generationTimeMs } = await callOpenAI(prompt, {
    ...options,
    temperature: options.temperature ?? 0.5, // Lower temp for structured output
  });

  // Try to extract JSON from response
  try {
    // Handle markdown code blocks
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const parsed = JSON.parse(jsonStr);
    return { data: parsed, generationTimeMs };
  } catch (err) {
    console.error('[Agent] JSON parse error:', err.message);
    return { data: null, raw: content, generationTimeMs, error: 'Failed to parse JSON' };
  }
}

/**
 * Format context as a string for prompts
 */
function formatContextForPrompt(context) {
  const lines = [];

  if (context.businessName) lines.push(`Business: ${context.businessName}`);
  if (context.industry) lines.push(`Industry: ${context.industry}`);
  if (context.ventureType) lines.push(`Type: ${context.ventureType}`);
  if (context.businessStage) lines.push(`Stage: ${context.businessStage}`);
  if (context.teamSize) lines.push(`Team Size: ${context.teamSize}`);

  if (context.ubp) lines.push(`\nUnique Business Proposition: ${context.ubp}`);
  if (context.purpose) lines.push(`Purpose: ${context.purpose}`);
  if (context.vision1y) lines.push(`1-Year Goals: ${context.vision1y}`);
  if (context.vision3y) lines.push(`3-Year Goals: ${context.vision3y}`);

  if (context.valuesCore) lines.push(`\nCore Values: ${context.valuesCore}`);

  if (context.marketCustomer) lines.push(`\nTarget Customers: ${context.marketCustomer}`);
  if (context.marketCompetitors) lines.push(`Competitors: ${context.marketCompetitors}`);
  if (context.competitorAdvantages) lines.push(`Competitive Advantages: ${context.competitorAdvantages}`);

  // Products summary
  if (context.products?.length > 0) {
    const productList = context.products
      .slice(0, 5)
      .map(p => `${p.product || p.name || 'Product'}: ${p.description || ''}`.trim())
      .join('; ');
    lines.push(`\nProducts/Services: ${productList}`);
  }

  // Projects summary
  if (context.coreProjectDetails?.length > 0) {
    const projectList = context.coreProjectDetails
      .slice(0, 5)
      .map(p => p.title || 'Untitled')
      .join(', ');
    lines.push(`\nActive Projects: ${projectList}`);
  }

  return lines.join('\n');
}

module.exports = {
  getOpenAI,
  hashInput,
  getFromCache,
  setCache,
  invalidateCache,
  buildAgentContext,
  callOpenAI,
  callOpenAIJSON,
  formatContextForPrompt,
  CACHE_TTL,
};
