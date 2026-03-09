const CoreProject = require('../models/CoreProject');
const User = require('../models/User');
const { getWorkspaceFilter, addWorkspaceToDoc, getWorkspaceId } = require('../utils/workspaceQuery');
const { getLimit } = require('../config/entitlements');
const cache = require('../services/cache');

/**
 * Get all core projects for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const workspaceId = getWorkspaceId(req) || 'default';

    const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
    const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];

    if (isLimitedCollab) {
      // Bypass cache and filter by involved departments
      const projects = await CoreProject.find({
        ...wsFilter,
        isDeleted: false,
        departments: { $in: allowedDepts.length ? allowedDepts : ['__none__'] },
      }).sort({ order: 1 }).lean();
      return res.json({ projects });
    }

    // Owner/admin: use cache
    const cacheKey = cache.CACHE_KEYS.userCoreProjects(userId, workspaceId);
    const projects = await cache.getOrSet(
      cacheKey,
      async () => {
        return CoreProject.find({
          ...wsFilter,
          isDeleted: false,
        }).sort({ order: 1 }).lean();
      },
      cache.TTL.MEDIUM
    );

    return res.json({ projects });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single core project by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await CoreProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Enforce department scope for limited collaborators
    try {
      const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
      if (isLimitedCollab) {
        const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];
        const involved = Array.isArray(project.departments) ? project.departments : [];
        const intersects = involved.some((d) => allowedDepts.includes(String(d || '')));
        if (!intersects) {
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
 * Create a new core project
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    // Load full user to check subscription status
    const user = userId ? await User.findById(userId).lean() : null;
    const limit = getLimit(user, 'maxCoreProjects');
    const currentCount = await CoreProject.countDocuments({
      ...wsFilter,
      isDeleted: false,
    });

    if (limit && currentCount >= limit) {
      return res.status(402).json({
        code: 'LIMIT_EXCEEDED',
        message: `Your plan allows up to ${limit} core projects`,
        limit,
        current: currentCount,
        upgradeTo: 'pro',
      });
    }

    const {
      title,
      description,
      goal,
      cost,
      dueWhen,
      priority,
      ownerId,
      ownerName,
      executiveSponsorName,
      responsibleLeadName,
      linkedCoreOKR,
      linkedCoreKrId,
      linkedGoals,
      departments,
      deliverables,
    } = req.body;

    if (!title || !title.trim()) return res.status(400).json({ message: 'Title is required' });
    if (!Array.isArray(departments) || departments.length === 0) return res.status(400).json({ message: 'Involved Departments are required' });

    // Provide sensible defaults for sponsor/lead when not provided (e.g., onboarding quick adds)
    const fallbackUserName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || (ownerName || 'Unassigned');
    const execName = (String(executiveSponsorName || ownerName || fallbackUserName).trim()) || 'Unassigned';
    const respName = (String(responsibleLeadName || ownerName || fallbackUserName).trim()) || 'Unassigned';

    // Prefer linkage to a single Core KR, but allow creation without it during onboarding.
    // If provided, validate linkage and enforce per-objective cap.
    if (linkedCoreOKR && linkedCoreKrId) {
      const OKR = require('../models/OKR');
      const okr = await OKR.findOne({ _id: linkedCoreOKR, ...wsFilter, okrType: 'core', isDeleted: false }).lean();
      if (!okr) return res.status(400).json({ message: 'linkedCoreOKR must reference a Core OKR in this workspace' });
      const krExists = (okr.keyResults || []).some((kr) => String(kr._id) === String(linkedCoreKrId));
      if (!krExists) return res.status(400).json({ message: 'linkedCoreKrId must reference a Key Result within the linked Core OKR' });

      // Enforce 1-3 projects per Core Objective
      const existingCount = await CoreProject.countDocuments({ ...wsFilter, isDeleted: false, linkedCoreOKR });
      if (existingCount >= 3) {
        return res.status(400).json({ message: 'Each Core Objective can have at most 3 Core Projects' });
      }
    }

    const projectData = addWorkspaceToDoc({
      user: userId,
      title: title.trim(),
      description: description?.trim() || undefined,
      goal: goal?.trim() || undefined,
      cost: cost?.trim() || undefined,
      dueWhen: dueWhen?.trim() || undefined,
      priority: priority || undefined,
      ownerId: ownerId || undefined,
      ownerName: ownerName?.trim() || undefined,
      executiveSponsorName: execName,
      responsibleLeadName: respName,
      linkedCoreOKR: linkedCoreOKR || undefined,
      linkedCoreKrId: linkedCoreKrId || undefined,
      linkedGoals: Array.isArray(linkedGoals) ? linkedGoals : undefined,
      departments: departments,
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

    const project = await CoreProject.create(projectData);

    // Invalidate cache
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateCoreProjects(userId, workspaceId);

    return res.status(201).json({ project, message: 'Project created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a core project
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await CoreProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const {
      title,
      description,
      goal,
      cost,
      dueWhen,
      priority,
      ownerId,
      ownerName,
      executiveSponsorName,
      responsibleLeadName,
      linkedCoreOKR,
      linkedCoreKrId,
      linkedGoals,
      departments,
      deliverables,
      order,
    } = req.body;

    // Update fields if provided
    if (title !== undefined) project.title = title.trim();
    if (description !== undefined) project.description = description?.trim() || undefined;
    if (goal !== undefined) project.goal = goal?.trim() || undefined;
    if (cost !== undefined) project.cost = cost?.trim() || undefined;
    if (dueWhen !== undefined) project.dueWhen = dueWhen?.trim() || undefined;
    if (priority !== undefined) project.priority = priority || undefined;
    if (ownerId !== undefined) project.ownerId = ownerId || undefined;
    if (ownerName !== undefined) project.ownerName = ownerName?.trim() || undefined;
    if (executiveSponsorName !== undefined) project.executiveSponsorName = executiveSponsorName?.trim() || undefined;
    if (responsibleLeadName !== undefined) project.responsibleLeadName = responsibleLeadName?.trim() || undefined;
    if (linkedCoreOKR !== undefined) project.linkedCoreOKR = linkedCoreOKR || undefined;
    if (linkedCoreKrId !== undefined) project.linkedCoreKrId = linkedCoreKrId || undefined;

    // If linkage fields are provided, validate integrity
    if (linkedCoreOKR || linkedCoreKrId) {
      const OKR = require('../models/OKR');
      const okr = await OKR.findOne({ _id: project.linkedCoreOKR, ...wsFilter, okrType: 'core', isDeleted: false }).lean();
      if (!okr) return res.status(400).json({ message: 'linkedCoreOKR must reference a Core OKR in this workspace' });
      const krExists = (okr.keyResults || []).some((kr) => String(kr._id) === String(project.linkedCoreKrId));
      if (!krExists) return res.status(400).json({ message: 'linkedCoreKrId must reference a Key Result within the linked Core OKR' });
    }
    if (linkedGoals !== undefined) project.linkedGoals = Array.isArray(linkedGoals) ? linkedGoals : [];
    if (departments !== undefined) project.departments = Array.isArray(departments) ? departments : [];
    if (order !== undefined) project.order = order;

    // Replace deliverables if provided
    if (deliverables !== undefined) {
      project.deliverables = Array.isArray(deliverables)
        ? deliverables.map(d => ({
            _id: d._id || undefined, // Preserve existing IDs
            text: d.text?.trim() || '',
            done: Boolean(d.done),
            kpi: d.kpi?.trim() || undefined,
            dueWhen: d.dueWhen?.trim() || undefined,
            ownerId: d.ownerId || undefined,
            ownerName: d.ownerName?.trim() || undefined,
          })).filter(d => d.text)
        : [];
    }

    // If linkedCoreOKR is set, ensure per-objective cap of 3
    if (project.linkedCoreOKR) {
      const count = await CoreProject.countDocuments({
        ...wsFilter,
        isDeleted: false,
        linkedCoreOKR: project.linkedCoreOKR,
        _id: { $ne: project._id },
      });
      if (count >= 3) {
        return res.status(400).json({ message: 'Each Core Objective can have at most 3 Core Projects' });
      }
    }

    await project.save();

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateCoreProjects(userId, workspaceId);

    return res.json({ project, message: 'Project updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a core project (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await CoreProject.findOne({
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
    cache.invalidateCoreProjects(userId, workspaceId);

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

    const project = await CoreProject.findOne({
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
    cache.invalidateCoreProjects(userId, workspaceId);

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

    const project = await CoreProject.findOne({
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
    cache.invalidateCoreProjects(userId, workspaceId);

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

    const project = await CoreProject.findOne({
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
    cache.invalidateCoreProjects(userId, workspaceId);

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

    const project = await CoreProject.findOne({
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
    cache.invalidateCoreProjects(userId, workspaceId);

    return res.json({ message: 'Deliverable deleted', project });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder projects
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { projectIds } = req.body;

    if (!Array.isArray(projectIds)) {
      return res.status(400).json({ message: 'projectIds array is required' });
    }

    // Update order for each project
    const updates = projectIds.map((id, index) =>
      CoreProject.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    // Invalidate cache
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req) || 'default';
    cache.invalidateCoreProjects(userId, workspaceId);

    return res.json({ message: 'Projects reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Generate AI details for a project (wrapper for existing AI endpoint)
 */
exports.generateDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const project = await CoreProject.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Forward to existing AI controller
    // This will be integrated with the existing suggestCoreProject endpoint
    req.body.input = `Core project: ${project.title}\nTask: Generate full project details including goal, deliverables with KPIs, and due date.`;

    // Call the AI endpoint (will be imported)
    const ai = require('./ai.controller');
    return ai.suggestCoreProject(req, res, next);
  } catch (err) {
    next(err);
  }
};
