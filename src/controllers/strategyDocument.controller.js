const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const StrategyDocument = require('../models/StrategyDocument');
const { getWorkspaceFilter, addWorkspaceToDoc, getWorkspaceId } = require('../utils/workspaceQuery');
const { getR2Client } = require('../config/r2');
const { extractText } = require('../utils/textExtractor');

// Allowed MIME types and their extensions
const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function parseDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = !!m[2];
  const data = m[3];
  try {
    const buf = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { mime, buf };
  } catch (_) {
    return null;
  }
}

/**
 * Extract text from document asynchronously
 * @param {string} documentId - Document ID
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - MIME type
 */
async function extractTextAsync(documentId, buffer, mimeType) {
  try {
    // Mark as processing
    await StrategyDocument.updateOne(
      { _id: documentId },
      { $set: { extractionStatus: 'processing' } }
    );

    // Extract text
    const extractedText = await extractText(buffer, mimeType);

    // Update document with extracted text
    await StrategyDocument.updateOne(
      { _id: documentId },
      {
        $set: {
          extractedText,
          extractionStatus: 'completed',
          extractionError: null,
        },
      }
    );

    console.log(`[TextExtraction] Successfully extracted text from document ${documentId}`);
  } catch (err) {
    console.error(`[TextExtraction] Failed for document ${documentId}:`, err.message);

    // Mark as failed
    await StrategyDocument.updateOne(
      { _id: documentId },
      {
        $set: {
          extractionStatus: 'failed',
          extractionError: err.message,
        },
      }
    );
  }
}

/**
 * Get all strategy documents for the current workspace
 */
exports.list = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);

    const documents = await StrategyDocument.find({
      ...wsFilter,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

    return res.json({ documents });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single strategy document by ID
 */
exports.get = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const document = await StrategyDocument.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    }).lean();

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    return res.json({ document });
  } catch (err) {
    next(err);
  }
};

/**
 * Upload a new strategy document
 */
exports.upload = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);

    const { title, description, category, dataUrl, originalFilename } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    if (!dataUrl) {
      return res.status(400).json({ message: 'File data is required' });
    }

    // Parse the data URL
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return res.status(400).json({ message: 'Invalid file payload' });
    }

    const { mime, buf } = parsed;

    // Validate file type
    if (!ALLOWED_TYPES[mime]) {
      return res.status(400).json({
        message: 'Unsupported file type. Allowed: PDF, DOCX, XLSX, TXT',
        allowedTypes: Object.keys(ALLOWED_TYPES),
      });
    }

    // Validate file size
    if (buf.length > MAX_FILE_SIZE) {
      return res.status(400).json({
        message: 'File too large. Maximum size is 50MB',
        maxSize: MAX_FILE_SIZE,
      });
    }

    // Generate unique key for R2
    const ext = ALLOWED_TYPES[mime];
    const workspaceId = getWorkspaceId(req);
    const timestamp = Date.now();
    const key = `strategy-documents/${workspaceId}/${timestamp}.${ext}`;

    // Upload to R2
    const bucket = process.env.R2_DOCUMENTS_BUCKET || process.env.R2_BUCKET || 'strategy-documents';
    const s3 = getR2Client();
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: mime,
    }));

    // Construct file URL
    const base = (process.env.R2_DOCUMENTS_PUBLIC_BASE_URL || process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
      return res.status(500).json({ message: 'R2 public URL not configured' });
    }
    const fileUrl = `${base}/${key}`;

    // Create document record
    const documentData = addWorkspaceToDoc({
      user: userId,
      title: title.trim(),
      description: description?.trim() || undefined,
      fileUrl,
      fileKey: key,
      fileSize: buf.length,
      mimeType: mime,
      originalFilename: originalFilename?.trim() || undefined,
      category: category || 'other',
      extractionStatus: 'pending',
    }, req);

    const document = await StrategyDocument.create(documentData);

    // Extract text asynchronously (don't block the response)
    extractTextAsync(document._id, buf, mime);

    return res.status(201).json({ document, message: 'Document uploaded successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * Update a strategy document's metadata
 */
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const document = await StrategyDocument.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const { title, description, category, order } = req.body;

    // Update fields if provided
    if (title !== undefined) document.title = title.trim();
    if (description !== undefined) document.description = description?.trim() || undefined;
    if (category !== undefined) document.category = category;
    if (order !== undefined) document.order = order;

    await document.save();

    return res.json({ document, message: 'Document updated' });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a strategy document (soft delete)
 */
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const document = await StrategyDocument.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: false,
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    await document.softDelete();

    return res.json({ message: 'Document deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Restore a soft-deleted document
 */
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const document = await StrategyDocument.findOne({
      _id: id,
      ...wsFilter,
      isDeleted: true,
    });

    if (!document) {
      return res.status(404).json({ message: 'Deleted document not found' });
    }

    await document.restore();

    return res.json({ document, message: 'Document restored' });
  } catch (err) {
    next(err);
  }
};

/**
 * Permanently delete a document and its file from R2
 */
exports.permanentDelete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const wsFilter = getWorkspaceFilter(req);

    const document = await StrategyDocument.findOne({
      _id: id,
      ...wsFilter,
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete from R2
    try {
      const bucket = process.env.R2_DOCUMENTS_BUCKET || process.env.R2_BUCKET || 'strategy-documents';
      const s3 = getR2Client();
      await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: document.fileKey,
      }));
    } catch (r2Err) {
      console.error('Failed to delete file from R2:', r2Err);
      // Continue with DB deletion even if R2 fails
    }

    // Delete from database
    await StrategyDocument.deleteOne({ _id: id });

    return res.json({ message: 'Document permanently deleted', id });
  } catch (err) {
    next(err);
  }
};

