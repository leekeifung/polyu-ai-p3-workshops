/* scripts/get-refresh-token.js — run locally ONCE to obtain GOOGLE_REFRESH_TOKEN.
 * Usage:
 *   1) Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your shell env (or edit below).
 *   2) Add redirect URI http://localhost:5555 to your OAuth client in Google Cloud.
 *   3) node scripts/get-refresh-token.js  → open the printed URL → sign in as the
 *      FOLDER OWNER → approve → the refresh token is printed in the terminal.
 */
const http = require('http');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = 'http://localhost:5555';

if (!CLIENT_ID || !CLIENT_SECRET) { console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.'); process.exit(1); }

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const url = oauth2.generateAuthUrl({
  access_type: 'offline',       // ← required to receive a refresh_token
  prompt: 'consent',            // ← force a fresh refresh_token
  scope: ['https://www.googleapis.com/auth/drive']
});

console.log('\n1) Open this URL and sign in as the folder owner:\n\n' + url + '\n');

http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end('No code.'); return; }
  const { tokens } = await oauth2.getToken(code);
  console.log('\n✅ GOOGLE_REFRESH_TOKEN=\n' + tokens.refresh_token + '\n');
  res.end('Done — check your terminal, you can close this tab.');
  process.exit(0);
}).listen(5555, () => console.log('2) Waiting for the redirect on http://localhost:5555 …'));
