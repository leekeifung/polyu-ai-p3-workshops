/* api/verify.js — POST /api/verify → { valid: boolean } */
const { applyCors, rateLimit, getIp } = require('../lib/http');
const { verifyStudent } = require('../lib/students');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ valid: false, error: 'Method not allowed' });
  if (!rateLimit(getIp(req), 30)) return res.status(429).json({ valid: false, error: 'Too many attempts' });

  const { name, studentId } = req.body || {};
  if (!studentId) return res.status(400).json({ valid: false, error: 'Missing studentId' });
  return res.status(200).json({ valid: verifyStudent(name, studentId) });
};
