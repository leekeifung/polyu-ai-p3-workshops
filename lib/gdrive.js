{
  "name": "polyu-ai-p3-workshop",
  "version": "1.0.0",
  "private": true,
  "description": "PolyU AMA Primary 3 AI Workshop upload platform (Google Drive)",
  "scripts": {
    "dev": "vercel dev",
    "start": "vercel dev",
    "get-token": "node scripts/get-refresh-token.js"
  },
  "dependencies": {
    "googleapis": "^144.0.0",
    "sanitize-html": "^2.13.0"
  },
  "engines": {
    "node": ">=18.x"
  }
}
