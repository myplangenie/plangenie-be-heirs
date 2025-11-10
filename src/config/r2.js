const { S3Client } = require('@aws-sdk/client-s3');

function getR2Client() {
  const endpoint = process.env.R2_ENDPOINT; // e.g., https://<accountid>.r2.cloudflarestorage.com
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 configuration missing: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

module.exports = { getR2Client };

