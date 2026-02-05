const OKR = require('../models/OKR');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all OKRs for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { timeframe } = req.query;

    const query = { ...wsFilter, isDeleted: false };
    if (timeframe && ['1y', '3-5y', 'quarterly', 'other'].includes(timeframe)) {
      query.timeframe = timeframe;
    }

    const okrs = await OKR.find(query)
      .sort({ order: 1 })
      .lean();

    return res.json({ okrs });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single OKR by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const okr = await OKR.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!okr) {
      return res.status(404).json({ message: 'OKR not found' });
    }

    return res.json({ okr });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new OKR
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const { objective, keyResults, notes, status, timeframe } = req.body;

    if (!objective || !objective.trim()) {
      return res.status(400).json({ message: 'Objective is required' });
    }

    const order = await OKR.getNextOrder(wsFilter.workspace);

    // Process key results
    const processedKRs = Array.isArray(keyResults)
      ? keyResults.map(kr => ({
          text: typeof kr === 'string' ? kr.trim() : kr.text?.trim(),
          progress: kr.progress || 0,
          status: kr.status || 'not_started',
        })).filter(kr => kr.text)
      : [];

    const okrData = addWorkspaceToDoc({
      user: userId,
      objective: objective.trim(),
      keyResults: processedKRs,
      notes: notes?.trim() || undefined,
      status: status || 'not_started',
      timeframe: timeframe || '1y',
      order,
    }, req);

    const okr = await OKR.create(okrData);

    return res.status(201).json({ okr, message: 'OKR created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update an OKR
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const okr = await OKR.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!okr) {
      return res.status(404).json({ message: 'OKR not found' });
    }

    const { objective, keyResults, notes, status, timeframe, order } = req.body;

    if (objective !== undefined) okr.objective = objective.trim();
    if (notes !== undefined) okr.notes = notes?.trim() || undefined;
    if (status !== undefined) okr.status = status;
    if (timeframe !== undefined) okr.timeframe = timeframe;
    if (order !== undefined) okr.order = order;

    if (keyResults !== undefined) {
      okr.keyResults = Array.isArray(keyResults)
        ? keyResults.map(kr => ({
            text: typeof kr === 'string' ? kr.trim() : kr.text?.trim(),
            progress: kr.progress || 0,
            status: kr.status || 'not_started',
          })).filter(kr => kr.text)
        : [];
    }

    await okr.save();

    return res.json({ okr, message: 'OKR updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete an OKR (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const okr = await OKR.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!okr) {
      return res.status(404).json({ message: 'OKR not found' });
    }

    await okr.softDelete();

    return res.json({ message: 'OKR deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted OKR
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const okr = await OKR.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!okr) {
      return res.status(404).json({ message: 'Deleted OKR not found' });
    }

    await okr.restore();

    return res.json({ okr, message: 'OKR restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder OKRs
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { okrIds } = req.body;

    if (!Array.isArray(okrIds)) {
      return res.status(400).json({ message: 'okrIds array is required' });
    }

    const updates = okrIds.map((id, index) =>
      OKR.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'OKRs reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create OKRs
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { okrs } = req.body;

    if (!Array.isArray(okrs) || okrs.length === 0) {
      return res.status(400).json({ message: 'OKRs array is required' });
    }

    const startOrder = await OKR.getNextOrder(wsFilter.workspace);

    const okrDocs = okrs.map((okr, index) => {
      const processedKRs = Array.isArray(okr.keyResults)
        ? okr.keyResults.map(kr => ({
            text: typeof kr === 'string' ? kr.trim() : kr.text?.trim(),
            progress: 0,
            status: 'not_started',
          })).filter(kr => kr.text)
        : [];

      return addWorkspaceToDoc({
        user: userId,
        objective: (okr.objective || '').trim(),
        keyResults: processedKRs,
        notes: okr.notes?.trim() || undefined,
        status: 'not_started',
        timeframe: okr.timeframe || '1y',
        order: startOrder + index,
      }, req);
    }).filter(okr => okr.objective);

    const created = await OKR.insertMany(okrDocs);

    return res.status(201).json({
      okrs: created,
      count: created.length,
      message: `${created.length} OKRs created`,
    });
  } catch (err) {
    next(err);
  }
};
