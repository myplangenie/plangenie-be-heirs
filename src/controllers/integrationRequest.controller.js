const { validationResult } = require('express-validator');
const IntegrationRequest = require('../models/IntegrationRequest');
const User = require('../models/User');
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');
const { Resend } = require('resend');

/**
 * Send admin notification email for new integration request
 */
async function sendAdminNotificationEmail({ user, request }) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@plangenie.com';
    const subject = `New Integration Request: ${request.system}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F8FAFC;">
        <div style="background-color: #FFFFFF; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="https://logos.plangenie.com/logo-white.7ee85271.png" alt="Plan Genie" style="height: 20px;" />
          </div>
          <h2 style="color: #1D4374; font-size: 20px; font-weight: 600; margin: 0 0 16px 0; text-align: center;">New Integration Request</h2>

          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">User</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${user.email}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">Organization</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.organizationName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">System</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.system}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">Category</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.category}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">Urgency</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.urgencyTimeline || 'exploring'}</td>
            </tr>
            ${request.currentUsageContext ? `
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">Current Usage</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.currentUsageContext}</td>
            </tr>
            ` : ''}
            ${request.primaryGoal ? `
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px; border-bottom: 1px solid #E5E7EB;">Primary Goal</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; border-bottom: 1px solid #E5E7EB; text-align: right;">${request.primaryGoal}</td>
            </tr>
            ` : ''}
            ${request.notes ? `
            <tr>
              <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Notes</td>
              <td style="padding: 8px 0; color: #1F2937; font-size: 14px; text-align: right;">${request.notes}</td>
            </tr>
            ` : ''}
          </table>
        </div>
        <div style="text-align: center; margin-top: 24px;">
          <p style="color: #9CA3AF; font-size: 12px; line-height: 1.6;">
            Plan Genie Inc. · Vancouver, Canada
          </p>
        </div>
      </div>
    `;

    const text = `New Integration Request

User: ${user.email}
Organization: ${request.organizationName}
System: ${request.system}
Category: ${request.category}
Urgency: ${request.urgencyTimeline || 'exploring'}
${request.currentUsageContext ? `Current Usage: ${request.currentUsageContext}` : ''}
${request.primaryGoal ? `Primary Goal: ${request.primaryGoal}` : ''}
${request.notes ? `Notes: ${request.notes}` : ''}

---
Plan Genie Inc. · Vancouver, Canada`;

    await resend.emails.send({ from, to: adminEmail, subject, html, text });
  } catch (err) {
    console.error('[email] Failed to send integration request notification:', err?.message || err);
  }
}

/**
 * Get all integration requests for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);

    const requests = await IntegrationRequest.find({
      ...wsFilter,
      status: { $ne: 'cancelled' },
    }).sort({ createdAt: -1 }).lean();

    return res.json({ items: requests });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new integration request
 */
exports.create = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
    }

    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);

    if (!workspaceId) {
      return res.status(400).json({ message: 'Workspace context is required' });
    }

    const {
      system,
      category,
      organizationName,
      currentUsageContext,
      primaryGoal,
      urgencyTimeline,
      notes,
    } = req.body;

    // Check if request already exists for this system in this workspace
    const existingRequest = await IntegrationRequest.findOne({
      workspace: workspaceId,
      system: system.trim().toLowerCase(),
      status: { $ne: 'cancelled' },
    });

    if (existingRequest) {
      return res.status(409).json({
        message: 'An integration request for this system already exists',
        existingRequest,
      });
    }

    const requestData = {
      user: userId,
      workspace: workspaceId,
      system: system.trim().toLowerCase(),
      category: category.trim().toLowerCase(),
      organizationName: organizationName.trim(),
      currentUsageContext: currentUsageContext?.trim() || undefined,
      primaryGoal: primaryGoal?.trim() || undefined,
      urgencyTimeline: urgencyTimeline || 'exploring',
      notes: notes?.trim() || undefined,
    };

    const request = await IntegrationRequest.create(requestData);

    // Send admin notification email
    const user = await User.findById(userId).lean();
    if (user) {
      await sendAdminNotificationEmail({ user, request: requestData });
    }

    return res.status(201).json({ item: request, message: 'Integration request submitted' });
  } catch (err) {
    // Handle duplicate key error
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'An integration request for this system already exists in this workspace',
      });
    }
    next(err);
  }
};

/**
 * Cancel an integration request (soft delete by setting status to 'cancelled')
 */
exports.cancel = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
    }

    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const request = await IntegrationRequest.findOne({
      _id: id,
      ...wsFilter,
      status: { $ne: 'cancelled' },
    });

    if (!request) {
      return res.status(404).json({ message: 'Integration request not found' });
    }

    request.status = 'cancelled';
    await request.save();

    return res.json({ message: 'Integration request cancelled', id });
  } catch (err) {
    next(err);
  }
};
