const Workspace = require('../models/Workspace');
const ReviewSession = require('../models/ReviewSession');
const User = require('../models/User');

function id(prefix='r_') { return `${prefix}${Math.random().toString(36).slice(2, 10)}`; }

// Helper to get Resend client
function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  return new Resend(process.env.RESEND_API_KEY);
}

// Helper to get OpenAI client
let openaiClient = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// GET /api/workspaces/:wid/reviews
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const items = await ReviewSession.find({ user: userId, workspace: ws._id }).sort({ startedAt: -1 }).lean().exec();
    return res.json({ items });
  } catch (err) { next(err); }
};

// POST /api/workspaces/:wid/reviews  { cadence?, notes? }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    // Enforce plan limits per calendar month (UTC)
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      const limit = ent.getLimit(user, 'reviewsPerMonth');
      if (limit && limit > 0) {
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth()+1, 1));
        const count = await ReviewSession.countDocuments({ user: userId, workspace: ws._id, createdAt: { $gte: start, $lt: end } });
        if (count >= limit) return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Monthly review limit reached', limitKey: 'reviewsPerMonth', limit, plan: ent.effectivePlan(user) });
      }
    } catch {}
    const payload = req.body || {};
    const doc = await ReviewSession.create({
      user: userId,
      workspace: ws._id,
      rid: id(),
      cadence: ['weekly','monthly','quarterly'].includes(String(payload.cadence)) ? String(payload.cadence) : 'weekly',
      notes: String(payload.notes || ''),
      projects: Array.isArray(payload.projects) ? payload.projects.map((p) => ({ index: Number(p?.index) || 0, title: String(p?.title || '').trim() })).filter((p) => p.title) : [],
      attendees: Array.isArray(payload.attendees) ? payload.attendees.map((a) => ({ id: String(a?.id || '').trim(), name: String(a?.name || '').trim(), email: String(a?.email || '').trim() })).filter((a) => a.id && a.name) : [],
      actionItems: Array.isArray(payload.actionItems) ? payload.actionItems.map((ai) => ({ text: String(ai?.text||'').trim(), owner: String(ai?.owner||'').trim(), dueWhen: String(ai?.dueWhen||'').trim(), status: ['Not started','In progress','Completed'].includes(ai?.status) ? ai.status : 'Not started' })).filter((ai)=> ai.text) : [],
    });
    return res.status(201).json({ review: doc });
  } catch (err) { next(err); }
};

// GET /api/workspaces/:wid/reviews/:rid
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const rid = String(req.params?.rid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await ReviewSession.findOne({ user: userId, workspace: ws._id, rid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Review not found' });
    return res.json({ review: doc });
  } catch (err) { next(err); }
};

// PATCH /api/workspaces/:wid/reviews/:rid  { notes?, actionItems?, status? }
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const rid = String(req.params?.rid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await ReviewSession.findOne({ user: userId, workspace: ws._id, rid });
    if (!doc) return res.status(404).json({ message: 'Review not found' });
    const payload = req.body || {};
    if (typeof payload.notes !== 'undefined') doc.notes = String(payload.notes || '');
    if (Array.isArray(payload.projects)) {
      doc.projects = payload.projects.map((p) => ({ index: Number(p?.index) || 0, title: String(p?.title || '').trim() })).filter((p) => p.title);
    }
    if (Array.isArray(payload.attendees)) {
      doc.attendees = payload.attendees.map((a) => ({ id: String(a?.id || '').trim(), name: String(a?.name || '').trim(), email: String(a?.email || '').trim() })).filter((a) => a.id && a.name);
    }
    if (Array.isArray(payload.actionItems)) {
      doc.actionItems = payload.actionItems.map((ai) => ({ text: String(ai?.text||'').trim(), owner: String(ai?.owner||'').trim(), dueWhen: String(ai?.dueWhen||'').trim(), status: ['Not started','In progress','Completed'].includes(ai?.status) ? ai.status : 'Not started' })).filter((ai)=> ai.text);
    }
    if (typeof payload.status !== 'undefined') {
      const st = String(payload.status);
      if (['open','closed'].includes(st)) {
        doc.status = st;
        if (st === 'closed' && !doc.endedAt) doc.endedAt = new Date();
      }
    }
    await doc.save();
    return res.json({ review: doc });
  } catch (err) { next(err); }
};

