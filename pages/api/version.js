export default function handler(req, res) {
  const nextPkg = require('next/package.json');
  res.status(200).json({ nextVersion: nextPkg.version });
}