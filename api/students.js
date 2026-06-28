/* api/students.js — GET /api/students → [{ name }] for the dropdown */
const { applyCors } = require('../lib/http');
const { publicList } = require('../lib/students');

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(200).json(publicList());
};