// POST /api/workspaces/:wid/reviews/:rid/send-actions
exports.sendActions = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || req.params?.jid || '').trim();
    const rid = String(req.params?.rid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await ReviewSession.findOne({ user: userId, workspace: ws._id, rid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Review not found' });

    const attendees = doc.attendees || [];
    const actionItems = doc.actionItems || [];

    if (attendees.length === 0) {
      return res.status(400).json({ message: 'No attendees to send to' });
    }
    if (actionItems.length === 0) {
      return res.status(400).json({ message: 'No action items to send' });
    }

    const resend = getResend();
    if (!resend) {
      return res.status(503).json({ message: 'Email service not configured' });
    }

    const user = await User.findById(userId).lean().exec();
    const senderName = user?.firstName || user?.fullName || 'Plan Genie';
    const fromAddress = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://www.plangenie.com/dashboard';

    // Build action items list for email
    const actionList = actionItems.map((ai, i) => {
      let line = `${i + 1}. ${ai.text}`;
      if (ai.owner) line += ` (Owner: ${ai.owner})`;
      if (ai.dueWhen) line += ` - Due: ${ai.dueWhen}`;
      return line;
    }).join('\n');

    // Send email to each attendee
    let sentCount = 0;
    for (const attendee of attendees) {
      if (!attendee.email) continue;
      try {
        await resend.emails.send({
          from: fromAddress,
          to: attendee.email,
          subject: `Action Items from ${senderName} - Review Session`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #1D4374 0%, #2563EB 100%); padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0; color: white; font-size: 20px;">Review Action Items</h1>
              </div>
              <div style="padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="margin: 0 0 16px 0; color: #374151;">Hi ${attendee.name || 'there'},</p>
                <p style="margin: 0 0 16px 0; color: #374151;">${senderName} has shared the following action items from a recent review session:</p>
                <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                  <pre style="margin: 0; font-family: inherit; white-space: pre-wrap; color: #1f2937;">${actionList}</pre>
                </div>
                <a href="${dashboardUrl}/reviews/${rid}" style="display: inline-block; background: #1D4374; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">View Review</a>
                <p style="margin: 24px 0 0 0; color: #9ca3af; font-size: 12px;">Sent via Plan Genie</p>
              </div>
            </div>
          `,
          text: `Hi ${attendee.name || 'there'},\n\n${senderName} has shared the following action items from a recent review session:\n\n${actionList}\n\nView the review: ${dashboardUrl}/reviews/${rid}\n\n---\nSent via Plan Genie`,
        });
        sentCount++;
      } catch (emailErr) {
        console.error(`[review.sendActions] Failed to send to ${attendee.email}:`, emailErr?.message || emailErr);
      }
    }

    return res.json({ ok: true, sentCount });
  } catch (err) { next(err); }
};

// POST /api/workspaces/:wid/reviews/:rid/insights
exports.generateInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || req.params?.jid || '').trim();
    const rid = String(req.params?.rid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await ReviewSession.findOne({ user: userId, workspace: ws._id, rid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Review not found' });

    const { notes, projects, actionItems } = req.body || {};

    // Build context for AI
    const projectsContext = (projects || []).map(p => {
      let ctx = `- ${p.title} (${p.type === 'core' ? 'Core Strategic Project' : p.department || 'Departmental'})`;
      if (p.goal) ctx += `\n  Goal: ${p.goal}`;
      if (p.ownerName) ctx += `\n  Owner: ${p.ownerName}`;
      if (p.dueWhen) ctx += `\n  Due: ${p.dueWhen}`;
      if (p.deliverables && p.deliverables.length > 0) {
        const completed = p.deliverables.filter(d => d.done).length;
        ctx += `\n  Deliverables: ${completed}/${p.deliverables.length} completed`;
        p.deliverables.forEach(d => {
          ctx += `\n    ${d.done ? '[x]' : '[ ]'} ${d.text}`;
          if (d.kpi) ctx += ` (KPI: ${d.kpi})`;
        });
      }
      return ctx;
    }).join('\n\n');

    const actionsContext = (actionItems || []).map((ai, i) => {
      let ctx = `${i + 1}. ${ai.text} [${ai.status || 'Not started'}]`;
      if (ai.owner) ctx += ` - Owner: ${ai.owner}`;
      if (ai.dueWhen) ctx += ` - Due: ${ai.dueWhen}`;
      return ctx;
    }).join('\n');

    const prompt = `You are an AI assistant helping analyze a business review session. Based on the following context, provide 3-5 strategic insights that would be helpful for the team.

Review Notes:
${notes || 'No notes provided'}

Projects Being Reviewed:
${projectsContext || 'No projects selected'}

Action Items:
${actionsContext || 'No action items'}

Provide insights in the following JSON format (no other text):
[
  {"category": "progress|risk|recommendation|highlight", "title": "Short title", "description": "1-2 sentence description"}
]

Categories:
- progress: Positive momentum or achievements
- risk: Potential issues or concerns to address
- recommendation: Actionable suggestions for improvement
- highlight: Notable accomplishments or key points`;

    // Call AI service
    let insights = [];
    const openai = getOpenAI();
    if (openai) {
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        });

        const response = completion.choices?.[0]?.message?.content || '';

        // Parse JSON from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          insights = JSON.parse(jsonMatch[0]);
        }
      } catch (aiErr) {
        console.error('[review.generateInsights] AI error:', aiErr?.message || aiErr);
        // Return fallback insights based on basic analysis
        insights = generateFallbackInsights(notes, projects, actionItems);
      }
    } else {
      // No AI configured, use fallback
      insights = generateFallbackInsights(notes, projects, actionItems);
    }

    return res.json({ insights });
  } catch (err) { next(err); }
};

// Fallback insights when AI is unavailable
function generateFallbackInsights(notes, projects, actionItems) {
  const insights = [];

  // Analyze projects
  if (projects && projects.length > 0) {
    const totalDeliverables = projects.reduce((sum, p) => sum + (p.deliverables?.length || 0), 0);
    const completedDeliverables = projects.reduce((sum, p) => sum + (p.deliverables?.filter(d => d.done).length || 0), 0);

    if (totalDeliverables > 0) {
      const progress = Math.round((completedDeliverables / totalDeliverables) * 100);
      insights.push({
        category: progress >= 70 ? 'progress' : progress >= 40 ? 'highlight' : 'risk',
        title: `${progress}% Deliverables Complete`,
        description: `${completedDeliverables} of ${totalDeliverables} deliverables have been completed across the reviewed projects.`
      });
    }
  }

  // Analyze action items
  if (actionItems && actionItems.length > 0) {
    const completed = actionItems.filter(ai => ai.status === 'Completed').length;
    const inProgress = actionItems.filter(ai => ai.status === 'In progress').length;
    const notStarted = actionItems.filter(ai => !ai.status || ai.status === 'Not started').length;

    if (notStarted > 0) {
      insights.push({
        category: 'recommendation',
        title: `${notStarted} Action Items Pending`,
        description: `Consider prioritizing the ${notStarted} action item${notStarted > 1 ? 's' : ''} that haven't been started yet.`
      });
    }

    if (completed > 0) {
      insights.push({
        category: 'progress',
        title: `${completed} Action Items Completed`,
        description: `Good progress with ${completed} action item${completed > 1 ? 's' : ''} already completed this review cycle.`
      });
    }
  }

  // Add a general recommendation if we have few insights
  if (insights.length < 2) {
    insights.push({
      category: 'recommendation',
      title: 'Track Progress Regularly',
      description: 'Consider scheduling regular check-ins to maintain momentum on your strategic initiatives.'
    });
  }

  return insights;
}

