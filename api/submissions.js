/* api/submissions.js — GET /api/submissions → latest 50 submissions with preview URLs */
const { applyCors } = require('../lib/http');
const { listFolderChildren } = require('../lib/graph');

// Filenames are encoded as: studentId__name__timestamp__rest.ext
function parseName(fileName) {
  const p = fileName.split('__');
  return p.length >= 3 ? { studentId: p[0], name: p[1] } : { studentId: '?', name: fileName };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const items = (await listFolderChildren(200)).filter((it) => it.file);
    items.sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));

    const out = items.slice(0, 50).map((it) => {
      const meta = parseName(it.name);
      const isHtml = /\.html?$/i.test(it.name);
      const thumb = it.thumbnails && it.thumbnails[0]
        && (it.thumbnails[0].large || it.thumbnails[0].medium || it.thumbnails[0].small);
      return {
        id: it.id,
        fileName: it.name,
        studentName: meta.name,
        studentId: meta.studentId,
        createdDateTime: it.createdDateTime,
        size: it.size,
        type: isHtml ? 'html' : 'image',
        downloadUrl: it['@microsoft.graph.downloadUrl'] || null,
        thumbnailUrl: thumb ? thumb.url : null,
        webUrl: it.webUrl || null
      };
    });
    return res.status(200).json(out);
  } catch (e) {
    console.error('[submissions] error:', e);
    return res.status(500).json({ error: 'Failed to load submissions: ' + (e.message || '') });
  }
};
