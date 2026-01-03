const mongoose = require('mongoose');

// Read model: a per-user per-workspace dashboard summary snapshot.
// Authoritative data for notifications, departments, financials, plan, and team members
// lives in their dedicated collections. This model stores only the summary used by the
// dashboard overview page.
const DashboardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },

    // Dashboard summary page
    summary: {
      kpis: {
        overdueTasks: { type: Number, default: 0 },
        activeTeamMembers: { type: Number, default: 0 },
      },
      milestones: [
        {
          label: String,
          due: String, // keep friendly text date for now to match UI
        },
      ],
      departmentProgress: [
        {
          name: String,
          percent: Number,
        },
      ],
      financeChart: [
        {
          name: String,
          Revenue: Number,
          Cost: Number,
        },
      ],
      activePlans: [
        {
          title: String,
          status: { type: String, enum: ['In progress', 'Completed', 'On track'], default: 'In progress' },
          owner: String,
        },
      ],
      insights: [String],
      insightSections: [
        {
          title: String,
          items: [String],
        },
      ],
      snapshot: {
        vision: String,
        ubp: String,
      },
      team: [
        {
          name: String,
          role: String,
          note: String,
        },
      ],
    },
  },
  { timestamps: true }
);

// Compound index for user + workspace uniqueness
DashboardSchema.index({ user: 1, workspace: 1 }, { unique: true });

module.exports = mongoose.model('Dashboard', DashboardSchema);
