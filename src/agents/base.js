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
const RevenueStream = require('../models/RevenueStream');
const FinancialBaseline = require('../models/FinancialBaseline');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const Competitor = require('../models/Competitor');
const SwotEntry = require('../models/SwotEntry');
const Product = require('../models/Product');
const OrgPosition = require('../models/OrgPosition');
const { getWorkspaceFields } = require('../services/workspaceFieldService');

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
 * Uses new individual CRUD models (CoreProject, Competitor, SwotEntry, etc.)
 */
async function buildAgentContext(userId, workspaceId = null) {
  console.log('[buildAgentContext] userId:', userId, 'workspaceId:', workspaceId);

  const obFilter = { user: userId };
  if (workspaceId) obFilter.workspace = workspaceId;

  const deptFilter = { user: userId };
  if (workspaceId) deptFilter.workspace = workspaceId;

  const tmFilter = { user: userId, status: 'Active' };
  if (workspaceId) tmFilter.workspace = workspaceId;

  // For revenue streams and baseline, also match null workspace for backward compatibility
  // This handles data created before workspace system was fully integrated
  const streamFilter = { user: userId, isActive: true };
  if (workspaceId) {
    streamFilter.$or = [{ workspace: workspaceId }, { workspace: null }];
  }

  const baselineFilter = { user: userId };
  if (workspaceId) {
    baselineFilter.$or = [{ workspace: workspaceId }, { workspace: null }];
  }

  console.log('[buildAgentContext] Query filters:');
  console.log('  - streamFilter:', JSON.stringify(streamFilter));
  console.log('  - baselineFilter:', JSON.stringify(baselineFilter));

  // Filter for new individual models (workspace-aware, not deleted)
  // Always include workspace in filter to match how data is stored (workspace is required)
  const crudFilter = { user: userId, isDeleted: { $ne: true }, workspace: workspaceId || null };

  const [
    ob,
    user,
    departments,
    teamMembers,
    revenueStreams,
    financialBaseline,
    coreProjects,
    departmentProjects,
    competitors,
    swotEntries,
    products,
    orgPositions,
  ] = await Promise.all([
    Onboarding.findOne(obFilter).lean(),
    User.findById(userId).lean(),
    Department.find(deptFilter).select('name status owner dueDate progress').limit(50).lean(),
    TeamMember.find(tmFilter).select('name role department').limit(100).lean(),
    RevenueStream.find(streamFilter).lean(),
    FinancialBaseline.findOne(baselineFilter).lean(),
    // New individual CRUD models
    CoreProject.find(crudFilter).sort({ order: 1 }).lean(),
    DepartmentProject.find(crudFilter).sort({ order: 1 }).lean(),
    Competitor.find(crudFilter).sort({ order: 1 }).lean(),
    SwotEntry.find(crudFilter).sort({ order: 1 }).lean(),
    Product.find(crudFilter).sort({ order: 1 }).lean(),
    OrgPosition.find(crudFilter).sort({ order: 1 }).lean(),
  ]);

  console.log('[buildAgentContext] Data found:');
  console.log('  - revenueStreams:', revenueStreams?.length || 0);
  console.log('  - financialBaseline:', financialBaseline ? 'yes' : 'no');
  if (financialBaseline) {
    console.log('    - revenue.totalMonthlyRevenue:', financialBaseline.revenue?.totalMonthlyRevenue);
    console.log('    - workRelatedCosts.total:', financialBaseline.workRelatedCosts?.total);
    console.log('    - fixedCosts.total:', financialBaseline.fixedCosts?.total);
  }

  const bp = ob?.businessProfile || {};
  const up = ob?.userProfile || {};
  // Read from Workspace.fields instead of Onboarding.answers
  const answers = await getWorkspaceFields(workspaceId);

  // Calculate v2 aggregate for revenue streams
  let revenueAggregate = null;
  if (revenueStreams && revenueStreams.length > 0) {
    revenueAggregate = {
      totalMonthlyRevenue: revenueStreams.reduce((sum, s) => sum + (s.metrics?.estimatedMonthlyRevenue || 0), 0),
      totalMonthlyDeliveryCost: revenueStreams.reduce((sum, s) => sum + (s.metrics?.estimatedMonthlyDeliveryCost || 0), 0),
      streamCount: revenueStreams.length,
    };
    revenueAggregate.grossProfit = revenueAggregate.totalMonthlyRevenue - revenueAggregate.totalMonthlyDeliveryCost;
    revenueAggregate.grossMarginPercent = revenueAggregate.totalMonthlyRevenue > 0
      ? (revenueAggregate.grossProfit / revenueAggregate.totalMonthlyRevenue) * 100
      : 0;
  }

  // Build competitor strings from new Competitor model
  const competitorNames = competitors.map(c => c.name).filter(Boolean);
  const competitorAdvantagesList = competitors.map(c => c.advantage).filter(Boolean);
  const marketCompetitors = competitorNames.join(', ');
  const competitorAdvantages = competitorAdvantagesList.join('; ');

  // Build SWOT strings from new SwotEntry model (field is entryType, not type)
  const swotStrengths = swotEntries.filter(s => s.entryType === 'strength').map(s => s.text).join('\n');
  const swotWeaknesses = swotEntries.filter(s => s.entryType === 'weakness').map(s => s.text).join('\n');
  const swotOpportunities = swotEntries.filter(s => s.entryType === 'opportunity').map(s => s.text).join('\n');
  const swotThreats = swotEntries.filter(s => s.entryType === 'threat').map(s => s.text).join('\n');

  // Map core projects to the expected format
  const coreProjectDetails = coreProjects.map(p => ({
    title: p.title || '',
    goal: p.goal || '',
    cost: p.cost || '',
    dueWhen: p.dueWhen || '',
    priority: p.priority || 'medium',
    ownerId: p.ownerId,
    ownerName: p.ownerName,
    deliverables: p.deliverables || [],
    linkedGoals: p.linkedGoals || [],
    departments: p.departments || [],
  }));

  // Group department projects by department key for actionAssignments format
  const actionAssignments = {};
  (departmentProjects || []).forEach(p => {
    const deptKey = p.departmentKey || p.department || 'other';
    if (!actionAssignments[deptKey]) actionAssignments[deptKey] = [];
    actionAssignments[deptKey].push({
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      goal: p.goal || p.title || '',
      title: p.title || '',
      milestone: p.milestone || '',
      resources: p.resources || '',
      kpi: p.kpi || '',
      dueWhen: p.dueWhen || '',
      status: p.status || 'not started',
      deliverables: p.deliverables || [],
    });
  });

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

    // Vision & Strategy (from Workspace.fields)
    ubp: answers.ubp || '',
    purpose: answers.purpose || '',
    vision1y: answers.vision1y || '',
    vision3y: answers.vision3y || '',
    visionBhag: answers.visionBhag || answers.bhag || '',
    valuesCore: answers.valuesCore || '',
    cultureFeeling: answers.cultureFeeling || '',

    // Market (from Workspace.fields + new Competitor model)
    marketCustomer: answers.marketCustomer || answers.targetCustomer || '',
    marketPartners: answers.marketPartners || answers.partners || '',
    marketCompetitors: marketCompetitors || answers.marketCompetitors || '',
    competitorAdvantages: competitorAdvantages || answers.competitorAdvantages || '',
    competitorsNotes: answers.competitorsNotes || '',

    // Products/Services - v2 data (RevenueStreams) + new Product model
    revenueStreams: revenueStreams || [],
    revenueAggregate,
    products: products || [],

    // Financial data - v2 data (FinancialBaseline)
    financialBaseline: financialBaseline || null,

    // Projects & Action Plans (from new CoreProject and DepartmentProject models)
    coreProjectDetails,
    coreProjects: coreProjects || [],
    departmentProjects: departmentProjects || [],
    actionAssignments,

    // Team & Org (+ new OrgPosition model)
    departments,
    teamMembers,
    teamMemberCount: teamMembers.length,
    orgPositions: orgPositions || [],

    // SWOT (from new SwotEntry model only - no legacy fallback)
    swot: {
      strengths: swotStrengths || '',
      weaknesses: swotWeaknesses || '',
      opportunities: swotOpportunities || '',
      threats: swotThreats || '',
    },

    // Raw data for advanced use
    _rawAnswers: answers,
    _user: user,
    _competitors: competitors,
    _swotEntries: swotEntries,
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
    systemPrompt = 'You are a business transformation strategist who provides SPECIFIC, ACTIONABLE guidance. Every recommendation must include a concrete action the user can take TODAY. No generic advice - reference their specific business data, industry, and goals. Be concise and direct. End every insight with a clear next step.',
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

  // Products/Services summary - v2 RevenueStreams only
  if (context.revenueStreams?.length > 0) {
    const streamList = context.revenueStreams
      .slice(0, 5)
      .map(s => `${s.name || 'Service'}: $${s.metrics?.estimatedMonthlyRevenue?.toLocaleString() || 0}/mo`.trim())
      .join('; ');
    lines.push(`\nProducts/Services: ${streamList}`);
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
