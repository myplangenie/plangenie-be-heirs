const CoreProject = require('../models/CoreProject');
const User = require('../models/User');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');
const { getLimit } = require('../config/entitlements');

/**
 * Get all core projects for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const projects = await CoreProject.find({
      ...wsFilter,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

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
      linkedGoals,
      departments,
      deliverables,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
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
      linkedGoals: Array.isArray(linkedGoals) ? linkedGoals : undefined,
      departments: Array.isArray(departments) ? departments : undefined,
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

    await project.save();

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
