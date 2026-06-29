/* api/upload.js — POST /api/upload
 * Flow: CORS → rate-limit → verify student → size check → sanitize HTML → upload to Google Drive.
 *
 * ┌─────────────────────────── 3-STEP SETUP (Google) ──────────────────────┐
 * │ 1) GOOGLE CLOUD: console.cloud.google.com → new project → "APIs &      │
 * │    Services" → Enable "Google Drive API". OAuth consent screen →        │
 * │    External → add the folder owner (kflee@...) as a Test User.          │
 * │ 2) CREDENTIALS: Create OAuth client ID (type "Web application"), add    │
 * │    redirect URI https://developers.google.com/oauthplayground. Then run │
 * │    `npm run get-token` (or use OAuth Playground) to mint a REFRESH      │
 * │    TOKEN. Put CLIENT_ID / SECRET / REFRESH_TOKEN / GDRIVE_FOLDER_ID in  │
 * │    Vercel env vars (see .env.example).                                  │
 * │ 3) DEPLOY: push to GitHub → import to Vercel → done.                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Vercel request bodies cap at ~4.5 MB; the frontend auto-resizes images to
 *    stay well under this. The 10 MB rule below is still enforced.
 */
/* api/upload.js — POST /api/upload
 * Flow: CORS → rate-limit → verify student → size check → sanitize HTML → upload to Google Drive.
 * Each class (3A, 3B … 6D) is routed to its own Drive folder, derived from the student ID.
 */
const sanitizeHtml = require('sanitize-html');
const { applyCors, rateLimit, getIp } = require('../lib/http');
const { verifyStudent } = require('../lib/students');
const { uploadFileBuffer } = require('../lib/gdrive');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (spec)

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
const classOf = (id) => String(id || '').slice(0, 2).toUpperCase();
const folderForClass = (cls) => CLASS_FOLDERS[String(cls || '').toUpperCase()] || process.env.GDRIVE_FOLDER_ID;

// Allows kid-friendly styling/SVG but strips <script>, <iframe>, on* handlers → blocks XSS.
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
  allowVulnerableTags: true
};

function safeName(str) {
  return String(str).replace(/[\\/:*?"<>|#%]/g, '_').replace(/\s+/g, '_').slice(0, 50);
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  if (!rateLimit(getIp(req), 12)) {
    return res.status(429).json({ success: false, error: '太快了！請等一分鐘再試。Too many uploads — wait a minute.' });
  }

  try {
    const { name, studentId, type, fileName, base64Data, content } = req.body || {};

    if (!name || !studentId) return res.status(400).json({ success: false, error: 'Missing name or studentId' });
    if (!verifyStudent(name, studentId)) return res.status(403).json({ success: false, error: '學生身份驗證失敗 Invalid student credentials' });

    // Route to the correct Drive folder based on the (verified) student ID.
    const cls = classOf(studentId);
    const folderId = folderForClass(cls);

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

    const item = await uploadFileBuffer(finalName, buffer, contentType, folderId);
    return res.status(200).json({
      success: true,
      id: item.id,
      url: item.webViewLink || null,
      name: item.name,
      class: cls
    });

  } catch (e) {
    console.error('[upload] error:', e);
    return res.status(500).json({ success: false, error: 'Upload failed: ' + (e.message || 'unknown') });
  }
};
