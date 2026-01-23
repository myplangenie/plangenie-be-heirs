const OrgPosition = require('../models/OrgPosition');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all org positions for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const positions = await OrgPosition.find({
      ...wsFilter,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

    return res.json({ positions });
  } catch (err) {
    next(err);
  }
};

/**
 * Get org chart as tree structure
 */
exports.getTree = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const tree = await OrgPosition.getOrgTree(wsFilter.workspace);
    return res.json({ tree });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single org position by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const position = await OrgPosition.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!position) {
      return res.status(404).json({ message: 'Position not found' });
    }

    return res.json({ position });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new org position
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const {
      position,
      role,
      name,
      department,
      parentId,
    } = req.body;

    if (!position || !position.trim()) {
      return res.status(400).json({ message: 'Position title is required' });
    }

    const order = await OrgPosition.getNextOrder(wsFilter.workspace);

    const positionData = addWorkspaceToDoc({
      user: userId,
      position: position.trim(),
      role: role?.trim() || undefined,
      name: name?.trim() || undefined,
      department: department?.trim() || undefined,
      parentId: parentId || null,
      order,
    }, req);

    const newPosition = await OrgPosition.create(positionData);

    return res.status(201).json({ position: newPosition, message: 'Position created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an org position
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const pos = await OrgPosition.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!pos) {
      return res.status(404).json({ message: 'Position not found' });
    }

    const {
      position,
      role,
      name,
      department,
      parentId,
      order,
    } = req.body;

    // Update fields if provided
    if (position !== undefined) pos.position = position.trim();
    if (role !== undefined) pos.role = role?.trim() || undefined;
    if (name !== undefined) pos.name = name?.trim() || undefined;
    if (department !== undefined) pos.department = department?.trim() || undefined;
    if (parentId !== undefined) pos.parentId = parentId || null;
    if (order !== undefined) pos.order = order;

    await pos.save();

    return res.json({ position: pos, message: 'Position updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete an org position (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const position = await OrgPosition.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!position) {
      return res.status(404).json({ message: 'Position not found' });
    }

    // Also update children to have no parent (or could cascade delete)
    await OrgPosition.updateMany(
      { ...wsFilter, parentId: id, isDeleted: false },
      { $set: { parentId: null } }
    );

    await position.softDelete();

    return res.json({ message: 'Position deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted position
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const position = await OrgPosition.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!position) {
      return res.status(404).json({ message: 'Deleted position not found' });
    }

    await position.restore();

    return res.json({ position, message: 'Position restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder positions
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { positionIds } = req.body;

    if (!Array.isArray(positionIds)) {
      return res.status(400).json({ message: 'positionIds array is required' });
    }

    const updates = positionIds.map((id, index) =>
      OrgPosition.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'Positions reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create positions (for migration)
 * Clears existing positions first to prevent duplicates
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { positions } = req.body;

    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({ message: 'Positions array is required' });
    }

    // Clear existing positions first to prevent duplicates
    await OrgPosition.deleteMany(wsFilter);

    const startOrder = 0;

    const positionDocs = positions.map((p, index) =>
      addWorkspaceToDoc({
        user: userId,
        position: (p.position || '').trim(),
        role: p.role?.trim() || undefined,
        name: p.name?.trim() || undefined,
        department: p.department?.trim() || undefined,
        legacyParentId: p.parentId || undefined, // Store legacy ID for later mapping
        order: startOrder + index,
      }, req)
    ).filter(p => p.position);

    const created = await OrgPosition.insertMany(positionDocs);

    return res.status(201).json({
      positions: created,
      count: created.length,
      message: `${created.length} positions created`,
    });
  } catch (err) {
    next(err);
  }
};
