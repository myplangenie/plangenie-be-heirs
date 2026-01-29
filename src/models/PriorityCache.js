const mongoose = require('mongoose');

const PriorityCacheSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    weeklyTop3: [
      {
        title: { type: String },
        dueWhen: { type: String },
        scores: {
          goalImportance: { type: Number, default: 0 },
          dueDateProximity: { type: Number, default: 0 },
          overdueScore: { type: Number, default: 0 },
          blockerScore: { type: Number, default: 0 },
          kpiWeight: { type: Number, default: 0 },
        },
        totalScore: { type: Number, default: 0 },
        source: {
          type: { type: String, enum: ['project', 'goal', 'deliverable', 'dept_deliverable'], default: 'deliverable' },
          projectIndex: { type: Number },
          deliverableIndex: { type: Number },
          goalIndex: { type: Number },
          department: { type: String },
          projectId: { type: String },
          deliverableId: { type: String },
        },
        projectTitle: { type: String },
        owner: { type: String },
        goal: { type: String },
        kpi: { type: String },
        deliverableCount: { type: Number },
      },
    ],
    monthlyThrust: {
      title: { type: String },
      dueWhen: { type: String },
      scores: {
        goalImportance: { type: Number, default: 0 },
        dueDateProximity: { type: Number, default: 0 },
        overdueScore: { type: Number, default: 0 },
        blockerScore: { type: Number, default: 0 },
        kpiWeight: { type: Number, default: 0 },
      },
      totalScore: { type: Number, default: 0 },
      source: {
        type: { type: String, enum: ['project', 'goal', 'deliverable', 'dept_deliverable'], default: 'project' },
        projectIndex: { type: Number },
        deliverableIndex: { type: Number },
        goalIndex: { type: Number },
        department: { type: String },
        projectId: { type: String },
        deliverableId: { type: String },
      },
      projectTitle: { type: String },
      owner: { type: String },
      goal: { type: String },
      kpi: { type: String },
      deliverableCount: { type: Number },
    },
    // Upcoming items (due beyond this week but within 30 days) - shown when weeklyTop3 is empty
    upcomingItems: [
      {
        title: { type: String },
        dueWhen: { type: String },
        scores: {
          goalImportance: { type: Number, default: 0 },
          dueDateProximity: { type: Number, default: 0 },
          overdueScore: { type: Number, default: 0 },
          blockerScore: { type: Number, default: 0 },
          kpiWeight: { type: Number, default: 0 },
        },
        totalScore: { type: Number, default: 0 },
        source: {
          type: { type: String, enum: ['project', 'goal', 'deliverable', 'dept_deliverable'], default: 'deliverable' },
          projectIndex: { type: Number },
          deliverableIndex: { type: Number },
          goalIndex: { type: Number },
          department: { type: String },
          projectId: { type: String },
          deliverableId: { type: String },
        },
        projectTitle: { type: String },
        owner: { type: String },
        goal: { type: String },
        kpi: { type: String },
        deliverableCount: { type: Number },
        isUpcoming: { type: Boolean, default: true },
      },
    ],
    // Track recent actions to avoid suggesting the same thing again
    recentActions: [
      {
        action: { type: String, enum: ['reschedule', 'complete', 'dismiss', 'snooze'] },
        source: {
          type: { type: String, enum: ['project', 'goal', 'deliverable', 'dept_deliverable'] },
          projectIndex: { type: Number },
          deliverableIndex: { type: Number },
          goalIndex: { type: Number },
          department: { type: String },
          projectId: { type: String },
          deliverableId: { type: String },
        },
        newDate: { type: String },
        timestamp: { type: String },
      },
    ],
    risks: [
      {
        type: { type: String, enum: ['overdue', 'clustering', 'kpi_offtrack', 'deadline_soon'] },
        severity: { type: String, enum: ['high', 'medium', 'warning'] },
        message: { type: String },
        itemTitle: { type: String },
        itemDue: { type: String },
        suggestion: {
          action: { type: String },
          newDate: { type: String },
          reason: { type: String },
        },
      },
    ],
    clusters: [
      {
        weekStart: { type: String },
        itemCount: { type: Number },
        items: [{ title: String, dueWhen: String }],
        suggestion: {
          itemTitle: { type: String },
          reason: { type: String },
          suggestedDate: { type: String },
        },
      },
    ],
    calculatedAt: { type: Date, default: Date.now },
    // User overrides for manual priority adjustments
    userOverrides: {
      weeklyOrder: [{ type: String }], // Array of item titles in user-preferred order
      dismissed: [{ type: String }], // Item titles the user dismissed
      snoozed: [
        {
          itemTitle: { type: String },
          snoozeUntil: { type: String },
          snoozedAt: { type: String },
        },
      ], // Items snoozed with expiry
    },
  },
  { timestamps: true }
);

// Unique index per user+workspace
PriorityCacheSchema.index({ user: 1, workspace: 1 }, { unique: true });
PriorityCacheSchema.index({ calculatedAt: 1 });

module.exports = mongoose.model('PriorityCache', PriorityCacheSchema);
