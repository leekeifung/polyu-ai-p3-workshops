/* lib/graph.js — Microsoft Graph API v1.0 helpers (app-only / client credentials).
 * Uses Node 18+ global fetch (no extra deps). Token + target folder are cached.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';

let _token = null, _tokenExp = 0, _target = null;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    throw new Error('Missing Azure env vars (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET)');
  }
  const body = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const r = await fetch(`https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  if (!r.ok) throw new Error('Token request failed: ' + r.status + ' ' + (await r.text()));
  const data = await r.json();
  _token = data.access_token;
  _tokenExp = Date.now() + data.expires_in * 1000;
  return _token;
}

// Encode a SharePoint/OneDrive sharing URL for the Graph /shares endpoint.
function encodeShareUrl(url) {
  const b64 = Buffer.from(url, 'utf8').toString('base64');
  return 'u!' + b64.replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-');
}

// Resolve a sharing link → { driveId, itemId } of the target folder.
async function resolveShareFolder(shareUrl) {
  const token = await getAccessToken();
  const enc = encodeShareUrl(shareUrl);
  const r = await fetch(`${GRAPH}/shares/${enc}/driveItem?$select=id,name,parentReference`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('Resolve share failed: ' + r.status + ' ' + (await r.text()));
  const item = await r.json();
  return { driveId: item.parentReference && item.parentReference.driveId, itemId: item.id };
}

// Decide the upload target once: explicit IDs win; else resolve the share link.
async function getTargetFolder() {
  if (_target) return _target;
  if (process.env.ONEDRIVE_DRIVE_ID && process.env.ONEDRIVE_FOLDER_ID) {
    _target = { driveId: process.env.ONEDRIVE_DRIVE_ID, itemId: process.env.ONEDRIVE_FOLDER_ID };
  } else if (process.env.ONEDRIVE_SHARE_URL) {
    _target = await resolveShareFolder(process.env.ONEDRIVE_SHARE_URL);
  } else {
    throw new Error('Configure ONEDRIVE_SHARE_URL or ONEDRIVE_DRIVE_ID + ONEDRIVE_FOLDER_ID');
  }
  return _target;
}

// Simple upload (Graph /content supports up to 250 MB; we cap at 10 MB upstream).
async function uploadFileBuffer(fileName, buffer, contentType) {
  const token = await getAccessToken();
  const { driveId, itemId } = await getTargetFolder();
  const url = `${GRAPH}/drives/${driveId}/items/${itemId}:/${encodeURIComponent(fileName)}:/content`
            + `?@microsoft.graph.conflictBehavior=rename`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': contentType || 'application/octet-stream' },
    body: buffer
  });
  if (!r.ok) throw new Error('OneDrive upload failed: ' + r.status + ' ' + (await r.text()));
  return r.json();
}

// List folder children (we sort + slice in submissions.js).
async function listFolderChildren(top = 200) {
  const token = await getAccessToken();
  const { driveId, itemId } = await getTargetFolder();
  const url = `${GRAPH}/drives/${driveId}/items/${itemId}/children?$top=${top}&$expand=thumbnails`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('List children failed: ' + r.status + ' ' + (await r.text()));
  return (await r.json()).value || [];
}

// Download a single item's bytes (used by /api/file for safe HTML preview).
async function downloadItem(itemId) {
  const token = await getAccessToken();
  const { driveId } = await getTargetFolder();
  const r = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!r.ok) throw new Error('Download failed: ' + r.status);
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'application/octet-stream' };
}

/* OPTIONAL — resumable session for files >4.5 MB (browser PUTs bytes directly,
 * bypassing Vercel's body limit). Wire it up in the frontend if you need full 10 MB. */
async function createUploadSession(fileName) {
  const token = await getAccessToken();
  const { driveId, itemId } = await getTargetFolder();
  const url = `${GRAPH}/drives/${driveId}/items/${itemId}:/${encodeURIComponent(fileName)}:/createUploadSession`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: fileName } })
  });
  if (!r.ok) throw new Error('Create upload session failed: ' + r.status + ' ' + (await r.text()));
  return r.json(); // { uploadUrl, expirationDateTime }
}

module.exports = {
  getAccessToken, resolveShareFolder, getTargetFolder,
  uploadFileBuffer, listFolderChildren, downloadItem, createUploadSession
};
