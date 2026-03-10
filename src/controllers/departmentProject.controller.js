const DepartmentProject = require('../models/DepartmentProject');
const CoreProject = require('../models/CoreProject');
const User = require('../models/User');
const { getWorkspaceFilter, addWorkspaceToDoc, getWorkspaceId } = require('../utils/workspaceQuery');
const { hasFeature } = require('../config/entitlements');
const cache = require('../services/cache');

// Helper to load full user for entitlement checks
async function loadUser(userId) {
  if (!userId) return null;
  try {
    return await User.findById(userId).lean();
  } catch {
    return null;
  }
}

/**
 * Get all department projects for the current workspace
 * Optionally filter by department key
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { department, grouped } = req.query;

    // Load full user to check subscription status
    const user = await loadUser(req.user?.id);

    // Check if user has access to department plans
    if (!hasFeature(user, 'departmentPlans')) {
      return res.status(402).json({
        code: 'UPGRADE_REQUIRED',
        message: 'Department plans require Plan Genie Pro',
        feature: 'departmentPlans',
        upgradeTo: 'pro',
      });
    }

    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
    const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];

    // Return grouped by department
    if (grouped === 'true') {
      // For limited collaborators, bypass owner-scoped cache and filter by departments
      if (isLimitedCollab) {
        if (!allowedDepts.length) return res.json({ projects: {} });
        const rows = await DepartmentProject.find({
          ...wsFilter,
          isDeleted: false,
          departmentKey: { $in: allowedDepts },
        }).sort({ departmentKey: 1, order: 1 }).lean();
        const groupedMap = {};
        for (const p of rows) {
          const k = p.departmentKey || 'other';
          if (!groupedMap[k]) groupedMap[k] = [];
          groupedMap[k].push(p);
        }
        return res.json({ projects: groupedMap });
      }

      // Owner/admin: use cache
      const cacheKey = cache.CACHE_KEYS.userDeptProjects(userId, workspaceId);
      const projects = await cache.getOrSet(
        cacheKey,
        async () => DepartmentProject.findGroupedByDepartment(wsFilter.workspace),
        cache.TTL.MEDIUM
      );
      return res.json({ projects });
    }

    // Build query (not cached - less frequent use case)
    const query = { ...wsFilter, isDeleted: false };
    if (department) {
      const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
      query.departmentKey = normalizeDepartmentKey(String(department || ''));
    }
    if (isLimitedCollab) {
      // Filter results to allowed departments only
      query.departmentKey = query.departmentKey
        ? query.departmentKey
        : { $in: allowedDepts.length ? allowedDepts : ['__none__'] };
    }

    const projects = await DepartmentProject.find(query)
      .sort({ departmentKey: 1, order: 1 })
      .populate('linkedCoreProject', 'title')
      .lean();

    return res.json({ projects });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single department project by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    })
      .populate('linkedCoreProject', 'title goal')
      .lean();

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Enforce department scope for limited collaborators
    try {
      const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
      if (isLimitedCollab) {
        const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];
        if (!allowedDepts.includes(String(project.departmentKey || ''))) {
          return res.status(404).json({ message: 'Project not found' });
        }
      }
    } catch (_) {}

    return res.json({ project });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new department project
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    // Load full user to check subscription status
    const user = await loadUser(userId);

    // Check feature access
    if (!hasFeature(user, 'departmentPlans')) {
      return res.status(402).json({
        code: 'UPGRADE_REQUIRED',
        message: 'Department plans require Plan Genie Pro',
        feature: 'departmentPlans',
        upgradeTo: 'pro',
      });
    }

    const {
      departmentKey,
      title,
      goal,
      milestone,
      resources,
      dueWhen,
      cost,
      priority,
      firstName,
      lastName,
      ownerId,
      linkedCoreProject,
      linkedGoal,
      linkedDeptOKR,
      linkedDeptKrId,
      deliverables,
    } = req.body;

    if (!departmentKey || !departmentKey.trim()) {
      return res.status(400).json({ message: 'Department key is required' });
    }

    // Validate linkedCoreProject if provided
    if (linkedCoreProject) {
      const coreProject = await CoreProject.findOne({
        _id: linkedCoreProject,
        ...wsFilter,
        isDeleted: false,
      });
      if (!coreProject) {
        return res.status(400).json({ message: 'Linked core project not found' });
      }
    }

    // Prefer linkage to a Department KR, but allow creation without it (onboarding quick adds).
    // If provided, validate integrity and department match.
    if (linkedDeptOKR && linkedDeptKrId) {
      const OKR = require('../models/OKR');
      const okr = await OKR.findOne({ _id: linkedDeptOKR, ...wsFilter, okrType: 'department', isDeleted: false }).lean();
      if (!okr) return res.status(400).json({ message: 'linkedDeptOKR must reference a Department OKR in this workspace' });
      if (String(okr.departmentKey || '').toLowerCase().trim() !== String(departmentKey || '').toLowerCase().trim()) {
        return res.status(400).json({ message: 'Department Project must link to a Department OKR in the same department' });
      }
      const krExists = (okr.keyResults || []).some((kr) => String(kr._id) === String(linkedDeptKrId));
      if (!krExists) return res.status(400).json({ message: 'linkedDeptKrId must reference a Key Result within the linked Department OKR' });
    }

    const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
    // Resolve department to an existing key if present in this workspace
    let normDeptKey = normalizeDepartmentKey(String(departmentKey || ''));
    try {
      const existingDeptKeys = await DepartmentProject.distinct('departmentKey', { ...wsFilter, isDeleted: false });
      const CoreProject = require('../models/CoreProject');
      const existingCoreDeptKeys = await CoreProject.distinct('departments', { ...wsFilter, isDeleted: false });
      const { getWorkspaceFields } = require('../services/workspaceFieldService');
      const fields = await getWorkspaceFields(wsFilter.workspace);
      const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
      const candidates = []
        .concat(existingDeptKeys || [])
        .concat(existingCoreDeptKeys || [])
        .concat(editable.map((d) => (typeof d === 'string' ? d : (d?.key || d?.label || ''))));
      for (const k of candidates) {
        const nk = normalizeDepartmentKey(String(k || ''));
        if (nk && nk === normDeptKey) { normDeptKey = String(k); break; }
      }
    } catch {}

    const projectData = addWorkspaceToDoc({
      user: userId,
      departmentKey: normDeptKey,
      title: title?.trim() || undefined,
      goal: goal?.trim() || undefined,
      milestone: milestone?.trim() || undefined,
      resources: resources?.trim() || undefined,
      dueWhen: dueWhen?.trim() || undefined,
      cost: cost?.trim() || undefined,
      priority: priority || undefined,
      firstName: firstName?.trim() || undefined,
      lastName: lastName?.trim() || undefined,
      ownerId: ownerId || undefined,
      linkedCoreProject: linkedCoreProject || undefined,
      linkedGoal: typeof linkedGoal === 'number' ? linkedGoal : undefined,
      linkedDeptOKR: linkedDeptOKR || undefined,
      linkedDeptKrId: linkedDeptKrId || undefined,
      deliverables: Array.isArray(deliverables)
        ? deliverables.map(d => ({
            text: d.text?.trim() || '',
            done: Boolean(d.done),
            kpi: d.kpi?.trim() || undefined,
            dueWhen: d.dueWhen?.trim() || undefined,
            ownerId: d.ownerId || undefined,
            ownerName: d.ownerName?.trim() || undefined,
          })).filter(d => d.text)
        : [],
    }, req);

    const project = await DepartmentProject.create(projectData);

    // Invalidate cache
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.status(201).json({ project, message: 'Project created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a department project
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const {
      departmentKey,
      title,
      goal,
      milestone,
      resources,
      dueWhen,
      cost,
      priority,
      firstName,
      lastName,
      ownerId,
      linkedCoreProject,
      linkedGoal,
      linkedDeptOKR,
      linkedDeptKrId,
      deliverables,
      order,
    } = req.body;

    // Update fields if provided
    if (departmentKey !== undefined) {
      const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
      project.departmentKey = normalizeDepartmentKey(String(departmentKey || ''));
    }
    if (title !== undefined) project.title = title?.trim() || undefined;
    if (goal !== undefined) project.goal = goal?.trim() || undefined;
    if (milestone !== undefined) project.milestone = milestone?.trim() || undefined;
    if (resources !== undefined) project.resources = resources?.trim() || undefined;
    if (dueWhen !== undefined) project.dueWhen = dueWhen?.trim() || undefined;
    if (cost !== undefined) project.cost = cost?.trim() || undefined;
    if (priority !== undefined) project.priority = priority || undefined;
    if (firstName !== undefined) project.firstName = firstName?.trim() || undefined;
    if (lastName !== undefined) project.lastName = lastName?.trim() || undefined;
    if (ownerId !== undefined) project.ownerId = ownerId || undefined;
    if (linkedCoreProject !== undefined) project.linkedCoreProject = linkedCoreProject || undefined;
    if (linkedGoal !== undefined) project.linkedGoal = typeof linkedGoal === 'number' ? linkedGoal : undefined;
    if (linkedDeptOKR !== undefined) project.linkedDeptOKR = linkedDeptOKR || undefined;
    if (linkedDeptKrId !== undefined) project.linkedDeptKrId = linkedDeptKrId || undefined;

    if (linkedDeptOKR || linkedDeptKrId) {
      const OKR = require('../models/OKR');
      const okr = await OKR.findOne({ _id: project.linkedDeptOKR, ...wsFilter, okrType: 'department', isDeleted: false }).lean();
      if (!okr) return res.status(400).json({ message: 'linkedDeptOKR must reference a Department OKR in this workspace' });
      if (String(okr.departmentKey || '').toLowerCase().trim() !== String(project.departmentKey || '').toLowerCase().trim()) {
        return res.status(400).json({ message: 'Department Project must link to a Department OKR in the same department' });
      }
      const krExists = (okr.keyResults || []).some((kr) => String(kr._id) === String(project.linkedDeptKrId));
      if (!krExists) return res.status(400).json({ message: 'linkedDeptKrId must reference a Key Result within the linked Department OKR' });
    }
    if (order !== undefined) project.order = order;

    // Replace deliverables if provided
    if (deliverables !== undefined) {
      project.deliverables = Array.isArray(deliverables)
        ? deliverables.map(d => ({
            _id: d._id || undefined,
            text: d.text?.trim() || '',
            done: Boolean(d.done),
            kpi: d.kpi?.trim() || undefined,
            dueWhen: d.dueWhen?.trim() || undefined,
            ownerId: d.ownerId || undefined,
            ownerName: d.ownerName?.trim() || undefined,
          })).filter(d => d.text)
        : [];
    }

    await project.save();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ project, message: 'Project updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a department project (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    await project.softDelete();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ message: 'Project deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted project
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!project) {
      return res.status(404).json({ message: 'Deleted project not found' });
    }

    await project.restore();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ project, message: 'Project restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Add a deliverable to a project
 */
