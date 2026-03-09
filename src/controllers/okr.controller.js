const OKR = require('../models/OKR');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');
const {
  CANONICAL_METRICS,
  isCanonicalMetricKey,
  computeKrProgress,
  computeOkrProgress,
} = require('../services/okrService');

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

    const raw = await OKR.find(query)
      .sort({ order: 1 })
      .lean();

    // Department-scoped filtering for limited collaborators
    let filtered = raw;
    try {
      const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
      const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];
      if (isLimitedCollab) {
        const deptOkrs = raw.filter((o) => o.okrType === 'department' && allowedDepts.includes(String(o.departmentKey || '')));
        const allowedCoreIds = new Set(deptOkrs.map((d) => String(d.anchorCoreOKR || '')).filter(Boolean));
        const coreOkrs = raw.filter((o) => o.okrType === 'core' && allowedCoreIds.has(String(o._id)));
        filtered = [...coreOkrs, ...deptOkrs];
      }
    } catch (_) {}

    // Attach computed progress and KR progress
    const okrs = filtered.map((o) => ({
      ...o,
      computedProgress: computeOkrProgress(o),
      keyResults: (o.keyResults || []).map((kr) => ({ ...kr, computedProgress: computeKrProgress(kr) })),
    }));

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
    // Enforce department scope for limited collaborators
    try {
      const isLimitedCollab = !!req.user?.viewerId && String(req.user?.accessType || '').toLowerCase() === 'limited';
      if (isLimitedCollab) {
        const allowedDepts = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];
        if (okr.okrType === 'department') {
          if (!allowedDepts.includes(String(okr.departmentKey || ''))) {
            return res.status(404).json({ message: 'OKR not found' });
          }
        } else if (okr.okrType === 'core') {
          const exists = await OKR.exists({
            workspace: wsFilter.workspace,
            isDeleted: false,
            okrType: 'department',
            departmentKey: { $in: allowedDepts },
            anchorCoreOKR: okr._id,
          });
          if (!exists) {
            return res.status(404).json({ message: 'OKR not found' });
          }
        }
      }
    } catch (_) {}
    return res.json({
      okr: {
        ...okr,
        computedProgress: computeOkrProgress(okr),
        keyResults: (okr.keyResults || []).map((kr) => ({ ...kr, computedProgress: computeKrProgress(kr) })),
      },
    });
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

    const { objective, keyResults, notes, timeframe, okrType, departmentKey, derivedFromGoals, anchorCoreOKR, anchorCoreKrId, ownerId, ownerName } = req.body;

    if (!objective || !objective.trim()) {
      return res.status(400).json({ message: 'Objective is required' });
    }

    const order = await OKR.getNextOrder(wsFilter.workspace);

    // Normalize type
    const type = String(okrType || 'core').toLowerCase() === 'department' ? 'department' : 'core';

    // Validate KRs structure
    const inputKrs = Array.isArray(keyResults) ? keyResults : [];
    if (type === 'core' && (inputKrs.length < 2 || inputKrs.length > 4)) {
      return res.status(400).json({ message: 'Core OKRs must have 2 to 4 key results' });
    }

    const processedKRs = inputKrs.map((kr) => {
      const text = typeof kr === 'string' ? kr.trim() : String(kr.text || '').trim();
      const metric = String(kr.metric || '').trim().toLowerCase();
      const unit = kr.unit ? String(kr.unit).trim() : undefined;
      const direction = (kr.direction === 'decrease') ? 'decrease' : 'increase';
      const baseline = Number(kr.baseline ?? 0);
      const target = Number(kr.target ?? 0);
      const current = Number(kr.current ?? baseline);
      const startAt = kr.startAt ? new Date(kr.startAt) : undefined;
      const endAt = kr.endAt ? new Date(kr.endAt) : undefined;
      const linkTag = kr.linkTag || null;
      const canonicalMetric = type === 'core' && isCanonicalMetricKey(metric);

      if (!text) return null;

      if (type === 'core') {
        if (!metric) {
          throw Object.assign(new Error('Core KR metric is required'), { statusCode: 400 });
        }
        if (!startAt || !endAt) {
          throw Object.assign(new Error('Core KR must define startAt and endAt for the OKR cycle'), { statusCode: 400 });
        }
      }

      if (type === 'department') {
        // Departments must not duplicate canonical metrics
        if (metric && isCanonicalMetricKey(metric)) {
          throw Object.assign(new Error('Department KR must not duplicate canonical core metrics'), { statusCode: 400 });
        }
        if (!['driver', 'enablement', 'operational'].includes(String(linkTag || ''))) {
          throw Object.assign(new Error('Department KR must have linkTag: driver | enablement | operational'), { statusCode: 400 });
        }
      }

      return { text, metric, unit, direction, baseline, target, current, startAt, endAt, linkTag, canonicalMetric };
    }).filter(Boolean);

    // Validate derivations/anchors
    const doc = addWorkspaceToDoc({
      user: userId,
      okrType: type,
      departmentKey: type === 'department' ? (departmentKey || undefined) : undefined,
      objective: objective.trim(),
      keyResults: processedKRs,
      notes: notes?.trim() || undefined,
      ownerId: ownerId ? String(ownerId).trim() : undefined,
      ownerName: ownerName ? String(ownerName).trim() : undefined,
      // status is computed by consumers; do not accept manual status
      timeframe: timeframe || '1y',
      order,
    }, req);

    if (type === 'core') {
      const derived = Array.isArray(derivedFromGoals) ? derivedFromGoals.filter(Boolean) : [];
      if (derived.length === 0) {
        return res.status(400).json({ message: 'Core OKR must be derived from at least one 1-year goal' });
      }
      doc.derivedFromGoals = derived;
    } else {
      if (!departmentKey) {
        return res.status(400).json({ message: 'Department OKR must include departmentKey' });
      }
      if (!anchorCoreOKR || !anchorCoreKrId) {
        return res.status(400).json({ message: 'Department OKR must anchor to one Core Key Result' });
      }
      doc.anchorCoreOKR = anchorCoreOKR;
      doc.anchorCoreKrId = anchorCoreKrId;
    }

    const okr = await OKR.create(doc);
    return res.status(201).json({ okr, message: 'OKR created' });
  } catch (err) {
    if (err && err.statusCode) return res.status(err.statusCode).json({ message: err.message });
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

    const { objective, keyResults, notes, timeframe, order, departmentKey, derivedFromGoals, anchorCoreOKR, anchorCoreKrId, ownerId, ownerName } = req.body;

    if (objective !== undefined) okr.objective = objective.trim();
    if (notes !== undefined) okr.notes = notes?.trim() || undefined;
    if (timeframe !== undefined) okr.timeframe = timeframe;
    if (order !== undefined) okr.order = order;
    if (ownerId !== undefined) okr.ownerId = ownerId ? String(ownerId).trim() : undefined;
    if (ownerName !== undefined) okr.ownerName = ownerName ? String(ownerName).trim() : undefined;

    if (okr.okrType === 'department' && typeof departmentKey !== 'undefined') {
      okr.departmentKey = String(departmentKey || '').trim() || okr.departmentKey;
    }
    if (okr.okrType === 'core' && Array.isArray(derivedFromGoals)) {
      if (derivedFromGoals.length === 0) return res.status(400).json({ message: 'Core OKR must be derived from at least one 1-year goal' });
      okr.derivedFromGoals = derivedFromGoals;
    }
    if (okr.okrType === 'department') {
      if (anchorCoreOKR) okr.anchorCoreOKR = anchorCoreOKR;
      if (anchorCoreKrId) okr.anchorCoreKrId = anchorCoreKrId;
      if (!okr.anchorCoreOKR || !okr.anchorCoreKrId) {
        return res.status(400).json({ message: 'Department OKR must anchor to one Core Key Result' });
      }
    }

    if (keyResults !== undefined) {
      const inputKrs = Array.isArray(keyResults) ? keyResults : [];
      if (okr.okrType === 'core' && (inputKrs.length < 2 || inputKrs.length > 4)) {
        return res.status(400).json({ message: 'Core OKRs must have 2 to 4 key results' });
      }
      okr.keyResults = inputKrs.map((kr) => {
        const text = typeof kr === 'string' ? kr.trim() : String(kr.text || '').trim();
        const metric = String(kr.metric || '').trim().toLowerCase();
        const unit = kr.unit ? String(kr.unit).trim() : undefined;
        const direction = (kr.direction === 'decrease') ? 'decrease' : 'increase';
        const baseline = Number(kr.baseline ?? 0);
        const target = Number(kr.target ?? 0);
        const current = Number(kr.current ?? baseline);
        const startAt = kr.startAt ? new Date(kr.startAt) : undefined;
        const endAt = kr.endAt ? new Date(kr.endAt) : undefined;
        const linkTag = kr.linkTag || null;
        const canonicalMetric = okr.okrType === 'core' && isCanonicalMetricKey(metric);

        if (!text) return null;

        if (okr.okrType === 'core') {
          if (!metric) {
            throw Object.assign(new Error('Core KR metric is required'), { statusCode: 400 });
          }
          if (!startAt || !endAt) {
            throw Object.assign(new Error('Core KR must define startAt and endAt for the OKR cycle'), { statusCode: 400 });
          }
        }

        if (okr.okrType === 'department') {
          if (metric && isCanonicalMetricKey(metric)) {
            throw Object.assign(new Error('Department KR must not duplicate canonical core metrics'), { statusCode: 400 });
          }
          if (!['driver', 'enablement', 'operational'].includes(String(linkTag || ''))) {
            throw Object.assign(new Error('Department KR must have linkTag: driver | enablement | operational'), { statusCode: 400 });
          }
        }

        return { text, metric, unit, direction, baseline, target, current, startAt, endAt, linkTag, canonicalMetric };
      }).filter(Boolean);
    }

    await okr.save();

    return res.json({ okr, message: 'OKR updated' });
  } catch (err) {
    if (err && err.statusCode) return res.status(err.statusCode).json({ message: err.message });
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

/**
 * Update metric fields for a specific Key Result
 */
exports.updateKrMetrics = async (req, res, next) => {
  try {
    const { id, krId } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const okr = await OKR.findOne({ _id: id, ...wsFilter, isDeleted: false });
    if (!okr) return res.status(404).json({ message: 'OKR not found' });

    const kr = okr.keyResults.id(krId);
    if (!kr) return res.status(404).json({ message: 'Key Result not found' });

    // Update metric fields only; no manual progress/status
    const { metric, current, baseline, target, unit, direction, startAt, endAt } = req.body;
    if (typeof metric !== 'undefined') kr.metric = String(metric || '').trim().toLowerCase() || kr.metric;
    if (typeof current !== 'undefined') kr.current = Number(current);
    if (typeof baseline !== 'undefined') kr.baseline = Number(baseline);
    if (typeof target !== 'undefined') kr.target = Number(target);
    if (typeof unit !== 'undefined') kr.unit = String(unit || '').trim();
    if (typeof direction !== 'undefined') kr.direction = (direction === 'decrease') ? 'decrease' : 'increase';
    if (typeof startAt !== 'undefined') kr.startAt = startAt ? new Date(startAt) : undefined;
    if (typeof endAt !== 'undefined') kr.endAt = endAt ? new Date(endAt) : undefined;

    await okr.save();

    // Return updated with computed progress fields
    const result = okr.toObject();
    result.computedProgress = computeOkrProgress(result);
    result.keyResults = (result.keyResults || []).map((k) => ({ ...k, computedProgress: computeKrProgress(k) }));
    return res.json({ okr: result });
  } catch (err) {
    next(err);
  }
};
