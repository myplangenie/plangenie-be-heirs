const SwotEntry = require('../models/SwotEntry');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all SWOT entries for the current workspace
 * Optionally filter by entry type
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { type } = req.query;

    const query = { ...wsFilter, isDeleted: false };
    if (type && ['strength', 'weakness', 'opportunity', 'threat'].includes(type)) {
      query.entryType = type;
    }

    const entries = await SwotEntry.find(query)
      .sort({ entryType: 1, order: 1 })
      .lean();

    return res.json({ entries });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all SWOT entries grouped by type
 */
exports.getGrouped = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const grouped = await SwotEntry.getAllGrouped(wsFilter.workspace);
    return res.json({ swot: grouped });
  } catch (err) {
    next(err);
  }
};

/**
 * Get SWOT as strings (backward compatible)
 */
exports.getAsStrings = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);

    const [strengths, weaknesses, opportunities, threats] = await Promise.all([
      SwotEntry.getAsString(wsFilter.workspace, 'strength'),
      SwotEntry.getAsString(wsFilter.workspace, 'weakness'),
      SwotEntry.getAsString(wsFilter.workspace, 'opportunity'),
      SwotEntry.getAsString(wsFilter.workspace, 'threat'),
    ]);

    return res.json({
      swotStrengths: strengths,
      swotWeaknesses: weaknesses,
      swotOpportunities: opportunities,
      swotThreats: threats,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single SWOT entry by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const entry = await SwotEntry.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!entry) {
      return res.status(404).json({ message: 'SWOT entry not found' });
    }

    return res.json({ entry });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new SWOT entry
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const { entryType, text, priority, notes } = req.body;

    if (!entryType || !['strength', 'weakness', 'opportunity', 'threat'].includes(entryType)) {
      return res.status(400).json({ message: 'Valid entryType is required' });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ message: 'Entry text is required' });
    }

    const order = await SwotEntry.getNextOrder(wsFilter.workspace, entryType);

    const entryData = addWorkspaceToDoc({
      user: userId,
      entryType,
      text: text.trim(),
      priority: priority || null,
      notes: notes?.trim() || undefined,
      order,
    }, req);

    const entry = await SwotEntry.create(entryData);

    return res.status(201).json({ entry, message: 'SWOT entry created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a SWOT entry
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const entry = await SwotEntry.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!entry) {
      return res.status(404).json({ message: 'SWOT entry not found' });
    }

    const { text, priority, notes, order } = req.body;

    if (text !== undefined) entry.text = text.trim();
    if (priority !== undefined) entry.priority = priority || null;
    if (notes !== undefined) entry.notes = notes?.trim() || undefined;
    if (order !== undefined) entry.order = order;

    await entry.save();

    return res.json({ entry, message: 'SWOT entry updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a SWOT entry (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const entry = await SwotEntry.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!entry) {
      return res.status(404).json({ message: 'SWOT entry not found' });
    }

    await entry.softDelete();

    return res.json({ message: 'SWOT entry deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted entry
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const entry = await SwotEntry.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!entry) {
      return res.status(404).json({ message: 'Deleted entry not found' });
    }

    await entry.restore();

    return res.json({ entry, message: 'SWOT entry restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder entries within an entry type
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { entryType, entryIds } = req.body;

    if (!entryType || !['strength', 'weakness', 'opportunity', 'threat'].includes(entryType)) {
      return res.status(400).json({ message: 'Valid entryType is required' });
    }

    if (!Array.isArray(entryIds)) {
      return res.status(400).json({ message: 'entryIds array is required' });
    }

    const updates = entryIds.map((id, index) =>
      SwotEntry.updateOne(
        { _id: id, ...wsFilter, entryType, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'SWOT entries reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create entries (for migration from string format)
 * Clears existing entries of this type first to prevent duplicates
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { entryType, entries } = req.body;

    if (!entryType || !['strength', 'weakness', 'opportunity', 'threat'].includes(entryType)) {
      return res.status(400).json({ message: 'Valid entryType is required' });
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: 'Entries array is required' });
    }

    // Clear existing entries of this type first to prevent duplicates
    await SwotEntry.deleteMany({ ...wsFilter, entryType });

    const entryDocs = entries.map((e, index) => {
      const text = typeof e === 'string' ? e : e.text;
      return addWorkspaceToDoc({
        user: userId,
        entryType,
        text: (text || '').trim(),
        priority: typeof e === 'object' ? e.priority : null,
        notes: typeof e === 'object' ? e.notes?.trim() : undefined,
        order: index,
      }, req);
    }).filter(e => e.text);

    const created = await SwotEntry.insertMany(entryDocs);

    return res.status(201).json({
      entries: created,
      count: created.length,
      message: `${created.length} SWOT entries created`,
    });
  } catch (err) {
    next(err);
  }
};
