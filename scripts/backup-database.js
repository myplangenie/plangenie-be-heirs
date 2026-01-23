/**
 * Database Backup Script
 *
 * This script exports all collections from the MongoDB database to JSON files.
 * Run with: node scripts/backup-database.js
 *
 * The backup will be saved to: ./backups/backup_<timestamp>/
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;

async function backupDatabase() {
  if (!MONGO_URI) {
    console.error('ERROR: MONGO_URI is not set in .env file');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI, { autoIndex: false });
  console.log('Connected successfully!\n');

  const db = mongoose.connection.db;

  // Create backup directory with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups', `backup_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`Backup directory: ${backupDir}\n`);

  // Get all collection names
  const collections = await db.listCollections().toArray();
  console.log(`Found ${collections.length} collections to backup:\n`);

  let totalDocuments = 0;

  for (const collectionInfo of collections) {
    const collectionName = collectionInfo.name;
    const collection = db.collection(collectionName);

    // Get all documents
    const documents = await collection.find({}).toArray();
    const count = documents.length;
    totalDocuments += count;

    // Save to JSON file
    const filePath = path.join(backupDir, `${collectionName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(documents, null, 2));

    console.log(`  ✓ ${collectionName}: ${count} documents`);
  }

  // Create a manifest file with backup info
  const manifest = {
    timestamp: new Date().toISOString(),
    database: db.databaseName,
    collections: collections.map(c => c.name),
    totalCollections: collections.length,
    totalDocuments: totalDocuments,
  };
  fs.writeFileSync(
    path.join(backupDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`\n========================================`);
  console.log(`Backup completed successfully!`);
  console.log(`Total: ${collections.length} collections, ${totalDocuments} documents`);
  console.log(`Location: ${backupDir}`);
  console.log(`========================================\n`);

  await mongoose.disconnect();
  process.exit(0);
}

backupDatabase().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
