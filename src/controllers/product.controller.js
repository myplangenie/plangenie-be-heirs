const Product = require('../models/Product');
const { getWorkspaceFilter, addWorkspaceToDoc } = require('../utils/workspaceQuery');

/**
 * Get all products for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const products = await Product.find({
      ...wsFilter,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

    return res.json({ products });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single product by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const product = await Product.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    return res.json({ product });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new product
 */
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const {
      name,
      description,
      pricing,
      price,
      unitCost,
      monthlyVolume,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Product name is required' });
    }

    const order = await Product.getNextOrder(wsFilter.workspace);

    const productData = addWorkspaceToDoc({
      user: userId,
      name: name.trim(),
      description: description?.trim() || undefined,
      pricing: pricing?.trim() || undefined,
      price: price?.trim() || undefined,
      unitCost: unitCost?.trim() || undefined,
      monthlyVolume: monthlyVolume?.trim() || undefined,
      order,
    }, req);

    const product = await Product.create(productData);

    return res.status(201).json({ product, message: 'Product created' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a product
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const product = await Product.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const {
      name,
      description,
      pricing,
      price,
      unitCost,
      monthlyVolume,
      order,
    } = req.body;

    // Update fields if provided
    if (name !== undefined) product.name = name.trim();
    if (description !== undefined) product.description = description?.trim() || undefined;
    if (pricing !== undefined) product.pricing = pricing?.trim() || undefined;
    if (price !== undefined) product.price = price?.trim() || undefined;
    if (unitCost !== undefined) product.unitCost = unitCost?.trim() || undefined;
    if (monthlyVolume !== undefined) product.monthlyVolume = monthlyVolume?.trim() || undefined;
    if (order !== undefined) product.order = order;

    await product.save();

    return res.json({ product, message: 'Product updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a product (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const product = await Product.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await product.softDelete();

    return res.json({ message: 'Product deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted product
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const product = await Product.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!product) {
      return res.status(404).json({ message: 'Deleted product not found' });
    }

    await product.restore();

    return res.json({ product, message: 'Product restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder products
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { productIds } = req.body;

    if (!Array.isArray(productIds)) {
      return res.status(400).json({ message: 'productIds array is required' });
    }

    // Update order for each product
    const updates = productIds.map((id, index) =>
      Product.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'Products reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Bulk create products (for migration or AI generation)
 */
exports.bulkCreate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required' });
    }

    const startOrder = await Product.getNextOrder(wsFilter.workspace);

    const productDocs = products.map((p, index) =>
      addWorkspaceToDoc({
        user: userId,
        name: (p.name || p.product || '').trim(),
        description: p.description?.trim() || undefined,
        pricing: p.pricing?.trim() || undefined,
        price: p.price?.trim() || undefined,
        unitCost: p.unitCost?.trim() || undefined,
        monthlyVolume: p.monthlyVolume?.trim() || undefined,
        order: startOrder + index,
      }, req)
    ).filter(p => p.name); // Filter out items without name

    const created = await Product.insertMany(productDocs);

    return res.status(201).json({
      products: created,
      count: created.length,
      message: `${created.length} products created`,
    });
  } catch (err) {
    next(err);
  }
};
