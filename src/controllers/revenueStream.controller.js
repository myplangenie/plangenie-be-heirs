const RevenueStream = require('../models/RevenueStream');
const Workspace = require('../models/Workspace');

/**
 * Get all revenue streams for the current user/workspace
 * GET /api/dashboard/revenue-streams
 */
exports.list = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const filter = { user: userId, isActive: true };
    if (workspaceId) filter.workspace = workspaceId;

    const streams = await RevenueStream.find(filter)
      .sort({ isPrimary: -1, createdAt: -1 })
      .lean()
      .exec();

    return res.json({ items: streams });
  } catch (err) {
    console.error('[revenueStream.list]', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch revenue streams' });
  }
};

/**
 * Get a single revenue stream by ID
 * GET /api/dashboard/revenue-streams/:id
 */
exports.get = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    const stream = await RevenueStream.findOne({
      $or: [{ _id: id }, { rsid: id }],
      user: userId,
    }).lean().exec();

    if (!stream) {
      return res.status(404).json({ message: 'Revenue stream not found' });
    }

    return res.json({ item: stream });
  } catch (err) {
    console.error('[revenueStream.get]', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch revenue stream' });
  }
};

/**
 * Create a new revenue stream
 * POST /api/dashboard/revenue-streams
 */
exports.create = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { name, description, type, inputs, isPrimary } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: 'Name and type are required' });
    }

    const validTypes = [
      'one_off_project',
      'ongoing_retainer',
      'time_based',
      'product_sales',
      'program_cohort',
      'grants_donations',
      'mixed_unsure',
    ];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: 'Invalid stream type' });
    }

    // If setting as primary, unset other primaries
    if (isPrimary) {
      await RevenueStream.updateMany(
        { user: userId, workspace: workspaceId, isPrimary: true },
        { isPrimary: false }
      );
    }

    const stream = await RevenueStream.create({
      user: userId,
      workspace: workspaceId,
      name,
      description: description || '',
      type,
      inputs: inputs || {},
      isPrimary: isPrimary || false,
      isActive: true,
    });

    return res.status(201).json({ item: stream.toObject() });
  } catch (err) {
    console.error('[revenueStream.create]', err?.message || err);
    return res.status(500).json({ message: 'Failed to create revenue stream' });
  }
};

/**
 * Update a revenue stream
 * PATCH /api/dashboard/revenue-streams/:id
 */
exports.update = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;
    const { name, description, type, inputs, isPrimary, isActive } = req.body;

    const stream = await RevenueStream.findOne({
      $or: [{ _id: id }, { rsid: id }],
      user: userId,
    });

    if (!stream) {
      return res.status(404).json({ message: 'Revenue stream not found' });
    }

    // Update fields if provided
    if (name !== undefined) stream.name = name;
    if (description !== undefined) stream.description = description;
    if (type !== undefined) {
      const validTypes = [
        'one_off_project',
        'ongoing_retainer',
        'time_based',
        'product_sales',
        'program_cohort',
        'grants_donations',
        'mixed_unsure',
      ];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: 'Invalid stream type' });
      }
      stream.type = type;
    }
    if (inputs !== undefined) {
      // Merge inputs to preserve existing values
      stream.inputs = { ...stream.inputs.toObject(), ...inputs };
    }
    if (isActive !== undefined) stream.isActive = isActive;

    // Handle primary flag
    if (isPrimary !== undefined) {
      if (isPrimary && !stream.isPrimary) {
        // Unset other primaries
        await RevenueStream.updateMany(
          { user: userId, workspace: stream.workspace, isPrimary: true, _id: { $ne: stream._id } },
          { isPrimary: false }
        );
      }
      stream.isPrimary = isPrimary;
    }

    await stream.save(); // Pre-save hook will recalculate normalized values

    return res.json({ item: stream.toObject() });
  } catch (err) {
    console.error('[revenueStream.update]', err?.message || err);
    return res.status(500).json({ message: 'Failed to update revenue stream' });
  }
};

/**
 * Delete a revenue stream (soft delete - sets isActive to false)
 * DELETE /api/dashboard/revenue-streams/:id
 */
exports.remove = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { id } = req.params;

    const stream = await RevenueStream.findOne({
      $or: [{ _id: id }, { rsid: id }],
      user: userId,
    });

    if (!stream) {
      return res.status(404).json({ message: 'Revenue stream not found' });
    }

    // Soft delete
    stream.isActive = false;
    await stream.save();

    return res.json({ ok: true, message: 'Revenue stream deleted' });
  } catch (err) {
    console.error('[revenueStream.remove]', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete revenue stream' });
  }
};

/**
 * Get aggregate metrics for all revenue streams
 * GET /api/dashboard/revenue-streams/aggregate
 */
exports.aggregate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const aggregate = await RevenueStream.getAggregate(userId, workspaceId);

    return res.json({ aggregate });
  } catch (err) {
    console.error('[revenueStream.aggregate]', err?.message || err);
    return res.status(500).json({ message: 'Failed to calculate aggregate' });
  }
};

/**
 * Bulk create revenue streams (for migration)
 * POST /api/dashboard/revenue-streams/bulk
 */
exports.bulkCreate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const workspaceId = req.workspace?._id || null;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required' });
    }

    const created = [];
    for (const item of items) {
      const stream = new RevenueStream({
        user: userId,
        workspace: workspaceId,
        name: item.name,
        description: item.description || '',
        type: item.type,
        inputs: item.inputs || {},
        isPrimary: item.isPrimary || false,
        isActive: true,
      });
      await stream.save();
      created.push(stream.toObject());
    }

    return res.status(201).json({ items: created });
  } catch (err) {
    console.error('[revenueStream.bulkCreate]', err?.message || err);
    return res.status(500).json({ message: 'Failed to bulk create revenue streams' });
  }
};
