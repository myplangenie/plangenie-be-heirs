const mongoose = require('mongoose');

const IntegrationRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  system: {
    type: String,
    required: true,
    enum: ['salesforce', 'hubspot', 'zoho', 'quickbooks', 'xero', 'sage', 'netsuite', 'sap-business-one', 'microsoft-dynamics', 'odoo', 'asana', 'monday', 'clickup', 'microsoft-project', 'bamboohr', 'workday', 'adp']
  },
  category: {
    type: String,
    required: true,
    enum: ['crm', 'finance', 'erp', 'project-management', 'hr']
  },
  status: {
    type: String,
    default: 'requested',
    enum: ['requested', 'in-progress', 'active', 'cancelled']
  },
  organizationName: { type: String, required: true },
  currentUsageContext: { type: String },
  primaryGoal: { type: String },
  urgencyTimeline: {
    type: String,
    enum: ['immediate', 'within-30-days', 'within-90-days', 'exploring'],
    default: 'exploring'
  },
  notes: { type: String }
}, { timestamps: true });

// Unique constraint: one request per system per workspace
IntegrationRequestSchema.index({ workspace: 1, system: 1 }, { unique: true });

module.exports = mongoose.model('IntegrationRequest', IntegrationRequestSchema);