exports.addDeliverable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const { text, kpi, dueWhen, ownerId, ownerName } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Deliverable text is required' });
    }

    project.deliverables.push({
      text: text.trim(),
      done: false,
      kpi: kpi?.trim() || undefined,
      dueWhen: dueWhen?.trim() || undefined,
      ownerId: ownerId || undefined,
      ownerName: ownerName?.trim() || undefined,
    });

    await project.save();

    const newDeliverable = project.deliverables[project.deliverables.length - 1];

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.status(201).json({
      deliverable: newDeliverable,
      project,
      message: 'Deliverable added',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a deliverable
 */
exports.updateDeliverable = async (req, res, next) => {
  try {
    const { id, deliverableId } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const deliverable = project.deliverables.id(deliverableId);
    if (!deliverable) {
      return res.status(404).json({ message: 'Deliverable not found' });
    }

    const { text, done, kpi, dueWhen, ownerId, ownerName } = req.body;

    if (text !== undefined) deliverable.text = text.trim();
    if (done !== undefined) deliverable.done = Boolean(done);
    if (kpi !== undefined) deliverable.kpi = kpi?.trim() || undefined;
    if (dueWhen !== undefined) deliverable.dueWhen = dueWhen?.trim() || undefined;
    if (ownerId !== undefined) deliverable.ownerId = ownerId || undefined;
    if (ownerName !== undefined) deliverable.ownerName = ownerName?.trim() || undefined;

    await project.save();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ deliverable, project, message: 'Deliverable updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a deliverable
 */
exports.deleteDeliverable = async (req, res, next) => {
  try {
    const { id, deliverableId } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await DepartmentProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const deliverable = project.deliverables.id(deliverableId);
    if (!deliverable) {
      return res.status(404).json({ message: 'Deliverable not found' });
    }

    deliverable.deleteOne();
    await project.save();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ message: 'Deliverable deleted', project });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder projects within a department
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { departmentKey, projectIds } = req.body;

    if (!departmentKey) {
      return res.status(400).json({ message: 'departmentKey is required' });
    }

    if (!Array.isArray(projectIds)) {
      return res.status(400).json({ message: 'projectIds array is required' });
    }

    // Normalize department key for matching
    const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
    const normDept = normalizeDepartmentKey(String(departmentKey || ''));

    // Update order for each project
    const updates = projectIds.map((id, index) =>
      DepartmentProject.updateOne(
        { _id: id, ...wsFilter, departmentKey: normDept, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.json({ message: 'Projects reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create projects for a department (for AI generation)
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    // Load full user to check subscription status
    const user = await loadUser(userId);

    // Check feature access
    if (!hasFeature(user, 'departmentPlans')) {
      return res.status(402).json({
        code: 'UPGRADE_REQUIRED',
        message: 'Department plans require Plan Genie Pro',
        feature: 'departmentPlans',
        upgradeTo: 'pro',
      });
    }

    const { departmentKey, projects } = req.body;

    if (!departmentKey || !departmentKey.trim()) {
      return res.status(400).json({ message: 'Department key is required' });
    }

    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(400).json({ message: 'Projects array is required' });
    }

    const { normalizeDepartmentKey } = require('../utils/departmentNormalize');
    let normDept = normalizeDepartmentKey(String(departmentKey || ''));
    try {
      const existingDeptKeys = await DepartmentProject.distinct('departmentKey', { ...wsFilter, isDeleted: false });
      const CoreProject = require('../models/CoreProject');
      const existingCoreDeptKeys = await CoreProject.distinct('departments', { ...wsFilter, isDeleted: false });
      const { getWorkspaceFields } = require('../services/workspaceFieldService');
      const fields = await getWorkspaceFields(wsFilter.workspace);
      const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
      const candidates = []
        .concat(existingDeptKeys || [])
        .concat(existingCoreDeptKeys || [])
        .concat(editable.map((d) => (typeof d === 'string' ? d : (d?.key || d?.label || ''))));
      for (const k of candidates) {
        const nk = normalizeDepartmentKey(String(k || ''));
        if (nk && nk === normDept) { normDept = String(k); break; }
      }
    } catch {}
    const startOrder = await DepartmentProject.getNextOrder(wsFilter.workspace, normDept);

    const projectDocs = projects.map((p, index) =>
      addWorkspaceToDoc({
        user: userId,
        departmentKey: normDept,
        title: p.title?.trim() || undefined,
        goal: p.goal?.trim() || undefined,
        milestone: p.milestone?.trim() || undefined,
        resources: p.resources?.trim() || undefined,
        dueWhen: p.dueWhen?.trim() || undefined,
        cost: p.cost?.trim() || undefined,
        priority: p.priority || undefined,
        firstName: p.firstName?.trim() || undefined,
        lastName: p.lastName?.trim() || undefined,
        ownerId: p.ownerId || undefined,
        linkedGoal: typeof p.linkedGoal === 'number' ? p.linkedGoal : undefined,
        deliverables: Array.isArray(p.deliverables)
          ? p.deliverables.map(d => ({
              text: d.text?.trim() || '',
              done: Boolean(d.done),
              kpi: d.kpi?.trim() || undefined,
              dueWhen: d.dueWhen?.trim() || undefined,
              ownerId: d.ownerId || undefined,
              ownerName: d.ownerName?.trim() || undefined,
            })).filter(d => d.text)
          : [],
        order: startOrder + index,
      }, req)
    );

    const created = await DepartmentProject.insertMany(projectDocs);

    // Invalidate cache
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateDeptProjects(userId, workspaceId);

    return res.status(201).json({
      projects: created,
      count: created.length,
      message: `${created.length} projects created`,
    });
  } catch (err) {
    next(err);
  }
};
