/* api/submissions.js — GET /api/submissions → latest 50 submissions with preview URLs.
 * Preview/download URLs are proxied through our own /api/file endpoint so the admin
 * page can render images & HTML with no Google cross-origin / auth headaches.
 */
/* api/submissions.js — GET /api/submissions?class=3A → latest 50 submissions for that class.
 * Preview/download URLs are proxied through our own /api/file endpoint.
 */
const { applyCors } = require('../lib/http');
const { listFolderChildren } = require('../lib/gdrive');

/* ── Per-class Google Drive folders (3A uses the original MSP3 folder) ── */
const CLASS_FOLDERS = {
  '3A': '1V2H5XcRbsbtABBIyEQF_9YUCol6YK03I',
  '3B': '12ijDy1oMzXq43-bjDDpmWmJjFNK3W5eQ',
  '3C': '1guldQZrKw48n1lqnIE1r5NvHgiOWbr5n',
  '3D': '1g6sIRZHaLD41rSfYGRkXcVKjzfdUpy8E',
  '4A': '1ap8gChQvw5XhWehBKqEiMQe3Cl72q1qp',
  '4B': '1pKcnZXkZzogG82iuvP8FMiQCwjhSz427',
  '4C': '1JxDDbwHUG_vCvNzWMqOrLcmth38TZQ58',
  '4D': '1u36AWJgZPSXqEM3LRKnfXYU7pwg3Hxys',
  '6A': '1QhL9ebljevGnwUoFA2HcQJMerv3o-mFd',
  '6B': '1tXLsx9sHX0Iu_UKNoY-XTBW28CcXZU2M',
  '6C': '14UOhLi_Z35lr6fng17PAWSP5FX2Aaqpt',
  '6D': '10Jb1AVVVa3IcPwimuW8emgD0DaaBbcz2'
};
const folderForClass = (cls) => CLASS_FOLDERS[String(cls || '').toUpperCase()] || process.env.GDRIVE_FOLDER_ID;

// Filenames are encoded as: studentId__name__timestamp__rest.ext
function parseName(fileName) {
  const p = fileName.split('__');
  return p.length >= 3 ? { studentId: p[0], name: p[1] } : { studentId: '?', name: fileName };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const cls = String((req.query && req.query.class) || '').toUpperCase();
    if (!cls || !CLASS_FOLDERS[cls]) {
      return res.status(400).json({ error: 'Missing or unknown class. Use ?class=3A' });
    }
    const folderId = folderForClass(cls);

    // Build an absolute base URL so it works even if the frontend is on a different origin.
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    const files = await listFolderChildren(50, folderId);

    const out = files.map((f) => {
      const meta = parseName(f.name);
      const isHtml = /\.html?$/i.test(f.name) || f.mimeType === 'text/html';
      return {
        id: f.id,
        fileName: f.name,
        studentName: meta.name,
        studentId: meta.studentId,
        createdDateTime: f.createdTime,
        size: f.size ? Number(f.size) : null,
        type: isHtml ? 'html' : 'image',
        thumbnailUrl: `${base}/api/file?id=${encodeURIComponent(f.id)}`,
        downloadUrl: `${base}/api/file?id=${encodeURIComponent(f.id)}&dl=1`,
        webUrl: `https://drive.google.com/file/d/${f.id}/view`
      };
    });

    return res.status(200).json(out);
  } catch (e) {
    console.error('[submissions] error:', e);
    return res.status(500).json({ error: 'Failed to load submissions: ' + (e.message || '') });
  }
};
