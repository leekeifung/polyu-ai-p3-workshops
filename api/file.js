/* api/file.js — GET /api/file?id=<itemId>
 * Proxies a file's bytes through our origin so the admin page can render HTML
 * submissions in a sandboxed iframe without cross-origin fetch problems.
 */
const { applyCors } = require('../lib/http');
const { downloadItem } = require('../lib/graph');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const { buffer, contentType } = await downloadItem(id);
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('[file] error:', e);
    return res.status(500).json({ error: 'Download failed' });
  }
};
