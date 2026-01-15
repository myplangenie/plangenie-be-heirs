/**
 * Workspace Export Permission Middleware
 *
 * Enforces export controls on workspace data exports.
 * Requires auth middleware to run first (sets req.user).
 * Requires workspace role middleware to run first (sets req.workspace, req.workspaceRole, req.workspaceMember).
 *
 * Checks:
 * 1. Workspace-level export enabled
 * 2. Export format allowed (pdf, docx, csv)
 * 3. User role meets minimum role requirement
 * 4. Member-level export permission overrides
 * 5. Content type allowed for export
 */

const Workspace = require('../models/Workspace');
const { ROLE_LEVELS } = require('./workspaceRole');

/**
 * Middleware factory to require export permission
 *
 * @param {Object} options - Export check options
 * @param {string} options.format - Required format: 'pdf', 'docx', or 'csv'
 * @param {string} options.content - Required content type: 'plan', 'strategyCanvas', 'departments', 'financials'
 * @returns {Function} Express middleware
 *
 * Usage:
 *   router.get('/export/pdf', requireExport({ format: 'pdf', content: 'plan' }), ctrl.exportPlanPdf);
 */
function requireExport(options = {}) {
  const { format, content } = options;

  return async (req, res, next) => {
    try {
      // Get workspace - should already be set by workspace role middleware
      const workspace = req.workspace;
      const member = req.workspaceMember;
      const userRole = req.workspaceRole;

      if (!workspace) {
        return res.status(400).json({
          message: 'Workspace context required',
          code: 'WORKSPACE_REQUIRED',
        });
      }

      // Get export settings from workspace (with defaults)
      const exportSettings = workspace.exportSettings || {
        enabled: true,
        formats: { pdf: true, docx: true, csv: true },
        minRole: null,
        content: { plan: true, strategyCanvas: true, departments: true, financials: true },
      };

      // Check 1: Is export enabled at workspace level?
      if (exportSettings.enabled === false) {
        return res.status(403).json({
          message: 'Exports are disabled for this workspace',
          code: 'EXPORT_DISABLED',
        });
      }

      // Check 2: Is the format allowed?
      if (format && exportSettings.formats) {
        const formatAllowed = exportSettings.formats[format];
        if (formatAllowed === false) {
          return res.status(403).json({
            message: `${format.toUpperCase()} exports are disabled for this workspace`,
            code: 'EXPORT_FORMAT_DISABLED',
            format,
          });
        }
      }

      // Check 3: Does user role meet minimum requirement?
      if (exportSettings.minRole) {
        const userLevel = ROLE_LEVELS[userRole] || 0;
        const requiredLevel = ROLE_LEVELS[exportSettings.minRole] || 0;

        if (userLevel < requiredLevel) {
          return res.status(403).json({
            message: `Export requires ${exportSettings.minRole} role or higher`,
            code: 'EXPORT_ROLE_REQUIRED',
            requiredRole: exportSettings.minRole,
          });
        }
      }

      // Check 4: Member-level export permission overrides
      if (member?.permissions) {
        // Check master canExport toggle
        if (member.permissions.canExport === false) {
          return res.status(403).json({
            message: 'You do not have permission to export from this workspace',
            code: 'EXPORT_MEMBER_DENIED',
          });
        }

        // Check format-specific override
        if (format && member.permissions.exportFormats?.[format] === false) {
          return res.status(403).json({
            message: `You do not have permission to export ${format.toUpperCase()} files`,
            code: 'EXPORT_FORMAT_MEMBER_DENIED',
            format,
          });
        }

        // Check content-specific override
        if (content && member.permissions.exportContent?.[content] === false) {
          return res.status(403).json({
            message: `You do not have permission to export ${content} data`,
            code: 'EXPORT_CONTENT_MEMBER_DENIED',
            content,
          });
        }
      }

      // Check 5: Is the content type allowed?
      if (content && exportSettings.content) {
        const contentAllowed = exportSettings.content[content];
        if (contentAllowed === false) {
          return res.status(403).json({
            message: `Exporting ${content} is disabled for this workspace`,
            code: 'EXPORT_CONTENT_DISABLED',
            content,
          });
        }
      }

      // All checks passed - attach export info to request
      req.exportSettings = exportSettings;
      req.exportFormat = format;
      req.exportContent = content;

      next();
    } catch (err) {
      console.error('[requireExport] Error:', err?.message || err);
      next(err);
    }
  };
}

/**
 * Convenience middleware factories for common export types
 */
const requirePlanPdfExport = requireExport({ format: 'pdf', content: 'plan' });
const requirePlanDocxExport = requireExport({ format: 'docx', content: 'plan' });
const requireStrategyPdfExport = requireExport({ format: 'pdf', content: 'strategyCanvas' });
const requireStrategyDocxExport = requireExport({ format: 'docx', content: 'strategyCanvas' });
const requireDepartmentsPdfExport = requireExport({ format: 'pdf', content: 'departments' });
const requireDepartmentsDocxExport = requireExport({ format: 'docx', content: 'departments' });
const requireFinancialsCsvExport = requireExport({ format: 'csv', content: 'financials' });

module.exports = {
  requireExport,
  requirePlanPdfExport,
  requirePlanDocxExport,
  requireStrategyPdfExport,
  requireStrategyDocxExport,
  requireDepartmentsPdfExport,
  requireDepartmentsDocxExport,
  requireFinancialsCsvExport,
};
