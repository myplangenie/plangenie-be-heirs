const Competitor = require('../models/Competitor');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all competitors for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const competitors = await Competitor.find({
      ...wsFilter,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

    return res.json({ competitors });
  } catch (err) {
    next(err);
  }
};

/**
 * Get competitor names as array (backward compatible)
 */
exports.getNamesArray = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const names = await Competitor.getNamesArray(wsFilter.workspace);
    const advantages = await Competitor.getAdvantagesArray(wsFilter.workspace);
    const weDoBetters = await Competitor.getWeDoBettersArray(wsFilter.workspace);
    return res.json({
      competitorNames: names,
      competitorAdvantages: advantages,
      competitorWeDoBetters: weDoBetters,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single competitor by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const competitor = await Competitor.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    return res.json({ competitor });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new competitor
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const { name, advantage, weDoBetter, website, notes, threatLevel } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Competitor name is required' });
    }

    const order = await Competitor.getNextOrder(wsFilter.workspace);

    const competitorData = addWorkspaceToDoc({
      user: userId,
      name: name.trim(),
      advantage: advantage?.trim() || undefined,
      weDoBetter: weDoBetter?.trim() || undefined,
      website: website?.trim() || undefined,
      notes: notes?.trim() || undefined,
      threatLevel: threatLevel || null,
      order,
    }, req);

    const competitor = await Competitor.create(competitorData);

    return res.status(201).json({ competitor, message: 'Competitor created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a competitor
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const competitor = await Competitor.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    const { name, advantage, weDoBetter, website, notes, threatLevel, order } = req.body;

    if (name !== undefined) competitor.name = name.trim();
    if (advantage !== undefined) competitor.advantage = advantage?.trim() || undefined;
    if (weDoBetter !== undefined) competitor.weDoBetter = weDoBetter?.trim() || undefined;
    if (website !== undefined) competitor.website = website?.trim() || undefined;
    if (notes !== undefined) competitor.notes = notes?.trim() || undefined;
    if (threatLevel !== undefined) competitor.threatLevel = threatLevel || null;
    if (order !== undefined) competitor.order = order;

    await competitor.save();

    return res.json({ competitor, message: 'Competitor updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a competitor (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const competitor = await Competitor.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    await competitor.softDelete();

    return res.json({ message: 'Competitor deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted competitor
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const competitor = await Competitor.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!competitor) {
      return res.status(404).json({ message: 'Deleted competitor not found' });
    }

    await competitor.restore();

    return res.json({ competitor, message: 'Competitor restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder competitors
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { competitorIds } = req.body;

    if (!Array.isArray(competitorIds)) {
      return res.status(400).json({ message: 'competitorIds array is required' });
    }

    const updates = competitorIds.map((id, index) =>
      Competitor.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'Competitors reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create competitors (for migration)
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { competitors } = req.body;

    if (!Array.isArray(competitors) || competitors.length === 0) {
      return res.status(400).json({ message: 'Competitors array is required' });
    }

    const startOrder = await Competitor.getNextOrder(wsFilter.workspace);

    const competitorDocs = competitors.map((c, index) => {
      const name = typeof c === 'string' ? c : c.name;
      return addWorkspaceToDoc({
        user: userId,
        name: (name || '').trim(),
        advantage: typeof c === 'object' ? c.advantage?.trim() : undefined,
        weDoBetter: typeof c === 'object' ? c.weDoBetter?.trim() : undefined,
        website: typeof c === 'object' ? c.website?.trim() : undefined,
        notes: typeof c === 'object' ? c.notes?.trim() : undefined,
        threatLevel: typeof c === 'object' ? c.threatLevel : null,
        order: startOrder + index,
      }, req);
    }).filter(c => c.name);

    const created = await Competitor.insertMany(competitorDocs);

    return res.status(201).json({
      competitors: created,
      count: created.length,
      message: `${created.length} competitors created`,
    });
  } catch (err) {
    next(err);
  }
};
