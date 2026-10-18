'use strict';
/* Pair with a DIRIGERA hub and write an API token (zero deps).
 *   node scripts/get-token.js [hub-ip]
 * Without hub-ip the hub is found via mDNS. Writes ./token.txt, or TOKEN_FILE if set. Press the action button on the hub when asked. */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discover } = require('../lib/mdns');

const agent = new https.Agent({ rejectUnauthorized: false });   // the hub uses a self-signed certificate
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(ip, method, p, body, type) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: ip, port: 8443, path: '/v1' + p, method, agent, timeout: 8000,
      headers: body ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {} }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let data = t; try { data = JSON.parse(t); } catch (e) {} resolve({ status: res.statusCode, data }); });
    });
    r.on('timeout', () => r.destroy(new Error('hub timeout')));
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  let ip = process.argv[2];
  const out = path.resolve(process.env.TOKEN_FILE || path.join(__dirname, '..', 'token.txt'));
  if (!ip) {
    console.log('Looking for the DIRIGERA hub via mDNS ...');
    [ip] = await discover();
    if (!ip) { console.error('No hub found. Pass its IP: node scripts/get-token.js <hub-ip>'); process.exit(1); }
  }
  console.log('Hub: ' + ip);

  const verifier = crypto.randomBytes(96).toString('base64url').slice(0, 128);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = await req(ip, 'GET', `/oauth/authorize?audience=homesmart.local&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`);
  if (a.status !== 200 || !a.data.code) { console.error(`authorize failed (${a.status}): ${JSON.stringify(a.data)}`); process.exit(1); }

  console.log('Press the action button on the bottom of the hub now (waiting up to 90 s) ...');
  const form = new URLSearchParams({ code: a.data.code, name: os.hostname(), grant_type: 'authorization_code', code_verifier: verifier }).toString();
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const t = await req(ip, 'POST', '/oauth/token', form, 'application/x-www-form-urlencoded').catch(() => null);
    if (t && t.status === 200 && t.data.access_token) {
      fs.writeFileSync(out, t.data.access_token + '\n', { mode: 0o600 });
      console.log('Token written to ' + out);
      return;
    }
  }
  console.error('Timed out waiting for the button press.'); process.exit(1);
})().catch(e => { console.error(e.message); process.exit(1); });
