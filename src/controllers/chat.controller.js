const Onboarding = require('../models/Onboarding');
const RevenueStream = require('../models/RevenueStream');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');
const User = require('../models/User');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const Product = require('../models/Product');
const OrgPosition = require('../models/OrgPosition');
const Competitor = require('../models/Competitor');
const SwotEntry = require('../models/SwotEntry');
const FinancialBaseline = require('../models/FinancialBaseline');
const Collaboration = require('../models/Collaboration');
const Notification = require('../models/Notification');
const WorkspaceMember = require('../models/WorkspaceMember');
const Workspace = require('../models/Workspace');
const crypto = require('crypto');
const { getLimit } = require('../config/entitlements');
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');
const { getWorkspaceFields, updateWorkspaceFields } = require('../services/workspaceFieldService');
const agents = require('../agents');
const { buildAgentContext, formatContextForPrompt, callOpenAI } = require('../agents/base');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
const OKR = require('../models/OKR');
const Decision = require('../models/Decision');
const Assumption = require('../models/Assumption');
const VisionGoal = require('../models/VisionGoal');
const ChatHistory = require('../models/ChatHistory');
const AgentActionLog = require('../models/AgentActionLog');

// Optional internal knowledge (Business Trainer)
let rag;
try {
  rag = require('../rag/index.js');
} catch (e) {
  rag = { initRag: async () => ({ ready: false, error: e }), retrieve: async () => [] };
}



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

// ── In-memory rate limiter (20 req/min per user, no package needed) ──
const _rlMap = new Map();
function _checkRateLimit(key) {
  const now = Date.now();
  const e = _rlMap.get(key);
  if (!e || now > e.r) { _rlMap.set(key, { c: 1, r: now + 60000 }); return false; }
  e.c++;
  return e.c > 20;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of _rlMap) if (n > v.r) _rlMap.delete(k); }, 300000).unref();

// ── Idempotency cache: skip duplicate tool calls within 5 seconds ──
const _idemMap = new Map();
function _isIdempotentDuplicate(userId, toolName, argsJson) {
  const key = `${userId}:${toolName}:${argsJson}`;
  const now = Date.now();
  const last = _idemMap.get(key);
  if (last && now - last < 5000) return true;
  _idemMap.set(key, now);
  return false;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of _idemMap) if (n - v > 10000) _idemMap.delete(k); }, 60000).unref();

// ── Status message shown to the user while a tool is executing ──
function _toolStatusMsg(name, args) {
  switch (name) {
    case 'get_core_projects': return 'Checking your projects...';
    case 'get_departmental_projects': return 'Checking department projects...';
    case 'get_financial_snapshot': return 'Reviewing financials...';
    case 'get_overdue_tasks': case 'get_upcoming_tasks': return 'Reviewing deadlines...';
    case 'get_swot_analysis': return 'Reviewing SWOT analysis...';
    case 'get_vision_and_goals': return 'Reviewing goals...';
    case 'create_core_project': return `Creating project "${args.title || ''}"...`;
    case 'create_department_project': return `Creating ${args.department || ''} project...`;
    case 'add_deliverable': return `Adding "${args.text || ''}"...`;
    case 'update_project': return 'Updating project...';
    case 'mark_deliverable_complete': return `Marking "${args.deliverableText || ''}" as complete...`;
    case 'reschedule_item': return `Rescheduling to ${args.newDate || ''}...`;
    case 'assign_owner': return `Assigning to ${args.ownerName || ''}...`;
    case 'delete_project': return 'Deleting project...';
    case 'create_okr': return `Creating OKR "${args.objective || ''}"...`;
    case 'add_swot_entry': return `Adding ${args.entryType || ''} to SWOT...`;
    case 'create_vision_goal': return `Creating ${args.goalType || ''} goal...`;
    case 'update_vision_goal': return `Updating ${args.goalType || ''} goal...`;
    case 'delete_vision_goal': return `Deleting ${args.goalType || ''} goal...`;
    case 'create_department': return `Creating department "${args.name || ''}"...`;
    case 'delete_department': return `Deleting department "${args.name || args.key || ''}"...`;
    case 'update_vision_goals': return 'Updating vision and goals...';
    case 'update_cash_position': return 'Updating cash position...';
    case 'update_fixed_costs': return 'Updating fixed costs...';
    case 'create_org_position': return `Creating position "${args.position || ''}"...`;
    case 'update_org_position': return `Updating position "${args.positionTitle || ''}"...`;
    case 'add_team_member': return `Adding ${args.name || 'team member'} to the roster...`;
    case 'remove_team_member': return `Removing ${args.name || 'team member'} from the roster...`;
    case 'invite_collaborator': return `Sending workspace invite to ${args.email || ''}...`;
    case 'revoke_collaborator': return `Revoking access for ${args.email || ''}...`;
    case 'update_kr_progress': return `Updating KR progress for "${args.krText || ''}"...`;
    case 'notify_team_member': return `Sending notification to ${args.recipientEmail || ''}...`;
    case 'get_okrs': return 'Fetching OKRs...';
    case 'batch_create_deliverables': return `Adding ${Array.isArray(args.deliverables) ? args.deliverables.length : ''} deliverables to "${args.projectTitle || ''}"...`;
    case 'delete_deliverable': return `Removing "${args.deliverableText || ''}"...`;
    case 'move_deliverable': return `Moving "${args.deliverableText || ''}" to "${args.targetProjectTitle || ''}"...`;
    case 'duplicate_project': return `Duplicating project "${args.projectTitle || ''}"...`;
    case 'delete_okr': return `Deleting OKR "${args.objective || ''}"...`;
    case 'update_okr': return `Updating OKR "${args.objective || args.newObjective || ''}"...`;
    case 'create_product': return `Adding product "${args.name || ''}"...`;
    case 'update_product': return `Updating product "${args.name || ''}"...`;
    case 'delete_product': return `Removing product "${args.name || ''}"...`;
    case 'create_competitor': return `Adding competitor "${args.name || ''}"...`;
    case 'update_competitor': return `Updating competitor "${args.name || ''}"...`;
    case 'delete_competitor': return `Removing competitor "${args.name || ''}"...`;
    case 'create_revenue_stream': return `Creating revenue stream "${args.name || ''}"...`;
    case 'update_revenue_stream': return `Updating revenue stream "${args.name || ''}"...`;
    case 'delete_revenue_stream': return `Removing revenue stream "${args.name || ''}"...`;
    case 'update_swot_entry': return `Updating SWOT entry...`;
    case 'delete_swot_entry': return `Removing SWOT entry...`;
    case 'update_work_costs': return 'Updating work-related costs...';
    case 'update_collaborator_access': return `Updating access for ${args.email || ''}...`;
    case 'get_workspace_members': return 'Fetching workspace members...';
    case 'update_deliverable': return `Updating deliverable "${args.deliverableText || ''}"...`;
    case 'restore_project': return 'Restoring project...';
    case 'restore_okr': return 'Restoring OKR...';
    case 'restore_product': return `Restoring product "${args.name || ''}"...`;
    case 'restore_competitor': return `Restoring competitor "${args.name || ''}"...`;
    case 'restore_swot_entry': return 'Restoring SWOT entry...';
    case 'create_decision': return `Logging decision "${args.title || ''}"...`;
    case 'update_decision': return 'Updating decision...';
    case 'create_assumption': return `Adding assumption "${args.key || ''}"...`;
    case 'update_assumption': return `Updating assumption "${args.key || ''}"...`;
    case 'resend_collaborator_invite': return `Resending invite to ${args.email || ''}...`;
    case 'update_workspace_member_role': return `Updating role for ${args.email || ''}...`;
    case 'update_values_culture': return 'Updating values and culture...';
    case 'update_market_info': return 'Updating market information...';
    case 'delete_org_position': return `Removing position "${args.positionTitle || ''}"...`;
    case 'delete_decision': return 'Deleting decision...';
    case 'delete_assumption': return `Removing assumption "${args.key || ''}"...`;
    case 'get_decisions': return 'Fetching decisions...';
    case 'get_assumptions': return 'Fetching assumptions...';
    case 'invite_workspace_member': return `Sending workspace invite to ${args.email || ''}...`;
    case 'remove_workspace_member': return `Removing ${args.email || 'member'} from workspace...`;
    case 'update_workspace': return 'Updating workspace settings...';
    case 'update_kr_fields': return `Updating key result "${args.krText || ''}"...`;
    default: return null;
  }
}

// ── Follow-up chip suggestions based on last tool call ──
function _getFollowUps(toolTrace) {
  if (!toolTrace || toolTrace.length === 0) return [];
  const last = toolTrace[toolTrace.length - 1];
  switch (last?.name) {
    case 'create_core_project': return ['Add deliverables to this project', 'Assign an owner', 'Set a priority level'];
    case 'create_department_project': return ['Add tasks to this project', 'Assign an owner', 'Set a due date'];
    case 'add_deliverable': case 'batch_create_deliverables': return ['Add another deliverable', 'Assign this task to someone', 'Reschedule this item'];
    case 'create_okr': return ['Update KR progress', 'Add more key results', 'View all OKRs'];
    case 'update_kr_progress': return ['Update another KR', 'Show OKR progress'];
    case 'add_team_member': return ['Add another team member', 'Assign them to a project', 'Invite them to the platform'];
    case 'remove_team_member': return ['View remaining team members', 'Add a new team member'];
    case 'invite_collaborator': return ['Invite another collaborator', 'View workspace members'];
    case 'revoke_collaborator': return ['Invite a different collaborator', 'View remaining collaborators'];
    case 'add_swot_entry': return ['Add another SWOT entry', 'View full SWOT analysis'];
    case 'duplicate_project': return ['Add deliverables to the copy', 'Assign an owner to the copy'];
    case 'create_vision_goal': return ['Add another goal', 'Create an OKR from this goal'];
    case 'update_vision_goal': return ['Update another goal', 'Create an OKR from this goal'];
    case 'delete_vision_goal': return ['Add a new goal', 'View remaining goals'];
    case 'update_vision_goals': return ['Create an OKR from these goals', 'Update your BHAG'];
    case 'update_cash_position': case 'update_fixed_costs': return ['View financial snapshot', 'Update other financial data'];
    case 'assign_owner': return ['Reschedule this item', 'Add a deliverable'];
    case 'reschedule_item': return ['Assign an owner', 'Add a deliverable'];
    case 'mark_deliverable_complete': return ['Mark another task complete', 'Show overdue tasks'];
    case 'delete_project': return ['Create a new project', 'View remaining projects'];
    case 'create_product': return ['Add another product', 'Update pricing for this product'];
    case 'update_product': return ['Update another product', 'Add a new product'];
    case 'delete_product': return ['Add a new product', 'View remaining products'];
    case 'create_competitor': return ['Add another competitor', 'Update their threat level'];
    case 'update_competitor': return ['Update another competitor', 'Add a new competitor'];
    case 'delete_competitor': return ['Add a new competitor', 'View remaining competitors'];
    case 'create_revenue_stream': return ['Add another revenue stream', 'Update stream inputs'];
    case 'update_revenue_stream': return ['Update another revenue stream', 'Add a new revenue stream'];
    case 'delete_revenue_stream': return ['Add a new revenue stream', 'View remaining streams'];
    case 'update_swot_entry': return ['Update another SWOT entry', 'Add a new SWOT entry'];
    case 'delete_swot_entry': return ['Add a new SWOT entry', 'View full SWOT analysis'];
    case 'update_okr': return ['Update KR progress', 'View all OKRs'];
    case 'update_work_costs': return ['Update fixed costs', 'View financial snapshot'];
    case 'update_collaborator_access': return ['Update another collaborator\'s access', 'View all collaborators'];
    case 'update_deliverable': return ['Mark this deliverable complete', 'Reschedule this deliverable'];
    case 'restore_project': return ['Add deliverables to this project', 'View all projects'];
    case 'restore_okr': return ['Update KR progress', 'View all OKRs'];
    case 'restore_product': return ['Update this product', 'View all products'];
    case 'restore_competitor': return ['Update this competitor', 'View all competitors'];
    case 'restore_swot_entry': return ['Add another SWOT entry', 'View full SWOT analysis'];
    case 'create_decision': return ['Log another decision', 'Create an assumption based on this'];
    case 'update_decision': return ['Log another decision', 'View all decisions'];
    case 'create_assumption': return ['Add another assumption', 'Update this assumption value'];
    case 'update_assumption': return ['Update another assumption', 'View all assumptions'];
    case 'resend_collaborator_invite': return ['View all collaborators', 'Resend another invite'];
    case 'update_workspace_member_role': return ['Update another member\'s role', 'View all workspace members'];
    case 'update_values_culture': return ['Update vision and goals', 'Create an OKR aligned to these values'];
    case 'update_market_info': return ['Add a competitor', 'View SWOT analysis'];
    case 'delete_org_position': return ['Create a new position', 'View remaining positions'];
    case 'delete_decision': return ['Log a new decision', 'View remaining decisions'];
    case 'delete_assumption': return ['Create a new assumption', 'View remaining assumptions'];
    case 'get_decisions': return ['Log a new decision', 'Update a decision status'];
    case 'get_assumptions': return ['Add a new assumption', 'Update an assumption value'];
    case 'invite_workspace_member': return ['Invite another member', 'View workspace members'];
    case 'remove_workspace_member': return ['Invite a replacement', 'View remaining members'];
    case 'update_workspace': return ['View workspace members', 'Update vision and goals'];
    case 'update_kr_fields': return ['Update KR progress', 'View all OKRs'];
    default: return [];
  }
}

// ── Mutation tools that should be logged in AgentActionLog ──
const MUTATION_TOOLS = new Set([
  'create_core_project', 'create_department_project', 'add_deliverable',
  'update_project', 'mark_deliverable_complete', 'reschedule_item',
  'assign_owner', 'delete_project', 'create_okr', 'delete_okr',
  'add_swot_entry', 'update_vision_goals', 'update_cash_position',
  'update_fixed_costs', 'create_org_position', 'update_org_position',
  'add_team_member', 'remove_team_member', 'invite_collaborator', 'revoke_collaborator',
  'update_kr_progress', 'notify_team_member',
  'delete_deliverable', 'move_deliverable', 'duplicate_project', 'batch_create_deliverables',
  'create_product', 'update_product', 'delete_product',
  'create_competitor', 'update_competitor', 'delete_competitor',
  'create_revenue_stream', 'update_revenue_stream', 'delete_revenue_stream',
  'update_swot_entry', 'delete_swot_entry', 'update_okr',
  'update_work_costs', 'update_collaborator_access',
  'update_deliverable', 'restore_project', 'restore_okr', 'restore_product', 'restore_competitor', 'restore_swot_entry',
  'create_decision', 'update_decision', 'create_assumption', 'update_assumption',
  'resend_collaborator_invite', 'update_workspace_member_role',
  'update_values_culture', 'update_market_info',
  'delete_org_position', 'delete_decision', 'delete_assumption',
  'invite_workspace_member', 'remove_workspace_member', 'update_workspace',
  'update_kr_fields',
  'create_vision_goal', 'update_vision_goal', 'delete_vision_goal',
  'create_department', 'delete_department',
]);

// ── Helpers for richer AI-driven project generation ──
function _sanitizeCurrency(s) {
  if (!s && s !== 0) return undefined;
  const str = String(s);
  const match = str.replace(/[,\s]/g, '').match(/\$?(-?\d+(?:\.\d{1,2})?)/);
  if (!match) return undefined;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return undefined;
  // Return simple string (keep as numeric string without $ to match existing storage pattern)
  return String(Math.round(num));
}

async function _aiEstimateBudget(userId, workspaceId, context, hint) {
  try {
    const ctxStr = formatContextForPrompt(context || {});
    const prompt = [
      ctxStr,
      '\nTask: Estimate a realistic project budget in dollars for the following project. Return ONLY a number (no currency symbol, no commas).',
      `Hint: ${hint}`,
    ].join('\n');
    const { content } = await callOpenAI(prompt, { model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 60 });
    return _sanitizeCurrency(content);
  } catch {
    return undefined;
  }
}

async function _aiSuggestDeliverables(userId, workspaceId, context, params) {
  const { departmentLabel, projectTitle, goal, count = 6 } = params;
  try {
    const ctxStr = formatContextForPrompt(context || {});
    const prompt = [
      ctxStr,
      '\nTask: List short, concrete deliverables for the following project. Each deliverable should be an action phrase (5-10 words).',
      `Department: ${departmentLabel || 'General'}`,
      projectTitle ? `Project Title: ${projectTitle}` : '',
      goal ? `Goal: ${goal}` : '',
      `Return a pure JSON array of ${count} strings. Example: ["Define campaign brief", "Launch pilot ads", ...]`,
    ].filter(Boolean).join('\n');
    const { data } = await require('../agents/base').callOpenAIJSON(prompt, { model: 'gpt-4o-mini', temperature: 0.5, maxTokens: 400 });
    if (Array.isArray(data)) {
      return data
        .map((t) => String(t || '').trim())
        .map((t) => t.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, ''))
        .filter(Boolean)
        .slice(0, count);
    }
  } catch {}
  return [];
}

async function _aiSuggestKPI(userId, workspaceId, context, deliverable, departmentLabel) {
  try {
    const ctxStr = formatContextForPrompt(context || {});
    const prompt = [
      ctxStr,
      'Task: Provide ONE quantifiable KPI with a specific numeric target for the deliverable. Keep it short.',
      `Department: ${departmentLabel || 'General'}`,
      `Deliverable: ${deliverable}`,
      'Return ONLY the KPI phrase (e.g., "Achieve 20% CTR", "Gain 500 qualified leads").',
    ].join('\n');
    const { content } = await callOpenAI(prompt, { model: 'gpt-4o-mini', temperature: 0.4, maxTokens: 60 });
    const raw = String(content || '').trim();
    // Strip any leading/trailing quotes (straight/curly/backticks)
    return raw.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '');
  } catch {
    return '';
  }
}

