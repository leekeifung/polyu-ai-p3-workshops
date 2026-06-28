/* lib/students.js — loads students.json (bundled via require) and verifies IDs */
const students = require('../students.json');

// Public dropdown list = NAMES ONLY (so the ID stays a real secret/check).
function publicList() { return students.map((s) => ({ name: s.name })); }

function verifyStudent(name, studentId) {
  const s = students.find((x) => String(x.id) === String(studentId).trim());
  if (!s) return false;
  if (name && String(s.name).trim() !== String(name).trim()) return false;
  return true;
}

module.exports = { students, publicList, verifyStudent };
