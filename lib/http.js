/* lib/http.js — CORS + simple rate limiting (shared by all API endpoints) */
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

const _hits = new Map(); // NOTE: per-instance only. For multi-instance, use Upstash/Redis.
function rateLimit(ip, max = 12, windowMs = 60000) {
  const now = Date.now();
  const arr = (_hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { _hits.set(ip, arr); return false; }
  arr.push(now); _hits.set(ip, arr); return true;
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { applyCors, rateLimit, getIp };
