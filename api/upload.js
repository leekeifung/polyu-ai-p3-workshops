/* api/upload.js — POST /api/upload
 * Flow: CORS → rate-limit → verify student → size check → sanitize HTML → upload to OneDrive.
 *
 * ┌─────────────────────────── 3-STEP SETUP ───────────────────────────┐
 * │ 1) AZURE: Portal → App registrations → New. Copy Application(client)│
 * │    ID + Directory(tenant) ID. Certificates & secrets → New secret → │
 * │    copy the VALUE. API permissions → Microsoft Graph → APPLICATION  │
 * │    → Files.ReadWrite.All → "Grant admin consent" (PolyU IT admin).  │
 * │ 2) ENV (Vercel → Settings → Environment Variables): AZURE_CLIENT_ID,│
 * │    AZURE_CLIENT_SECRET, AZURE_TENANT_ID, and ONEDRIVE_SHARE_URL      │
 * │    (paste the public folder link) — see .env.example.               │
 * │ 3) DEPLOY: push to GitHub → import to Vercel → done.                │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ PLATFORM LIMIT: Vercel request bodies cap at ~4.5 MB. A 10 MB image as
 *    base64 is ~13 MB and would fail. The frontend auto-resizes images to keep
 *    them small, which covers typical workshop files. For guaranteed 10 MB
 *    support, switch to the resumable upload-session flow (see lib/graph.js →
 *    createUploadSession) where the browser PUTs bytes directly to OneDrive.
 */
const sanitizeHtml = require('sanitize-html');
const { applyCors, rateLimit, getIp } = require('../lib/http');
const { verifyStudent } = require('../lib/students');
const { uploadFileBuffer } = require('../lib/graph');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (spec)

// HTML sanitiser: allows kid-friendly styling (CSS, <style>, SVG) but strips
// <script>, <iframe>, <object>, <link>, and all on* event handlers → blocks XSS.
const SANITIZE = {
  allowedTags: [
    'html', 'head', 'body', 'title', 'style', 'meta',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'hr',
    'b', 'i', 'u', 'strong', 'em', 'small', 'mark', 'sub', 'sup', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'a', 'img', 'figure', 'figcaption', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'button', 'label',
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
    'defs', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol', 'clippath',
    'animate', 'animatetransform', 'animatemotion'
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'width', 'height', 'align', 'title', 'alt', 'lang', 'dir'],
    a: ['href', 'target', 'rel'],
    img: ['src'],
    meta: ['charset', 'name', 'content'],
    svg: ['xmlns', 'viewbox', 'width', 'height', 'fill', 'stroke', 'preserveaspectratio'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'transform', 'opacity'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'transform', 'opacity'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'transform', 'opacity'],
    text: ['x', 'y', 'dx', 'dy', 'font-size', 'font-family', 'fill', 'text-anchor', 'transform', 'opacity'],
    tspan: ['x', 'y', 'dx', 'dy', 'fill'],
    g: ['fill', 'stroke', 'transform', 'opacity'],
    stop: ['offset', 'stop-color', 'stop-opacity'],
    lineargradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientunits'],
    radialgradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientunits'],
    use: ['href', 'x', 'y', 'width', 'height'],
    animate: ['attributename', 'from', 'to', 'dur', 'repeatcount', 'values', 'begin', 'fill'],
    animatetransform: ['attributename', 'type', 'from', 'to', 'dur', 'repeatcount', 'values', 'begin', 'fill'],
    animatemotion: ['path', 'dur', 'repeatcount', 'begin', 'fill']
  },
  allowedSchemes: ['http', 'https', 'data', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  allowVulnerableTags: true // we intentionally permit <style> for CSS art
};

// Replace characters not allowed in OneDrive filenames.
function safeName(str) {
  return String(str).replace(/[\\/:*?"<>|#%]/g, '_').replace(/\s+/g, '_').slice(0, 50);
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return; // handles OPTIONS preflight
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // Rate-limit: max 12 uploads / minute / IP (best-effort, per serverless instance)
  if (!rateLimit(getIp(req), 12)) {
    return res.status(429).json({ success: false, error: '太快了！請等一分鐘再試。Too many uploads — wait a minute.' });
  }

  try {
    const { name, studentId, type, fileName, base64Data, content } = req.body || {};

    if (!name || !studentId) return res.status(400).json({ success: false, error: 'Missing name or studentId' });
    if (!verifyStudent(name, studentId)) return res.status(403).json({ success: false, error: '學生身份驗證失敗 Invalid student credentials' });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `${safeName(studentId)}__${safeName(name)}__${ts}`;

    let buffer, finalName, contentType;

    if (type === 'html') {
      if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ success: false, error: 'Missing HTML content' });
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) return res.status(413).json({ success: false, error: 'HTML too large' });
      const clean = sanitizeHtml(content, SANITIZE);
      buffer = Buffer.from(clean, 'utf8');
      finalName = `${prefix}__art.html`;
      contentType = 'text/html; charset=utf-8';

    } else if (type === 'image') {
      if (!base64Data) return res.status(400).json({ success: false, error: 'Missing image data' });
      const b64 = String(base64Data).replace(/^data:[^;]+;base64,/, '');
      buffer = Buffer.from(b64, 'base64');
      if (buffer.length > MAX_FILE_SIZE) return res.status(413).json({ success: false, error: '檔案超過 10MB File exceeds 10MB' });
      const ext = (fileName && fileName.includes('.'))
        ? fileName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : 'png';
      const baseNoExt = safeName((fileName || 'image').replace(/\.[^.]+$/, ''));
      finalName = `${prefix}__${baseNoExt}.${ext}`;
      contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    } else {
      return res.status(400).json({ success: false, error: 'Invalid type — use "image" or "html"' });
    }

    const item = await uploadFileBuffer(finalName, buffer, contentType);
    return res.status(200).json({
      success: true,
      id: item.id,
      url: item.webUrl || item['@microsoft.graph.downloadUrl'] || null,
      name: item.name
    });

  } catch (e) {
    console.error('[upload] error:', e);
    return res.status(500).json({ success: false, error: 'Upload failed: ' + (e.message || 'unknown') });
  }
};