function _spreadDueDates(now, finalDate, n) {
  const out = [];
  const start = new Date(now);
  const end = new Date(finalDate);
  if (!Number.isFinite(end.getTime())) {
    // Default: +90 days
    end.setTime(Date.now() + 90 * 24 * 60 * 60 * 1000);
  }
  const totalMs = Math.max(1, end.getTime() - start.getTime());
  for (let i = 1; i <= n; i++) {
    const t = start.getTime() + Math.round((totalMs * i) / (n + 1));
    const d = new Date(Math.min(t, end.getTime()));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function _pickAssignee(workspaceId, deptKeyOrLabel) {
  try {
    const OrgPosition = require('../models/OrgPosition');
    const positions = await OrgPosition.find({ workspace: workspaceId, isDeleted: false }).select('name position department').lean();
    if (!positions || positions.length === 0) return null;
    const normDept = normalizeDepartmentKey(String(deptKeyOrLabel || '')) || '';
    // Prefer department-matching positions
    const inDept = positions.filter((p) => normalizeDepartmentKey(String(p.department || '')) === normDept);
    const pool = inDept.length ? inDept : positions;
    // Bias to managerial titles if possible
    const mgr = pool.find(p => /(head|lead|manager|director)/i.test(p.position || '')) || pool[0];
    return mgr?.name || null;
  } catch {
    return null;
  }
}

async function _getCycleWindow(workspaceId, type /* 'core' | 'department' */) {
  const { getWorkspaceFields } = require('../services/workspaceFieldService');
  const fields = await getWorkspaceFields(workspaceId);
  const fiscalStartMonth = Number(fields.fiscalYearStartMonth) || 1; // 1-12
  const rollThresholdDays = Number(fields.okrRollThresholdDays) || 10;
  function getAnnualWindow(now) {
    const startMonthIdx = fiscalStartMonth - 1;
    let year = now.getFullYear();
    const fyStart = new Date(year, startMonthIdx, 1);
    if (now < fyStart) year -= 1;
    const start = new Date(year, startMonthIdx, 1);
    const end = new Date(start);
    end.setFullYear(start.getFullYear() + 1);
    end.setDate(end.getDate() - 1);
    return { start, end };
  }
  function getQuarterWindow(now) {
    const startMonthIdx = fiscalStartMonth - 1;
    const nowMonth = now.getMonth();
    let diff = nowMonth - startMonthIdx; if (diff < 0) diff += 12;
    const qIndex = Math.floor(diff / 3);
    let qStartYear = now.getFullYear();
    const qStartMonth = (startMonthIdx + qIndex * 3) % 12;
    if (qStartMonth > nowMonth) qStartYear -= 1;
    const start = new Date(qStartYear, qStartMonth, 1);
    const nextQStart = new Date(start); nextQStart.setMonth(start.getMonth() + 3, 1);
    const end = new Date(nextQStart); end.setDate(0);
    const msPerDay = 24*60*60*1000;
    const daysLeft = Math.ceil((end.getTime() - now.getTime())/msPerDay);
    if (daysLeft >= 0 && daysLeft <= rollThresholdDays) {
      const nextStart = new Date(start); nextStart.setMonth(start.getMonth() + 3, 1);
      const nextEnd = new Date(nextStart); nextEnd.setMonth(nextStart.getMonth() + 3, 0);
      return { start: nextStart, end: nextEnd };
    }
    return { start, end };
  }
  const now = new Date();
  return type === 'core' ? getAnnualWindow(now) : getQuarterWindow(now);
}

// ── Similarity helpers to prevent duplicate OKR objectives ──
function _textTokens(text, minLen = 4) {
  const t = String(text || '').toLowerCase();
  return Array.from(new Set(t.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && w.length >= minLen)));
}
function _isSimilarObjective(a, b) {
  const A = _textTokens(a, 4);
  const B = _textTokens(b, 4);
  if (!A.length || !B.length) return false;
  const inter = A.filter((x) => B.includes(x)).length;
  const ratio = inter / Math.min(A.length, B.length);
  return ratio >= 0.7;
}
function _isSimilarKr(a, b) {
  const A = _textTokens(a, 3);
  const B = _textTokens(b, 3);
  if (!A.length || !B.length) return false;
  const inter = A.filter((x) => B.includes(x)).length;
  const ratio = inter / Math.min(A.length, B.length);
  return ratio >= 0.8;
}

// ── Helper: send workspace invite email (used by add_team_member tool) ──
async function _sendWorkspaceInviteEmail(member, workspaceId, invitedByUserId) {
  try {
    const { Resend } = require('resend');
    const workspace = await Workspace.findById(workspaceId).select('name').lean();
    const inviter = await User.findById(invitedByUserId).select('firstName lastName fullName email').lean();
    const inviterName = inviter?.fullName || `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() || 'Someone';
    const appUrl = process.env.FRONTEND_URL || 'https://app.plangenie.ai';
    const inviteUrl = `${appUrl}/workspace-invite?token=${member.inviteToken}`;
    const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);
    const workspaceName = workspace?.name || 'your workspace';

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>',
      to: member.email,
      subject: `You've been invited to join ${workspaceName} on Plan Genie`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#F8FAFC;">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,.05);">
            <h2 style="color:#1D4374;font-size:20px;font-weight:600;margin:0 0 16px;text-align:center;">Workspace Invitation</h2>
            <p style="color:#4B5563;font-size:15px;line-height:1.6;"><strong>${inviterName}</strong> has invited you to join <strong>${workspaceName}</strong> on Plan Genie as a <strong>${roleLabel}</strong>.</p>
            <div style="text-align:center;margin:32px 0;">
              <a href="${inviteUrl}" style="display:inline-block;background:#1D4374;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Accept Invitation</a>
            </div>
            <p style="color:#6B7280;font-size:13px;">Or copy this link: <a href="${inviteUrl}" style="color:#1D4374;">${inviteUrl}</a></p>
            <p style="color:#6B7280;font-size:13px;margin-top:24px;">This invitation expires in 7 days.</p>
          </div>
        </div>`,
      text: `${inviterName} has invited you to join ${workspaceName} on Plan Genie as a ${roleLabel}.\n\nAccept: ${inviteUrl}\n\nExpires in 7 days.`,
    });
  } catch (err) {
    console.error('[add_team_member] Failed to send invite email:', err?.message || err);
  }
}

// Simple JSON-safe parse
function tryParseJSON(text, fallback) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_) {
    return fallback;
  }
}

// Planner: ask the model which facts to fetch from DB for this user request
// Allowed ops:
// - user.profile
// - business.profile
// - team.members.count
// - team.members.list { limit?: number }
// - departments.count
// - departments.list { limit?: number }
// - coreProjects.count
// - coreProjects.list { limit?: number }
// - deadlines.list { limit?: number }
async function planFacts(messages, contextText) {
  const client = getOpenAI();
  const system = [
    'You are an assistant that returns ONLY JSON to plan which facts to fetch from the database.',
    'Use the minimal set of operations needed to answer the latest user message.',
    'Allowed ops: user.profile | business.profile | team.members.count | team.members.list | departments.count | departments.list | coreProjects.count | coreProjects.list | deadlines.list.',
    'JSON schema: { "operations": Array<{ "op": string, "limit"?: number }> }',
    'Do NOT include any text outside JSON. Avoid redundant operations.',
  ].join(' ');
  const lastUser = (messages || []).slice().reverse().find((m) => m && m.role !== 'assistant');
  const content = [
    contextText ? '(Context provided; do not duplicate here).' : '',
    'User message:',
    String(lastUser?.content || '').slice(0, 1000),
  ].filter(Boolean).join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 120,
    messages: [ { role: 'system', content: system }, { role: 'user', content } ],
  });
  let text = String(resp.choices?.[0]?.message?.content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();
  const j = tryParseJSON(text, { operations: [] });
  const ops = Array.isArray(j?.operations) ? j.operations : [];
  const allowed = new Set([
    'user.profile', 'business.profile',
    'team.members.count', 'team.members.list',
    'departments.count', 'departments.list',
    'coreProjects.count', 'coreProjects.list',
    'deadlines.list',
  ]);
  return ops
    .map((o) => ({ op: String(o?.op || '').trim(), limit: Number.isFinite(o?.limit) ? o.limit : undefined }))
    .filter((o) => allowed.has(o.op))
    .slice(0, 8);
}

async function executeFactsPlan({ userId, me, ob, teamMembers, teamMembersCount, departments, coreProjects, deptProjects, limitDefault = 20 }) {
  const facts = {};

  function deadlineItems() {
    // Build from new models only - no legacy fallback
    const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
    const items = [];
    try {
      (deptProjects || []).forEach((u) => {
        const d = parseDate(u?.dueWhen); if (!d) return;
        const goal = String(u?.goal || '').trim();
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        items.push({ when: d, label: [goal, u?.department && `Dept: ${u.department}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
      });
    } catch {}
    try {
      (coreProjects || []).forEach((p) => {
        (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
          const dt = parseDate(d?.dueWhen); if (!dt) return;
          const txt = String(d?.text || '').trim();
          items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    items.sort((x, y) => x.when - y.when);
    return items;
  }

  return {
    get user_profile() {
      const full = [String(me?.firstName||'').trim(), String(me?.lastName||'').trim()].filter(Boolean).join(' ') || String(me?.fullName||'').trim();
      return { name: full || undefined, email: me?.email || undefined, role: ob?.userProfile?.role || undefined };
    },
    get business_profile() {
      const bp = ob?.businessProfile || {};
      return { name: bp.businessName || me?.companyName || undefined, industry: bp.industry || undefined, location: [bp.city, bp.country].filter(Boolean).join(', ') || undefined };
    },
    get team_members_count() { return teamMembersCount || 0; },
    get team_members_list() { return (teamMembers || []).map((t)=>({ name: t?.name||'', role: t?.role||'', department: t?.department||'', email: t?.email||'' })); },
    get departments_count() { return (departments || []).length; },
    get departments_list() { return (departments || []).map((d)=>({ name: d?.name||'', status: d?.status||'', owner: d?.owner||'', dueDate: d?.dueDate||'' })); },
    get core_projects_count() {
      return (coreProjects || []).length;
    },
    get core_projects_list() {
      return (coreProjects || []).map((p) => ({
        title: String(p?.title||'').trim(),
        ownerName: p?.ownerName || '',
        dueWhen: p?.dueWhen || '',
        deliverables: Array.isArray(p?.deliverables) ? p.deliverables : []
      }));
    },
    get deadlines_list() { return deadlineItems(); },
  };
}

function buildContextText(ob, stats, extras, wsFields = {}, financialBaseline = null) {
  const bp = (ob && ob.businessProfile) || {};
  const up = (ob && ob.userProfile) || {};
  // Use workspace fields instead of ob.answers
  const a = wsFields || {};
  const fb = financialBaseline || {};
  const fallbackBiz = String(extras?.user?.companyName || '').trim();
  const userFullName = (String(up?.fullName || '').trim()) ||
    ([String(extras?.user?.firstName||'').trim(), String(extras?.user?.lastName||'').trim()].filter(Boolean).join(' ') || String(extras?.user?.fullName||'').trim());

  // Section: Business & User Profile
  const profileLines = [
    (bp.businessName || fallbackBiz) && `Business Name: ${bp.businessName || fallbackBiz}`,
    bp.businessWebsite && `Website: ${bp.businessWebsite}`,
    bp.industry && `Industry: ${bp.industry}`,
    bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
    bp.ventureType && `Venture Type: ${bp.ventureType}`,
    bp.teamSize && `Team Size: ${bp.teamSize}`,
    bp.businessStage && `Stage: ${bp.businessStage}`,
    typeof bp.funding === 'boolean' && `Has Funding: ${bp.funding ? 'Yes' : 'No'}`,
    Array.isArray(bp.tools) && bp.tools.length > 0 && `Tools Used: ${bp.tools.join(', ')}`,
    bp.description && `Business Profile Description: ${String(bp.description).trim()}`,
    up.role && `User Role: ${up.role}`,
    userFullName && `User Name: ${userFullName}`,
    up.planningGoal && `Planning Goal: ${up.planningGoal}`,
    typeof up.builtPlanBefore === 'boolean' && `Has Built Plan Before: ${up.builtPlanBefore ? 'Yes' : 'No'}`,
    typeof stats?.teamMembersCount === 'number' && `Active Team Members: ${stats.teamMembersCount}`,
    typeof stats?.departmentsCount === 'number' && `Departments: ${stats.departmentsCount}`,
    typeof stats?.coreProjectsCount === 'number' && `Core Projects: ${stats.coreProjectsCount}`,
    typeof stats?.departmentalProjectsCount === 'number' && `Departmental Projects: ${stats.departmentalProjectsCount}`,
    typeof stats?.productsCount === 'number' && `Products/Services: ${stats.productsCount}`,
    typeof stats?.orgPositionsCount === 'number' && `Organization Positions: ${stats.orgPositionsCount}`,
    typeof stats?.competitorsCount === 'number' && stats.competitorsCount > 0 && `Competitors: ${stats.competitorsCount}`,
    typeof stats?.swotCount === 'number' && stats.swotCount > 0 && `SWOT Entries: ${stats.swotCount}`,
    typeof stats?.oneYearGoalsCount === 'number' && stats.oneYearGoalsCount > 0 && `1-Year Goals: ${stats.oneYearGoalsCount}`,
    typeof stats?.threeYearGoalsCount === 'number' && stats.threeYearGoalsCount > 0 && `3-5 Year Goals: ${stats.threeYearGoalsCount}`,
    typeof stats?.collaboratorsCount === 'number' && `Collaborators: ${stats.collaboratorsCount}`,
  ].filter(Boolean);
  const profileText = profileLines.length ? `Context about the business:\n- ${profileLines.join('\n- ')}` : '';

  // Section: Vision & Values
  const vvParts = [];
  if (a.ubp) vvParts.push(`UBP: ${String(a.ubp).trim()}`);
  if (a.purpose) vvParts.push(`Purpose: ${String(a.purpose).trim()}`);
  if (a.visionBhag) vvParts.push(`BHAG: ${String(a.visionBhag).trim()}`);
  if (a.vision1y) vvParts.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.vision3y) vvParts.push(`3-5 Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.valuesCore) vvParts.push(`Core Values: ${String(a.valuesCore).trim()}`);
  if (a.cultureFeeling) vvParts.push(`Culture: ${String(a.cultureFeeling).trim()}`);
  const vvText = vvParts.length ? `\n\nVision & Values:\n- ${vvParts.join('\n- ')}` : '';

  // Section: Market & Competition
  const marketLines = [];
  if (a.targetCustomer || a.marketCustomer) marketLines.push(`Customer: ${String(a.targetCustomer || a.marketCustomer).trim()}`);
  if (a.partners || a.partnersDesc) marketLines.push(`Partners: ${String(a.partners || a.partnersDesc).trim()}`);
  if (a.competitorsNotes || a.compNotes) marketLines.push(`Competitors Notes: ${String(a.competitorsNotes || a.compNotes).trim()}`);
  if (Array.isArray(a.competitorNames) && a.competitorNames.length) marketLines.push(`Competitor Names: ${a.competitorNames.map(String).join(', ')}`);
  const marketText = marketLines.length ? `\n\nMarket & Competition:\n- ${marketLines.join('\n- ')}` : '';

  // Section: Products & Services
  let productsText = '';
  try {
    const prods = Array.isArray(a.products) ? a.products : [];
    if (prods.length) {
      const lines = prods.map((p) => {
        const name = String(p?.product || '').trim();
        const desc = String(p?.description || '').trim();
        const pricing = [
          typeof p?.price !== 'undefined' && String(p.price || '').trim() && `Price: ${String(p.price).trim()}`,
          typeof p?.unitCost !== 'undefined' && String(p.unitCost || '').trim() && `Unit Cost: ${String(p.unitCost).trim()}`,
          typeof p?.pricing !== 'undefined' && String(p.pricing || '').trim() && `Pricing: ${String(p.pricing).trim()}`,
          typeof p?.monthlyVolume !== 'undefined' && String(p.monthlyVolume || '').trim() && `Monthly Volume: ${String(p.monthlyVolume).trim()}`,
        ].filter(Boolean).join(' | ');
        const bits = [name && `Product: ${name}`, desc && `Desc: ${desc}`, pricing].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) productsText = `\n\nProducts & Services:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Organization (positions/structure)
  let orgText = '';
  try {
    const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    if (org.length) {
      const head = `Positions: ${org.length}`;
      const lines = org.slice(0, 50).map((o) => {
        const nm = String(o?.name || o?.position || '').trim();
        const pos = String(o?.position || '').trim();
        const dept = String(o?.department || '').trim();
        const bits = [nm, pos && `Role: ${pos}`, dept && `Dept: ${dept}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      orgText = `\n\nOrganization:\n- ${head}${lines.length ? `\n${lines.join('\n')}` : ''}`;
    }
  } catch {}

  // Section: Financial Snapshot (from FinancialBaseline model only)
  const finLines = [];
  let derivedText = '';
  try {
    const add = (label, v) => { if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '' && v !== 0) finLines.push(`${label}: ${String(v).trim()}`); };
    const formatCurrency = (v) => v ? `$${Number(v).toLocaleString()}` : null;

    // Use FinancialBaseline data if available
    if (fb && fb.revenue) {
      add('Monthly Revenue', formatCurrency(fb.revenue.totalMonthlyRevenue));
      add('Monthly Delivery Costs', formatCurrency(fb.revenue.totalMonthlyDeliveryCost));
      add('Revenue Streams Count', fb.revenue.streamCount);
    }
    if (fb && fb.workRelatedCosts) {
      add('Work-Related Costs (Monthly)', formatCurrency(fb.workRelatedCosts.total));
      if (fb.workRelatedCosts.contractors) add('  - Contractors', formatCurrency(fb.workRelatedCosts.contractors));
      if (fb.workRelatedCosts.materials) add('  - Materials', formatCurrency(fb.workRelatedCosts.materials));
      if (fb.workRelatedCosts.commissions) add('  - Commissions', formatCurrency(fb.workRelatedCosts.commissions));
      if (fb.workRelatedCosts.shipping) add('  - Shipping', formatCurrency(fb.workRelatedCosts.shipping));
    }
    if (fb && fb.fixedCosts) {
      add('Fixed Costs (Monthly)', formatCurrency(fb.fixedCosts.total));
      if (fb.fixedCosts.salaries) add('  - Salaries', formatCurrency(fb.fixedCosts.salaries));
      if (fb.fixedCosts.rent) add('  - Rent', formatCurrency(fb.fixedCosts.rent));
      if (fb.fixedCosts.software) add('  - Software', formatCurrency(fb.fixedCosts.software));
      if (fb.fixedCosts.insurance) add('  - Insurance', formatCurrency(fb.fixedCosts.insurance));
      if (fb.fixedCosts.utilities) add('  - Utilities', formatCurrency(fb.fixedCosts.utilities));
      if (fb.fixedCosts.marketing) add('  - Marketing', formatCurrency(fb.fixedCosts.marketing));
    }
    if (fb && fb.cash) {
      add('Current Cash Balance', formatCurrency(fb.cash.currentBalance));
      if (fb.cash.expectedFunding) add('Expected Funding', formatCurrency(fb.cash.expectedFunding));
      if (fb.cash.fundingDate) add('Funding Expected Date', new Date(fb.cash.fundingDate).toLocaleDateString());
    }
    if (fb && fb.metrics) {
      add('Monthly Net Surplus/Deficit', formatCurrency(fb.metrics.monthlyNetSurplus));
      add('Gross Profit', formatCurrency(fb.metrics.grossProfit));
      add('Gross Margin %', fb.metrics.grossMarginPercent ? `${Math.round(fb.metrics.grossMarginPercent)}%` : null);
      add('Net Margin %', fb.metrics.netMarginPercent ? `${Math.round(fb.metrics.netMarginPercent)}%` : null);
      add('Monthly Burn Rate', fb.metrics.monthlyBurnRate ? formatCurrency(fb.metrics.monthlyBurnRate) : null);
      add('Cash Runway', fb.metrics.cashRunwayMonths !== null ? (fb.metrics.cashRunwayMonths >= 999 ? 'Infinite (profitable)' : `${fb.metrics.cashRunwayMonths} months`) : null);
      add('Break-Even Revenue', formatCurrency(fb.metrics.breakEvenRevenue));
    }

    // No legacy fallback - only use FinancialBaseline data
  } catch {}

  // Create finText from finLines
  const finText = finLines.length ? `\n\nFinancial Snapshot:\n- ${finLines.join('\n- ')}` : '';

  // Section: Core Projects (from new CoreProject model via extras)
  let coreProjectsText = '';
  try {
    const cps = Array.isArray(extras?.coreProjects) ? extras.coreProjects : [];
    if (cps.length) {
      const lines = cps.map((p) => {
        const title = String(p?.title || '').trim();
        const goal = String(p?.goal || '').trim();
        const kpi = String(p?.kpi || '').trim();
        const due = String(p?.dueWhen || '').trim();
        const owner = String(p?.ownerName || '').trim();
        const head = ['Project', title || goal].filter(Boolean).join(': ');
        const meta = [owner && `Owner: ${owner}`, kpi && `KPI: ${kpi}`, due && `Due: ${due}`].filter(Boolean).join(' | ');
        const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
        const dlines = dels.map((d) => {
          const txt = String(d?.text || '').trim();
          const dk = String(d?.kpi || '').trim();
          const dd = String(d?.dueWhen || '').trim();
          const done = d?.done ? 'Done' : '';
          const bits = [txt && `• ${txt}`, dk && `KPI: ${dk}`, dd && `Due: ${dd}`, done].filter(Boolean);
          return bits.length ? '  - ' + bits.join(' | ') : '';
        }).filter(Boolean);
        return ['- ' + head, meta && '  - ' + meta, ...dlines].filter(Boolean).join('\n');
      });
      coreProjectsText = `\n\nCore Projects:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Action Plans by Department (from new DepartmentProject model via extras)
  let actionsText = '';
  try {
    const deptProjects = Array.isArray(extras?.deptProjects) ? extras.deptProjects : [];
    // Group by department
    const byDept = {};
    deptProjects.forEach((u) => {
      const dept = u?.department || 'Other';
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(u);
    });
    const lines = [];
    Object.entries(byDept).forEach(([dept, arr]) => {
      const alines = (arr || []).map((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return '';
        const kpi = String(u?.kpi || '').trim();
        const m = String(u?.milestone || '').trim();
        const r = String(u?.resources || '').trim();
        const due = String(u?.dueWhen || '').trim();
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const bits = [goal, owner && `Owner: ${owner}`, m && `Milestone: ${m}`, kpi && `KPI: ${kpi}`, r && `Resources: ${r}`, due && `Due: ${due}`].filter(Boolean);
        return bits.length ? '  - ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (alines.length) {
        lines.push(`- Department: ${dept}`);
        lines.push(...alines);
      }
    });
    if (lines.length) actionsText = `\n\nAction Plans:\n${lines.join('\n')}`;
  } catch {}

  // Section: Team Members (active)
  let teamText = '';
  try {
    const tm = Array.isArray(extras?.teamMembers) ? extras.teamMembers : [];
    if (tm.length) {
      const lines = tm.map((t) => {
        const name = String(t?.name || '').trim();
        const role = String(t?.role || '').trim();
        const dept = String(t?.department || '').trim();
        const email = String(t?.email || '').trim();
        const bits = [name && `Name: ${name}`, role && `Role: ${role}`, dept && `Dept: ${dept}`, email && `Email: ${email}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      teamText = `\n\nTeam Members (Active):\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Departments
  let departmentsText = '';
  try {
    const deps = Array.isArray(extras?.departments) ? extras.departments : [];
    if (deps.length) {
      const lines = deps.slice(0, 12).map((d) => {
        const nm = String(d?.name || '').trim();
        const st = String(d?.status || '').trim();
        const due = String(d?.dueDate || '').trim();
        const owner = String(d?.owner || '').trim();
        const bits = [nm && `Dept: ${nm}`, owner && `Owner: ${owner}`, st && `Status: ${st}`, due && `Due: ${due}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) departmentsText = `\n\nDepartments:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Upcoming Deadlines (aggregated from new models via extras)
  let deadlinesText = '';
  try {
    const parseDate = (s) => {
      const t = String(s || '').trim();
      if (!t) return null;
      const d = new Date(t);
      return isNaN(d.getTime()) ? null : d;
    };
    const items = [];
    // From DepartmentProject model
    try {
      const deptProjects = Array.isArray(extras?.deptProjects) ? extras.deptProjects : [];
      deptProjects.forEach((u) => {
        const d = parseDate(u?.dueWhen);
        if (!d) return;
        const goal = String(u?.goal || u?.title || '').trim();
        const dept = u?.department || u?.departmentKey || '';
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
      });
    } catch {}
    // From CoreProject model deliverables
    try {
      const coreProjects = Array.isArray(extras?.coreProjects) ? extras.coreProjects : [];
      coreProjects.forEach((p) => {
        (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
          const dt = parseDate(d?.dueWhen);
          if (!dt) return;
          const txt = String(d?.text || '').trim();
          items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    items.sort((x, y) => x.when - y.when);
    if (items.length) deadlinesText = `\n\nUpcoming Deadlines:\n- ${items.slice(0, 50).map((it) => `${it.when.toISOString().slice(0,10)} — ${it.label}`).join('\n- ')}`;
  } catch {}

  return [
    profileText,
    vvText,
    marketText,
    productsText,
    orgText,
    finText,
    derivedText,
    coreProjectsText,
    actionsText,
    teamText,
    departmentsText,
    deadlinesText,
  ].filter(Boolean).join('\n');
}

exports.respond = async (req, res) => {
  // Rate limiting
  const rlKey = req.user?.id || req.ip;
  if (_checkRateLimit(rlKey)) {
    return res.status(429).json({ error: 'Too many messages. Please wait a moment before sending another.' });
  }

  // Streaming support — pass stream:true in body to receive SSE events
  const wantStream = req.body?.stream === true;
  if (wantStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }
  const sendSSE = (data) => { if (wantStream) res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const sendFinal = (reply, wsF, msgs, agentT, followUps = []) => {
    // Fire-and-forget history persistence
    if (wsF?.workspace && wsF?.user) {
      const lastUser = Array.isArray(msgs) ? msgs[msgs.length - 1] : null;
      ChatHistory.appendMessages(wsF.workspace, wsF.user, [
        ...(lastUser?.role === 'user' ? [{ role: 'user', content: String(lastUser.content || '').slice(0, 2000), agentType: agentT }] : []),
        { role: 'assistant', content: reply, agentType: agentT },
      ]).catch(() => {});
    }
    if (wantStream) {
      res.write(`data: ${JSON.stringify({ type: 'reply', text: reply })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', followUps })}\n\n`);
      return res.end();
    }
    return res.json({ reply });
  };

  try {
    const raw = req.body?.messages;
    const wantDebug = (req?.query && String(req.query.debug||'') === '1') || (req.body && req.body.debug === true);
    const agentType = String(req.body?.agentType || '').trim() || null;
    const agentContext = req.body?.agentContext || null;
    const mentionedProjects = Array.isArray(req.body?.mentionedProjects) ? req.body.mentionedProjects : [];
    const messages = Array.isArray(raw) ? raw : [];
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    sendSSE({ type: 'status', text: 'Analyzing your workspace...' });
    const ob = userId ? await Onboarding.findOne(wsFilter) : null;

    // Derive simple, real user stats to ground AI responses
    let stats = {};
    // Store fetched data from new CRUD models for use in tool calls
    let crudData = { coreProjects: [], deptProjects: [], products: [], orgPositions: [], competitors: [], swotEntries: [], collaborations: [] };
    try {
      if (userId) {
        const workspaceId = getWorkspaceId(req);
        const crudFilter = { user: userId, isDeleted: { $ne: true } };
        if (workspaceId) crudFilter.workspace = workspaceId;

        let [me, teamMembersCount, teamMembers, departments, coreProjects, deptProjects, products, orgPositions, competitors, swotEntries, collaborations] = await Promise.all([
          User.findById(userId).lean().exec(),
          TeamMember.countDocuments({ ...wsFilter, status: 'Active' }).exec(),
          TeamMember.find({ ...wsFilter, status: 'Active' }).select('name email role department status').limit(200).lean().exec(),
          Department.find(wsFilter).select('name status owner dueDate').limit(50).lean().exec(),
          // New CRUD models
          CoreProject.find(crudFilter).sort({ order: 1 }).lean(),
          DepartmentProject.find(crudFilter).sort({ order: 1 }).lean(),
          Product.find(crudFilter).sort({ order: 1 }).lean(),
          OrgPosition.find(crudFilter).sort({ order: 1 }).lean(),
          Competitor.find(crudFilter).sort({ order: 1 }).lean(),
          SwotEntry.find(crudFilter).sort({ order: 1 }).lean(),
          // Collaborators (people invited to the workspace)
          Collaboration.find({ owner: userId, status: 'accepted' }).populate('collaborator', 'firstName lastName email').lean(),
        ]);

        // Also fetch pending invites for tools
        let pendingInvites = [];
        try {
          pendingInvites = await Collaboration.find({ owner: userId, status: 'pending' }).lean().exec();
        } catch {}

        // Store for use in runTool
        crudData = { coreProjects: coreProjects || [], deptProjects: deptProjects || [], products: products || [], orgPositions: orgPositions || [], competitors: competitors || [], swotEntries: swotEntries || [], collaborations: collaborations || [], collabInvites: pendingInvites || [] };

        // Read from Workspace.fields instead of Onboarding.answers
        const a = await getWorkspaceFields(workspaceId);
        // Prefer orgPositions from new OrgPosition model, fallback to workspace fields
        try {
          const org = orgPositions && orgPositions.length > 0 ? orgPositions : (Array.isArray(a.orgPositions) ? a.orgPositions : []);
          if (org.length) {
            const active = org.filter((p) => String(p?.status || 'Active').trim() === 'Active');
            teamMembers = active.map((p) => ({
              name: String(p?.name || '').trim(),
              email: String(p?.email || '').trim(),
              role: String(p?.position || p?.role || '').trim(),
              department: String(p?.department || '').trim(),
              status: 'Active',
            }));
            teamMembersCount = teamMembers.length;
          }
        } catch {}
        // Derive departments from DepartmentProject model only - no legacy fallback
        try {
          if ((!Array.isArray(departments) || departments.length === 0) && deptProjects && deptProjects.length > 0) {
            // Get unique departments from DepartmentProject
            const deptSet = new Set();
            deptProjects.forEach((p) => {
              const dk = String(p?.departmentKey || '').trim();
              if (dk) deptSet.add(dk);
            });
            const label = (k) => ({
              marketing: 'Marketing', sales: 'Sales', operations:'Operations and Service Delivery', financeAdmin:'Finance and Admin', peopleHR:'People and Human Resources', partnerships:'Partnerships and Alliances', technology:'Technology and Infrastructure', communityImpact:'ESG and Sustainability'
            }[k] || k);
            departments = Array.from(deptSet).map((k) => ({ name: label(k) }));
          }
        } catch {}

        // Use new CRUD models for counts only - no legacy fallback
        const coreProjectsCount = coreProjects.length;
        const departmentalProjectsCount = deptProjects.length;
        const productsCount = products.length;
        const orgPositionsCount = orgPositions.length;
        const competitorsCount = competitors.length;
        const swotCount = swotEntries.length;
        const collaboratorsCount = (collaborations || []).length;
        // Count 1-year goals
        const oneYearGoalsCount = String(a.vision1y || '').trim().split('\n').filter(Boolean).length;
        // Count 3-year goals
        const threeYearGoalsCount = String(a.vision3y || '').trim().split('\n').filter(Boolean).length;
        // Count departments
        const departmentsCount = (departments || []).length;
        stats = { teamMembersCount, departmentsCount, coreProjectsCount, departmentalProjectsCount, productsCount, orgPositionsCount, competitorsCount, swotCount, oneYearGoalsCount, threeYearGoalsCount, collaboratorsCount };

        // Fetch financial baseline data (use getOrCreate and sync to match financials page)
        let financialBaseline = null;
        try {
          const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);
          // Sync revenue from streams to ensure fresh data (like financials page does)
          await baseline.syncRevenueFromStreams();
          await baseline.save();
          financialBaseline = baseline.toObject();
        } catch {}

        // Build context with expanded extras (including new model data and financial baseline)
        const contextText = buildContextText(ob, stats, { teamMembers, departments, user: me, coreProjects, deptProjects }, a, financialBaseline);

        // No regex intercepts — use tool-calling planner pattern below

        // Optional: augment with internal business trainer snippets
        let ragText = '';
        try {
          if (process.env.RAG_ENABLE !== 'false') {
            const lastUser = messages.slice(-5).map((m)=>String(m?.content||'')).join(' \n ').slice(0, 500);
            const seed = [contextText, lastUser].filter(Boolean).join(' \n ');
            const results = await rag.retrieve(seed);
            if (results && results.length) ragText = 'Additional guidance from Business Trainer (internal knowledge):\n' + results.map((r)=>r.text).join('\n\n---\n\n');
          }
        } catch {}
        
        const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const system = [
          'You are Plangenie, a strategic business advisor with deep expertise in business transformation, growth strategy, and operational excellence.',
          'Think like a trusted board advisor combined with a hands-on operator who understands the realities of building businesses.',
          `Today's date is ${todayDate}.`,
          'CRITICAL: Every response must demonstrate deep understanding of THIS specific business - their industry, stage, goals, challenges, and opportunities.',
          'Draw insights from their complete context: UVP, purpose, vision, SWOT analysis, competitive landscape, financials, team structure, and strategic projects.',
          'Be direct, confident, and strategic. Provide insights that could only apply to THIS business, not generic advice.',
          'Ground every answer in the provided business context and the conversation. Do not invent facts or numbers.',
          'IMPORTANT: Information from your previous responses in this conversation is valid context. Reference data you mentioned earlier when answering follow-ups.',
          'If a detail is missing from both the context AND conversation history, say what is missing and ask a concise follow-up question.',
          'When giving recommendations, explicitly connect them to the business\'s stated goals, competitive advantages, and strategic priorities.',
          'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
          'Prefer concrete, prioritized action items tied to their specific departments, projects, team members, KPIs, and deadlines.',
          'Never provide generic templates or boilerplate. Every recommendation must be tailored to this business.',
          'Never mention that you are an AI model.',
          'Never output example or placeholder names; only use names enumerated in the context or mentioned in prior conversation messages.',
          'If team member names are not in context, do not guess; state that they are not provided.',
          'IMPORTANT: You are not just a reporting advisor. You can take real actions on this platform. When the user asks you to create a project, add a deliverable, assign an owner, reschedule a task, mark something complete, or delete a project — use the available action tools to do it immediately. Do not just give advice; actually execute the action. After completing an action, briefly confirm what was done.',
          'PROJECTS: When creating a core project, always call get_okrs first to retrieve available Core OKRs and their key result IDs. Core projects MUST link to a Core OKR key result and require executiveSponsorName, responsibleLeadName, and departments. When creating a department project, always call get_okrs first to retrieve available Department OKRs for that department. Department projects MUST link to a Department OKR key result in the same department.',
          'DEPARTMENTS: To create a new department (so it appears on Departments and in selectors), call create_department with a name (and optional key). This updates workspace configuration (actionSections/editableDepts).',
          'PEOPLE: There are two distinct concepts. (1) Team Members — people on the internal roster/directory (name, role, department). Use add_team_member when the user says "add [name] to the team", "add a team member", or mentions a person by name. No email needed, no invite sent. (2) Collaborators — people who need actual login access to the platform. Use invite_collaborator ONLY when the user explicitly says "invite", "give access", "send an invite", or "add as a collaborator". This sends an email invite and requires an email address. Never use invite_collaborator just because someone says "add a team member".',
          'WHEN ASKED ABOUT TEAM: If the user asks for the number of team members or their names, ALWAYS call get_team_members_count and/or get_team_members before answering. Do not reply that the information is not provided without first calling these tools.',
          'SAFETY: Before calling delete_project or delete_department, ALWAYS confirm with the user first. Say exactly: "Are you sure you want to delete [item]? Reply yes to confirm." Only call delete_project/delete_department after the user confirms. Similarly, before calling remove_team_member or revoke_collaborator, confirm with: "Are you sure you want to remove [name/email]? Reply yes to confirm." Only proceed after the user confirms.',
        ].join(' ');

        const safeMsgs = messages
          .slice(-20)
          .map((m) => ({
            role: m?.role === 'assistant' ? 'assistant' : 'user',
            content: String(m?.content ?? '').slice(0, 4000),
          }));
        // TOOL CALLING: Let the model decide which DB-backed tools to call, then answer with verified facts
        const tools = [
          { type: 'function', function: { name: 'get_user_profile', description: 'Get user profile from onboarding (name, email, role, planning goal, planning preferences).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_business_profile', description: 'Get business profile from onboarding (name, website, industry, stage, location, venture type, team size, funding status, tools, description).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_team_members_count', description: 'Get count of active team members.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_team_members', description: 'List active team members.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departments_count', description: 'Get count of departments.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departments', description: 'List departments.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'create_department', description: 'Create a new department (adds to workspace configuration so it appears on Departments page and selectors).', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Department display name (required)' }, key: { type: 'string', description: 'Optional unique key (letters/numbers only). If omitted, derived from name.' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_projects_count', description: 'Get count of core strategic projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_projects', description: 'List core strategic projects.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_deliverables_count', description: 'Get count of active (not completed) deliverables under core strategic projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_deadlines', description: 'List upcoming deadlines.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_projects_count', description: 'Get count of departmental projects (action items assigned across all departments).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_projects', description: 'List departmental projects (action items assigned to departments), including their deliverables.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 }, department: { type: 'string', description: 'Optional: filter by department key' } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_deliverables_count', description: 'Get count of active (not completed) deliverables under departmental projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_products', description: 'List products and services offered by the business.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_products_count', description: 'Get count of products/services.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_financial_snapshot', description: 'Get financial data including revenue, costs, cash, funding, margins.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_vision_and_goals', description: 'Get business vision, UBP (unique business proposition), purpose, and 1-year/3-5 year goals.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_values_and_culture', description: 'Get core values, culture, and character traits.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_market_info', description: 'Get market information including ideal customer, partners, competitors.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_org_positions', description: 'Get organizational structure and positions.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_overdue_tasks', description: 'Get tasks and deadlines that are past their due date (overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_upcoming_tasks', description: 'Get tasks and deadlines due in the future (not yet overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 }, days: { type: 'number', description: 'Optional: only include tasks due within this many days' } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_swot_analysis', description: 'Get SWOT analysis (strengths, weaknesses, opportunities, threats).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_competitors', description: 'Get list of competitors with their advantages.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 20 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_collaborators', description: 'Get list of collaborators (people invited to collaborate on the workspace/team).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_collaborators_count', description: 'Get count of collaborators on the team.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_pending_invites', description: 'Get list of pending collaborator invitations.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_pending_invites_count', description: 'Get count of pending collaborator invitations.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          // ── Action / Mutation tools ──
          { type: 'function', function: { name: 'create_core_project', description: 'Create a new core strategic project. Requires a title, executive sponsor, responsible lead, at least one department, and must be linked to a Core OKR Key Result. Call get_okrs first to get valid linkedCoreOKR and linkedCoreKrId values.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Project title (required)' }, executiveSponsorName: { type: 'string', description: 'Name of the executive sponsor (required)' }, responsibleLeadName: { type: 'string', description: 'Name of the responsible project lead (required)' }, departments: { type: 'array', items: { type: 'string' }, description: 'Department keys involved in this project (required, e.g. ["marketing", "sales"])' }, linkedCoreOKR: { type: 'string', description: '_id of the Core OKR to link this project to (required) — use get_okrs to find' }, linkedCoreKrId: { type: 'string', description: '_id of the specific Key Result within that OKR (required) — use get_okrs to find' }, description: { type: 'string', description: 'Project description' }, goal: { type: 'string', description: 'Project goal or objective' }, dueWhen: { type: 'string', description: 'Due date in YYYY-MM-DD format' }, cost: { type: 'string', description: 'Estimated cost or budget' }, ownerName: { type: 'string', description: 'Owner full name' }, priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Project priority level' }, linkedGoals: { type: 'array', items: { type: 'string' }, description: 'VisionGoal _ids this project is linked to — get from get_vision_and_goals' } }, required: ['title', 'executiveSponsorName', 'responsibleLeadName', 'departments', 'linkedCoreOKR', 'linkedCoreKrId'], additionalProperties: false } } },
          { type: 'function', function: { name: 'create_department_project', description: 'Create a new departmental project for a specific department. Must be linked to a Department OKR Key Result in the same department. Call get_okrs first to get valid linkedDeptOKR and linkedDeptKrId values.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Project title (required)' }, department: { type: 'string', description: 'Department key (required). E.g. marketing, sales, operations, financeAdmin, peopleHR, technology, partnerships, communityImpact.' }, linkedDeptOKR: { type: 'string', description: '_id of the Department OKR to link this project to (required) — use get_okrs to find' }, linkedDeptKrId: { type: 'string', description: '_id of the Key Result within that Department OKR (required) — use get_okrs to find' }, description: { type: 'string', description: 'Project description' }, goal: { type: 'string', description: 'Project goal or objective' }, dueWhen: { type: 'string', description: 'Due date in YYYY-MM-DD format' }, cost: { type: 'string', description: 'Estimated cost or budget' }, ownerName: { type: 'string', description: 'Full name of the person responsible' }, milestone: { type: 'string', description: 'Key milestone' }, resources: { type: 'string', description: 'Resources needed' }, kpi: { type: 'string', description: 'Key performance indicator' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['title', 'department', 'linkedDeptOKR', 'linkedDeptKrId'], additionalProperties: false } } },
          { type: 'function', function: { name: 'add_deliverable', description: 'Add a deliverable, task, or milestone to an existing project. Call this when the user wants to add a task or deliverable to a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'], description: 'Whether to add to a core project or department project' }, projectId: { type: 'string', description: 'The project _id (use if available from get_core_projects or get_departmental_projects)' }, projectTitle: { type: 'string', description: 'Project title to find by (used if projectId not known)' }, text: { type: 'string', description: 'The deliverable text or task name (required)' }, dueWhen: { type: 'string', description: 'Due date in YYYY-MM-DD format' }, ownerName: { type: 'string', description: 'Name of the person responsible' }, kpi: { type: 'string', description: 'KPI for this deliverable' } }, required: ['projectType', 'text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_project', description: 'Update an existing project\'s fields. Call this when user wants to edit, change, rename, or update a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' }, newTitle: { type: 'string', description: 'New title for the project' }, goal: { type: 'string', description: 'New goal text' }, dueWhen: { type: 'string', description: 'New due date (YYYY-MM-DD)' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, ownerName: { type: 'string', description: 'New owner name' }, executiveSponsorName: { type: 'string', description: 'Executive sponsor name (core projects only)' }, responsibleLeadName: { type: 'string', description: 'Responsible project lead name (core projects only)' }, departments: { type: 'array', items: { type: 'string' }, description: 'Department keys involved (core projects only)' }, linkedCoreOKR: { type: 'string', description: 'Core OKR _id to link/change (core projects only)' }, linkedCoreKrId: { type: 'string', description: 'Core KR _id to link/change (core projects only)' }, milestone: { type: 'string', description: 'Key milestone (department projects only)' }, resources: { type: 'string', description: 'Resources needed (department projects only)' }, linkedDeptOKR: { type: 'string', description: 'Department OKR _id to link/change (department projects only)' }, linkedDeptKrId: { type: 'string', description: 'Department KR _id to link/change (department projects only)' }, description: { type: 'string', description: 'Project description' }, cost: { type: 'string', description: 'Estimated cost or budget' }, linkedGoals: { type: 'array', items: { type: 'string' }, description: 'VisionGoal _ids (core projects only)' } }, required: ['projectType'], additionalProperties: false } } },
          { type: 'function', function: { name: 'mark_deliverable_complete', description: 'Mark a specific deliverable or task as complete. Call this when user says something is done, finished, or completed.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' }, deliverableText: { type: 'string', description: 'The text or title of the deliverable to mark complete (required)' } }, required: ['projectType', 'deliverableText'], additionalProperties: false } } },
          { type: 'function', function: { name: 'reschedule_item', description: 'Change the due date of a project or one of its deliverables. Call this when user wants to reschedule, push back, or move a deadline.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' }, deliverableText: { type: 'string', description: 'Deliverable text if rescheduling a specific deliverable (omit to reschedule the whole project)' }, newDate: { type: 'string', description: 'New due date in YYYY-MM-DD format (required)' } }, required: ['projectType', 'newDate'], additionalProperties: false } } },
          { type: 'function', function: { name: 'assign_owner', description: 'Assign an owner to a project or one of its deliverables. Call this when user wants to assign, delegate, or give someone responsibility.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' }, deliverableText: { type: 'string', description: 'Deliverable text if assigning to a specific deliverable (omit to assign to the whole project)' }, ownerName: { type: 'string', description: 'Full name of the owner to assign (required)' } }, required: ['projectType', 'ownerName'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_project', description: 'Soft-delete a project. Only call this when user explicitly and clearly asks to delete or remove a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' } }, required: ['projectType'], additionalProperties: false } } },
          { type: 'function', function: { name: 'create_okr', description: 'Create a new OKR (Objective and Key Results). Core OKRs need 2-4 key results and derivedFromGoals (get goal IDs via get_vision_and_goals). Department OKRs need departmentKey, anchorCoreOKR, and anchorCoreKrId (get via get_okrs).', parameters: { type: 'object', properties: { objective: { type: 'string', description: 'The objective statement (required)' }, okrType: { type: 'string', enum: ['core', 'department'], description: 'Core OKR or department OKR (default: core)' }, departmentKey: { type: 'string', description: 'Department key — required for department OKRs' }, derivedFromGoals: { type: 'array', items: { type: 'string' }, description: 'Array of VisionGoal _ids this core OKR is derived from. Get IDs via get_vision_and_goals.' }, anchorCoreOKR: { type: 'string', description: '_id of the Core OKR this department OKR anchors to — required for department OKRs' }, anchorCoreKrId: { type: 'string', description: '_id of the Core KR this department OKR anchors to — required for department OKRs' }, keyResults: { type: 'array', description: 'Key results (2-4 required for core OKRs)', items: { type: 'object', properties: { text: { type: 'string' }, metric: { type: 'string' }, unit: { type: 'string' }, direction: { type: 'string', enum: ['increase', 'decrease'] }, baseline: { type: 'number' }, target: { type: 'number' }, current: { type: 'number' }, startAt: { type: 'string', description: 'ISO date string' }, endAt: { type: 'string', description: 'ISO date string' }, linkTag: { type: 'string', enum: ['driver', 'enablement', 'operational'], description: 'Required for department KRs' } }, required: ['text'], additionalProperties: false } }, notes: { type: 'string' } }, required: ['objective'], additionalProperties: false } } },
          { type: 'function', function: { name: 'add_swot_entry', description: 'Add a new entry to the SWOT analysis. Call this when the user wants to add a strength, weakness, opportunity, or threat.', parameters: { type: 'object', properties: { entryType: { type: 'string', enum: ['strength', 'weakness', 'opportunity', 'threat'], description: 'Type of SWOT entry (required)' }, text: { type: 'string', description: 'The entry text (required)' }, notes: { type: 'string', description: 'Optional additional notes' }, priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Priority level' } }, required: ['entryType', 'text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'get_okrs', description: 'List existing OKRs and their key results. Use this to find OKR IDs or key result text before updating progress.', parameters: { type: 'object', properties: { okrType: { type: 'string', enum: ['core', 'department'], description: 'Filter by type (optional)' }, limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'create_vision_goal', description: 'Create an individual 1-year or 3-year goal item. Call this when the user wants to add a specific goal to their 1-year or 3-5 year goals list.', parameters: { type: 'object', properties: { goalType: { type: 'string', enum: ['1y', '3y'], description: 'Goal type: 1y for one-year, 3y for three-year (required)' }, text: { type: 'string', description: 'Goal text (required)' }, notes: { type: 'string', description: 'Optional notes for the goal' } }, required: ['goalType', 'text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_vision_goal', description: 'Update an existing individual 1-year or 3-year goal item by its text. Call this when the user wants to edit a specific goal.', parameters: { type: 'object', properties: { goalType: { type: 'string', enum: ['1y', '3y'], description: 'Goal type to narrow the search' }, text: { type: 'string', description: 'Current goal text to search by (required)' }, newText: { type: 'string', description: 'Updated goal text' }, notes: { type: 'string', description: 'Updated notes' } }, required: ['text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_vision_goal', description: 'Delete an individual 1-year or 3-year goal item. Call this when the user wants to remove a specific goal from their list.', parameters: { type: 'object', properties: { goalType: { type: 'string', enum: ['1y', '3y'], description: 'Goal type to narrow the search' }, text: { type: 'string', description: 'Goal text to search by (required)' } }, required: ['text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_vision_goals', description: 'Update the business vision, purpose, UBP, 1-year goals, 3-5 year goals, or BHAG. Call this when the user wants to update their vision, purpose, or strategic goals.', parameters: { type: 'object', properties: { ubp: { type: 'string', description: 'Unique Business Proposition / UVP' }, purpose: { type: 'string', description: 'Company purpose statement' }, vision1y: { type: 'string', description: '1-year goals or vision' }, vision3y: { type: 'string', description: '3-5 year goals or vision' }, visionBhag: { type: 'string', description: 'BHAG (Big Hairy Audacious Goal)' }, missionStatement: { type: 'string', description: 'Mission statement' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_cash_position', description: 'Update the business cash position, current balance, or expected funding. Call this when the user updates their bank balance, cash, or investment details.', parameters: { type: 'object', properties: { currentBalance: { type: 'number', description: 'Current cash balance' }, expectedFunding: { type: 'number', description: 'Expected funding/investment amount' }, fundingDate: { type: 'string', description: 'Expected funding date (YYYY-MM-DD)' }, fundingType: { type: 'string', enum: ['investment', 'loan', 'grant'], description: 'Type of funding' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_fixed_costs', description: 'Update fixed cost categories in the financial baseline such as salaries, rent, software, marketing. Call this when the user updates their overhead costs.', parameters: { type: 'object', properties: { salaries: { type: 'number' }, rent: { type: 'number' }, software: { type: 'number' }, insurance: { type: 'number' }, utilities: { type: 'number' }, marketing: { type: 'number' }, other: { type: 'number' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'create_org_position', description: 'Create a new position in the org chart. Call this when the user wants to add a role or job title to the organization.', parameters: { type: 'object', properties: { position: { type: 'string', description: 'Job title or role name (required)' }, name: { type: 'string', description: 'Name of the person filling this role' }, email: { type: 'string', description: 'Person email' }, department: { type: 'string', description: 'Department' }, role: { type: 'string', description: 'Role description or responsibilities' } }, required: ['position'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_org_position', description: 'Update an existing org chart position — assign someone to it, rename it, or change its department. Call this when assigning a person to a role.', parameters: { type: 'object', properties: { positionTitle: { type: 'string', description: 'Current position title to search by (required)' }, newTitle: { type: 'string', description: 'New job title if renaming' }, name: { type: 'string', description: 'Person to assign' }, email: { type: 'string', description: 'Person email' }, department: { type: 'string', description: 'New department' }, role: { type: 'string', description: 'Updated description' } }, required: ['positionTitle'], additionalProperties: false } } },
          { type: 'function', function: { name: 'add_team_member', description: 'Add a person to the team roster so they appear in Settings > Team. Use this when the user says "add [name] to the team" or "create a team member". Does NOT grant platform login access or send any email — use invite_collaborator for that.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Full name of the person (required)' }, position: { type: 'string', description: 'Job title or role (e.g. "Marketing Manager", "Developer"). Defaults to "Team Member" if not provided.' }, email: { type: 'string', description: 'Email address (optional)' }, department: { type: 'string', description: 'Department they belong to (optional)' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'remove_team_member', description: 'Remove a person from the team roster. Call this when the user explicitly asks to remove, delete, or dismiss a team member. Requires a name to identify the person.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Full name (or partial name) of the team member to remove (required)' }, positionId: { type: 'string', description: 'OrgPosition _id if known' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'invite_collaborator', description: 'Invite someone to view the dashboard as a collaborator by sending them an email invite. Use ONLY when the user explicitly says "invite", "give access", "send an invite to", or "add as a collaborator". Requires a valid email address. Will fail if the email belongs to an existing full account holder.', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Email address of the person to invite (required)' } }, required: ['email'], additionalProperties: false } } },
          { type: 'function', function: { name: 'revoke_collaborator', description: 'Revoke a collaborator\'s access to the dashboard. Call this when the user explicitly asks to revoke, remove, or cancel access for a collaborator. Requires the collaborator\'s email address.', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Email address of the collaborator to revoke (required)' } }, required: ['email'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_kr_progress', description: 'Update the current progress value of a Key Result in an OKR. Call this when the user wants to log progress, update a metric, or record an achievement on a KR.', parameters: { type: 'object', properties: { krText: { type: 'string', description: 'Key result text to find (required)' }, current: { type: 'number', description: 'New current value (required)' }, okrId: { type: 'string', description: 'OKR _id if known' }, objective: { type: 'string', description: 'OKR objective to find by' } }, required: ['krText', 'current'], additionalProperties: false } } },
          { type: 'function', function: { name: 'notify_team_member', description: 'Send an email notification or reminder to a team member. Call this when the user wants to notify, remind, or message someone on the team about a task or deadline.', parameters: { type: 'object', properties: { recipientEmail: { type: 'string', description: 'Recipient email address (required)' }, recipientName: { type: 'string', description: 'Recipient name' }, subject: { type: 'string', description: 'Email subject (required)' }, message: { type: 'string', description: 'Message body (required)' } }, required: ['recipientEmail', 'subject', 'message'], additionalProperties: false } } },
          { type: 'function', function: { name: 'batch_create_deliverables', description: 'Add multiple deliverables/tasks to a project at once. Use when the user wants to add several tasks in a single operation instead of one at a time.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by (required if no projectId)' }, deliverables: { type: 'array', description: 'List of deliverables to add', items: { type: 'object', properties: { text: { type: 'string', description: 'Deliverable text (required)' }, dueWhen: { type: 'string', description: 'Due date YYYY-MM-DD' }, ownerName: { type: 'string', description: 'Person responsible' } }, required: ['text'] }, minItems: 1, maxItems: 20 } }, required: ['projectType', 'deliverables'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_deliverable', description: 'Remove a specific deliverable or task from a project. Call this when the user wants to delete or remove a task from a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by' }, deliverableText: { type: 'string', description: 'The deliverable text to delete (required)' } }, required: ['projectType', 'deliverableText'], additionalProperties: false } } },
          { type: 'function', function: { name: 'move_deliverable', description: 'Move a deliverable from one project to another. Call this when the user wants to move or transfer a task between projects.', parameters: { type: 'object', properties: { sourceProjectType: { type: 'string', enum: ['core', 'department'], description: 'Project type of the source project (required)' }, sourceProjectTitle: { type: 'string', description: 'Source project title (required)' }, deliverableText: { type: 'string', description: 'The deliverable text to move (required)' }, targetProjectType: { type: 'string', enum: ['core', 'department'], description: 'Project type of the target project (required)' }, targetProjectTitle: { type: 'string', description: 'Target project title (required)' } }, required: ['sourceProjectType', 'sourceProjectTitle', 'deliverableText', 'targetProjectType', 'targetProjectTitle'], additionalProperties: false } } },
          { type: 'function', function: { name: 'duplicate_project', description: 'Create a copy of an existing project with all its deliverables. Call this when the user wants to duplicate or copy a project as a template.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to find by (required if no id)' }, newTitle: { type: 'string', description: 'Title for the duplicate project (required)' } }, required: ['projectType', 'newTitle'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_okr', description: 'Delete an OKR (Objective and Key Results). Call this when the user explicitly asks to delete or remove an OKR.', parameters: { type: 'object', properties: { okrId: { type: 'string', description: 'OKR _id if known' }, objective: { type: 'string', description: 'OKR objective text to find by' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'get_workspace_members', description: 'List workspace members with their roles and invite status. Use this to find who has access to the workspace before inviting or managing members.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          // ── Products ──
          { type: 'function', function: { name: 'create_product', description: 'Add a new product or service to the business. Call this when the user wants to add a product, service, or offering.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Product or service name (required)' }, description: { type: 'string', description: 'What the product does' }, pricing: { type: 'string', description: 'Pricing model description (e.g. "monthly subscription", "one-time fee")' }, price: { type: 'string', description: 'Price amount (e.g. "$99/mo", "$499")' }, unitCost: { type: 'string', description: 'Cost to deliver per unit' }, monthlyVolume: { type: 'string', description: 'Expected monthly volume or units sold' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_product', description: 'Update an existing product or service. Call this when the user wants to edit, rename, or update a product.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Current product name to search by (required)' }, newName: { type: 'string', description: 'New product name' }, description: { type: 'string' }, pricing: { type: 'string' }, price: { type: 'string' }, unitCost: { type: 'string' }, monthlyVolume: { type: 'string' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_product', description: 'Remove a product or service. Call this when the user explicitly asks to delete or remove a product.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Product name to find and delete (required)' } }, required: ['name'], additionalProperties: false } } },
          // ── Competitors ──
          { type: 'function', function: { name: 'create_competitor', description: 'Add a new competitor to the competitive analysis. Call this when the user wants to add or track a competitor.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Competitor name (required)' }, advantage: { type: 'string', description: 'What advantage they have over you' }, weDoBetter: { type: 'string', description: 'What you do better than them' }, website: { type: 'string', description: 'Competitor website URL' }, notes: { type: 'string', description: 'Any additional notes' }, threatLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Threat level assessment' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_competitor', description: 'Update an existing competitor entry. Call this when the user wants to edit competitor information.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Current competitor name to search by (required)' }, newName: { type: 'string' }, advantage: { type: 'string' }, weDoBetter: { type: 'string' }, website: { type: 'string' }, notes: { type: 'string' }, threatLevel: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_competitor', description: 'Remove a competitor from the competitive analysis.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Competitor name to find and delete (required)' } }, required: ['name'], additionalProperties: false } } },
          // ── Revenue Streams ──
          { type: 'function', function: { name: 'create_revenue_stream', description: 'Add a new revenue stream to the business financial model. Call this when the user wants to add a way the business earns money.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Revenue stream name (required)' }, type: { type: 'string', enum: ['one_off_project', 'ongoing_retainer', 'time_based', 'product_sales', 'program_cohort', 'grants_donations', 'mixed_unsure'], description: 'Type of revenue stream (required)' }, description: { type: 'string' }, isPrimary: { type: 'boolean', description: 'Whether this is the primary revenue stream' }, inputs: { type: 'object', description: 'Type-specific financial inputs. For one_off_project: {projectPrice, projectsPerMonth, deliveryCostPerProject}. For ongoing_retainer: {monthlyFee, numberOfClients, avgClientLifespanMonths}. For product_sales: {pricePerUnit, unitsSoldPerMonth, cogsPerUnit}. For time_based: {hourlyRate, hoursPerMonth}.' } }, required: ['name', 'type'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_revenue_stream', description: 'Update an existing revenue stream. Call this when the user wants to edit a revenue stream name, type, or financial inputs.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Current revenue stream name to search by (required)' }, newName: { type: 'string' }, type: { type: 'string', enum: ['one_off_project', 'ongoing_retainer', 'time_based', 'product_sales', 'program_cohort', 'grants_donations', 'mixed_unsure'] }, description: { type: 'string' }, isPrimary: { type: 'boolean' }, isActive: { type: 'boolean' }, inputs: { type: 'object', description: 'Financial inputs to merge (partial update supported)' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_revenue_stream', description: 'Remove a revenue stream from the financial model.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Revenue stream name to find and remove (required)' } }, required: ['name'], additionalProperties: false } } },
          // ── SWOT extended ──
          { type: 'function', function: { name: 'update_swot_entry', description: 'Edit an existing SWOT entry. Call this when the user wants to update or correct a strength, weakness, opportunity, or threat.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Current text of the SWOT entry to find (required)' }, entryType: { type: 'string', enum: ['strength', 'weakness', 'opportunity', 'threat'], description: 'Filter to a specific SWOT type (optional but helps find the right entry)' }, newText: { type: 'string', description: 'Updated entry text' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, notes: { type: 'string' } }, required: ['text'], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_swot_entry', description: 'Remove an existing SWOT entry. Call this when the user wants to delete a strength, weakness, opportunity, or threat.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text of the SWOT entry to delete (required)' }, entryType: { type: 'string', enum: ['strength', 'weakness', 'opportunity', 'threat'] } }, required: ['text'], additionalProperties: false } } },
          // ── OKR update ──
          { type: 'function', function: { name: 'update_okr', description: 'Update an existing OKR\'s objective text or notes. Call this when the user wants to rename or edit an OKR.', parameters: { type: 'object', properties: { objective: { type: 'string', description: 'Current objective text to find the OKR (required if no okrId)' }, okrId: { type: 'string', description: 'OKR _id if known' }, newObjective: { type: 'string', description: 'New objective text' }, notes: { type: 'string', description: 'Updated notes' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_kr_fields', description: 'Update the metric fields of an existing Key Result — baseline, target, unit, direction, metric name, or current value. Use this when the user wants to change how a KR is measured, not just log current progress. Use update_kr_progress to log a progress value only.', parameters: { type: 'object', properties: { krText: { type: 'string', description: 'Text of the key result to find (required)' }, okrId: { type: 'string', description: 'OKR _id if known' }, objective: { type: 'string', description: 'OKR objective to search within' }, metric: { type: 'string', description: 'Metric type (e.g. "percentage", "number", "currency")' }, current: { type: 'number', description: 'Current progress value' }, baseline: { type: 'number', description: 'Starting/baseline value' }, target: { type: 'number', description: 'Target value to achieve' }, unit: { type: 'string', description: 'Unit label (e.g. "%", "USD", "users")' }, direction: { type: 'string', enum: ['increase', 'decrease'], description: 'Whether success means increasing or decreasing the metric' }, startAt: { type: 'string', description: 'KR start date (YYYY-MM-DD)' }, endAt: { type: 'string', description: 'KR end date (YYYY-MM-DD)' } }, required: ['krText'], additionalProperties: false } } },
          // ── Financial work costs ──
          { type: 'function', function: { name: 'update_work_costs', description: 'Update variable/work-related costs in the financial baseline such as contractors, materials, commissions, or shipping. Call this when the user updates their delivery costs or variable expenses.', parameters: { type: 'object', properties: { contractors: { type: 'number', description: 'Contractor costs per month' }, materials: { type: 'number', description: 'Materials costs per month' }, commissions: { type: 'number', description: 'Commission costs per month' }, shipping: { type: 'number', description: 'Shipping costs per month' }, other: { type: 'number', description: 'Other variable costs per month' }, otherTitle: { type: 'string', description: 'Label for the other category' } }, required: [], additionalProperties: false } } },
          // ── Collaborator access ──
          { type: 'function', function: { name: 'update_collaborator_access', description: 'Change what a collaborator can see on the dashboard. Use "admin" for full access or "limited" to restrict to specific departments/pages.', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Collaborator email address (required)' }, accessType: { type: 'string', enum: ['admin', 'limited'], description: '"admin" gives full access, "limited" restricts to specified departments/pages' }, departments: { type: 'array', items: { type: 'string' }, description: 'Department keys to allow (only used when accessType is "limited")' }, restrictedPages: { type: 'array', items: { type: 'string' }, description: 'Page keys to hide (only used when accessType is "limited")' } }, required: ['email'], additionalProperties: false } } },
          // ── Deliverable update ──
          { type: 'function', function: { name: 'update_deliverable', description: 'Edit an existing deliverable\'s text, KPI, due date, or owner. Call this when the user wants to rename, edit, or update a specific task/deliverable within a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'], description: 'Project type (required)' }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to search by' }, deliverableText: { type: 'string', description: 'Current text of the deliverable to find (required)' }, newText: { type: 'string', description: 'New deliverable text' }, kpi: { type: 'string', description: 'Updated KPI' }, dueWhen: { type: 'string', description: 'New due date in YYYY-MM-DD format' }, ownerName: { type: 'string', description: 'New owner name' } }, required: ['projectType', 'deliverableText'], additionalProperties: false } } },
          // ── Restore (un-delete) tools ──
          { type: 'function', function: { name: 'restore_project', description: 'Restore a previously deleted project. Call this when the user wants to recover or undelete a project.', parameters: { type: 'object', properties: { projectType: { type: 'string', enum: ['core', 'department'] }, projectId: { type: 'string', description: 'Project _id if known' }, projectTitle: { type: 'string', description: 'Project title to search by' } }, required: ['projectType'], additionalProperties: false } } },
          { type: 'function', function: { name: 'restore_okr', description: 'Restore a previously deleted OKR. Call this when the user wants to recover or undelete an OKR.', parameters: { type: 'object', properties: { okrId: { type: 'string', description: 'OKR _id if known' }, objective: { type: 'string', description: 'OKR objective text to search by' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'restore_product', description: 'Restore a previously deleted product. Call this when the user wants to recover or undelete a product.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Product name to search by (required)' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'restore_competitor', description: 'Restore a previously deleted competitor. Call this when the user wants to recover or undelete a competitor.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Competitor name to search by (required)' } }, required: ['name'], additionalProperties: false } } },
          { type: 'function', function: { name: 'restore_swot_entry', description: 'Restore a previously deleted SWOT entry. Call this when the user wants to recover or undelete a SWOT entry.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'SWOT entry text to search by (required)' }, entryType: { type: 'string', enum: ['strength', 'weakness', 'opportunity', 'threat'] } }, required: ['text'], additionalProperties: false } } },
          // ── Decisions ──
          { type: 'function', function: { name: 'create_decision', description: 'Log a strategic decision. Call this when the user wants to record a business decision, choice, or strategic direction with context and rationale.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Decision title or summary (required)' }, context: { type: 'string', description: 'Background context for the decision' }, rationale: { type: 'string', description: 'Reasoning or justification' }, status: { type: 'string', enum: ['proposed', 'approved', 'rejected'], description: 'Decision status (default: approved)' }, decidedBy: { type: 'string', description: 'Name or role of the decision maker' }, tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' }, decidedAt: { type: 'string', description: 'ISO date string for when the decision was made (defaults to now)' }, targets: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['goal', 'project', 'assumption', 'other'] }, label: { type: 'string' }, ref: { type: 'object' } }, additionalProperties: false }, description: 'Linked targets this decision affects' } }, required: ['title'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_decision', description: 'Edit an existing decision\'s title, context, rationale, status, or tags. Call this when the user wants to update or correct a logged decision.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Current decision title to search by (required if no decisionId)' }, decisionId: { type: 'string', description: 'Decision _id if known' }, newTitle: { type: 'string', description: 'Updated title' }, context: { type: 'string', description: 'Updated context' }, rationale: { type: 'string', description: 'Updated rationale' }, status: { type: 'string', enum: ['proposed', 'approved', 'rejected'] }, decidedBy: { type: 'string', description: 'Updated decision maker' }, tags: { type: 'array', items: { type: 'string' }, description: 'Updated tags list' } }, required: [], additionalProperties: false } } },
          // ── Assumptions ──
          { type: 'function', function: { name: 'create_assumption', description: 'Create a tracked business assumption. Call this when the user wants to record a key assumption about revenue, costs, headcount, pricing, or other business factors.', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Short unique key for the assumption, e.g. "avg_deal_size" (required)' }, label: { type: 'string', description: 'Human-readable label, e.g. "Average Deal Size"' }, value: { type: 'string', description: 'Current value of the assumption, e.g. "5000"' }, category: { type: 'string', enum: ['revenue', 'cost', 'headcount', 'pricing', 'other'], description: 'Category of the assumption' }, unit: { type: 'string', description: 'Unit, e.g. "USD", "%", "months"' } }, required: ['key'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_assumption', description: 'Update an existing business assumption\'s value, label, or category. Call this when the user wants to revise an assumption.', parameters: { type: 'object', properties: { key: { type: 'string', description: 'The assumption key to find (required)' }, value: { type: 'string', description: 'New current value' }, label: { type: 'string', description: 'Updated label' }, category: { type: 'string', enum: ['revenue', 'cost', 'headcount', 'pricing', 'other'] }, unit: { type: 'string', description: 'Updated unit' } }, required: ['key'], additionalProperties: false } } },
          // ── Invite management ──
          { type: 'function', function: { name: 'resend_collaborator_invite', description: 'Resend a dashboard collaboration invite to someone who hasn\'t accepted yet. Call this when the user wants to resend or refresh an invite email.', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Email address of the collaborator to resend the invite to (required)' } }, required: ['email'], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_workspace_member_role', description: 'Change a workspace member\'s role. Valid roles are admin, contributor, and viewer. Cannot change the owner\'s role.', parameters: { type: 'object', properties: { memberId: { type: 'string', description: 'WorkspaceMember _id if known' }, email: { type: 'string', description: 'Member email address to find by (required if no memberId)' }, role: { type: 'string', enum: ['admin', 'contributor', 'viewer'], description: 'New role to assign (required)' } }, required: ['role'], additionalProperties: false } } },
          // ── Values & culture + Market info ──
          { type: 'function', function: { name: 'update_values_culture', description: 'Update the business core values and culture description. Call this when the user wants to update their company values, culture, or character traits.', parameters: { type: 'object', properties: { valuesCore: { type: 'string', description: 'Core values of the business' }, cultureFeeling: { type: 'string', description: 'How the culture or team environment feels' }, valuesCoreKeywords: { type: 'array', items: { type: 'string' }, description: 'List of core value keywords or character traits' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'update_market_info', description: 'Update market and competitive context such as ideal customer, partners, and competitor notes. Call this when the user updates their target market, customer description, or partner notes.', parameters: { type: 'object', properties: { targetCustomer: { type: 'string', description: 'Description of the ideal customer or target market' }, partners: { type: 'string', description: 'Description of key partners or strategic alliances' }, competitorsNotes: { type: 'string', description: 'General notes about the competitive landscape' } }, required: [], additionalProperties: false } } },
          // ── Delete org position, decision, assumption ──
          { type: 'function', function: { name: 'delete_org_position', description: 'Remove a position from the org chart. Call this when the user explicitly asks to delete or remove a role or position.', parameters: { type: 'object', properties: { positionTitle: { type: 'string', description: 'Job title or position to find and remove (required)' }, positionId: { type: 'string', description: 'OrgPosition _id if known' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_decision', description: 'Delete a logged decision. Call this when the user explicitly asks to remove or delete a decision.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Decision title to search by (required if no decisionId)' }, decisionId: { type: 'string', description: 'Decision _id if known' } }, required: [], additionalProperties: false } } },
          { type: 'function', function: { name: 'delete_assumption', description: 'Delete a tracked business assumption. Call this when the user explicitly asks to remove or delete an assumption.', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Assumption key to find and delete (required)' } }, required: ['key'], additionalProperties: false } } },
          // ── Read decisions + assumptions ──
          { type: 'function', function: { name: 'get_decisions', description: 'List logged strategic decisions. Use this before updating or referencing a decision, or when the user asks what decisions have been made.', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['proposed', 'approved', 'rejected'], description: 'Filter by status (optional)' }, limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_assumptions', description: 'List tracked business assumptions. Use this before updating or referencing an assumption, or when the user asks what assumptions are tracked.', parameters: { type: 'object', properties: { category: { type: 'string', enum: ['revenue', 'cost', 'headcount', 'pricing', 'other'], description: 'Filter by category (optional)' }, limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          // ── Workspace member invite / remove ──
          { type: 'function', function: { name: 'invite_workspace_member', description: 'Invite someone to the workspace platform with a specific role (admin, contributor, or viewer). This sends a proper workspace invite email. Use this when the user wants to give someone real platform login access. Different from invite_collaborator which is for dashboard-only viewers.', parameters: { type: 'object', properties: { email: { type: 'string', description: 'Email address to invite (required)' }, role: { type: 'string', enum: ['admin', 'contributor', 'viewer'], description: 'Role to assign (required)' } }, required: ['email', 'role'], additionalProperties: false } } },
          { type: 'function', function: { name: 'remove_workspace_member', description: 'Remove a member from the workspace. They will lose access. Cannot remove the workspace owner. Call this when the user explicitly asks to remove someone from the workspace.', parameters: { type: 'object', properties: { memberId: { type: 'string', description: 'WorkspaceMember _id if known' }, email: { type: 'string', description: 'Member email to find by (required if no memberId)' } }, required: [], additionalProperties: false } } },
          // ── Workspace settings ──
          { type: 'function', function: { name: 'update_workspace', description: 'Update workspace settings such as name, description, industry, or review cadence. Call this when the user wants to rename the workspace or update workspace-level information.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'New workspace name' }, description: { type: 'string', description: 'Workspace description' }, industry: { type: 'string', description: 'Industry the workspace is in' }, status: { type: 'string', enum: ['active', 'paused', 'archived'], description: 'Workspace status' }, reviewCadence: { type: 'object', description: 'Review cadence settings (e.g. { weekly: true, monthly: true })' }, defaultWorkspace: { type: 'boolean', description: 'Set to true to make this the default workspace' } }, required: [], additionalProperties: false } } },
        ];

        // 'a' contains workspace fields from above
        const aAns = a || {};
        const deadlineItems = () => {
          const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
          const items = [];
          // Use new DepartmentProject model only - no legacy fallback
          try {
            (crudData.deptProjects || []).forEach((p) => {
              const d = parseDate(p?.dueWhen); if (!d) return;
              const goal = String(p?.title || '').trim();
              const owner = `${String(p?.firstName||'').trim()} ${String(p?.lastName||'').trim()}`.trim();
              const dept = p?.departmentKey || '';
              items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
              // Also add deliverables
              (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((del) => {
                const dt = parseDate(del?.dueWhen); if (!dt) return;
                const txt = String(del?.text || '').trim();
                items.push({ when: dt, label: [goal && `Project: ${goal}`, txt, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
              });
            });
          } catch {}
          // Use new CoreProject model only - no legacy fallback
          try {
            (crudData.coreProjects || []).forEach((p) => {
              (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
                const dt = parseDate(d?.dueWhen); if (!dt) return;
                const txt = String(d?.text || '').trim();
                items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
              });
            });
          } catch {}
          items.sort((x, y) => x.when - y.when);
          return items;
        };

        const runTool = async (name, args) => {
          const limitNum = (v, def, max) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n <= 0) return def; return Math.min(n, max); };
          switch (name) {
            case 'get_user_profile': {
              const full = [String(me?.firstName||'').trim(), String(me?.lastName||'').trim()].filter(Boolean).join(' ') || String(me?.fullName||'').trim();
              const up = ob?.userProfile || {};
              return {
                name: full || up.fullName || undefined,
                email: me?.email || undefined,
                role: up.role || undefined,
                builtPlanBefore: up.builtPlanBefore,
                planningGoal: up.planningGoal || undefined,
                includePersonalPlanning: up.includePersonalPlanning,
                planningFor: up.planningFor || undefined,
              };
            }
            case 'get_business_profile': {
              const bp = ob?.businessProfile || {};
              return {
                name: bp.businessName || me?.companyName || undefined,
                website: bp.businessWebsite || undefined,
                industry: bp.industry || undefined,
                businessStage: bp.businessStage || undefined,
                location: [bp.city, bp.country].filter(Boolean).join(', ') || undefined,
                city: bp.city || undefined,
                country: bp.country || undefined,
                ventureType: bp.ventureType || undefined,
                teamSize: bp.teamSize || undefined,
                hasFunding: bp.funding,
                tools: Array.isArray(bp.tools) ? bp.tools : undefined,
                description: bp.description || undefined,
              };
            }
            case 'get_team_members_count': return { count: teamMembersCount || 0 };
            case 'get_team_members': { const limit = limitNum(args?.limit, 20, 200); return { list: (teamMembers || []).slice(0, limit).map((t)=>({ name: t?.name||'', role: t?.role||'', department: t?.department||'', email: t?.email||'' })) }; }
            case 'get_departments_count': {
              try {
                const fields = await getWorkspaceFields(wsFilter.workspace);
                const sections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
                if (sections.length) return { count: sections.length };
                // Fallback to editableDepts (unique by key)
                const ed = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
                const keys = Array.from(new Set(ed.map((d) => (typeof d === 'string' ? d : (d?.key || '')).trim()).filter(Boolean)));
                if (keys.length) return { count: keys.length };
              } catch {}
              return { count: (departments || []).length };
            }
            case 'get_departments': {
              const limit = limitNum(args?.limit, 20, 100);
              try {
                const fields = await getWorkspaceFields(wsFilter.workspace);
                const sections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
                if (sections.length) {
                  const list = sections.map((s) => ({ name: String(s?.label || s?.name || s?.key || '').trim() })).filter((x) => x.name);
                  return { list: list.slice(0, limit) };
                }
                const ed = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
                if (ed.length) {
                  const list = ed.map((d) => ({ name: typeof d === 'string' ? d : (d?.label || d?.key || '') })).filter((x) => x.name);
                  return { list: list.slice(0, limit) };
                }
              } catch {}
              // Legacy fallback
              return { list: (departments || []).slice(0, limit).map((d)=>({ name: d?.name||'', status: d?.status||'', owner: d?.owner||'', dueDate: d?.dueDate||'' })) };
            }
            case 'create_department': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Department name is required.' };
              const fields = await getWorkspaceFields(wsFilter.workspace);
              const sections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
              const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
              const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
              const rawKey = String(args.key || '').trim();
              let key = rawKey || normalizeDepartmentKey(name);
              if (!key) key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+(.)/g, (_, ch) => ch.toUpperCase()).replace(/\s/g, '');
              const existsByKey = sections.some((s) => String(s?.key || '') === key);
              const existsByLabel = sections.some((s) => String(s?.label || s?.name || '').toLowerCase() === name.toLowerCase());
              if (existsByKey || existsByLabel) return { error: `Department already exists (${name}).` };
              const newSections = sections.concat([{ key, label: name }]);
              let newEditable = editable;
              if (editable.length > 0) {
                if (typeof editable[0] === 'string') {
                  if (!editable.includes(key)) newEditable = editable.concat([key]);
                } else {
                  if (!editable.some((d) => String(d?.key || '') === key)) newEditable = editable.concat([{ key, label: name }]);
                }
              } else {
                newEditable = [key];
              }
              await updateWorkspaceFields(wsFilter.workspace, { actionSections: newSections, editableDepts: newEditable, deptsConfirmed: true });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, key, name, message: `Department "${name}" created.` };
            }
            case 'get_core_projects_count': {
              // Use new CoreProject model only - no legacy fallback
              return { count: crudData.coreProjects?.length || 0 };
            }
            case 'get_core_projects': {
              const limit = limitNum(args?.limit, 10, 50);
              const list = [];
              // Use new CoreProject model only - no legacy fallback
              (crudData.coreProjects || []).forEach((p) => list.push({ id: p?._id?.toString() || '', title: String(p?.title||'').trim(), description: p?.description || undefined, ownerName: p?.ownerName || '', dueWhen: p?.dueWhen || '', cost: p?.cost || undefined, goal: p?.goal || '', priority: p?.priority || '', executiveSponsorName: p?.executiveSponsorName || '', responsibleLeadName: p?.responsibleLeadName || '', departments: Array.isArray(p?.departments) ? p.departments : [], linkedCoreOKR: p?.linkedCoreOKR?.toString() || '', linkedCoreKrId: p?.linkedCoreKrId?.toString() || '', linkedGoals: Array.isArray(p?.linkedGoals) ? p.linkedGoals.map(String) : [], deliverables: Array.isArray(p?.deliverables) ? p.deliverables.map((d) => ({ id: d?._id?.toString() || '', text: d?.text || '', done: Boolean(d?.done), dueWhen: d?.dueWhen || '', ownerName: d?.ownerName || '' })) : [] }));
              return { list: list.slice(0, limit) };
            }
            case 'get_core_deliverables_count': {
              let count = 0;
              // Use new CoreProject model only - no legacy fallback
              (crudData.coreProjects || []).forEach((p) => {
                const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                dels.forEach((d) => { if (!d?.done) count++; });
              });
              return { count };
            }
            case 'get_deadlines': { const limit = limitNum(args?.limit, 20, 200); return { list: deadlineItems().slice(0, limit).map((d)=>({ date: d.when.toISOString().slice(0,10), label: d.label })) }; }
            case 'get_departmental_projects_count': {
              // Use new DepartmentProject model only - no legacy fallback
              return { count: crudData.deptProjects?.length || 0 };
            }
            case 'get_departmental_projects': {
              const limit = limitNum(args?.limit, 20, 200);
              const filterDept = args?.department ? String(args.department).trim().toLowerCase() : null;
              const list = [];
              // Use new DepartmentProject model only - no legacy fallback
              (crudData.deptProjects || []).forEach((p) => {
                const dept = p?.departmentKey || '';
                if (filterDept && dept.toLowerCase() !== filterDept) return;
                const goal = String(p?.title || '').trim();
                if (!goal) return;
                list.push({
                  id: p?._id?.toString() || '',
                  department: dept,
                  goal,
                  owner: `${String(p?.firstName||'').trim()} ${String(p?.lastName||'').trim()}`.trim() || undefined,
                  milestone: String(p?.milestone || '').trim() || undefined,
                  kpi: String(p?.kpi || '').trim() || undefined,
                  description: String(p?.description || '').trim() || undefined,
                  cost: String(p?.cost || '').trim() || undefined,
                  resources: String(p?.resources || '').trim() || undefined,
                  linkedDeptOKR: p?.linkedDeptOKR?.toString() || undefined,
                  linkedDeptKrId: p?.linkedDeptKrId?.toString() || undefined,
                  dueWhen: String(p?.dueWhen || '').trim() || undefined,
                  status: p?.status || undefined,
                  deliverables: Array.isArray(p?.deliverables) ? p.deliverables.map((d) => ({ id: d?._id?.toString() || '', text: String(d?.text || '').trim(), done: Boolean(d?.done), kpi: d?.kpi || undefined, dueWhen: d?.dueWhen || undefined, ownerName: d?.ownerName || undefined })) : [],
                });
              });
              return { list: list.slice(0, limit) };
            }
            case 'get_departmental_deliverables_count': {
              let count = 0;
              // Use new DepartmentProject model only - no legacy fallback
              (crudData.deptProjects || []).forEach((p) => {
                const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                dels.forEach((d) => { if (!d?.done) count++; });
              });
              return { count };
            }
            case 'get_products': {
              const limit = limitNum(args?.limit, 20, 50);
              // Use new Product model only - no legacy fallback
              return {
                list: (crudData.products || []).slice(0, limit).map((p) => ({
                  id: p?._id?.toString() || '',
                  name: String(p?.name || '').trim() || undefined,
                  description: String(p?.description || '').trim() || undefined,
                  price: p?.price || undefined,
                  unitCost: p?.unitCost || undefined,
                  pricing: String(p?.pricing || '').trim() || undefined,
                  monthlyVolume: p?.monthlyVolume || undefined,
                  category: p?.category || undefined,
                }))
              };
            }
            case 'get_products_count': {
              // Use new Product model only - no legacy fallback
              return { count: (crudData.products || []).length };
            }
            case 'get_financial_snapshot': {
              // Use FinancialBaseline model data only (no legacy fallback)
              if (!financialBaseline) {
                return { message: 'No financial data available. Please set up financials in the Financials page.' };
              }
              return {
                // Revenue
                monthlyRevenue: financialBaseline.revenue?.totalMonthlyRevenue || 0,
                monthlyDeliveryCost: financialBaseline.revenue?.totalMonthlyDeliveryCost || 0,
                revenueStreamCount: financialBaseline.revenue?.streamCount || 0,
                // Work-related costs
                workRelatedCostsTotal: financialBaseline.workRelatedCosts?.total || 0,
                contractors: financialBaseline.workRelatedCosts?.contractors || 0,
                materials: financialBaseline.workRelatedCosts?.materials || 0,
                commissions: financialBaseline.workRelatedCosts?.commissions || 0,
                shipping: financialBaseline.workRelatedCosts?.shipping || 0,
                // Fixed costs
                fixedCostsTotal: financialBaseline.fixedCosts?.total || 0,
                salaries: financialBaseline.fixedCosts?.salaries || 0,
                rent: financialBaseline.fixedCosts?.rent || 0,
                software: financialBaseline.fixedCosts?.software || 0,
                insurance: financialBaseline.fixedCosts?.insurance || 0,
                utilities: financialBaseline.fixedCosts?.utilities || 0,
                marketing: financialBaseline.fixedCosts?.marketing || 0,
                // Cash
                currentCashBalance: financialBaseline.cash?.currentBalance || 0,
                expectedFunding: financialBaseline.cash?.expectedFunding || 0,
                fundingDate: financialBaseline.cash?.fundingDate || null,
                // Metrics
                monthlyNetSurplus: financialBaseline.metrics?.monthlyNetSurplus || 0,
                grossProfit: financialBaseline.metrics?.grossProfit || 0,
                grossMarginPercent: financialBaseline.metrics?.grossMarginPercent || 0,
                netMarginPercent: financialBaseline.metrics?.netMarginPercent || 0,
                monthlyBurnRate: financialBaseline.metrics?.monthlyBurnRate || 0,
                cashRunwayMonths: financialBaseline.metrics?.cashRunwayMonths,
                breakEvenRevenue: financialBaseline.metrics?.breakEvenRevenue || 0,
              };
            }
            case 'get_vision_and_goals': {
              const [goals1y, goals3y] = await Promise.all([
                VisionGoal.find({ workspace: wsFilter.workspace, goalType: '1y', isDeleted: false }).sort({ order: 1 }).lean(),
                VisionGoal.find({ workspace: wsFilter.workspace, goalType: '3y', isDeleted: false }).sort({ order: 1 }).lean(),
              ]);
              return {
                ubp: String(aAns.ubp || '').trim() || undefined,
                purpose: String(aAns.purpose || '').trim() || undefined,
                bhag: String(aAns.visionBhag || '').trim() || undefined,
                missionStatement: String(aAns.missionStatement || '').trim() || undefined,
                oneYearGoals: goals1y.map((g) => ({ id: g._id.toString(), text: g.text, notes: g.notes || undefined })),
                threeYearGoals: goals3y.map((g) => ({ id: g._id.toString(), text: g.text, notes: g.notes || undefined })),
              };
            }
            case 'get_values_and_culture': {
              const keywords = Array.isArray(aAns.valuesCoreKeywords) ? aAns.valuesCoreKeywords : [];
              return {
                coreValues: String(aAns.valuesCore || '').trim() || undefined,
                culture: String(aAns.cultureFeeling || '').trim() || undefined,
                characterTraits: keywords.length ? keywords : undefined,
              };
            }
            case 'get_market_info': {
              // Use new Competitor model only - no legacy fallback
              const competitorNames = (crudData.competitors || []).map((c) => c.name).filter(Boolean);
              const competitorAdvantages = (crudData.competitors || []).map((c) => c.advantage).filter(Boolean);
              return {
                idealCustomer: String(aAns.targetCustomer || aAns.marketCustomer || '').trim() || undefined,
                partners: String(aAns.partners || aAns.partnersDesc || '').trim() || undefined,
                competitorNotes: String(aAns.competitorsNotes || aAns.compNotes || '').trim() || undefined,
                competitorNames: competitorNames.length ? competitorNames : undefined,
                competitorAdvantages: competitorAdvantages.length ? competitorAdvantages : undefined,
              };
            }
            case 'get_org_positions': {
              const limit = limitNum(args?.limit, 50, 100);
              // Use new OrgPosition model only - no legacy fallback
              return {
                list: (crudData.orgPositions || []).slice(0, limit).map((p) => ({
                  id: p?._id?.toString() || '',
                  name: String(p?.name || '').trim() || undefined,
                  position: String(p?.position || '').trim() || undefined,
                  role: String(p?.role || '').trim() || undefined,
                  department: String(p?.department || '').trim() || undefined,
                  email: String(p?.email || '').trim() || undefined,
                  parentId: p?.parentId?.toString() || undefined,
                  status: String(p?.status || 'Active').trim(),
                }))
              };
            }
            case 'get_overdue_tasks': {
              const limit = limitNum(args?.limit, 20, 100);
              const now = new Date();
              now.setHours(0, 0, 0, 0); // Start of today
              const allItems = deadlineItems();
              const overdue = allItems.filter((item) => item.when < now);
              return {
                count: overdue.length,
                list: overdue.slice(0, limit).map((d) => ({
                  date: d.when.toISOString().slice(0, 10),
                  daysOverdue: Math.floor((now - d.when) / (1000 * 60 * 60 * 24)),
                  label: d.label
                }))
              };
            }
            case 'get_upcoming_tasks': {
              const limit = limitNum(args?.limit, 20, 100);
              const daysFilter = args?.days && Number.isFinite(args.days) ? args.days : null;
              const now = new Date();
              now.setHours(0, 0, 0, 0); // Start of today
              const allItems = deadlineItems();
              let upcoming = allItems.filter((item) => item.when >= now);
              if (daysFilter) {
                const cutoff = new Date(now);
                cutoff.setDate(cutoff.getDate() + daysFilter);
                upcoming = upcoming.filter((item) => item.when <= cutoff);
              }
              return {
                count: upcoming.length,
                list: upcoming.slice(0, limit).map((d) => ({
                  date: d.when.toISOString().slice(0, 10),
                  daysUntilDue: Math.floor((d.when - now) / (1000 * 60 * 60 * 24)),
                  label: d.label
                }))
              };
            }
            case 'get_swot_analysis': {
              // Use new SwotEntry model only - no legacy fallback (field is entryType, not type)
              const entries = crudData.swotEntries || [];
              const strengths = entries.filter((s) => s.entryType === 'strength').map((s) => s.text).filter(Boolean);
              const weaknesses = entries.filter((s) => s.entryType === 'weakness').map((s) => s.text).filter(Boolean);
              const opportunities = entries.filter((s) => s.entryType === 'opportunity').map((s) => s.text).filter(Boolean);
              const threats = entries.filter((s) => s.entryType === 'threat').map((s) => s.text).filter(Boolean);
              return {
                strengths: strengths.length ? strengths : undefined,
                weaknesses: weaknesses.length ? weaknesses : undefined,
                opportunities: opportunities.length ? opportunities : undefined,
                threats: threats.length ? threats : undefined,
                count: entries.length,
              };
            }
            case 'get_competitors': {
              const limit = limitNum(args?.limit, 10, 20);
              // Use new Competitor model only - no legacy fallback
              const competitors = crudData.competitors || [];
              return {
                count: competitors.length,
                list: competitors.slice(0, limit).map((c) => ({
                  id: c?._id?.toString() || '',
                  name: String(c?.name || '').trim() || undefined,
                  advantage: String(c?.advantage || '').trim() || undefined,
                  weDoBetter: String(c?.weDoBetter || '').trim() || undefined,
                  website: String(c?.website || '').trim() || undefined,
                  notes: String(c?.notes || '').trim() || undefined,
                  threatLevel: c?.threatLevel || undefined,
                }))
              };
            }
            case 'get_collaborators': {
              const limit = limitNum(args?.limit, 20, 50);
              const collabs = crudData.collaborations || [];
              return {
                count: collabs.length,
                list: collabs.slice(0, limit).map((c) => {
                  const collab = c?.collaborator || {};
                  return {
                    name: [String(collab?.firstName || '').trim(), String(collab?.lastName || '').trim()].filter(Boolean).join(' ') || undefined,
                    email: String(c?.email || collab?.email || '').trim() || undefined,
                    accessType: c?.accessType || 'admin',
                    departments: Array.isArray(c?.departments) ? c.departments : [],
                    acceptedAt: c?.acceptedAt || undefined,
                  };
                })
              };
            }
            case 'get_collaborators_count': {
              return { count: (crudData.collaborations || []).length };
            }
            case 'get_pending_invites': {
              const limit = limitNum(args?.limit, 20, 50);
              const invites = crudData.collabInvites || [];
              return {
                count: invites.length,
                list: invites.slice(0, limit).map((c) => ({
                  email: String(c?.email || '').trim() || undefined,
                  invitedAt: c?.invitedAt || c?.createdAt || undefined,
                  accessType: c?.accessType || 'admin',
                })),
              };
            }
            case 'get_pending_invites_count': {
              return { count: (crudData.collabInvites || []).length };
            }
            // ── Mutation / Action tools ──
            case 'create_core_project': {
              const title = String(args.title || '').trim();
              if (!title) return { error: 'Title is required.' };
              if (!Array.isArray(args.departments) || args.departments.length === 0) return { error: 'departments array is required (e.g. ["marketing", "sales"]).' };
              if (!String(args.executiveSponsorName || '').trim()) return { error: 'executiveSponsorName is required.' };
              if (!String(args.responsibleLeadName || '').trim()) return { error: 'responsibleLeadName is required.' };
              if (!args.linkedCoreOKR || !args.linkedCoreKrId) return { error: 'linkedCoreOKR and linkedCoreKrId are required. Call get_okrs first to find valid IDs.' };
              // Subscription limit check (same as coreProject.controller.js)
              const cpOwner = await User.findById(wsFilter.user).lean();
              const maxCoreProjects = getLimit(cpOwner, 'maxCoreProjects');
              if (maxCoreProjects > 0) {
                const totalCount = await CoreProject.countDocuments({ workspace: wsFilter.workspace, isDeleted: false });
                if (totalCount >= maxCoreProjects) return { error: `Core project limit reached (${maxCoreProjects}). Upgrade your plan to create more.` };
              }
              // Validate OKR + KR exist
              const coreOkr = await OKR.findOne({ _id: args.linkedCoreOKR, workspace: wsFilter.workspace, okrType: 'core', isDeleted: { $ne: true } }).lean();
              if (!coreOkr) return { error: `Core OKR "${args.linkedCoreOKR}" not found. Use get_okrs to list available Core OKRs.` };
              const krExists = (coreOkr.keyResults || []).some((kr) => String(kr._id) === String(args.linkedCoreKrId));
              if (!krExists) return { error: `Key Result "${args.linkedCoreKrId}" not found in that OKR. Use get_okrs to list key result IDs.` };
              // Enforce 3-project cap per objective for Lite users only
              if (!cpOwner?.hasActiveSubscription) {
                const existingCount = await CoreProject.countDocuments({ workspace: wsFilter.workspace, isDeleted: false, linkedCoreOKR: args.linkedCoreOKR });
                if (existingCount >= 3) return { error: 'Each Core Objective can have at most 3 Core Projects on the free plan.' };
              }
              // Resolve departments to existing keys in this workspace when possible
              const { normalizeDepartmentKey: _normDeptArr } = require('../utils/departmentNormalize');
              const rawDepts = Array.isArray(args.departments) ? args.departments : [];
              let normalizedDepartments = Array.from(new Set(rawDepts.map((d) => _normDeptArr(String(d || ''))))).filter(Boolean);
              try {
                const DepartmentProject = require('../models/DepartmentProject');
                const CoreProject = require('../models/CoreProject');
                const existingDeptKeys = await DepartmentProject.distinct('departmentKey', { workspace: wsFilter.workspace, isDeleted: false });
                const existingCoreDeptKeys = await CoreProject.distinct('departments', { workspace: wsFilter.workspace, isDeleted: false });
                const { getWorkspaceFields } = require('../services/workspaceFieldService');
                const fields = await getWorkspaceFields(wsFilter.workspace);
                const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
                const candidates = []
                  .concat(existingDeptKeys || [])
                  .concat(existingCoreDeptKeys || [])
                  .concat(editable.map((d) => (typeof d === 'string' ? d : (d?.key || d?.label || ''))));
                // Map each normalized dept to first matching existing candidate (by normalized form)
                normalizedDepartments = normalizedDepartments.map((nd) => {
                  for (const k of candidates) {
                    const nk = _normDeptArr(String(k || ''));
                    if (nk && nk === nd) return String(k);
                  }
                  return nd;
                });
              } catch {}

              // Build richer defaults (budget, due date, deliverables)
              const context = await buildAgentContext(String(wsFilter.user || ''), String(wsFilter.workspace || ''));

              // Try to infer due date from linked Core KR
              let inferredDueWhen = String(args.dueWhen || '').trim() || undefined;
              if (!inferredDueWhen) {
                const kr = (coreOkr.keyResults || []).find((k) => String(k._id) === String(args.linkedCoreKrId));
                if (kr?.endAt) {
                  inferredDueWhen = new Date(kr.endAt).toISOString().slice(0, 10);
                }
              }
              // Estimate budget if missing
              let inferredCost = _sanitizeCurrency(args.cost);
              if (!inferredCost) {
                const hint = `Project Title: ${title}${args.goal ? ` | Goal: ${String(args.goal).trim()}` : ''}`;
                inferredCost = await _aiEstimateBudget(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, hint);
              }
              // Generate deliverables (6) with KPIs, owners, and spaced due dates
              const firstDept = normalizedDepartments[0];
              let deliverableTitles = await _aiSuggestDeliverables(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, {
                departmentLabel: firstDept,
                projectTitle: title,
                goal: String(args.goal || ''),
                count: 6,
              });
              if (!deliverableTitles || deliverableTitles.length === 0) {
                deliverableTitles = ['Define scope and requirements', 'Implement core tasks', 'QA and finalize'];
              }
              const spacedDates = _spreadDueDates(new Date(), inferredDueWhen || new Date(Date.now() + 90*24*60*60*1000), Math.max(3, deliverableTitles.length || 6));
              const defaultOwner = await _pickAssignee(wsFilter.workspace, firstDept);
              const richDeliverables = [];
              for (let i = 0; i < deliverableTitles.length; i++) {
                const text = deliverableTitles[i];
                const kpi = await _aiSuggestKPI(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, text, firstDept);
                richDeliverables.push({
                  text,
                  kpi: kpi || undefined,
                  ownerName: defaultOwner || String(args.responsibleLeadName).trim() || undefined,
                  dueWhen: spacedDates[i] || undefined,
                  done: false,
                });
              }

              const project = new CoreProject({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                title,
                description: String(args.description || '').trim() || undefined,
                executiveSponsorName: String(args.executiveSponsorName).trim(),
                responsibleLeadName: String(args.responsibleLeadName).trim(),
                departments: normalizedDepartments,
                linkedCoreOKR: args.linkedCoreOKR,
                linkedCoreKrId: args.linkedCoreKrId,
                linkedGoals: Array.isArray(args.linkedGoals) ? args.linkedGoals : undefined,
                goal: String(args.goal || '').trim() || undefined,
                dueWhen: inferredDueWhen,
                cost: inferredCost,
                ownerName: String(args.ownerName || '').trim() || undefined,
                priority: ['high', 'medium', 'low'].includes(args.priority) ? args.priority : undefined,
                deliverables: richDeliverables,
              });
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: project._id.toString(), title: project.title, message: `Core project "${project.title}" created with budget and deliverables.` };
            }
            case 'create_department_project': {
              const title = String(args.title || '').trim();
              const department = String(args.department || '').trim();
              if (!title) return { error: 'Title is required.' };
              if (!department) return { error: 'Department key is required.' };
              // Pro feature gate (same as departmentProject.controller.js)
              const dpOwner = await User.findById(wsFilter.user).lean();
              const { hasFeature } = require('../config/entitlements');
              if (!hasFeature(dpOwner, 'departmentPlans')) return { error: 'Department projects require a Pro plan. Upgrade to create department projects.' };
              const { normalizeDepartmentKey: _normDeptKeyMatch } = require('../utils/departmentNormalize');
              const { normalizeDepartmentKey: _normDeptKey } = require('../utils/departmentNormalize');
              let normalizedDept = _normDeptKey(department);
              try {
                const DepartmentProject = require('../models/DepartmentProject');
                const CoreProject = require('../models/CoreProject');
                const existingDeptKeys = await DepartmentProject.distinct('departmentKey', { workspace: wsFilter.workspace, isDeleted: false });
                const existingCoreDeptKeys = await CoreProject.distinct('departments', { workspace: wsFilter.workspace, isDeleted: false });
                const { getWorkspaceFields } = require('../services/workspaceFieldService');
                const fields = await getWorkspaceFields(wsFilter.workspace);
                const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
                const candidates = []
                  .concat(existingDeptKeys || [])
                  .concat(existingCoreDeptKeys || [])
                  .concat(editable.map((d) => (typeof d === 'string' ? d : (d?.key || d?.label || ''))));
                for (const k of candidates) {
                  const nk = _normDeptKey(String(k || ''));
                  if (nk && nk === normalizedDept) { normalizedDept = String(k); break; }
                }
              } catch {}
              // Ensure dept OKR + KR exist and match department (auto-select if missing)
              let linkedDeptOKR = String(args.linkedDeptOKR || '').trim();
              let linkedDeptKrId = String(args.linkedDeptKrId || '').trim();
              let deptOkr = null;
              if (!linkedDeptOKR || !linkedDeptKrId) {
                try {
                  const candidates = await OKR.find({ workspace: wsFilter.workspace, okrType: 'department', isDeleted: { $ne: true } }).lean();
                  const objTok = _textTokens(`${title} ${String(args.goal || '')}`, 3);
                  let best = null;
                  for (const c of candidates) {
                    if (_normDeptKeyMatch(String(c.departmentKey || '')) !== _normDeptKeyMatch(String(normalizedDept || ''))) continue;
                    const cObjTok = _textTokens(c.objective || '', 3);
                    const objInter = objTok.filter((x)=> cObjTok.includes(x)).length;
                    const objScore = objTok.length && cObjTok.length ? (objInter / Math.min(objTok.length, cObjTok.length)) : 0;
                    for (const kr of (c.keyResults || [])) {
                      const cKrTok = _textTokens(kr.text || '', 3);
                      const krInter = objTok.filter((x)=> cKrTok.includes(x)).length;
                      const krScore = objTok.length && cKrTok.length ? (krInter / Math.min(objTok.length, cKrTok.length)) : 0;
                      const score = objScore * 0.6 + krScore * 0.4;
                      if (!best || score > best.score) best = { okrId: String(c._id), krId: String(kr._id), score, okr: c };
                    }
                  }
                  if (best) {
                    linkedDeptOKR = best.okrId;
                    linkedDeptKrId = best.krId;
                    deptOkr = best.okr;
                  }
                } catch {}
              }
              if (!linkedDeptOKR || !linkedDeptKrId) {
                return { error: 'linkedDeptOKR and linkedDeptKrId are required or could not be auto-selected. Call get_okrs first to find valid IDs.' };
              }
              if (!deptOkr) {
                deptOkr = await OKR.findOne({ _id: linkedDeptOKR, workspace: wsFilter.workspace, okrType: 'department', isDeleted: { $ne: true } }).lean();
                if (!deptOkr) return { error: `Department OKR "${linkedDeptOKR}" not found. Use get_okrs to list available Department OKRs.` };
              }
              if (_normDeptKeyMatch(String(deptOkr.departmentKey || '')) !== _normDeptKeyMatch(String(normalizedDept || ''))) {
                return { error: `The linked OKR belongs to department "${deptOkr.departmentKey}" but the project is for "${normalizedDept}". They must match.` };
              }
              const deptKrExists = (deptOkr.keyResults || []).some((kr) => String(kr._id) === String(linkedDeptKrId));
              if (!deptKrExists) return { error: `Key Result "${linkedDeptKrId}" not found in that OKR. Use get_okrs to list key result IDs.` };
              // Rich defaults (budget, due date, deliverables)
              const context = await buildAgentContext(String(wsFilter.user || ''), String(wsFilter.workspace || ''));
              // Infer due date from linked Dept KR
              let inferredDueWhen = String(args.dueWhen || '').trim() || undefined;
              if (!inferredDueWhen) {
                const kr = (deptOkr.keyResults || []).find((k) => String(k._id) === String(linkedDeptKrId));
                if (kr?.endAt) {
                  inferredDueWhen = new Date(kr.endAt).toISOString().slice(0, 10);
                }
              }
              // Estimate budget if missing
              let inferredCost = _sanitizeCurrency(args.cost);
              if (!inferredCost) {
                const hint = `Department: ${normalizedDept} | Project: ${title}${args.goal ? ` | Goal: ${String(args.goal).trim()}` : ''}`;
                inferredCost = await _aiEstimateBudget(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, hint);
              }
              let deliverableTitles = await _aiSuggestDeliverables(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, {
                departmentLabel: normalizedDept,
                projectTitle: title,
                goal: String(args.goal || ''),
                count: 6,
              });
              if (!deliverableTitles || deliverableTitles.length === 0) {
                deliverableTitles = ['Define scope and requirements', 'Implement core tasks', 'QA and finalize'];
              }
              const spacedDates = _spreadDueDates(new Date(), inferredDueWhen || new Date(Date.now() + 90*24*60*60*1000), Math.max(3, deliverableTitles.length || 6));
              const defaultOwner = await _pickAssignee(wsFilter.workspace, normalizedDept);
              const richDeliverables = [];
              for (let i = 0; i < deliverableTitles.length; i++) {
                const text = deliverableTitles[i];
                const kpi = await _aiSuggestKPI(String(wsFilter.user || ''), String(wsFilter.workspace || ''), context, text, normalizedDept);
                richDeliverables.push({
                  text,
                  kpi: kpi || undefined,
                  ownerName: defaultOwner || String(args.ownerName || '').trim() || undefined,
                  dueWhen: spacedDates[i] || undefined,
                  done: false,
                });
              }

              const ownerParts = String(args.ownerName || '').trim().split(' ');
              const deptProject = new DepartmentProject({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                departmentKey: normalizedDept,
                title,
                description: String(args.description || '').trim() || undefined,
                linkedDeptOKR: linkedDeptOKR,
                linkedDeptKrId: linkedDeptKrId,
                goal: String(args.goal || '').trim() || undefined,
                dueWhen: inferredDueWhen,
                cost: inferredCost,
                kpi: String(args.kpi || '').trim() || undefined,
                milestone: String(args.milestone || '').trim() || undefined,
                resources: String(args.resources || '').trim() || undefined,
                firstName: ownerParts[0] || undefined,
                lastName: ownerParts.slice(1).join(' ') || undefined,
                priority: ['high', 'medium', 'low'].includes(args.priority) ? args.priority : undefined,
                deliverables: richDeliverables,
              });
              await deptProject.save();
              // Ensure canonical registry includes this department
              try {
                const { ensureActionSections } = require('../services/workspaceFieldService');
                await ensureActionSections(wsFilter.workspace, [normalizedDept]);
              } catch {}
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: deptProject._id.toString(), title: deptProject.title, department: deptProject.departmentKey, message: `Department project "${deptProject.title}" created with budget and deliverables for ${deptProject.departmentKey}.` };
            }
            case 'add_deliverable': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'Deliverable text is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project. Try calling get_core_projects or get_departmental_projects to get the project id first.` };
              project.deliverables.push({
                text,
                done: false,
                dueWhen: String(args.dueWhen || '').trim() || undefined,
                ownerName: String(args.ownerName || '').trim() || undefined,
                kpi: (String(args.kpi || '').trim().replace(/^[\"'“‘`]+/, '').replace(/[\"'”’`]+$/, '')) || undefined,
              });
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, deliverableText: text, projectTitle: project.title || project.goal, message: `Deliverable "${text}" added to "${project.title || project.goal}".` };
            }
            case 'update_project': {
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project. Use get_core_projects or get_departmental_projects to find it.` };
              if (args.newTitle) project.title = String(args.newTitle).trim();
              if (args.goal !== undefined) project.goal = String(args.goal).trim();
              if (args.description !== undefined) project.description = String(args.description).trim() || undefined;
              if (args.dueWhen !== undefined) project.dueWhen = String(args.dueWhen).trim() || null;
              if (args.cost !== undefined) project.cost = String(args.cost).trim() || undefined;
              if (['high', 'medium', 'low'].includes(args.priority)) project.priority = args.priority;
              if (args.ownerName) {
                if (args.projectType === 'core') {
                  project.ownerName = String(args.ownerName).trim();
                } else {
                  const parts = String(args.ownerName).trim().split(' ');
                  project.firstName = parts[0] || '';
                  project.lastName = parts.slice(1).join(' ') || '';
                }
              }
              // Core-specific fields
              if (args.projectType === 'core') {
                if (args.executiveSponsorName !== undefined) project.executiveSponsorName = String(args.executiveSponsorName).trim() || undefined;
                if (args.responsibleLeadName !== undefined) project.responsibleLeadName = String(args.responsibleLeadName).trim() || undefined;
                if (Array.isArray(args.departments)) project.departments = args.departments;
                if (Array.isArray(args.linkedGoals)) project.linkedGoals = args.linkedGoals;
                // Re-validate OKR linkage on update (same as coreProject.controller.js)
                if (args.linkedCoreOKR !== undefined || args.linkedCoreKrId !== undefined) {
                  const newOkrId = args.linkedCoreOKR || project.linkedCoreOKR?.toString();
                  const newKrId = args.linkedCoreKrId || project.linkedCoreKrId?.toString();
                  if (newOkrId) {
                    const relinkedOkr = await OKR.findOne({ _id: newOkrId, workspace: wsFilter.workspace, okrType: 'core', isDeleted: { $ne: true } }).lean();
                    if (!relinkedOkr) return { error: `Core OKR "${newOkrId}" not found.` };
                    if (newKrId && !(relinkedOkr.keyResults || []).some((kr) => String(kr._id) === String(newKrId))) return { error: `Key Result "${newKrId}" not found in that OKR.` };
                    // Re-check 3-project cap if switching OKR (Lite users only)
                    if (args.linkedCoreOKR && String(args.linkedCoreOKR) !== String(project.linkedCoreOKR)) {
                      const updateOwner = await User.findById(wsFilter.user).lean();
                      if (!updateOwner?.hasActiveSubscription) {
                        const capCount = await CoreProject.countDocuments({ workspace: wsFilter.workspace, isDeleted: false, linkedCoreOKR: args.linkedCoreOKR, _id: { $ne: project._id } });
                        if (capCount >= 3) return { error: 'That Core Objective already has 3 Core Projects on the free plan.' };
                      }
                    }
                  }
                  if (args.linkedCoreOKR !== undefined) project.linkedCoreOKR = args.linkedCoreOKR || undefined;
                  if (args.linkedCoreKrId !== undefined) project.linkedCoreKrId = args.linkedCoreKrId || undefined;
                }
              }
              // Department-specific fields
              if (args.projectType === 'department') {
                if (args.milestone !== undefined) project.milestone = String(args.milestone).trim() || undefined;
                if (args.resources !== undefined) project.resources = String(args.resources).trim() || undefined;
                // Re-validate OKR linkage on update (same as departmentProject.controller.js)
                if (args.linkedDeptOKR !== undefined || args.linkedDeptKrId !== undefined) {
                  const newDeptOkrId = args.linkedDeptOKR || project.linkedDeptOKR?.toString();
                  if (newDeptOkrId) {
                    const relinkedDeptOkr = await OKR.findOne({ _id: newDeptOkrId, workspace: wsFilter.workspace, okrType: 'department', isDeleted: { $ne: true } }).lean();
                    if (!relinkedDeptOkr) return { error: `Department OKR "${newDeptOkrId}" not found.` };
                    const newDeptKrId = args.linkedDeptKrId || project.linkedDeptKrId?.toString();
                    if (newDeptKrId && !(relinkedDeptOkr.keyResults || []).some((kr) => String(kr._id) === String(newDeptKrId))) return { error: `Key Result "${newDeptKrId}" not found in that OKR.` };
                  }
                  if (args.linkedDeptOKR !== undefined) project.linkedDeptOKR = args.linkedDeptOKR || undefined;
                  if (args.linkedDeptKrId !== undefined) project.linkedDeptKrId = args.linkedDeptKrId || undefined;
                }
              }
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, title: project.title, message: `Project "${project.title}" updated successfully.` };
            }
            case 'mark_deliverable_complete': {
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                const allProjects = await Model.find({ workspace: wsFilter.workspace, isDeleted: { $ne: true } }).lean();
                const searchText = String(args.deliverableText || '').toLowerCase();
                for (const p of allProjects) {
                  if ((p.deliverables || []).some((d) => String(d.text || '').toLowerCase().includes(searchText))) {
                    project = await Model.findById(p._id);
                    break;
                  }
                }
              }
              if (!project) return { error: 'Could not find the project containing this deliverable.' };
              const searchText = String(args.deliverableText || '').toLowerCase();
              const del = project.deliverables.find((d) => String(d.text || '').toLowerCase().includes(searchText));
              if (!del) return { error: `Deliverable matching "${args.deliverableText}" not found in project "${project.title}".` };
              del.done = true;
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, deliverableText: del.text, projectTitle: project.title, message: `"${del.text}" marked as complete in "${project.title}".` };
            }
            case 'reschedule_item': {
              const newDate = String(args.newDate || '').trim();
              if (!newDate) return { error: 'newDate is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project.` };
              if (args.deliverableText) {
                const del = project.deliverables.find((d) => String(d.text || '').toLowerCase().includes(String(args.deliverableText).toLowerCase()));
                if (!del) return { error: `Deliverable "${args.deliverableText}" not found.` };
                del.dueWhen = newDate;
                await project.save();
                try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
                return { success: true, message: `Deliverable "${del.text}" rescheduled to ${newDate}.` };
              }
              project.dueWhen = newDate;
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, message: `Project "${project.title}" rescheduled to ${newDate}.` };
            }
            case 'assign_owner': {
              const ownerName = String(args.ownerName || '').trim();
              if (!ownerName) return { error: 'ownerName is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project.` };
              if (args.deliverableText) {
                const del = project.deliverables.find((d) => String(d.text || '').toLowerCase().includes(String(args.deliverableText).toLowerCase()));
                if (!del) return { error: `Deliverable "${args.deliverableText}" not found.` };
                del.ownerName = ownerName;
                await project.save();
                try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
                return { success: true, message: `"${del.text}" assigned to ${ownerName}.` };
              }
              if (args.projectType === 'core') {
                project.ownerName = ownerName;
              } else {
                const parts = ownerName.split(' ');
                project.firstName = parts[0] || '';
                project.lastName = parts.slice(1).join(' ') || '';
              }
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, message: `Project "${project.title}" assigned to ${ownerName}.` };
            }
            case 'delete_project': {
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project to delete.` };
              project.isDeleted = true;
              project.deletedAt = new Date();
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, message: `Project "${project.title}" deleted successfully.` };
            }
            case 'create_okr': {
              const objective = String(args.objective || '').trim();
              if (!objective) return { error: 'Objective is required.' };
              const okrType = args.okrType === 'department' ? 'department' : 'core';
              // Validate type-specific required fields
              if (okrType === 'department' && !String(args.departmentKey || '').trim()) return { error: 'departmentKey is required for department OKRs.' };
              // Prevent duplicate/similar objectives; auto-generate a novel one if needed
              let finalObjective = objective;
              try {
                const existFilter = { workspace: wsFilter.workspace, okrType, isDeleted: { $ne: true } };
                if (okrType === 'department' && String(args.departmentKey || '').trim()) {
                  existFilter.departmentKey = String(args.departmentKey).trim();
                }
                const existing = await OKR.find(existFilter).select('objective').lean();
                const existingObjectives = existing.map((e) => String(e.objective || ''));
                const isDup = existingObjectives.some((e) => _isSimilarObjective(e, finalObjective));
                if (isDup) {
                  // Build a novelty prompt and attempt up to 3 retries
                  const ctx = await buildAgentContext(String(wsFilter.user || ''), String(wsFilter.workspace || ''));
                  const ctxStr = formatContextForPrompt(ctx);
                  const doNotRepeat = existingObjectives
                    .concat([finalObjective])
                    .filter(Boolean)
                    .slice(0, 50) // avoid very long prompts
                    .map((s, i) => `${i + 1}. ${s}`)
                    .join('\n');
                  const basePrompt = [
                    ctxStr,
                    `Task: Propose ONE NEW ${okrType.toUpperCase()} OKR Objective (1 sentence) that is meaningfully different from all of the existing objectives listed below.`,
                    'Constraints:',
                    '- Do NOT rephrase or restate any item in the list.',
                    '- Be specific and measurable in spirit but qualitative as an objective.',
                    '- Keep to one sentence, no quotes, no labels.',
                    '',
                    'Existing objectives to avoid (hard do-not-repeat list):',
                    doNotRepeat,
                  ].join('\n');
                  for (let attempt = 0; attempt < 3; attempt++) {
                    const alt = (await callOpenAI(basePrompt, { model: 'gpt-4o-mini', temperature: 0.9, maxTokens: 120 }))?.content || '';
                    const altObj = String(alt || '').trim();
                    if (altObj && !existingObjectives.some((e) => _isSimilarObjective(e, altObj)) && !_isSimilarObjective(finalObjective, altObj)) {
                      finalObjective = altObj;
                      break;
                    }
                  }
                  // If still duplicate, fail with a helpful message
                  if (existingObjectives.some((e) => _isSimilarObjective(e, finalObjective))) {
                    return { error: 'Generated objective would duplicate existing OKRs. Please try again with different phrasing.' };
                  }
                }
              } catch {}
              let inputKrs = Array.isArray(args.keyResults) ? args.keyResults : [];
              if (okrType === 'core' && (inputKrs.length < 2 || inputKrs.length > 4)) return { error: 'Core OKRs must have 2 to 4 key results.' };
              // Compute default cycle window for missing dates
              const win = await _getCycleWindow(wsFilter.workspace, okrType);

              // Departmental OKR: ensure valid anchor to Core OKR + KR (auto-select if missing/invalid)
              let anchorOkrId = okrType === 'department' ? (args.anchorCoreOKR ? String(args.anchorCoreOKR) : '') : '';
              let anchorKrId = okrType === 'department' ? (args.anchorCoreKrId ? String(args.anchorCoreKrId) : '') : '';
              if (okrType === 'department') {
                const validateAnchor = async (okrId, krId) => {
                  const coreOkr = await OKR.findOne({ _id: okrId, workspace: wsFilter.workspace, okrType: 'core', isDeleted: { $ne: true } }).lean();
                  if (!coreOkr) return false;
                  const hasKr = (coreOkr.keyResults || []).some((k) => String(k._id) === String(krId));
                  return !!hasKr;
                };
                let valid = false;
                if (anchorOkrId && anchorKrId) {
                  valid = await validateAnchor(anchorOkrId, anchorKrId);
                }
                if (!valid) {
                  try {
                    const cores = await OKR.find({ workspace: wsFilter.workspace, okrType: 'core', isDeleted: { $ne: true } })
                      .sort({ order: 1 })
                      .limit(25)
                      .lean();
                    const objTok = _textTokens(finalObjective || objective, 3);
                    const krTextAll = inputKrs.map((k) => String(k?.text || '')).filter(Boolean).join(' ');
                    const krTok = _textTokens(krTextAll, 3);
                    let best = null;
                    for (const c of cores) {
                      const cObjTok = _textTokens(c.objective || '', 3);
                      const objInter = objTok.filter((x) => cObjTok.includes(x)).length;
                      const objScore = objTok.length && cObjTok.length ? (objInter / Math.min(objTok.length, cObjTok.length)) : 0;
                      for (const kr of (c.keyResults || [])) {
                        const cKrTok = _textTokens(kr.text || '', 3);
                        const krInter = krTok.filter((x) => cKrTok.includes(x)).length;
                        const krScore = (krTok.length && cKrTok.length) ? (krInter / Math.min(krTok.length, cKrTok.length)) : 0;
                        const score = objScore * 0.6 + krScore * 0.4;
                        if (!best || score > best.score) best = { okrId: String(c._id), krId: String(kr._id), score };
                      }
                    }
                    if (best) {
                      anchorOkrId = best.okrId;
                      anchorKrId = best.krId;
                      valid = true;
                    }
                  } catch {}
                }
                if (!valid) {
                  return { error: 'Unable to determine a valid Core OKR anchor. Please select a Core OKR and a Key Result to anchor this departmental OKR.' };
                }
              }
              // De-duplicate KR texts against existing KR texts in workspace and within this batch
              try {
                const existing = await OKR.find({ workspace: wsFilter.workspace, isDeleted: { $ne: true } })
                  .select('keyResults.text objective okrType departmentKey')
                  .lean();
                const existingKrTexts = [];
                existing.forEach((o) => (o.keyResults || []).forEach((k) => k?.text && existingKrTexts.push(String(k.text))));
                // Flag duplicates and gather indices needing replacement
                const needs = [];
                const seen = [];
                inputKrs.forEach((kr, idx) => {
                  const txt = String(kr?.text || '').trim();
                  if (!txt) return;
                  const dupExisting = existingKrTexts.some((ek) => _isSimilarKr(ek, txt));
                  const dupSeen = seen.some((sk) => _isSimilarKr(sk, txt));
                  if (dupExisting || dupSeen) {
                    needs.push(idx);
                  } else {
                    seen.push(txt);
                  }
                });
                if (needs.length > 0) {
                  const avoid = Array.from(new Set(existingKrTexts.concat(seen))).slice(0, 200);
                  const ctx = await buildAgentContext(String(wsFilter.user || ''), String(wsFilter.workspace || ''));
                  const ctxStr = formatContextForPrompt(ctx);
                  const askN = needs.length;
                  const prompt = [
                    ctxStr,
                    `Task: Propose exactly ${askN} NEW Key Result statements (text only) for the objective below.`,
                    `Objective: ${finalObjective}`,
                    'Constraints:',
                    '- Each KR must be measurable with a numeric target; keep each under 18 words.',
                    '- Do NOT duplicate or rephrase any of the KRs in the avoid list.',
                    '- Return ONLY a strict JSON array of strings.',
                    '',
                    'Avoid list (existing KRs and those already accepted):',
                    avoid.map((a) => `- ${a}`).join('\n'),
                  ].join('\n');
                  const { data } = await require('../agents/base').callOpenAIJSON(prompt, { model: 'gpt-4o-mini', temperature: 0.9, maxTokens: 400 });
                  const candidates = Array.isArray(data) ? data.map((s) => String(s || '').trim()).filter(Boolean) : [];
                  needs.forEach((idx, i) => {
                    if (candidates[i]) {
                      inputKrs[idx] = { ...inputKrs[idx], text: candidates[i] };
                    }
                  });
                }
              } catch {}
              const keyResults = inputKrs
                .map((kr) => {
                  const baseline = Number(kr.baseline) || 0;
                  return {
                    text: String(kr.text || '').trim(),
                    metric: String(kr.metric || '').trim().toLowerCase() || undefined,
                    unit: String(kr.unit || '').trim() || undefined,
                    direction: kr.direction === 'decrease' ? 'decrease' : 'increase',
                    baseline,
                    target: Number(kr.target) || 0,
                    current: kr.current !== undefined ? Number(kr.current) : baseline,
                    startAt: kr.startAt ? new Date(kr.startAt) : new Date(win.start),
                    endAt: kr.endAt ? new Date(kr.endAt) : new Date(win.end),
                    linkTag: ['driver', 'enablement', 'operational'].includes(kr.linkTag) ? kr.linkTag : undefined,
                  };
                })
                .filter((kr) => kr.text);
              const okrOrder = await OKR.getNextOrder(wsFilter.workspace);
              const { normalizeDepartmentKey: _normDeptForOKR } = require('../utils/departmentNormalize');
              const okr = new OKR({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                okrType,
                departmentKey: okrType === 'department' ? _normDeptForOKR(String(args.departmentKey || '')) || undefined : undefined,
                objective: finalObjective,
                keyResults,
                notes: String(args.notes || '').trim() || undefined,
                order: okrOrder,
                derivedFromGoals: okrType === 'core' && Array.isArray(args.derivedFromGoals) && args.derivedFromGoals.length ? args.derivedFromGoals : undefined,
                anchorCoreOKR: okrType === 'department' ? anchorOkrId : undefined,
                anchorCoreKrId: okrType === 'department' ? anchorKrId : undefined,
              });
              // Fallback: if core OKR has no derivedFromGoals provided, pick the most relevant 1–2 1-year goals
              if (okrType === 'core' && (!okr.derivedFromGoals || okr.derivedFromGoals.length === 0)) {
                try {
                  const VisionGoal = require('../models/VisionGoal');
                  const goals = await VisionGoal.find({ workspace: wsFilter.workspace, isDeleted: false, goalType: '1y' })
                    .select('_id text order')
                    .sort({ order: 1 })
                    .lean();
                  if (goals && goals.length) {
                    const tok = (s, minLen = 4) => Array.from(new Set(String(s || '')
                      .toLowerCase()
                      .replace(/[^a-z0-9\s]/g, ' ')
                      .split(/\s+/)
                      .filter((w) => w && w.length >= minLen)));
                    const objTok = tok(finalObjective, 4);
                    const scored = goals.map((g) => {
                      const gt = tok(g.text || '', 4);
                      const inter = objTok.filter((x) => gt.includes(x)).length;
                      const score = inter / Math.max(1, Math.min(objTok.length, gt.length));
                      return { id: String(g._id), score };
                    }).sort((a, b) => b.score - a.score);
                    okr.derivedFromGoals = scored.slice(0, Math.min(2, scored.length)).map((s) => s.id);
                  }
                } catch {}
              }
              await okr.save();
              if (okrType === 'department') {
                try {
                  const { ensureActionSections } = require('../services/workspaceFieldService');
                  await ensureActionSections(wsFilter.workspace, [String(args.departmentKey || '')]);
                } catch {}
              }
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: okr._id.toString(), objective: okr.objective, okrType: okr.okrType, keyResultCount: keyResults.length, message: `OKR "${okr.objective}" created with ${keyResults.length} key result(s).` };
            }
            case 'add_swot_entry': {
              const text = String(args.text || '').trim();
              const entryType = ['strength', 'weakness', 'opportunity', 'threat'].includes(args.entryType) ? args.entryType : null;
              if (!text) return { error: 'Text is required.' };
              if (!entryType) return { error: 'entryType must be strength, weakness, opportunity, or threat.' };
              const order = await SwotEntry.getNextOrder(wsFilter.workspace, entryType);
              const entry = new SwotEntry({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                entryType,
                text,
                notes: String(args.notes || '').trim() || undefined,
                priority: ['low', 'medium', 'high'].includes(args.priority) ? args.priority : null,
                order,
              });
              await entry.save();
              return { success: true, id: entry._id.toString(), entryType, text, message: `Added "${text}" as a SWOT ${entryType}.` };
            }
            case 'get_okrs': {
              const limitNum = Math.min(parseInt(args?.limit || '20', 10), 50);
              const filter = { workspace: wsFilter.workspace, isDeleted: { $ne: true } };
              if (args.okrType) filter.okrType = args.okrType;
              const okrs = await OKR.find(filter).sort({ order: 1 }).limit(limitNum).lean();
              return {
                count: okrs.length,
                list: okrs.map((o) => ({
                  id: o._id.toString(),
                  okrType: o.okrType,
                  departmentKey: o.departmentKey || undefined,
                  objective: o.objective,
                  notes: o.notes || undefined,
                  derivedFromGoals: o.derivedFromGoals?.length ? o.derivedFromGoals.map(String) : undefined,
                  anchorCoreOKR: o.anchorCoreOKR?.toString() || undefined,
                  anchorCoreKrId: o.anchorCoreKrId?.toString() || undefined,
                  keyResults: (o.keyResults || []).map((kr) => ({
                    id: kr._id?.toString(),
                    text: kr.text,
                    metric: kr.metric,
                    unit: kr.unit,
                    direction: kr.direction,
                    baseline: kr.baseline,
                    target: kr.target,
                    current: kr.current,
                    startAt: kr.startAt || undefined,
                    endAt: kr.endAt || undefined,
                    linkTag: kr.linkTag || undefined,
                    canonicalMetric: kr.canonicalMetric || undefined,
                  })),
                })),
              };
            }
            case 'create_vision_goal': {
              const goalType = ['1y', '3y'].includes(args.goalType) ? args.goalType : null;
              if (!goalType) return { error: 'goalType must be "1y" or "3y".' };
              const text = String(args.text || '').trim();
              if (!text) return { error: 'Goal text is required.' };
              const order = await VisionGoal.getNextOrder(wsFilter.workspace, goalType);
              const goal = await VisionGoal.create({
                workspace: wsFilter.workspace, user: wsFilter.user,
                goalType, text, notes: args.notes?.trim() || undefined, order,
              });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: goal._id.toString(), goalType, text: goal.text, message: `${goalType === '1y' ? '1-year' : '3-year'} goal "${goal.text}" created.` };
            }
            case 'update_vision_goal': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'text is required to find the goal.' };
              const query = { workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false };
              if (args.goalType && ['1y', '3y'].includes(args.goalType)) query.goalType = args.goalType;
              const goal = await VisionGoal.findOne(query);
              if (!goal) return { error: `Goal "${text}" not found. Use get_vision_and_goals to list goals.` };
              if (args.newText !== undefined) goal.text = args.newText.trim();
              if (args.notes !== undefined) goal.notes = args.notes?.trim() || undefined;
              await goal.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: goal._id.toString(), goalType: goal.goalType, text: goal.text, message: `${goal.goalType === '1y' ? '1-year' : '3-year'} goal updated: "${goal.text}".` };
            }
            case 'delete_vision_goal': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'text is required to find the goal.' };
              const query = { workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false };
              if (args.goalType && ['1y', '3y'].includes(args.goalType)) query.goalType = args.goalType;
              const goal = await VisionGoal.findOne(query);
              if (!goal) return { error: `Goal "${text}" not found.` };
              goal.isDeleted = true; goal.deletedAt = new Date();
              await goal.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: goal._id.toString(), goalType: goal.goalType, text: goal.text, message: `${goal.goalType === '1y' ? '1-year' : '3-year'} goal "${goal.text}" deleted.` };
            }
            case 'update_vision_goals': {
              if (!wsFilter.workspace) return { error: 'No workspace found.' };
              const allowedFields = ['ubp', 'purpose', 'vision1y', 'vision3y', 'visionBhag', 'missionStatement'];
              const updates = {};
              for (const f of allowedFields) {
                if (args[f] !== undefined) updates[f] = String(args[f] || '').trim();
              }
              if (Object.keys(updates).length === 0) return { error: 'No fields provided to update.' };
              await updateWorkspaceFields(wsFilter.workspace, updates);
              return { success: true, updated: Object.keys(updates), message: `Updated: ${Object.keys(updates).join(', ')}.` };
            }
            case 'update_cash_position': {
              const baseline = await FinancialBaseline.getOrCreate(wsFilter.user, wsFilter.workspace);
              if (!baseline.cash) baseline.cash = {};
              if (args.currentBalance !== undefined) baseline.cash.currentBalance = Number(args.currentBalance) || 0;
              if (args.expectedFunding !== undefined) baseline.cash.expectedFunding = Number(args.expectedFunding) || 0;
              if (args.fundingDate) baseline.cash.fundingDate = new Date(args.fundingDate);
              if (args.fundingType && ['investment', 'loan', 'grant'].includes(args.fundingType)) baseline.cash.fundingType = args.fundingType;
              if (typeof baseline.calculateMetrics === 'function') baseline.calculateMetrics();
              await baseline.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, currentBalance: baseline.cash?.currentBalance, message: `Cash position updated. Balance: ${baseline.cash?.currentBalance}.` };
            }
            case 'update_fixed_costs': {
              const baseline = await FinancialBaseline.getOrCreate(wsFilter.user, wsFilter.workspace);
              if (!baseline.fixedCosts) baseline.fixedCosts = {};
              const costFields = ['salaries', 'rent', 'software', 'insurance', 'utilities', 'marketing', 'other'];
              const updated = [];
              for (const f of costFields) {
                if (args[f] !== undefined) { baseline.fixedCosts[f] = Number(args[f]) || 0; updated.push(`${f}: ${args[f]}`); }
              }
              if (args.otherTitle !== undefined) baseline.fixedCosts.otherTitle = String(args.otherTitle || '');
              if (updated.length === 0) return { error: 'No cost fields provided.' };
              baseline.fixedCosts.total = costFields.reduce((s, f) => s + (Number(baseline.fixedCosts[f]) || 0), 0);
              baseline.fixedCosts.items = []; // clear items array to stay in sync with legacy format
              if (typeof baseline.calculateMetrics === 'function') baseline.calculateMetrics();
              await baseline.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, updated, total: baseline.fixedCosts.total, message: `Fixed costs updated: ${updated.join(', ')}. New total: ${baseline.fixedCosts.total}.` };
            }
            case 'create_org_position': {
              const position = String(args.position || '').trim();
              if (!position) return { error: 'Position title is required.' };
              const { normalizeDepartmentKey: _normDeptKey } = require('../utils/departmentNormalize');
              const order = await OrgPosition.getNextOrder(wsFilter.workspace);
              const pos = new OrgPosition({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                position,
                name: String(args.name || '').trim() || undefined,
                email: String(args.email || '').trim().toLowerCase() || undefined,
                department: args.department ? _normDeptKey(args.department) : undefined,
                role: String(args.role || '').trim() || undefined,
                order,
              });
              await pos.save();
              return { success: true, id: pos._id.toString(), position: pos.position, message: `Org position "${pos.position}" created${pos.name ? ` — assigned to ${pos.name}` : ''}.` };
            }
            case 'update_org_position': {
              const positionTitle = String(args.positionTitle || '').trim();
              if (!positionTitle) return { error: 'positionTitle is required.' };
              const pos = await OrgPosition.findOne({ position: new RegExp(positionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              if (!pos) return { error: `Position "${positionTitle}" not found. Use get_org_positions to list available positions.` };
              const { normalizeDepartmentKey: _normDeptKeyU } = require('../utils/departmentNormalize');
              if (args.newTitle) pos.position = String(args.newTitle).trim();
              if (args.name !== undefined) pos.name = String(args.name).trim();
              if (args.email !== undefined) pos.email = String(args.email).trim().toLowerCase();
              if (args.department !== undefined) pos.department = args.department ? _normDeptKeyU(args.department) : undefined;
              if (args.role !== undefined) pos.role = String(args.role).trim();
              await pos.save();
              return { success: true, position: pos.position, name: pos.name, message: `Position "${pos.position}" updated${pos.name ? ` — assigned to ${pos.name}` : ''}.` };
            }
            case 'add_team_member': {
              // Creates an OrgPosition — this is what shows in Settings > Team tab
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Name is required to add a team member.' };
              const position = String(args.position || args.role || '').trim() || 'Team Member';
              const order = await OrgPosition.getNextOrder(wsFilter.workspace);
              const pos = new OrgPosition({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                position,   // job title / role (maps to 'title' in frontend)
                name,       // person's name (maps to 'holderName' in frontend)
                email: String(args.email || '').trim() || undefined,
                department: String(args.department || '').trim() || undefined,
                order,
              });
              await pos.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: pos._id.toString(), name: pos.name, position: pos.position, message: `"${pos.name}" added to the team as ${pos.position}${pos.department ? ` in ${pos.department}` : ''}. They will now appear in Settings > Team.` };
            }
            case 'invite_collaborator': {
              // Uses same Collaboration system as manual invite flow
              const email = String(args.email || '').toLowerCase().trim();
              if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return { error: 'A valid email address is required to send a collaborator invite.' };
              }

              // Same check as manual flow: block if email belongs to a full account holder
              const inviteeUser = await User.findOne({ email }).select('_id isCollaborator onboardingDone').lean();
              if (inviteeUser) {
                const isCollaboratorOnly = inviteeUser.isCollaborator && !inviteeUser.onboardingDone;
                if (!isCollaboratorOnly) {
                  return { error: `This email belongs to an existing account holder and can't be added as a collaborator.` };
                }
              }

              // Check collaborator limit (same as manual flow)
              const ownerUser = await User.findById(wsFilter.user).lean();
              const maxCollaborators = getLimit(ownerUser, 'maxCollaborators');
              if (maxCollaborators > 0) {
                const existingCount = await Collaboration.countDocuments({ owner: wsFilter.user, email: { $ne: email } });
                if (existingCount >= maxCollaborators) {
                  return { error: `Collaborator limit reached (${maxCollaborators}). Upgrade your plan to add more.` };
                }
              }

              // Create or update Collaboration record (same as manual flow)
              let collab = await Collaboration.findOne({ owner: wsFilter.user, email });
              if (!collab) {
                collab = await Collaboration.create({
                  owner: wsFilter.user,
                  email,
                  status: 'pending',
                  accessType: 'admin',
                  departments: [],
                  restrictedPages: [],
                  ...(inviteeUser ? { viewer: inviteeUser._id, collaborator: inviteeUser._id } : {}),
                });
              } else {
                if (inviteeUser) {
                  collab.viewer = collab.viewer || inviteeUser._id;
                  collab.collaborator = collab.collaborator || inviteeUser._id;
                }
              }
              const collabToken = crypto.randomBytes(24).toString('hex');
              collab.acceptToken = collabToken;
              collab.tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
              await collab.save();

              // Send invite email
              try {
                const { Resend } = require('resend');
                const resend = new Resend(process.env.RESEND_API_KEY);
                const owner = await User.findById(wsFilter.user).lean();
                const ownerName = owner
                  ? ([owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.fullName || owner.email)
                  : 'A Plan Genie user';
                const base = (process.env.APP_URL || 'https://plangenie.com').replace(/\/$/, '');
                const acceptUrl = `${base}/signup?collabToken=${encodeURIComponent(collabToken)}&email=${encodeURIComponent(email)}`;
                await resend.emails.send({
                  from: process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>',
                  to: email,
                  subject: `${ownerName} invited you to collaborate`,
                  html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#F8FAFC;"><div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,.05);"><h2 style="color:#1D4374;text-align:center;">Collaboration Invite</h2><p style="color:#4B5563;font-size:15px;line-height:1.6;"><strong>${ownerName}</strong> has invited you to view their Plan Genie dashboard.</p><div style="text-align:center;margin:32px 0;"><a href="${acceptUrl}" style="background:#1D4374;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;">Accept Invitation</a></div><p style="color:#6B7280;font-size:13px;">Or copy: <a href="${acceptUrl}" style="color:#1D4374;">${acceptUrl}</a></p><p style="color:#6B7280;font-size:13px;margin-top:24px;">This invite expires in 7 days.</p></div></div>`,
                  text: `${ownerName} invited you to collaborate on Plan Genie. Accept: ${acceptUrl}`,
                });
              } catch (emailErr) {
                console.error('[invite_collaborator] Email error:', emailErr?.message);
              }

              // In-app notification if invitee already has an account
              try {
                const freshInvitee = await User.findOne({ email }).lean();
                if (freshInvitee && String(freshInvitee._id) !== String(wsFilter.user)) {
                  const owner = await User.findById(wsFilter.user).lean();
                  const ownerName = owner ? ([owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.fullName || owner.email) : 'A Plan Genie user';
                  const nid = `collab-${String(collab._id)}`;
                  await Notification.findOneAndUpdate(
                    { user: freshInvitee._id, nid },
                    {
                      $set: {
                        title: `Collaboration invite from ${ownerName}`,
                        description: `${ownerName} invited you to view their Plan Genie dashboard (read-only).`,
                        type: 'collaboration',
                        severity: 'info',
                        time: 'now',
                        actions: [{ label: 'Accept', kind: 'primary' }, { label: 'Decline', kind: 'secondary' }],
                        data: { collabId: String(collab._id), ownerId: String(wsFilter.user), ownerName },
                        read: false,
                      },
                      $setOnInsert: { user: freshInvitee._id, nid },
                    },
                    { upsert: true }
                  );
                }
              } catch {}

              return { success: true, id: collab._id.toString(), email: collab.email, message: `Collaboration invite sent to ${email}. They will receive an email to accept.` };
            }
            case 'remove_team_member': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Name is required to identify the team member.' };
              let pos;
              if (args.positionId) {
                pos = await OrgPosition.findOne({ _id: args.positionId, ...wsFilter, isDeleted: { $ne: true } });
              }
              if (!pos) {
                // Case-insensitive partial name match
                pos = await OrgPosition.findOne({ ...wsFilter, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: { $ne: true } });
              }
              if (!pos) return { error: `No team member named "${name}" found. Use get_team_members to see the roster.` };
              pos.isDeleted = true;
              pos.deletedAt = new Date();
              await pos.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: pos._id.toString(), name: pos.name, message: `"${pos.name}" has been removed from the team roster.` };
            }
            case 'revoke_collaborator': {
              const email = String(args.email || '').toLowerCase().trim();
              if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email address is required to revoke a collaborator.' };
              const doc = await Collaboration.findOneAndDelete({ owner: wsFilter.user, email }).lean().exec();
              if (!doc) return { error: `No collaborator with email "${email}" found.` };
              // Clean up notifications and orphaned collaborator-only accounts (same as manual revoke)
              try {
                const invitee = await User.findOne({ email: doc.email }).lean().exec();
                if (invitee) {
                  await Notification.deleteMany({ user: invitee._id, nid: `collab-${String(doc._id)}` }).exec();
                  const isCollaboratorOnly = invitee.isCollaborator && !invitee.onboardingDone;
                  if (isCollaboratorOnly) {
                    const otherCollabs = await Collaboration.countDocuments({ $or: [{ viewer: invitee._id }, { collaborator: invitee._id }], status: 'accepted' }).exec();
                    const ownsCollabs = await Collaboration.countDocuments({ owner: invitee._id }).exec();
                    if (otherCollabs === 0 && ownsCollabs === 0) {
                      await User.deleteOne({ _id: invitee._id }).exec();
                      try { const RefreshToken = require('../models/RefreshToken'); await RefreshToken.deleteMany({ user: invitee._id }).exec(); } catch {}
                      try { await Notification.deleteMany({ user: invitee._id }).exec(); } catch {}
                    }
                  }
                }
              } catch (_e) {
                console.error('[revoke_collaborator] Cleanup error:', _e?.message || _e);
              }
              return { success: true, email, message: `Collaborator access for "${email}" has been revoked.` };
            }
            case 'update_kr_progress': {
              const krText = String(args.krText || '').trim();
              const current = Number(args.current);
              if (!krText) return { error: 'krText is required.' };
              if (isNaN(current)) return { error: 'current must be a number.' };
              let okr;
              if (args.okrId) {
                okr = await OKR.findOne({ _id: args.okrId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.objective) {
                okr = await OKR.findOne({ objective: new RegExp(args.objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                const allOkrs = await OKR.find({ workspace: wsFilter.workspace, isDeleted: { $ne: true } });
                for (const o of allOkrs) {
                  if (o.keyResults.some((k) => String(k.text || '').toLowerCase().includes(krText.toLowerCase()))) { okr = o; break; }
                }
              }
              if (!okr) return { error: `Could not find an OKR containing key result "${krText}". Try calling get_okrs first.` };
              const kr = okr.keyResults.find((k) => String(k.text || '').toLowerCase().includes(krText.toLowerCase()));
              if (!kr) return { error: `Key result "${krText}" not found.` };
              const prev = kr.current;
              kr.current = current;
              await okr.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              const pct = kr.target > 0 ? Math.round((current / kr.target) * 100) : 0;
              return { success: true, krText: kr.text, objective: okr.objective, previous: prev, current, target: kr.target, progress: pct, message: `"${kr.text}" updated to ${current} (${pct}% of target ${kr.target}).` };
            }
            case 'update_kr_fields': {
              const krText = String(args.krText || '').trim();
              if (!krText) return { error: 'krText is required to identify the key result.' };
              let okr;
              if (args.okrId) {
                okr = await OKR.findOne({ _id: args.okrId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.objective) {
                okr = await OKR.findOne({ objective: new RegExp(args.objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                const allOkrs = await OKR.find({ workspace: wsFilter.workspace, isDeleted: { $ne: true } });
                for (const o of allOkrs) {
                  if (o.keyResults.some((k) => String(k.text || '').toLowerCase().includes(krText.toLowerCase()))) { okr = o; break; }
                }
              }
              if (!okr) return { error: `Could not find an OKR containing key result "${krText}". Try calling get_okrs first.` };
              const kr = okr.keyResults.find((k) => String(k.text || '').toLowerCase().includes(krText.toLowerCase()));
              if (!kr) return { error: `Key result "${krText}" not found in OKR "${okr.objective}".` };
              if (args.metric !== undefined) kr.metric = String(args.metric || '').trim().toLowerCase() || kr.metric;
              if (args.current !== undefined) kr.current = Number(args.current);
              if (args.baseline !== undefined) kr.baseline = Number(args.baseline);
              if (args.target !== undefined) kr.target = Number(args.target);
              if (args.unit !== undefined) kr.unit = String(args.unit || '').trim();
              if (args.direction !== undefined) kr.direction = args.direction === 'decrease' ? 'decrease' : 'increase';
              if (args.startAt !== undefined) kr.startAt = args.startAt ? new Date(args.startAt) : undefined;
              if (args.endAt !== undefined) kr.endAt = args.endAt ? new Date(args.endAt) : undefined;
              await okr.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, krText: kr.text, objective: okr.objective, message: `Key result "${kr.text}" fields updated.` };
            }
            case 'notify_team_member': {
              const { recipientEmail, recipientName, subject, message: emailMsg } = args;
              if (!recipientEmail || !subject || !emailMsg) return { error: 'recipientEmail, subject, and message are required.' };
              if (!process.env.RESEND_API_KEY) return { error: 'Email notifications are not configured on this server.' };
              const { Resend } = require('resend');
              const resendClient = new Resend(process.env.RESEND_API_KEY);
              const fromAddress = process.env.RESEND_FROM || 'Plan Genie <hello@plangenie.com>';
              const htmlBody = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;"><p style="color:#1D4374;font-size:16px;font-weight:600;margin-bottom:16px;">${recipientName ? `Hi ${recipientName},` : 'Hello,'}</p><div style="background:#f8fafc;border-left:4px solid #1D4374;padding:16px;border-radius:4px;font-size:14px;color:#334155;white-space:pre-wrap;">${emailMsg}</div><p style="color:#94a3b8;font-size:12px;margin-top:24px;">Sent via Plan Genie</p></div>`;
              await resendClient.emails.send({ from: fromAddress, to: recipientEmail, subject, html: htmlBody, text: emailMsg });
              return { success: true, message: `Notification sent to ${recipientEmail}.` };
            }
            case 'batch_create_deliverables': {
              if (!Array.isArray(args.deliverables) || args.deliverables.length === 0) return { error: 'deliverables array is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project. Provide a valid projectTitle or projectId.` };
              const added = [];
              for (const d of args.deliverables) {
                const text = String(d.text || '').trim();
                if (!text) continue;
                project.deliverables.push({ text, dueWhen: d.dueWhen || undefined, ownerName: d.ownerName || undefined, done: false });
                added.push(text);
              }
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, count: added.length, added, projectTitle: project.title, message: `Added ${added.length} deliverable(s) to "${project.title}": ${added.join(', ')}.` };
            }
            case 'delete_deliverable': {
              const deliverableText = String(args.deliverableText || '').trim();
              if (!deliverableText) return { error: 'deliverableText is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let project;
              if (args.projectId) {
                project = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                project = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!project) return { error: `Could not find the ${args.projectType} project.` };
              const idx = project.deliverables.findIndex((d) => String(d.text || '').toLowerCase().includes(deliverableText.toLowerCase()));
              if (idx === -1) return { error: `Deliverable "${deliverableText}" not found in this project.` };
              const removed = project.deliverables[idx];
              project.deliverables.splice(idx, 1);
              await project.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, message: `Deliverable "${removed.text}" removed from "${project.title}".` };
            }
            case 'move_deliverable': {
              const deliverableText = String(args.deliverableText || '').trim();
              const sourceType = args.sourceProjectType;
              const targetType = args.targetProjectType;
              if (!deliverableText || !args.sourceProjectTitle || !args.targetProjectTitle) return { error: 'sourceProjectTitle, deliverableText, and targetProjectTitle are required.' };
              const SourceModel = sourceType === 'core' ? CoreProject : DepartmentProject;
              const TargetModel = targetType === 'core' ? CoreProject : DepartmentProject;
              const source = await SourceModel.findOne({ title: new RegExp(args.sourceProjectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              if (!source) return { error: `Source project "${args.sourceProjectTitle}" not found.` };
              const target = await TargetModel.findOne({ title: new RegExp(args.targetProjectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              if (!target) return { error: `Target project "${args.targetProjectTitle}" not found.` };
              const idx = source.deliverables.findIndex((d) => String(d.text || '').toLowerCase().includes(deliverableText.toLowerCase()));
              if (idx === -1) return { error: `Deliverable "${deliverableText}" not found in "${source.title}".` };
              const [del] = source.deliverables.splice(idx, 1);
              target.deliverables.push(del);
              await source.save();
              await target.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, message: `Deliverable "${del.text}" moved from "${source.title}" to "${target.title}".` };
            }
            case 'duplicate_project': {
              const newTitle = String(args.newTitle || '').trim();
              if (!newTitle) return { error: 'newTitle is required.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let original;
              if (args.projectId) {
                original = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } }).lean();
              } else if (args.projectTitle) {
                original = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } }).lean();
              }
              if (!original) return { error: `Could not find the ${args.projectType} project to duplicate.` };
              const { _id, createdAt, updatedAt, ...rest } = original;
              const copy = new Model({
                ...rest,
                title: newTitle,
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                isDeleted: false,
                deletedAt: undefined,
                deliverables: (original.deliverables || []).map(({ _id: did, done, ...d }) => ({ ...d, done: false })),
              });
              await copy.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: copy._id.toString(), title: copy.title, message: `Project duplicated as "${newTitle}" with ${copy.deliverables.length} deliverable(s).` };
            }
            case 'delete_okr': {
              if (!args.okrId && !args.objective) return { error: 'Provide either okrId or objective to identify the OKR.' };
              let okr;
              if (args.okrId) {
                okr = await OKR.findOne({ _id: args.okrId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                okr = await OKR.findOne({ objective: new RegExp(args.objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!okr) return { error: `OKR not found. Use get_okrs to list available OKRs.` };
              okr.isDeleted = true;
              okr.deletedAt = new Date();
              await okr.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, objective: okr.objective, message: `OKR "${okr.objective}" deleted.` };
            }
            case 'get_workspace_members': {
              const limit = limitNum(args?.limit, 50, 100);
              const members = await WorkspaceMember.find({ workspace: wsFilter.workspace, status: { $in: ['active', 'pending'] } })
                .select('email role status invitedAt acceptedAt user')
                .populate('user', 'firstName lastName fullName email')
                .sort({ role: 1, status: 1 })
                .limit(limit)
                .lean();
              return {
                list: members.map((m) => ({
                  id: m._id.toString(),
                  email: m.email,
                  name: m.user?.fullName || `${m.user?.firstName || ''} ${m.user?.lastName || ''}`.trim() || undefined,
                  role: m.role,
                  status: m.status,
                })),
                count: members.length,
              };
            }
            // ── Products ──
            case 'create_product': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Product name is required.' };
              const order = await Product.getNextOrder(wsFilter.workspace);
              const product = await Product.create({
                user: wsFilter.user, workspace: wsFilter.workspace,
                name,
                description: args.description?.trim() || undefined,
                pricing: args.pricing?.trim() || undefined,
                price: args.price?.trim() || undefined,
                unitCost: args.unitCost?.trim() || undefined,
                monthlyVolume: args.monthlyVolume?.trim() || undefined,
                order,
              });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: product._id.toString(), name: product.name, message: `Product "${product.name}" added.` };
            }
            case 'update_product': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Product name is required to find it.' };
              const product = await Product.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false });
              if (!product) return { error: `Product "${name}" not found. Use get_products to list available products.` };
              if (args.newName !== undefined) product.name = args.newName.trim();
              if (args.description !== undefined) product.description = args.description?.trim() || undefined;
              if (args.pricing !== undefined) product.pricing = args.pricing?.trim() || undefined;
              if (args.price !== undefined) product.price = args.price?.trim() || undefined;
              if (args.unitCost !== undefined) product.unitCost = args.unitCost?.trim() || undefined;
              if (args.monthlyVolume !== undefined) product.monthlyVolume = args.monthlyVolume?.trim() || undefined;
              await product.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: product._id.toString(), name: product.name, message: `Product "${product.name}" updated.` };
            }
            case 'delete_product': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Product name is required.' };
              const product = await Product.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false });
              if (!product) return { error: `Product "${name}" not found.` };
              product.isDeleted = true; product.deletedAt = new Date();
              await product.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: product._id.toString(), name: product.name, message: `Product "${product.name}" removed.` };
            }
            // ── Competitors ──
            case 'create_competitor': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Competitor name is required.' };
              const order = await Competitor.getNextOrder(wsFilter.workspace);
              const competitor = await Competitor.create({
                user: wsFilter.user, workspace: wsFilter.workspace,
                name,
                advantage: args.advantage?.trim() || undefined,
                weDoBetter: args.weDoBetter?.trim() || undefined,
                website: args.website?.trim() || undefined,
                notes: args.notes?.trim() || undefined,
                threatLevel: args.threatLevel || null,
                order,
              });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: competitor._id.toString(), name: competitor.name, message: `Competitor "${competitor.name}" added.` };
            }
            case 'update_competitor': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Competitor name is required to find it.' };
              const competitor = await Competitor.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false });
              if (!competitor) return { error: `Competitor "${name}" not found. Use get_competitors to list available competitors.` };
              if (args.newName !== undefined) competitor.name = args.newName.trim();
              if (args.advantage !== undefined) competitor.advantage = args.advantage?.trim() || undefined;
              if (args.weDoBetter !== undefined) competitor.weDoBetter = args.weDoBetter?.trim() || undefined;
              if (args.website !== undefined) competitor.website = args.website?.trim() || undefined;
              if (args.notes !== undefined) competitor.notes = args.notes?.trim() || undefined;
              if (args.threatLevel !== undefined) competitor.threatLevel = args.threatLevel || null;
              await competitor.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: competitor._id.toString(), name: competitor.name, message: `Competitor "${competitor.name}" updated.` };
            }
            case 'delete_competitor': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Competitor name is required.' };
              const competitor = await Competitor.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false });
              if (!competitor) return { error: `Competitor "${name}" not found.` };
              competitor.isDeleted = true; competitor.deletedAt = new Date();
              await competitor.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: competitor._id.toString(), name: competitor.name, message: `Competitor "${competitor.name}" removed.` };
            }
            // ── Revenue Streams ──
            case 'create_revenue_stream': {
              const name = String(args.name || '').trim();
              const type = String(args.type || '').trim();
              const validTypes = ['one_off_project', 'ongoing_retainer', 'time_based', 'product_sales', 'program_cohort', 'grants_donations', 'mixed_unsure'];
              if (!name) return { error: 'Revenue stream name is required.' };
              if (!validTypes.includes(type)) return { error: `Invalid type. Must be one of: ${validTypes.join(', ')}.` };
              if (args.isPrimary) {
                await RevenueStream.updateMany({ user: wsFilter.user, workspace: wsFilter.workspace, isPrimary: true }, { isPrimary: false });
              }
              const stream = await RevenueStream.create({
                user: wsFilter.user, workspace: wsFilter.workspace,
                name, type,
                description: args.description || '',
                inputs: args.inputs || {},
                isPrimary: args.isPrimary || false,
                isActive: true,
              });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: stream._id.toString(), name: stream.name, message: `Revenue stream "${stream.name}" created.` };
            }
            case 'update_revenue_stream': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Revenue stream name is required to find it.' };
              const stream = await RevenueStream.findOne({ user: wsFilter.user, workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
              if (!stream) return { error: `Revenue stream "${name}" not found.` };
              if (args.newName !== undefined) stream.name = args.newName;
              if (args.description !== undefined) stream.description = args.description;
              const validTypes = ['one_off_project', 'ongoing_retainer', 'time_based', 'product_sales', 'program_cohort', 'grants_donations', 'mixed_unsure'];
              if (args.type !== undefined && validTypes.includes(args.type)) stream.type = args.type;
              if (args.inputs !== undefined) stream.inputs = { ...(stream.inputs?.toObject ? stream.inputs.toObject() : stream.inputs), ...args.inputs };
              if (args.isActive !== undefined) stream.isActive = args.isActive;
              if (args.isPrimary !== undefined && args.isPrimary) {
                await RevenueStream.updateMany({ user: wsFilter.user, workspace: wsFilter.workspace, isPrimary: true, _id: { $ne: stream._id } }, { isPrimary: false });
                stream.isPrimary = true;
              }
              await stream.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: stream._id.toString(), name: stream.name, message: `Revenue stream "${stream.name}" updated.` };
            }
            case 'delete_revenue_stream': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Revenue stream name is required.' };
              const stream = await RevenueStream.findOne({ user: wsFilter.user, workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
              if (!stream) return { error: `Revenue stream "${name}" not found.` };
              stream.isActive = false;
              await stream.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: stream._id.toString(), name: stream.name, message: `Revenue stream "${stream.name}" removed.` };
            }
            // ── SWOT update/delete ──
            case 'update_swot_entry': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'Current SWOT entry text is required to find it.' };
              const query = { workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false };
              if (args.entryType) query.entryType = args.entryType;
              const entry = await SwotEntry.findOne(query);
              if (!entry) return { error: `SWOT entry "${text}" not found. Use get_swot_analysis to see current entries.` };
              if (args.newText !== undefined) entry.text = args.newText.trim();
              if (args.priority !== undefined) entry.priority = args.priority || null;
              if (args.notes !== undefined) entry.notes = args.notes?.trim() || undefined;
              await entry.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: entry._id.toString(), entryType: entry.entryType, message: `SWOT ${entry.entryType} "${entry.text}" updated.` };
            }
            case 'delete_swot_entry': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'SWOT entry text is required.' };
              const query = { workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: false };
              if (args.entryType) query.entryType = args.entryType;
              const entry = await SwotEntry.findOne(query);
              if (!entry) return { error: `SWOT entry "${text}" not found.` };
              entry.isDeleted = true; entry.deletedAt = new Date();
              await entry.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: entry._id.toString(), entryType: entry.entryType, text: entry.text, message: `SWOT ${entry.entryType} "${entry.text}" removed.` };
            }
            // ── OKR update ──
            case 'update_okr': {
              if (!args.okrId && !args.objective) return { error: 'Provide either okrId or objective to identify the OKR.' };
              let okr;
              if (args.okrId) {
                okr = await OKR.findOne({ _id: args.okrId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                okr = await OKR.findOne({ objective: new RegExp(args.objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!okr) return { error: 'OKR not found. Use get_okrs to list available OKRs.' };
              if (args.newObjective !== undefined) okr.objective = args.newObjective.trim();
              if (args.notes !== undefined) okr.notes = args.notes?.trim() || undefined;
              await okr.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: okr._id.toString(), objective: okr.objective, message: `OKR "${okr.objective}" updated.` };
            }
            // ── Financial work costs ──
            case 'update_work_costs': {
              const workspaceId = wsFilter.workspace;
              const baseline = await FinancialBaseline.getOrCreate(wsFilter.user, workspaceId);
              if (args.contractors !== undefined) baseline.workRelatedCosts.contractors = args.contractors;
              if (args.materials !== undefined) baseline.workRelatedCosts.materials = args.materials;
              if (args.commissions !== undefined) baseline.workRelatedCosts.commissions = args.commissions;
              if (args.shipping !== undefined) baseline.workRelatedCosts.shipping = args.shipping;
              if (args.other !== undefined) baseline.workRelatedCosts.other = args.other;
              if (args.otherTitle !== undefined) baseline.workRelatedCosts.otherTitle = args.otherTitle;
              const wc = baseline.workRelatedCosts;
              baseline.workRelatedCosts.total = (wc.contractors || 0) + (wc.materials || 0) + (wc.commissions || 0) + (wc.shipping || 0) + (wc.other || 0);
              baseline.workRelatedCosts.items = [];
              await baseline.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, total: baseline.workRelatedCosts.total, message: `Work-related costs updated. Total: $${baseline.workRelatedCosts.total}/mo.` };
            }
            // ── Collaborator access ──
            case 'update_collaborator_access': {
              const email = String(args.email || '').toLowerCase().trim();
              if (!email) return { error: 'Collaborator email is required.' };
              const collab = await Collaboration.findOne({ owner: wsFilter.user, email });
              if (!collab) return { error: `No collaborator with email "${email}" found.` };
              const accessType = ['admin', 'limited'].includes(args.accessType) ? args.accessType : 'admin';
              collab.accessType = accessType;
              collab.departments = accessType === 'limited' && Array.isArray(args.departments) ? args.departments : [];
              collab.restrictedPages = accessType === 'limited' && Array.isArray(args.restrictedPages) ? args.restrictedPages : [];
              await collab.save();
              return { success: true, email, accessType, message: `Access for "${email}" updated to ${accessType}.` };
            }
            // ── Deliverable update ──
            case 'update_deliverable': {
              const dText = String(args.deliverableText || '').trim();
              if (!dText) return { error: 'deliverableText is required to find the deliverable.' };
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let proj;
              if (args.projectId) {
                proj = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else if (args.projectTitle) {
                proj = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                // Search across all projects for the deliverable
                proj = await Model.findOne({ workspace: wsFilter.workspace, isDeleted: { $ne: true }, 'deliverables.text': new RegExp(dText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
              }
              if (!proj) return { error: 'Project not found. Provide projectTitle or projectId.' };
              const dIdx = proj.deliverables.findIndex((d) => String(d.text || '').toLowerCase().includes(dText.toLowerCase()));
              if (dIdx === -1) return { error: `Deliverable "${dText}" not found in project "${proj.title}".` };
              const del = proj.deliverables[dIdx];
              if (args.newText !== undefined) del.text = args.newText.trim();
              if (args.kpi !== undefined) del.kpi = args.kpi?.trim() || undefined;
              if (args.dueWhen !== undefined) del.dueWhen = args.dueWhen?.trim() || undefined;
              if (args.ownerName !== undefined) del.ownerName = args.ownerName?.trim() || undefined;
              proj.deliverables[dIdx] = del;
              proj.markModified('deliverables');
              await proj.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, projectTitle: proj.title, deliverableText: del.text, message: `Deliverable updated in "${proj.title}".` };
            }
            // ── Restore tools ──
            case 'restore_project': {
              const Model = args.projectType === 'core' ? CoreProject : DepartmentProject;
              let proj;
              if (args.projectId) {
                proj = await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace, isDeleted: true });
              } else if (args.projectTitle) {
                proj = await Model.findOne({ title: new RegExp(args.projectTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: true });
              } else {
                return { error: 'Provide projectId or projectTitle to identify the deleted project.' };
              }
              if (!proj) return { error: 'Deleted project not found. It may have already been restored.' };
              proj.isDeleted = false;
              proj.deletedAt = undefined;
              await proj.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: proj._id.toString(), title: proj.title, message: `Project "${proj.title}" restored.` };
            }
            case 'restore_okr': {
              if (!args.okrId && !args.objective) return { error: 'Provide okrId or objective to identify the deleted OKR.' };
              let okr;
              if (args.okrId) {
                okr = await OKR.findOne({ _id: args.okrId, workspace: wsFilter.workspace, isDeleted: true });
              } else {
                okr = await OKR.findOne({ objective: new RegExp(args.objective.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: true });
              }
              if (!okr) return { error: 'Deleted OKR not found. It may have already been restored.' };
              okr.isDeleted = false;
              okr.deletedAt = undefined;
              await okr.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: okr._id.toString(), objective: okr.objective, message: `OKR "${okr.objective}" restored.` };
            }
            case 'restore_product': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Product name is required.' };
              const product = await Product.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: true });
              if (!product) return { error: `Deleted product "${name}" not found.` };
              product.isDeleted = false;
              product.deletedAt = undefined;
              await product.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: product._id.toString(), name: product.name, message: `Product "${product.name}" restored.` };
            }
            case 'restore_competitor': {
              const name = String(args.name || '').trim();
              if (!name) return { error: 'Competitor name is required.' };
              const competitor = await Competitor.findOne({ workspace: wsFilter.workspace, name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: true });
              if (!competitor) return { error: `Deleted competitor "${name}" not found.` };
              competitor.isDeleted = false;
              competitor.deletedAt = undefined;
              await competitor.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: competitor._id.toString(), name: competitor.name, message: `Competitor "${competitor.name}" restored.` };
            }
            case 'restore_swot_entry': {
              const text = String(args.text || '').trim();
              if (!text) return { error: 'SWOT entry text is required.' };
              const query = { workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: true };
              if (args.entryType) query.entryType = args.entryType;
              const entry = await SwotEntry.findOne(query);
              if (!entry) return { error: `Deleted SWOT entry "${text}" not found.` };
              entry.isDeleted = false;
              entry.deletedAt = undefined;
              await entry.save();
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: entry._id.toString(), entryType: entry.entryType, message: `SWOT ${entry.entryType} "${entry.text}" restored.` };
            }
            // ── Decisions ──
            case 'create_decision': {
              const title = String(args.title || '').trim();
              if (!title) return { error: 'Decision title is required.' };
              // Entitlement check — same as decision.controller.js
              const decisionOwner = await User.findById(wsFilter.user).lean();
              const decisionLimit = getLimit(decisionOwner, 'decisionsPerMonth');
              if (decisionLimit > 0) {
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const decisionCount = await Decision.countDocuments({ user: wsFilter.user, workspace: wsFilter.workspace, createdAt: { $gte: monthStart } });
                if (decisionCount >= decisionLimit) return { error: `Monthly decision limit reached (${decisionLimit}). Upgrade your plan to log more decisions.` };
              }
              const did = `d_${Math.random().toString(36).slice(2, 10)}`;
              const decision = await Decision.create({
                user: wsFilter.user, workspace: wsFilter.workspace, did, title,
                context: args.context?.trim() || '',
                rationale: args.rationale?.trim() || '',
                decidedBy: args.decidedBy?.trim() || '',
                status: ['proposed', 'approved', 'rejected'].includes(args.status) ? args.status : 'approved',
                tags: Array.isArray(args.tags) ? args.tags.map(String).filter(Boolean) : [],
                targets: Array.isArray(args.targets) ? args.targets.map((t) => ({ type: ['goal', 'project', 'assumption', 'other'].includes(t?.type) ? t.type : 'other', ref: t?.ref || {}, label: String(t?.label || '').trim() })) : [],
                decidedAt: args.decidedAt ? new Date(args.decidedAt) : new Date(),
              });
              return { success: true, id: decision._id.toString(), did: decision.did, title: decision.title, message: `Decision "${decision.title}" logged.` };
            }
            case 'update_decision': {
              if (!args.decisionId && !args.title) return { error: 'Provide decisionId or title to identify the decision.' };
              let decision;
              if (args.decisionId) {
                decision = await Decision.findOne({ _id: args.decisionId, workspace: wsFilter.workspace });
              } else {
                decision = await Decision.findOne({ title: new RegExp(args.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace });
              }
              if (!decision) return { error: 'Decision not found.' };
              if (args.newTitle !== undefined) decision.title = args.newTitle.trim();
              if (args.context !== undefined) decision.context = args.context?.trim() || '';
              if (args.rationale !== undefined) decision.rationale = args.rationale?.trim() || '';
              if (args.decidedBy !== undefined) decision.decidedBy = args.decidedBy?.trim() || '';
              if (args.decidedAt !== undefined) decision.decidedAt = args.decidedAt ? new Date(args.decidedAt) : decision.decidedAt;
              if (args.status !== undefined && ['proposed', 'approved', 'rejected'].includes(args.status)) decision.status = args.status;
              if (Array.isArray(args.tags)) decision.tags = args.tags.map(String).filter(Boolean);
              if (Array.isArray(args.targets)) decision.targets = args.targets.map((t) => ({ type: ['goal', 'project', 'assumption', 'other'].includes(t?.type) ? t.type : 'other', ref: t?.ref || {}, label: String(t?.label || '').trim() }));
              if (Array.isArray(args.impacts)) decision.impacts = args.impacts.map((im) => ({ assumptionKey: String(im?.assumptionKey || '').trim(), oldValue: String(im?.oldValue || '').trim(), newValue: String(im?.newValue || '').trim(), note: String(im?.note || '').trim() })).filter((im) => im.assumptionKey);
              await decision.save();
              return { success: true, id: decision._id.toString(), title: decision.title, message: `Decision "${decision.title}" updated.` };
            }
            // ── Assumptions ──
            case 'create_assumption': {
              const key = String(args.key || '').trim();
              if (!key) return { error: 'Assumption key is required.' };
              const aid = `a_${Math.random().toString(36).slice(2, 10)}`;
              const value = String(args.value || '').trim();
              const assumption = await Assumption.create({
                user: wsFilter.user, workspace: wsFilter.workspace, aid, key,
                label: args.label?.trim() || key,
                category: ['revenue', 'cost', 'headcount', 'pricing', 'other'].includes(args.category) ? args.category : 'other',
                unit: args.unit?.trim() || '',
                currentValue: value,
                history: [{ version: 1, value, changedBy: String(wsFilter.user), changedAt: new Date() }],
              });
              return { success: true, id: assumption._id.toString(), aid: assumption.aid, key: assumption.key, message: `Assumption "${assumption.label || assumption.key}" created.` };
            }
            case 'update_assumption': {
              const key = String(args.key || '').trim();
              if (!key) return { error: 'Assumption key is required.' };
              const assumption = await Assumption.findOne({ user: wsFilter.user, workspace: wsFilter.workspace, key: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
              if (!assumption) return { error: `Assumption "${key}" not found.` };
              if (args.label !== undefined) assumption.label = args.label?.trim() || '';
              if (args.unit !== undefined) assumption.unit = args.unit?.trim() || '';
              if (args.category !== undefined && ['revenue', 'cost', 'headcount', 'pricing', 'other'].includes(args.category)) assumption.category = args.category;
              if (args.value !== undefined) {
                const newVal = String(args.value || '');
                const ver = assumption.history && assumption.history.length ? Math.max(...assumption.history.map((h) => Number(h.version) || 0)) + 1 : 1;
                assumption.currentValue = newVal;
                assumption.history = (assumption.history || []).concat([{ version: ver, value: newVal, changedBy: String(wsFilter.user), changedAt: new Date() }]);
              }
              await assumption.save();
              return { success: true, id: assumption._id.toString(), key: assumption.key, currentValue: assumption.currentValue, message: `Assumption "${assumption.label || assumption.key}" updated.` };
            }
            // ── Invite management ──
            case 'resend_collaborator_invite': {
              const email = String(args.email || '').toLowerCase().trim();
              if (!email) return { error: 'Email is required.' };
              const collab = await Collaboration.findOne({ owner: wsFilter.user, email, status: 'pending' });
              if (!collab) return { error: `No pending invite found for "${email}". They may have already accepted or were not invited.` };
              // Generate fresh token and expiry
              const newToken = crypto.randomBytes(24).toString('hex');
              const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
              collab.acceptToken = newToken;
              collab.tokenExpiry = newExpiry;
              await collab.save();
              // Resend email
              try {
                const { Resend } = require('resend');
                const owner = await User.findById(wsFilter.user).select('firstName lastName fullName email').lean();
                const ownerName = owner?.fullName || `${owner?.firstName || ''} ${owner?.lastName || ''}`.trim() || 'Your colleague';
                const appUrl = process.env.FRONTEND_URL || 'https://app.plangenie.ai';
                const inviteUrl = `${appUrl}/collab-invite?token=${newToken}`;
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                  from: process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>',
                  to: email,
                  subject: `Reminder: ${ownerName} invited you to collaborate on Plan Genie`,
                  html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#F8FAFC;"><div style="background:#fff;border-radius:12px;padding:32px;"><h2 style="color:#1D4374;">Dashboard Invite Reminder</h2><p style="color:#4B5563;"><strong>${ownerName}</strong> invited you to view their business plan on Plan Genie.</p><div style="text-align:center;margin:32px 0;"><a href="${inviteUrl}" style="display:inline-block;background:#1D4374;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;">View Dashboard</a></div><p style="color:#6B7280;font-size:13px;">Link: <a href="${inviteUrl}">${inviteUrl}</a></p><p style="color:#6B7280;font-size:13px;">Expires in 7 days.</p></div></div>`,
                  text: `${ownerName} invited you to view their business plan on Plan Genie.\n\nAccept: ${inviteUrl}\n\nExpires in 7 days.`,
                });
              } catch (emailErr) {
                console.error('[resend_collaborator_invite] Email failed:', emailErr?.message);
              }
              return { success: true, email, message: `Invite resent to "${email}" with a fresh 7-day link.` };
            }
            case 'update_workspace_member_role': {
              const role = args.role;
              if (!['admin', 'contributor', 'viewer'].includes(role)) return { error: 'Role must be one of: admin, contributor, viewer.' };
              // Only admins and owners can change roles (same as workspaceMember.controller.js)
              const { checkWorkspaceRole: _checkRoleUpdate } = require('../controllers/workspaceMember.controller');
              const roleChanger = await _checkRoleUpdate(String(wsFilter.user), wsFilter.workspace, 'admin');
              if (!roleChanger) return { error: 'Only workspace admins or owners can change member roles.' };
              let member;
              if (args.memberId) {
                member = await WorkspaceMember.findOne({ _id: args.memberId, workspace: wsFilter.workspace });
              } else if (args.email) {
                const email = String(args.email).toLowerCase().trim();
                member = await WorkspaceMember.findOne({ email, workspace: wsFilter.workspace });
              } else {
                return { error: 'Provide memberId or email to identify the workspace member.' };
              }
              if (!member) return { error: 'Workspace member not found. Use get_workspace_members to list members.' };
              if (member.role === 'owner') return { error: 'Cannot change the role of the workspace owner.' };
              const oldRole = member.role;
              member.role = role;
              await member.save();
              return { success: true, id: member._id.toString(), email: member.email, role: member.role, message: `Role for "${member.email}" changed from ${oldRole} to ${role}.` };
            }
            // ── Values & culture ──
            case 'update_values_culture': {
              if (!wsFilter.workspace) return { error: 'No workspace found.' };
              const allowed = ['valuesCore', 'cultureFeeling', 'valuesCoreKeywords'];
              const updates = {};
              for (const f of allowed) {
                if (args[f] !== undefined) {
                  updates[f] = f === 'valuesCoreKeywords' ? (Array.isArray(args[f]) ? args[f] : [String(args[f]).trim()]) : String(args[f] || '').trim();
                }
              }
              if (Object.keys(updates).length === 0) return { error: 'No fields provided. Use valuesCore, cultureFeeling, or valuesCoreKeywords.' };
              await updateWorkspaceFields(wsFilter.workspace, updates);
              return { success: true, updated: Object.keys(updates), message: `Updated: ${Object.keys(updates).join(', ')}.` };
            }
            // ── Market info ──
            case 'update_market_info': {
              if (!wsFilter.workspace) return { error: 'No workspace found.' };
              // Use canonical field names that match the page UI (targetCustomer, partners, competitorsNotes)
              const updates = {};
              if (args.targetCustomer !== undefined) updates.targetCustomer = String(args.targetCustomer || '').trim();
              if (args.partners !== undefined) updates.partners = String(args.partners || '').trim();
              if (args.competitorsNotes !== undefined) updates.competitorsNotes = String(args.competitorsNotes || '').trim();
              if (Object.keys(updates).length === 0) return { error: 'No fields provided. Use targetCustomer, partners, or competitorsNotes.' };
              await updateWorkspaceFields(wsFilter.workspace, updates);
              return { success: true, updated: Object.keys(updates), message: `Updated: ${Object.keys(updates).join(', ')}.` };
            }
            // ── Delete org position ──
            case 'delete_org_position': {
              if (!args.positionId && !args.positionTitle) return { error: 'Provide positionId or positionTitle to identify the position.' };
              let pos;
              if (args.positionId) {
                pos = await OrgPosition.findOne({ _id: args.positionId, workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              } else {
                pos = await OrgPosition.findOne({ position: new RegExp(args.positionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
              }
              if (!pos) return { error: `Position "${args.positionTitle || args.positionId}" not found.` };
              pos.isDeleted = true; pos.deletedAt = new Date();
              await pos.save();
              // Cascade: reparent any children (same as orgPosition.controller.js delete)
              await OrgPosition.updateMany({ parentId: pos._id, workspace: wsFilter.workspace }, { $set: { parentId: null } });
              try { await agents.invalidateCache(String(wsFilter.user || ''), null, String(wsFilter.workspace || '')); } catch {}
              return { success: true, id: pos._id.toString(), position: pos.position, name: pos.name, message: `Position "${pos.position}"${pos.name ? ` (${pos.name})` : ''} removed from the org chart.` };
            }
            // ── Delete decision ──
            case 'delete_decision': {
              if (!args.decisionId && !args.title) return { error: 'Provide decisionId or title to identify the decision.' };
              let decision;
              if (args.decisionId) {
                decision = await Decision.findOne({ _id: args.decisionId, workspace: wsFilter.workspace });
              } else {
                decision = await Decision.findOne({ title: new RegExp(args.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace });
              }
              if (!decision) return { error: 'Decision not found.' };
              const deletedTitle = decision.title;
              await Decision.deleteOne({ _id: decision._id });
              return { success: true, title: deletedTitle, message: `Decision "${deletedTitle}" deleted.` };
            }
            // ── Delete assumption ──
            case 'delete_assumption': {
              const key = String(args.key || '').trim();
              if (!key) return { error: 'Assumption key is required.' };
              const assumption = await Assumption.findOne({ user: wsFilter.user, workspace: wsFilter.workspace, key: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
              if (!assumption) return { error: `Assumption "${key}" not found.` };
              const deletedKey = assumption.key;
              await Assumption.deleteOne({ _id: assumption._id });
              return { success: true, key: deletedKey, message: `Assumption "${deletedKey}" deleted.` };
            }
            // ── Read decisions + assumptions ──
            case 'get_decisions': {
              const limitNum2 = limitNum(args?.limit, 20, 50);
              const query = { workspace: wsFilter.workspace };
              if (args.status && ['proposed', 'approved', 'rejected'].includes(args.status)) query.status = args.status;
              const decisions = await Decision.find(query).sort({ decidedAt: -1 }).limit(limitNum2).lean();
              return {
                count: decisions.length,
                list: decisions.map((d) => ({
                  id: d._id.toString(),
                  did: d.did,
                  title: d.title,
                  status: d.status,
                  context: d.context || undefined,
                  rationale: d.rationale || undefined,
                  decidedBy: d.decidedBy || undefined,
                  decidedAt: d.decidedAt ? d.decidedAt.toISOString().slice(0, 10) : undefined,
                  tags: d.tags?.length ? d.tags : undefined,
                  targets: d.targets?.length ? d.targets : undefined,
                  impacts: d.impacts?.length ? d.impacts : undefined,
                })),
              };
            }
            case 'get_assumptions': {
              const limitNum2 = limitNum(args?.limit, 20, 50);
              const query = { workspace: wsFilter.workspace };
              if (args.category && ['revenue', 'cost', 'headcount', 'pricing', 'other'].includes(args.category)) query.category = args.category;
              const assumptions = await Assumption.find(query).sort({ createdAt: -1 }).limit(limitNum2).lean();
              return {
                count: assumptions.length,
                list: assumptions.map((a) => ({
                  id: a._id.toString(),
                  aid: a.aid,
                  key: a.key,
                  label: a.label || undefined,
                  category: a.category,
                  currentValue: a.currentValue,
                  unit: a.unit || undefined,
                })),
              };
            }
            // ── Workspace member invite / remove ──
            case 'invite_workspace_member': {
              const email = String(args.email || '').toLowerCase().trim();
              if (!email || !email.includes('@')) return { error: 'Valid email is required.' };
              const role = ['admin', 'contributor', 'viewer'].includes(args.role) ? args.role : 'viewer';
              // Only admins and owners can invite (same as workspaceMember.controller.js)
              const { checkWorkspaceRole } = require('../controllers/workspaceMember.controller');
              const inviterAccess = await checkWorkspaceRole(String(wsFilter.user), wsFilter.workspace, 'admin');
              if (!inviterAccess) return { error: 'Only workspace admins or owners can invite members.' };
              // Check if already a member
              const existing = await WorkspaceMember.findOne({ workspace: wsFilter.workspace, email });
              if (existing) {
                if (existing.status === 'active') return { error: `"${email}" is already an active workspace member.` };
                if (existing.status === 'pending') return { error: `An invite is already pending for "${email}". Use resend_collaborator_invite if you want to resend.` };
                // Re-invite removed/declined member
                existing.status = 'pending';
                existing.role = role;
                existing.inviteToken = WorkspaceMember.generateInviteToken();
                existing.inviteTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                existing.invitedBy = wsFilter.user;
                existing.invitedAt = new Date();
                await existing.save();
                await _sendWorkspaceInviteEmail(existing, wsFilter.workspace, wsFilter.user);
                return { success: true, id: existing._id.toString(), email, role, message: `Workspace invite resent to "${email}" as ${role}.` };
              }
              const existingUser = await User.findOne({ email }).select('_id').lean();
              const member = await WorkspaceMember.create({
                workspace: wsFilter.workspace,
                user: existingUser?._id || null,
                email, role,
                status: 'pending',
                inviteToken: WorkspaceMember.generateInviteToken(),
                inviteTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                invitedBy: wsFilter.user,
                invitedAt: new Date(),
              });
              await _sendWorkspaceInviteEmail(member, wsFilter.workspace, wsFilter.user);
              return { success: true, id: member._id.toString(), email, role, message: `Workspace invite sent to "${email}" as ${role}.` };
            }
            case 'remove_workspace_member': {
              if (!args.memberId && !args.email) return { error: 'Provide memberId or email to identify the member.' };
              // Only admins and owners can remove members
              const { checkWorkspaceRole: _checkRoleRemove } = require('../controllers/workspaceMember.controller');
              const removerAccess = await _checkRoleRemove(String(wsFilter.user), wsFilter.workspace, 'admin');
              if (!removerAccess) return { error: 'Only workspace admins or owners can remove members.' };
              let member;
              if (args.memberId) {
                member = await WorkspaceMember.findOne({ _id: args.memberId, workspace: wsFilter.workspace });
              } else {
                const email = String(args.email).toLowerCase().trim();
                member = await WorkspaceMember.findOne({ email, workspace: wsFilter.workspace });
              }
              if (!member) return { error: 'Workspace member not found. Use get_workspace_members to list members.' };
              if (member.role === 'owner') return { error: 'Cannot remove the workspace owner.' };
              const removedEmail = member.email;
              member.status = 'removed';
              await member.save();
              return { success: true, id: member._id.toString(), email: removedEmail, message: `"${removedEmail}" has been removed from the workspace.` };
            }
            // ── Workspace settings ──
            case 'update_workspace': {
              const workspace = await Workspace.findOne({ _id: wsFilter.workspace, user: wsFilter.user });
              if (!workspace) return { error: 'Workspace not found.' };
              const updates = {};
              if (args.name !== undefined) { workspace.name = String(args.name || '').trim(); updates.name = workspace.name; }
              if (args.description !== undefined) { workspace.description = String(args.description || '').trim(); updates.description = workspace.description; }
              if (args.industry !== undefined) { workspace.industry = String(args.industry || '').trim(); updates.industry = workspace.industry; }
              if (args.status !== undefined && ['active', 'paused', 'archived'].includes(args.status)) { workspace.status = args.status; updates.status = workspace.status; }
              if (args.reviewCadence && typeof args.reviewCadence === 'object') {
                workspace.reviewCadence = { ...(workspace.reviewCadence?.toObject?.() || workspace.reviewCadence || {}), ...args.reviewCadence };
                updates.reviewCadence = workspace.reviewCadence;
              }
              if (args.defaultWorkspace === true) {
                await Workspace.updateMany({ user: wsFilter.user, _id: { $ne: workspace._id } }, { $set: { defaultWorkspace: false } });
                workspace.defaultWorkspace = true;
                updates.defaultWorkspace = true;
              }
              if (Object.keys(updates).length === 0) return { error: 'No fields provided to update.' };
              workspace.lastActivityAt = new Date();
              await workspace.save();
              return { success: true, updated: Object.keys(updates), message: `Workspace updated: ${Object.keys(updates).join(', ')}.` };
            }
            default: return {};
          }
        };

        let chatMessages = [
          { role: 'system', content: system },
          ...(contextText ? [{ role: 'system', content: contextText }] : []),
          ...(ragText ? [{ role: 'system', content: ragText }] : []),
          ...(agentType ? [{ role: 'system', content: `You are currently operating as the ${agentType} agent. Focus your analysis and actions on ${agentType}-related tasks.${agentContext ? '\n\nLatest analysis from this agent:\n' + JSON.stringify(agentContext).slice(0, 1500) : ''}` }] : []),
          ...(mentionedProjects.length > 0 ? [{
            role: 'system',
            content: 'MENTIONED PROJECTS — the user referenced these with @ so use this data directly without needing to call tools:\n\n' +
              mentionedProjects.map((p) => {
                const lines = [`[${p.title}] (${p.type === 'core' ? 'Core project' : `${p.departmentKey || 'Department'} project`})`];
                if (p.goal) lines.push(`  Goal: ${p.goal}`);
                if (p.ownerName) lines.push(`  Owner: ${p.ownerName}`);
                if (p.dueWhen) lines.push(`  Due: ${p.dueWhen}`);
                if (p.priority) lines.push(`  Priority: ${p.priority}`);
                if (Array.isArray(p.deliverables) && p.deliverables.length > 0) {
                  lines.push(`  Deliverables (${p.deliverables.length}):`);
                  p.deliverables.forEach((d) => {
                    lines.push(`    - ${d.text}${d.done ? ' [done]' : ''}${d.dueWhen ? ` (due ${d.dueWhen})` : ''}${d.ownerName ? ` [owner: ${d.ownerName}]` : ''}`);
                  });
                }
                return lines.join('\n');
              }).join('\n\n'),
          }] : []),
          ...safeMsgs,
        ];
        const client = getOpenAI();
        const toolTrace = [];
        for (let i = 0; i < 5; i++) {
          const resp = await client.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800, messages: chatMessages, tools, tool_choice: 'auto' });
          const msg = resp.choices?.[0]?.message;
          const toolCalls = msg?.tool_calls || [];
          if (toolCalls.length === 0) {
            const baseReply = String(msg?.content || '').trim() || 'I did not find an answer.';
            const followUps = _getFollowUps(toolTrace);
            if (wantStream) {
              // Stream the final reply token-by-token using OpenAI streaming
              let fullReply = '';
              try {
                const streamResp = await client.chat.completions.create({
                  model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 800,
                  messages: chatMessages, tools, tool_choice: 'none', stream: true,
                });
                for await (const chunk of streamResp) {
                  const delta = chunk.choices?.[0]?.delta?.content || '';
                  if (delta) { fullReply += delta; sendSSE({ type: 'token', text: delta }); }
                }
              } catch { fullReply = baseReply; sendSSE({ type: 'token', text: baseReply }); }
              // Persist to history
              if (wsFilter?.workspace && wsFilter?.user) {
                const lastUser = Array.isArray(messages) ? messages[messages.length - 1] : null;
                ChatHistory.appendMessages(wsFilter.workspace, wsFilter.user, [
                  ...(lastUser?.role === 'user' ? [{ role: 'user', content: String(lastUser.content || '').slice(0, 2000), agentType }] : []),
                  { role: 'assistant', content: fullReply || baseReply, agentType },
                ]).catch(() => {});
              }
              sendSSE({ type: 'done', followUps });
              return res.end();
            }
            return sendFinal(baseReply, wsFilter, messages, agentType, followUps);
          }
          chatMessages.push({ role: 'assistant', content: msg?.content || '', tool_calls: toolCalls });
          for (const tc of toolCalls) {
            const name = tc?.function?.name || '';
            const args = tryParseJSON(tc?.function?.arguments || '{}', {});
            const argsJson = JSON.stringify(args);
            // Skip duplicate mutation calls within 5 seconds
            if (MUTATION_TOOLS.has(name) && _isIdempotentDuplicate(String(wsFilter?.user || ''), name, argsJson)) {
              chatMessages.push({ role: 'tool', tool_call_id: tc?.id, content: JSON.stringify({ skipped: true, reason: 'Duplicate call detected — this action was already performed.' }) });
              continue;
            }
            const statusMsg = _toolStatusMsg(name, args);
            if (statusMsg) sendSSE({ type: 'status', text: statusMsg });
            let out;
            try {
              out = await runTool(name, args);
            } catch (toolErr) {
              out = { error: `Tool "${name}" failed: ${toolErr?.message || 'unknown error'}` };
            }
            toolTrace.push({ name, args, out });
            chatMessages.push({ role: 'tool', tool_call_id: tc?.id, content: JSON.stringify(out) });
            // Log mutations to audit trail
            if (MUTATION_TOOLS.has(name) && wsFilter?.workspace && wsFilter?.user) {
              AgentActionLog.create({
                workspace: wsFilter.workspace,
                user: wsFilter.user,
                toolName: name,
                args,
                result: out,
                success: !out?.error,
                agentType: agentType || null,
              }).catch(() => {});
            }
          }
        }
        const reply = 'I could not complete the response. Please try rephrasing your request.';
        return sendFinal(reply, wsFilter, messages, agentType);
      }
    } catch (_) {
      // Non-fatal: if stats fail, continue without them
    }
    // If we couldn't gather expanded data (e.g., unauthenticated), fallback to minimal context
    const wsIdFallback = getWorkspaceId(req);
    const userIdFallback = req.user?.id;
    const wsFieldsFallback = wsIdFallback ? await getWorkspaceFields(wsIdFallback) : {};
    let financialBaselineFallback = null;
    try {
      if (userIdFallback && wsIdFallback) {
        const baseline = await FinancialBaseline.getOrCreate(userIdFallback, wsIdFallback);
        await baseline.syncRevenueFromStreams();
        await baseline.save();
        financialBaselineFallback = baseline.toObject();
      }
    } catch {}
    const contextText = buildContextText(ob, stats, {}, wsFieldsFallback, financialBaselineFallback);

    const todayDateFallback = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const system = [
      'You are Plangenie, a strategic business advisor with deep expertise in business transformation, growth strategy, and operational excellence.',
      'Think like a trusted board advisor combined with a hands-on operator who understands the realities of building businesses.',
      `Today's date is ${todayDateFallback}.`,
      'CRITICAL: Every response must demonstrate understanding of THIS specific business based on the context provided.',
      'Be direct, confident, and strategic. Provide insights tailored to their situation, not generic advice.',
      'Use provided context if relevant; never contradict it.',
      'IMPORTANT: Information from your previous responses in this conversation is valid context. Reference data you mentioned earlier when answering follow-ups.',
      'When giving recommendations, explicitly connect them to the business\'s context, goals, and priorities.',
      'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
      'Prefer concrete, prioritized action items tied to their specific departments, projects, team members, KPIs, and deadlines.',
      'Never provide generic templates or boilerplate. Every recommendation must be tailored to this business.',
      'Never mention that you are an AI model.',
      'Never output example or placeholder names; only use names enumerated in the context or mentioned in prior conversation messages.',
      'If team member names are not in context, do not guess; state that they are not provided.',
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
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        ...(contextText ? [{ role: 'system', content: contextText }] : []),
        ...safeMsgs,
      ],
    });

    const reply = String(resp.choices?.[0]?.message?.content || '').trim() || 'I did not find an answer.';
    return sendFinal(reply, wsFilter, messages, agentType);
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      const msg = 'OpenAI API key not configured on server';
      if (wantStream) { res.write(`data: ${JSON.stringify({ type: 'error', text: msg })}\n\n`); return res.end(); }
      return res.status(500).json({ message: msg });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to respond';
    if (wantStream) { res.write(`data: ${JSON.stringify({ type: 'error', text: message })}\n\n`); return res.end(); }
    return res.status(500).json({ message });
  }
};

// ── Chat History ──

exports.getHistory = async (req, res) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    if (!wsFilter.workspace || !wsFilter.user) return res.json({ messages: [] });
    const doc = await ChatHistory.findOne({ workspace: wsFilter.workspace, user: wsFilter.user }).lean();
    const messages = (doc?.messages || []).slice(-100); // return last 100
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load history' });
  }
};

exports.clearHistory = async (req, res) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    if (!wsFilter.workspace || !wsFilter.user) return res.json({ success: true });
    await ChatHistory.deleteOne({ workspace: wsFilter.workspace, user: wsFilter.user });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to clear history' });
  }
};

// ── Agent Action Audit Log ──

exports.getActionLog = async (req, res) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    if (!wsFilter.workspace) return res.json({ actions: [] });
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const actions = await AgentActionLog.find({ workspace: wsFilter.workspace })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ actions });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load action log' });
  }
};

// ── Undo last AI action ──
exports.undoLastAction = async (req, res) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    if (!wsFilter.workspace || !wsFilter.user) return res.status(401).json({ message: 'Unauthorized' });

    // Find the most recent successful mutation for this user in this workspace
    const action = await AgentActionLog.findOne({
      workspace: wsFilter.workspace,
      user: wsFilter.user,
      success: true,
    }).sort({ createdAt: -1 }).lean();

    if (!action) return res.status(404).json({ message: 'No recent action to undo.' });

    const { toolName, args, result } = action;
    let undone = false;
    let message = '';

    switch (toolName) {
      case 'create_core_project': {
        const id = result?.id || args?.id;
        if (id) {
          await CoreProject.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted core project "${result?.title || args?.title}".`;
          undone = true;
        }
        break;
      }
      case 'create_department_project': {
        const id = result?.id || args?.id;
        if (id) {
          await DepartmentProject.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted department project "${result?.title || args?.title}".`;
          undone = true;
        }
        break;
      }
      case 'delete_project': {
        const Model = args?.projectType === 'core' ? CoreProject : DepartmentProject;
        const query = args?.projectId
          ? { _id: args.projectId, workspace: wsFilter.workspace, isDeleted: true }
          : { title: new RegExp((args?.projectTitle || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: true };
        const proj = await Model.findOne(query);
        if (proj) {
          proj.isDeleted = false;
          proj.deletedAt = undefined;
          await proj.save();
          message = `Undone: restored project "${proj.title}".`;
          undone = true;
        }
        break;
      }
      case 'create_okr': {
        const id = result?.id;
        if (id) {
          await OKR.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted OKR "${result?.objective || args?.objective}".`;
          undone = true;
        }
        break;
      }
      case 'delete_okr': {
        const obj = result?.objective || args?.objective;
        if (obj) {
          await OKR.findOneAndUpdate(
            { objective: new RegExp(obj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: true },
            { isDeleted: false, deletedAt: undefined }
          );
          message = `Undone: restored OKR "${obj}".`;
          undone = true;
        }
        break;
      }
      case 'add_swot_entry': {
        // Remove the last SWOT entry matching the text
        const text = args?.text;
        if (text) {
          await SwotEntry.findOneAndDelete({ workspace: wsFilter.workspace, text: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
          message = `Undone: removed SWOT entry "${text}".`;
          undone = true;
        }
        break;
      }
      case 'create_org_position':
      case 'add_team_member': {
        const id = result?.id;
        if (id) {
          await OrgPosition.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true });
          message = `Undone: removed "${result?.name || result?.position || args?.name || args?.position}" from the team.`;
          undone = true;
        }
        break;
      }
      case 'remove_team_member': {
        const id = result?.id;
        if (id) {
          await OrgPosition.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored "${result?.name || args?.name}" to the team roster.`;
          undone = true;
        }
        break;
      }
      case 'create_product': {
        const id = result?.id;
        if (id) {
          await Product.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: removed product "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'delete_product': {
        const id = result?.id;
        if (id) {
          await Product.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored product "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'create_competitor': {
        const id = result?.id;
        if (id) {
          await Competitor.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: removed competitor "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'delete_competitor': {
        const id = result?.id;
        if (id) {
          await Competitor.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored competitor "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'create_revenue_stream': {
        const id = result?.id;
        if (id) {
          await RevenueStream.findOneAndUpdate({ _id: id, user: wsFilter.user }, { isActive: false });
          message = `Undone: removed revenue stream "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'delete_swot_entry': {
        const id = result?.id;
        if (id) {
          await SwotEntry.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored SWOT ${result?.entryType || ''} "${result?.text || args?.text}".`;
          undone = true;
        }
        break;
      }
      case 'add_deliverable': {
        // Remove the last-added deliverable matching the text from the project
        const text = args?.text;
        const Model = args?.projectType === 'core' ? CoreProject : DepartmentProject;
        if (text) {
          const proj = args?.projectId
            ? await Model.findOne({ _id: args.projectId, workspace: wsFilter.workspace })
            : await Model.findOne({ title: new RegExp((args?.projectTitle || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), workspace: wsFilter.workspace, isDeleted: { $ne: true } });
          if (proj) {
            const idx = proj.deliverables.findIndex((d) => String(d.text || '').toLowerCase().includes(text.toLowerCase()));
            if (idx !== -1) {
              proj.deliverables.splice(idx, 1);
              await proj.save();
              message = `Undone: removed deliverable "${text}" from "${proj.title}".`;
              undone = true;
            }
          }
        }
        break;
      }
      case 'duplicate_project': {
        const id = result?.id;
        if (id) {
          const Model = args?.projectType === 'core' ? CoreProject : DepartmentProject;
          await Model.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted duplicated project "${result?.title || args?.newTitle}".`;
          undone = true;
        }
        break;
      }
      case 'restore_project': {
        const id = result?.id;
        if (id) {
          const Model = args?.projectType === 'core' ? CoreProject : DepartmentProject;
          await Model.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted restored project "${result?.title || args?.projectTitle}".`;
          undone = true;
        }
        break;
      }
      case 'restore_okr': {
        const id = result?.id;
        if (id) {
          await OKR.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted restored OKR "${result?.objective || args?.objective}".`;
          undone = true;
        }
        break;
      }
      case 'restore_product': {
        const id = result?.id;
        if (id) {
          await Product.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted restored product "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'restore_competitor': {
        const id = result?.id;
        if (id) {
          await Competitor.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted restored competitor "${result?.name || args?.name}".`;
          undone = true;
        }
        break;
      }
      case 'restore_swot_entry': {
        const id = result?.id;
        if (id) {
          await SwotEntry.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted restored SWOT entry "${result?.text || args?.text}".`;
          undone = true;
        }
        break;
      }
      case 'create_vision_goal': {
        const id = result?.id;
        if (id) {
          await VisionGoal.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: true, deletedAt: new Date() });
          message = `Undone: deleted ${result?.goalType || ''} goal "${result?.text || args?.text}".`;
          undone = true;
        }
        break;
      }
      case 'delete_vision_goal': {
        const id = result?.id;
        if (id) {
          await VisionGoal.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored ${result?.goalType || ''} goal "${result?.text || args?.text}".`;
          undone = true;
        }
        break;
      }
      case 'create_decision': {
        const id = result?.id;
        if (id) {
          await Decision.findOneAndDelete({ _id: id, workspace: wsFilter.workspace });
          message = `Undone: removed decision "${result?.title || args?.title}".`;
          undone = true;
        }
        break;
      }
      case 'create_assumption': {
        const id = result?.id;
        if (id) {
          await Assumption.findOneAndDelete({ _id: id, workspace: wsFilter.workspace });
          message = `Undone: removed assumption "${result?.key || args?.key}".`;
          undone = true;
        }
        break;
      }
      case 'delete_org_position': {
        const id = result?.id;
        if (id) {
          await OrgPosition.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { isDeleted: false, $unset: { deletedAt: 1 } });
          message = `Undone: restored position "${result?.position || args?.positionTitle}" to the org chart.`;
          undone = true;
        }
        break;
      }
      case 'invite_workspace_member': {
        const id = result?.id;
        if (id) {
          await WorkspaceMember.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { status: 'removed' });
          message = `Undone: cancelled workspace invite for "${result?.email || args?.email}".`;
          undone = true;
        }
        break;
      }
      case 'remove_workspace_member': {
        const id = result?.id;
        if (id) {
          await WorkspaceMember.findOneAndUpdate({ _id: id, workspace: wsFilter.workspace }, { status: 'active' });
          message = `Undone: restored "${result?.email || args?.email}" to the workspace.`;
          undone = true;
        }
        break;
      }
      default:
        return res.status(422).json({ message: `Undo is not supported for action "${toolName}".` });
    }

    if (!undone) return res.status(422).json({ message: `Could not undo — the affected record was not found.` });

    // Delete the log entry so it won't be undone twice
    await AgentActionLog.deleteOne({ _id: action._id });

    // Invalidate agent cache
    try { await agents.invalidateCache(String(wsFilter.user), null, String(wsFilter.workspace)); } catch {}

    return res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to undo action' });
  }
};

// ── Proactive greeting / workspace snapshot ──
exports.getGreeting = async (req, res) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    if (!wsFilter.workspace || !wsFilter.user) return res.json({ greeting: null });

    const workspaceId = wsFilter.workspace;

    const [coreProjects, deptProjects, okrs] = await Promise.all([
      CoreProject.find({ workspace: workspaceId, isDeleted: { $ne: true } }).lean(),
      DepartmentProject.find({ workspace: workspaceId, isDeleted: { $ne: true } }).lean(),
      OKR.find({ workspace: workspaceId, isDeleted: { $ne: true } }).lean(),
    ]);

    const today = new Date();
    let overdueCount = 0;
    let upcomingCount = 0;

    const checkDeliverables = (projects) => {
      for (const p of projects) {
        for (const d of (p.deliverables || [])) {
          if (d.done) continue;
          const due = d.dueWhen ? new Date(d.dueWhen) : null;
          if (!due) continue;
          if (due < today) overdueCount++;
          else if ((due - today) / 86400000 <= 7) upcomingCount++;
        }
      }
    };
    checkDeliverables(coreProjects);
    checkDeliverables(deptProjects);

    const parts = [];
    if (overdueCount > 0) parts.push(`⚠️ **${overdueCount}** overdue task${overdueCount > 1 ? 's' : ''}`);
    if (upcomingCount > 0) parts.push(`📅 **${upcomingCount}** task${upcomingCount > 1 ? 's' : ''} due this week`);
    if (okrs.length > 0) {
      const totalKRs = okrs.reduce((sum, o) => sum + (o.keyResults?.length || 0), 0);
      parts.push(`🎯 **${okrs.length}** active OKR${okrs.length > 1 ? 's' : ''} (${totalKRs} key result${totalKRs !== 1 ? 's' : ''})`);
    }
    if (coreProjects.length > 0) parts.push(`🗂 **${coreProjects.length}** core project${coreProjects.length > 1 ? 's' : ''}`);

    let greeting;
    if (parts.length === 0) {
      greeting = `Hi! I'm your Plan Genie assistant. I can create projects, manage tasks, update OKRs, invite team members, and more. What would you like to work on today?`;
    } else {
      greeting = `Here's a quick snapshot of your workspace:\n\n${parts.join('\n')}\n\nHow can I help you today?`;
    }

    res.json({ greeting });
  } catch {
    res.json({ greeting: null });
  }
};
