const mongoose = require('mongoose');

const WorkspaceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    wid: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    industry: { type: String, default: '' },
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active', index: true },
    startedAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    defaultWorkspace: { type: Boolean, default: false, index: true },
    reviewCadence: {
      weekly: { type: Boolean, default: true },
      monthly: { type: Boolean, default: false },
      quarterly: { type: Boolean, default: false },
      dayOfWeek: { type: Number, default: 1 }, // 0-6 (Mon default = 1)
      dayOfMonth: { type: Number, default: 1 }, // 1-28
    },
    // Workspace-level AI settings (controls AI availability for all members)
    aiSettings: {
      enabled: { type: Boolean, default: true }, // Master toggle for AI in workspace
      features: {
        visionSuggestions: { type: Boolean, default: true },
        valueSuggestions: { type: Boolean, default: true },
        swotAnalysis: { type: Boolean, default: true },
        marketAnalysis: { type: Boolean, default: true },
        financialSuggestions: { type: Boolean, default: true },
        actionPlanSuggestions: { type: Boolean, default: true },
        coreProjectSuggestions: { type: Boolean, default: true },
      },
    },
    // Workspace-level notification preferences
    notificationPreferences: {
      // Email notifications
      email: {
        weeklyDigest: { type: Boolean, default: true }, // Weekly summary of tasks and progress
        dailyWish: { type: Boolean, default: true }, // Daily AI-generated recommendations
        reviewReminders: { type: Boolean, default: true }, // Reminders before scheduled reviews
        deadlineAlerts: { type: Boolean, default: true }, // Alerts for upcoming/overdue deadlines
        teamActivity: { type: Boolean, default: true }, // Notifications about team member actions
      },
      // In-app notifications
      inApp: {
        taskUpdates: { type: Boolean, default: true }, // Updates on task status changes
        reviewReminders: { type: Boolean, default: true }, // Review session reminders
        deadlineAlerts: { type: Boolean, default: true }, // Deadline warnings
        teamActivity: { type: Boolean, default: true }, // Team member actions
        aiInsights: { type: Boolean, default: true }, // AI-generated insights and suggestions
      },
      // Timing preferences
      timing: {
        digestDay: { type: Number, default: 5 }, // Day of week for digest (0=Sun, 5=Fri)
        digestHour: { type: Number, default: 9 }, // Hour of day (0-23, local time)
        quietHoursStart: { type: Number, default: null }, // Start of quiet hours (null = disabled)
        quietHoursEnd: { type: Number, default: null }, // End of quiet hours
      },
    },
    // Workspace-level export settings
    exportSettings: {
      enabled: { type: Boolean, default: true }, // Master toggle for all exports
      formats: {
        pdf: { type: Boolean, default: true }, // Allow PDF exports
        docx: { type: Boolean, default: true }, // Allow Word/DOCX exports
        csv: { type: Boolean, default: true }, // Allow CSV exports (for financials)
      },
      // Minimum role required to export (null = viewer can export)
      minRole: { type: String, enum: ['viewer', 'contributor', 'admin', 'owner', null], default: null },
      // Specific content export controls
      content: {
        plan: { type: Boolean, default: true }, // Export business plan
        strategyCanvas: { type: Boolean, default: true }, // Export strategy canvas
        departments: { type: Boolean, default: true }, // Export departments/projects
        financials: { type: Boolean, default: true }, // Export financial data
      },
    },
    links: {
      onboardingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Onboarding', default: null },
      planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    },
  },
  { timestamps: true }
);

WorkspaceSchema.index({ user: 1, name: 1 });
WorkspaceSchema.index({ user: 1, defaultWorkspace: 1 });

module.exports = mongoose.model('Workspace', WorkspaceSchema);
