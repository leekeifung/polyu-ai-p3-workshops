/* api/file.js — GET /api/file?id=<fileId>[&dl=1]
 * Proxies a Drive file's bytes through our origin. ?dl=1 forces a download.
 */
const { applyCors } = require('../lib/http');
const { downloadItem } = require('../lib/gdrive'); // ← was ../lib/graph

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query && req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const { buffer, contentType, fileName } = await downloadItem(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (req.query.dl) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    }
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('[file] error:', e);
    return res.status(500).json({ error: 'Download failed' });
  }
};
