const VisionGoal = require('../models/VisionGoal');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all vision goals for the current workspace
 * Optionally filter by goal type (1y or 3y)
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { type } = req.query;

    const query = { ...wsFilter, isDeleted: false };
    if (type && ['1y', '3y'].includes(type)) {
      query.goalType = type;
    }

    const goals = await VisionGoal.find(query)
      .sort({ goalType: 1, order: 1 })
      .lean();

    return res.json({ goals });
  } catch (err) {
    next(err);
  }
};

/**
 * Get goals as newline-separated strings (backward compatible)
 */
exports.getAsStrings = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);

    const [vision1y, vision3y] = await Promise.all([
      VisionGoal.getAsString(wsFilter.workspace, '1y'),
      VisionGoal.getAsString(wsFilter.workspace, '3y'),
    ]);

    return res.json({ vision1y, vision3y });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single vision goal by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const goal = await VisionGoal.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!goal) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    return res.json({ goal });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new vision goal
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const { goalType, text, notes, status } = req.body;

    if (!goalType || !['1y', '3y'].includes(goalType)) {
      return res.status(400).json({ message: 'Valid goalType (1y or 3y) is required' });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Goal text is required' });
    }

    const order = await VisionGoal.getNextOrder(wsFilter.workspace, goalType);

    const goalData = addWorkspaceToDoc({
      user: userId,
      goalType,
      text: text.trim(),
      notes: notes?.trim() || undefined,
      status: status || 'not_started',
      order,
    }, req);

    const goal = await VisionGoal.create(goalData);

    return res.status(201).json({ goal, message: 'Goal created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a vision goal
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const goal = await VisionGoal.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!goal) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    const { text, notes, status, order } = req.body;

    if (text !== undefined) goal.text = text.trim();
    if (notes !== undefined) goal.notes = notes?.trim() || undefined;
    if (status !== undefined) goal.status = status;
    if (order !== undefined) goal.order = order;

    await goal.save();

    return res.json({ goal, message: 'Goal updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a vision goal (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const goal = await VisionGoal.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!goal) {
      return res.status(404).json({ message: 'Goal not found' });
    }

    await goal.softDelete();

    return res.json({ message: 'Goal deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted goal
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const goal = await VisionGoal.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!goal) {
      return res.status(404).json({ message: 'Deleted goal not found' });
    }

    await goal.restore();

    return res.json({ goal, message: 'Goal restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder goals within a goal type
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { goalType, goalIds } = req.body;

    if (!goalType || !['1y', '3y'].includes(goalType)) {
      return res.status(400).json({ message: 'Valid goalType is required' });
    }

    if (!Array.isArray(goalIds)) {
      return res.status(400).json({ message: 'goalIds array is required' });
    }

    const updates = goalIds.map((id, index) =>
      VisionGoal.updateOne(
        { _id: id, ...wsFilter, goalType, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'Goals reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create goals (for migration from string format)
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { goalType, goals } = req.body;

    if (!goalType || !['1y', '3y'].includes(goalType)) {
      return res.status(400).json({ message: 'Valid goalType is required' });
    }

    if (!Array.isArray(goals) || goals.length === 0) {
      return res.status(400).json({ message: 'Goals array is required' });
    }

    const startOrder = await VisionGoal.getNextOrder(wsFilter.workspace, goalType);

    const goalDocs = goals.map((g, index) => {
      const text = typeof g === 'string' ? g : g.text;
      return addWorkspaceToDoc({
        user: userId,
        goalType,
        text: (text || '').trim(),
        notes: typeof g === 'object' ? g.notes?.trim() : undefined,
        status: typeof g === 'object' ? g.status : 'not_started',
        order: startOrder + index,
      }, req);
    }).filter(g => g.text);

    const created = await VisionGoal.insertMany(goalDocs);

    return res.status(201).json({
      goals: created,
      count: created.length,
      message: `${created.length} goals created`,
    });
  } catch (err) {
    next(err);
  }
};
