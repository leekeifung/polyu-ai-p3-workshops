/* lib/gdrive.js — Google Drive API v3 helpers (OAuth2 refresh-token flow).
 *
 * We use the folder OWNER's OAuth2 refresh token so uploaded files are owned by
 * a real user account (with real storage), not a quota-less service account.
 *
 * Required env vars (see .env.example):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GDRIVE_FOLDER_ID
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

let _drive = null;

function getDrive() {
  if (_drive) return _drive;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing Google env vars (CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)');
  }
  // The googleapis client auto-refreshes the short-lived access token for us.
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  _drive = google.drive({ version: 'v3', auth: oauth2 });
  return _drive;
}

function folderId() {
  if (!process.env.GDRIVE_FOLDER_ID) throw new Error('Missing GDRIVE_FOLDER_ID');
  return process.env.GDRIVE_FOLDER_ID;
}

/* Upload a Buffer into the target folder. Returns the created file metadata. */
async function uploadFileBuffer(fileName, buffer, contentType) {
  const drive = getDrive();
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId()] },
    media: { mimeType: contentType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id,name,webViewLink,createdTime,size,mimeType',
    supportsAllDrives: true // harmless for My Drive, needed if you switch to a Shared Drive
  });
  return res.data;
}

/* List the folder's files (newest first). */
async function listFolderChildren(pageSize = 50) {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${folderId()}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,createdTime,size,thumbnailLink)',
    orderBy: 'createdTime desc',
    pageSize,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  return res.data.files || [];
}

/* Download one file's raw bytes (used by /api/file for safe HTML/image preview). */
async function downloadItem(fileId) {
  const drive = getDrive();
  const meta = await drive.files.get({ fileId, fields: 'name,mimeType', supportsAllDrives: true });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  return {
    buffer: Buffer.from(res.data),
    contentType: meta.data.mimeType || 'application/octet-stream',
    fileName: meta.data.name
  };
}

module.exports = { getDrive, uploadFileBuffer, listFolderChildren, downloadItem };
