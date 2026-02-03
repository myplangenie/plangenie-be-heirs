const Workspace = require('../models/Workspace');
const ReviewSession = require('../models/ReviewSession');
const User = require('../models/User');
const OrgPosition = require('../models/OrgPosition');
const Collaboration = require('../models/Collaboration');

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

    const rawAttendees = doc.attendees || [];
    // Use selected action items from request body if provided, otherwise use all from doc
    const selectedItems = req.body?.actionItems;
    const actionItems = Array.isArray(selectedItems) && selectedItems.length > 0
      ? selectedItems
      : (doc.actionItems || []);

    if (rawAttendees.length === 0) {
      return res.status(400).json({ message: 'No attendees to send to' });
    }

    // Look up current emails from OrgPosition and Collaboration
    // The attendee id might be an ObjectId string from OrgPosition or a custom id
    const orgPositions = await OrgPosition.find({
      workspace: ws._id,
      isDeleted: { $ne: true },
    }).lean().exec();

    const collaborations = await Collaboration.find({
      owner: userId,
      status: 'accepted',
    }).lean().exec();

    // Build lookup maps for quick access
    const orgEmailById = new Map();
    const orgEmailByName = new Map();
    for (const pos of orgPositions) {
      if (pos.email) {
        orgEmailById.set(pos._id.toString(), pos.email);
        if (pos.name) {
          orgEmailByName.set(pos.name.toLowerCase().trim(), pos.email);
        }
      }
    }

    const collabEmailByName = new Map();
    for (const collab of collaborations) {
      if (collab.email) {
        // Look up the collaborator's name from User model if we have the collaborator id
        if (collab.collaborator) {
          const collabUser = await User.findById(collab.collaborator).lean().exec();
          if (collabUser) {
            const name = (collabUser.firstName || collabUser.fullName || collabUser.email || '').toLowerCase().trim();
            if (name) collabEmailByName.set(name, collab.email);
          }
        }
      }
    }

    // Enrich attendees with current emails from OrgPosition/Collaboration
    const attendees = rawAttendees.map(a => {
      // First check if attendee already has email
      if (a.email && a.email.trim()) {
        return a;
      }

      // Try to find email by id (ObjectId from OrgPosition)
      let currentEmail = orgEmailById.get(a.id);

      // If not found, try by name from OrgPosition
      if (!currentEmail && a.name) {
        currentEmail = orgEmailByName.get(a.name.toLowerCase().trim());
      }

      // If still not found, try by name from Collaboration
      if (!currentEmail && a.name) {
        currentEmail = collabEmailByName.get(a.name.toLowerCase().trim());
      }

      return {
        ...a,
        email: currentEmail || a.email || '',
      };
    });
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

    // Group action items by owner
    // Items with owner -> only send to that owner
    // Items without owner -> send to all attendees
    const itemsWithoutOwner = actionItems.filter(ai => !ai.owner || !ai.owner.trim());
    const itemsWithOwner = actionItems.filter(ai => ai.owner && ai.owner.trim());

    // First, determine which attendees need to receive action items
    // Build a map of attendee name (lowercase) -> their action items
    const attendeeActionItems = new Map();

    // For items without owner, all attendees should receive them
    for (const attendee of attendees) {
      const name = (attendee.name || '').toLowerCase().trim();
      if (itemsWithoutOwner.length > 0) {
        attendeeActionItems.set(name, [...itemsWithoutOwner]);
      }
    }

    // For items with owner, only the owner should receive them
    for (const item of itemsWithOwner) {
      const ownerName = item.owner.toLowerCase().trim();
      // Find matching attendee
      for (const attendee of attendees) {
        const attendeeName = (attendee.name || '').toLowerCase().trim();
        if (attendeeName === ownerName) {
          const items = attendeeActionItems.get(attendeeName) || [];
          items.push(item);
          attendeeActionItems.set(attendeeName, items);
        }
      }
    }

    // Now filter to only attendees who actually need to receive something
    const attendeesNeedingEmail = attendees.filter(a => {
      const name = (a.name || '').toLowerCase().trim();
      const items = attendeeActionItems.get(name) || [];
      return items.length > 0;
    });

    if (attendeesNeedingEmail.length === 0) {
      return res.status(400).json({
        message: 'No attendees match the owners of the selected action items.'
      });
    }

    // Check which of the needed attendees have emails
    const attendeesWithEmail = attendeesNeedingEmail.filter(a => a.email && a.email.trim());
    const attendeesWithoutEmail = attendeesNeedingEmail.filter(a => !a.email || !a.email.trim());

    if (attendeesWithEmail.length === 0) {
      const names = attendeesWithoutEmail.map(a => a.name || 'Unknown').join(', ');
      return res.status(400).json({
        message: `The following attendees need to receive action items but don't have email addresses: ${names}. Please add their email addresses.`
      });
    }

    // Send email only to attendees who have action items assigned to them
    let sentCount = 0;
    const sentTo = [];
    const failedTo = [];
    const skippedNoEmail = attendeesWithoutEmail.map(a => ({ name: a.name || 'Unknown', reason: 'No email address' }));

    for (const attendee of attendeesWithEmail) {
      const attendeeName = (attendee.name || '').toLowerCase().trim();
      const theirItems = attendeeActionItems.get(attendeeName) || [];

      // Build action items list for this specific attendee
      const actionList = theirItems.map((ai, i) => {
        let line = `${i + 1}. ${ai.text}`;
        if (ai.owner) line += ` (Owner: ${ai.owner})`;
        if (ai.dueWhen) line += ` - Due: ${ai.dueWhen}`;
        return line;
      }).join('\n');

      try {
        await resend.emails.send({
          from: fromAddress,
          to: attendee.email,
          subject: `Action Items from ${senderName} - Review Session`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #1D4374 0%, #2563EB 100%); padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0; color: white; font-size: 20px;">Your Action Items</h1>
              </div>
              <div style="padding: 24px; background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="margin: 0 0 16px 0; color: #374151;">Hi ${attendee.name || 'there'},</p>
                <p style="margin: 0 0 16px 0; color: #374151;">${senderName} has assigned you the following action items from a recent review session:</p>
                <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                  <pre style="margin: 0; font-family: inherit; white-space: pre-wrap; color: #1f2937;">${actionList}</pre>
                </div>
                <a href="${dashboardUrl}/reviews/${rid}" style="display: inline-block; background: #1D4374; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">View Review</a>
                <p style="margin: 24px 0 0 0; color: #9ca3af; font-size: 12px;">Sent via Plan Genie</p>
              </div>
            </div>
          `,
          text: `Hi ${attendee.name || 'there'},\n\n${senderName} has assigned you the following action items from a recent review session:\n\n${actionList}\n\nView the review: ${dashboardUrl}/reviews/${rid}\n\n---\nSent via Plan Genie`,
        });
        sentCount++;
        sentTo.push({ name: attendee.name || attendee.email, itemCount: theirItems.length });
      } catch (emailErr) {
        console.error(`[review.sendActions] Failed to send to ${attendee.email}:`, emailErr?.message || emailErr);
        failedTo.push({ name: attendee.name || attendee.email, reason: 'Email delivery failed' });
      }
    }

    // Build response with details about skipped attendees
    const allSkipped = [...skippedNoEmail, ...failedTo];

    // Build descriptive message
    let message = '';
    if (sentCount > 0) {
      message = `Sent to ${sentCount} attendee${sentCount !== 1 ? 's' : ''}`;
      if (allSkipped.length > 0) {
        message += `. ${allSkipped.length} skipped (no email).`;
      } else {
        message += '.';
      }
    } else {
      message = 'Failed to send to any attendees.';
    }

    return res.json({
      ok: sentCount > 0,
      sentCount,
      sentTo,
      skipped: allSkipped,
      message
    });
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
      let ctx = `- ${p.title} (${p.type === 'core' ? 'Core Project' : p.department || 'Departmental'})`;
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

    const prompt = `You are a strategic execution advisor analyzing a business review session. You think like a chief of staff who understands what drives results - helping leaders focus on the highest-impact activities and identify execution risks before they become problems.

Your task is to provide insights ONLY based on the data provided below - demonstrate deep understanding of THIS specific review session's projects, deliverables, and action items.

IMPORTANT:
- Only analyze the specific notes, projects, and action items provided below
- If a section says "No notes provided" or "No projects selected", acknowledge that limited data is available
- Focus on concrete observations from the data with strategic implications
- Insights must directly reference the projects, deliverables, or action items mentioned
- Connect observations to execution momentum - what's working, what's at risk, what needs attention

=== THIS REVIEW SESSION'S DATA ===

Review Notes:
${notes || 'No notes provided'}

Projects Being Reviewed:
${projectsContext || 'No projects selected for this review'}

Action Items from This Review:
${actionsContext || 'No action items in this review'}

=== END OF REVIEW DATA ===

Based ONLY on the data above, provide 3-5 specific insights. Each insight must be grounded in the actual content provided.

Provide insights in the following JSON format (no other text):
[
  {"category": "progress|risk|recommendation|highlight", "title": "Short title", "description": "1-2 sentence description referencing specific items from this review"}
]

Categories:
- progress: Positive momentum or achievements observed in the data
- risk: Potential issues or concerns visible in the review data
- recommendation: Actionable suggestions based on the current state of projects/action items
- highlight: Notable accomplishments or key points from this review session`;

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

