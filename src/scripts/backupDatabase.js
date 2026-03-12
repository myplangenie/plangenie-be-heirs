/**
 * MongoDB JSON backup (per-collection .jsonl files)
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." node src/scripts/backupDatabase.js [--out backups/backup-<timestamp>] [--workspace <id>] [--collections users,workspaces]
 *
 * Notes:
 * - Writes one file per collection as Extended JSON (EJSON) lines
 * - If --workspace is provided, filters collections that have a top‑level `workspace` field
 * - Safe to run in production (read‑only)
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out.push(['out', args[++i]]);
    else if (a === '--workspace') out.push(['workspace', args[++i]]);
    else if (a === '--collections') out.push(['collections', args[++i]]);
  }
  return Object.fromEntries(out);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function main() {
  const { out: outDirArg, workspace, collections } = parseArgs();
  // Load env from common locations
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  } catch {}
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: Set MONGO_URI env var to your MongoDB connection string');
    process.exit(1);
  }
  const stamp = nowStamp();
  const outDir = outDirArg || path.join(__dirname, '../../backups', `backup-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  await mongoose.connect(uri, { maxPoolSize: 4 });
  const db = mongoose.connection.db;
  const dbName = db.databaseName;
  console.log(`[backup] Connected to DB: ${dbName}`);

  const filterCollections = collections
    ? new Set(String(collections).split(',').map((s) => s.trim()).filter(Boolean))
    : null;

  const all = await db.listCollections().toArray();
  const names = all
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .filter((n) => (filterCollections ? filterCollections.has(n) : true));

  // Try to get EJSON for proper ObjectId/Date serialization
  let EJSON = null;
  try { EJSON = require('bson').EJSON; } catch {}
  const stringify = (doc) => {
    if (EJSON) return EJSON.stringify(doc, { relaxed: false });
    // Fallback best-effort replacer for ObjectId/Date
    return JSON.stringify(doc, (_k, v) => {
      if (v && typeof v === 'object') {
        if (v._bsontype === 'ObjectID' && typeof v.toString === 'function') return v.toString();
        if (v instanceof Date) return v.toISOString();
      }
      return v;
    });
  };

  console.log(`[backup] Writing to: ${outDir}`);
  for (const name of names) {
    const file = path.join(outDir, `${name}.jsonl`);
    console.log(`[backup] Dumping ${name} -> ${path.relative(process.cwd(), file)}`);
    const wsFilter = workspace ? { workspace: mongoose.Types.ObjectId.isValid(workspace) ? new mongoose.Types.ObjectId(workspace) : workspace } : null;
    const predicate = wsFilter ? wsFilter : {};

    const col = db.collection(name);
    const cursor = col.find(predicate, { batchSize: 500 });
    const ws = fs.createWriteStream(file, { encoding: 'utf8' });
    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      ws.write(stringify(doc) + '\n');
      count++;
    }
    ws.end();
    console.log(`[backup] ${name}: ${count} docs`);
  }

  await mongoose.disconnect();
  console.log('[backup] Done.');
}

main().catch((err) => {
  console.error('[backup] Failed:', err?.message || err);
  process.exit(1);
});