/**
 * Reorder documents
 */
exports.reorder = async (req, res, next) => {
  try {
    const wsFilter = getWorkspaceFilter(req);
    const { documentIds } = req.body;

    if (!Array.isArray(documentIds)) {
      return res.status(400).json({ message: 'documentIds array is required' });
    }

    // Update order for each document
    const updates = documentIds.map((id, index) =>
      StrategyDocument.updateOne(
        { _id: id, ...wsFilter, isDeleted: false },
        { $set: { order: index } }
      )
    );

    await Promise.all(updates);

    return res.json({ message: 'Documents reordered' });
  } catch (err) {
    next(err);
  }
};

/**
 * Get strategy document context for AI generation
 * Returns extracted text from all documents in a format suitable for AI prompts
 */
exports.getContext = async (req, res, next) => {
  try {
    const workspaceId = getWorkspaceId(req);

    const context = await StrategyDocument.getContextForWorkspace(workspaceId);

    // Format for AI prompt
    const formattedContext = context.length > 0
      ? context.map(doc => {
          const categoryLabel = {
            'strategy-vision': 'Strategy & Vision',
            'okrs-goals': 'OKRs & Goals',
            'board-decisions': 'Board Decisions',
            'operating-plans': 'Operating Plans',
            'other': 'Other Document',
          }[doc.category] || doc.category;

          return `--- ${categoryLabel}: ${doc.title} ---\n${doc.content}`;
        }).join('\n\n')
      : null;

    return res.json({
      hasContext: context.length > 0,
      documentCount: context.length,
      context: formattedContext,
      documents: context,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get strategy document context as a formatted string for internal use
 * Can be called from other controllers/services
 */
exports.getContextString = async (workspaceId) => {
  const context = await StrategyDocument.getContextForWorkspace(workspaceId);

  if (context.length === 0) return null;

  const categoryLabels = {
    'strategy-vision': 'Strategy & Vision',
    'okrs-goals': 'OKRs & Goals',
    'board-decisions': 'Board Decisions',
    'operating-plans': 'Operating Plans',
    'other': 'Other Document',
  };

  return context.map(doc => {
    const label = categoryLabels[doc.category] || doc.category;
    return `--- ${label}: ${doc.title} ---\n${doc.content}`;
  }).join('\n\n');
};
