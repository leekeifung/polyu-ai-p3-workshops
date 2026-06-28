/* api/submissions.js — GET /api/submissions → latest 50 submissions with preview URLs.
 * Preview/download URLs are proxied through our own /api/file endpoint so the admin
 * page can render images & HTML with no Google cross-origin / auth headaches.
 */
const { applyCors } = require('../lib/http');
const { listFolderChildren } = require('../lib/gdrive'); // ← was ../lib/graph

// Filenames are encoded as: studentId__name__timestamp__rest.ext
function parseName(fileName) {
  const p = fileName.split('__');
  return p.length >= 3 ? { studentId: p[0], name: p[1] } : { studentId: '?', name: fileName };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Build an absolute base URL so it works even if the frontend is on a different origin.
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;

    const files = await listFolderChildren(50);

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
        thumbnailUrl: `${base}/api/file?id=${encodeURIComponent(f.id)}`,         // inline (for <img>)
        downloadUrl: `${base}/api/file?id=${encodeURIComponent(f.id)}&dl=1`,     // forces download
        webUrl: `https://drive.google.com/file/d/${f.id}/view`
      };
    });

    return res.status(200).json(out);
  } catch (e) {
    console.error('[submissions] error:', e);
    return res.status(500).json({ error: 'Failed to load submissions: ' + (e.message || '') });
  }
};
