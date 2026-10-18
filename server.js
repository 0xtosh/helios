'use strict';
/* HELIOS EXPRESS — IKEA DIRIGERA control server
 * Zero dependencies. Hub WebSocket in, SSE + REST + static UI out.
 *   env: PORT (3200) BIND (0.0.0.0) HUB_IP TOKEN_FILE (./token.txt) RESYNC_MS (60000) RAW_WRITE (0) DEMO (0) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { Hub } = require('./lib/hub');
const { Store } = require('./lib/store');
const { plan, Sender, CommandError, pickTargets, GROUP_COMMANDS } = require('./lib/commands');

const cfg = {
  port: +process.env.PORT || 3200,
  bind: process.env.BIND || '0.0.0.0',
  hubIp: process.env.HUB_IP || null,                     // null: find the hub via mDNS
  tokenFile: process.env.TOKEN_FILE || path.join(__dirname, 'token.txt'),
  resyncMs: +process.env.RESYNC_MS || 60000,
  rawWrite: process.env.RAW_WRITE === '1',
  publicDir: path.join(__dirname, 'public'),
};
const VERSION = require('./package.json').version;
const log = (lvl, msg) => console.log(`${new Date().toISOString().slice(11, 19)} ${lvl.padEnd(4)} ${msg}`);

let hub;
if (process.env.DEMO === '1') {                           // simulated hub with fictitious devices, no hardware needed
  const { DemoHub } = require('./lib/demo-hub');
  hub = new DemoHub({ resyncMs: cfg.resyncMs, log }); cfg.hubIp = 'demo';
} else {
  let token;
  try { token = fs.readFileSync(cfg.tokenFile, 'utf8').trim(); } catch (e) { console.error('FATAL: cannot read ' + cfg.tokenFile); process.exit(1); }
  hub = new Hub({ ip: cfg.hubIp, token, resyncMs: cfg.resyncMs, log });
}
const store = new Store();
const sender = new Sender(hub, store, log);

hub.on('resync', all => store.load(all));
hub.on('event', ev => store.applyEvent(ev));
hub.on('ws', up => { broadcast('hub', hubState()); log('info', 'event stream ' + (up ? 'up' : 'down')); });
hub.on('ip', ip => { cfg.hubIp = ip; });
let resyncSoon = null;
store.on('needResync', () => { clearTimeout(resyncSoon); resyncSoon = setTimeout(() => hub.resync().catch(() => {}), 400); });

/* ---------- realtime (SSE) ---------- */
const clients = new Set();
function broadcast(event, data) {
  if (!clients.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
const hubState = () => ({ ip: hub.ip, ws: hub.wsUp, synced: store.ready, lastEventAt: hub.stats.lastEventAt, rev: store.rev });
store.on('snapshot', () => broadcast('snapshot', store.snapshot()));
store.on('device', d => broadcast('patch', { rev: store.rev, device: d }));
store.on('log', e => broadcast('log', e));

/* ---------- helpers ---------- */
const send = (res, status, body, headers = {}) => {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, headers));
  res.end(json);
};
const fail = (res, e) => send(res, e.status || 500, { ok: false, error: e.message });
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 65536) { reject(new CommandError('body too large', 413)); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new CommandError('invalid JSON')); } });
  req.on('error', reject);
});
const needReady = () => { if (!store.ready) throw new CommandError('hub not synced yet', 503); };
const getDevice = id => { needReady(); const d = store.device(id); if (!d) throw new CommandError('device not found', 404); return d; };

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/', m = req.method;
  let seg;

  if (m === 'OPTIONS') return send(res, 204, '', { 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });

  if (m === 'GET') {
    if (p === '/health') return send(res, 200, { ok: store.ready && hub.wsUp, version: VERSION, hub: hubState(), devices: store.pub.size, rev: store.rev });
    if (p === '/state') { needReady(); return send(res, 200, Object.assign(store.snapshot(), { server: { version: VERSION, hub: hubState() } })); }
    if (p === '/devices') { needReady(); return send(res, 200, store.devices()); }
    if (p === '/rooms') { needReady(); return send(res, 200, store.snapshot().rooms); }
    if (p === '/scenes') { needReady(); return send(res, 200, store.scenes); }
    if (p === '/log') return send(res, 200, store.log.slice(-Math.min(300, +url.searchParams.get('limit') || 50)).reverse());
    if (p === '/stats') {
      const mu = process.memoryUsage();
      return send(res, 200, { version: VERSION, node: process.version, uptimeSec: Math.round(process.uptime()), rssMB: +(mu.rss / 1048576).toFixed(1), heapMB: +(mu.heapUsed / 1048576).toFixed(1),
        sseClients: clients.size, hub: Object.assign({ ip: hub.ip, ws: hub.wsUp }, hub.stats), rev: store.rev, rawWrite: cfg.rawWrite });
    }
    if ((seg = p.match(/^\/devices\/([^/]+)$/))) return send(res, 200, getDevice(decodeURIComponent(seg[1])));
    if (p === '/events') return sse(req, res);
  }

  if (m === 'POST') {
    if ((seg = p.match(/^\/devices\/([^/]+)\/command$/))) {
      const dev = getDevice(decodeURIComponent(seg[1])), body = await readBody(req);
      const attrs = plan(dev, body), r = await sender.send(dev.id, attrs);
      return send(res, 200, { ok: true, device: dev.id, command: body.command, sent: r.sent });
    }
    if (p === '/batch') {                                   // [{id, command, value, ...}, ...]
      needReady(); const items = await readBody(req);
      if (!Array.isArray(items) || items.length > 40) throw new CommandError('expected an array of up to 40 commands');
      const results = await Promise.all(items.map(async it => { try { const d = getDevice(it.id); await sender.send(d.id, plan(d, it)); return { id: it.id, ok: true }; } catch (e) { return { id: it.id, ok: false, error: e.message }; } }));
      return send(res, 200, { ok: results.every(r => r.ok), results });
    }
    if ((seg = p.match(/^\/rooms\/([^/]+)\/command$/)) || p === '/all/command') {
      needReady(); const body = await readBody(req), g = GROUP_COMMANDS[body.command];
      if (!g) throw new CommandError(`unknown group command; use one of ${Object.keys(GROUP_COMMANDS).join(', ')}`);
      const targets = pickTargets(store, { roomId: seg && decodeURIComponent(seg[1]) }, g.filter);
      const results = await Promise.all(targets.map(async d => { try { await sender.send(d.id, plan(d, { command: g.cmd, value: body.value })); return { id: d.id, ok: true }; } catch (e) { return { id: d.id, ok: false, error: e.message }; } }));
      return send(res, 200, { ok: true, count: results.length, results });
    }
    if ((seg = p.match(/^\/scenes\/([^/]+)\/trigger$/))) return triggerScene(res, decodeURIComponent(seg[1]));
    if (p === '/resync') { await hub.resync(); return send(res, 200, { ok: true, rev: store.rev }); }
  }

  if (m === 'PATCH' && (seg = p.match(/^\/devices\/([^/]+)$/))) {      // raw attributes, restricted to what the device can receive
    const dev = getDevice(decodeURIComponent(seg[1])), body = await readBody(req), attrs = {};
    for (const [k, v] of Object.entries(body.attributes || {})) if (dev.writable.includes(k) && k !== 'customName') attrs[k] = v;
    if (!Object.keys(attrs).length) throw new CommandError('no writable attributes in payload');
    const r = await sender.send(dev.id, attrs);
    return send(res, 200, { ok: true, device: dev.id, sent: r.sent });
  }

  if (p.startsWith('/proxy/')) {                                         // 1:1 passthrough to the hub (writes need RAW_WRITE=1)
    if (m !== 'GET' && !cfg.rawWrite) throw new CommandError('raw writes are disabled (set RAW_WRITE=1)', 403);
    const hubPath = p.slice('/proxy'.length) + url.search;
    if (/^\/auth/.test(hubPath)) throw new CommandError('auth endpoints are not proxied', 403);
    const body = m === 'GET' ? undefined : await readBody(req);
    const r = await hub.request(m, hubPath, body);
    return send(res, r.status, r.data === null ? '' : r.data);
  }

  throw new CommandError('not found', 404);
}

async function triggerScene(res, id) {
  needReady();
  const sc = store.scenes.find(s => s.id === id); if (!sc) throw new CommandError('scene not found', 404);
  const tries = sc.type === 'wakeUpScene'
    ? [[{ trigger: { type: 'timeTrigger', time: new Date().toTimeString().slice(0, 5), timeDuration: 30 } }]]
    : [undefined, [{ trigger: { type: 'turnOn' } }], []];
  let last;
  for (const body of tries) {
    last = await hub.request('POST', `/scenes/${id}/trigger`, body === undefined ? '' : body);
    if (last.status < 300) { log('info', `scene "${sc.name}" triggered`); store.log.push({ t: Date.now(), id, name: sc.name, room: null, type: 'scene', text: 'triggered' }); broadcast('log', store.log[store.log.length - 1]); return send(res, 200, { ok: true, scene: id, status: last.status }); }
  }
  throw new CommandError(`hub refused the scene (${last.status}): ${JSON.stringify(last.data).slice(0, 160)}`, 502);
}

function sse(req, res) {
  if (clients.size >= 30) throw new CommandError('too many live connections', 429);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  if (store.ready) res.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
  res.write(`event: hub\ndata: ${JSON.stringify(hubState())}\n\n`);
  const hb = setInterval(() => { try { res.write(':\n\n'); } catch (e) {} }, 20000);
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
}

/* ---------- static files (gzip cached in memory, ETag revalidation) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const fileCache = new Map();
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(cfg.publicDir, rel));
  if (!file.startsWith(cfg.publicDir)) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const ext = path.extname(file), etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': ext === '.woff2' ? 'public, max-age=604800' : 'no-cache', Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const textual = /\.(html|js|css|svg|json|webmanifest)$/.test(ext), wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    let c = fileCache.get(file);
    const fill = cb => { if (c && c.etag === etag) return cb(c); fs.readFile(file, (e, buf) => { if (e) return send(res, 500, { error: 'read failed' }); c = { etag, raw: buf, gz: textual ? zlib.gzipSync(buf, { level: 9 }) : null }; fileCache.set(file, c); cb(c); }); };
    fill(entry => {
      if (textual && wantsGzip) { headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers); res.end(entry.gz); }
      else { res.writeHead(200, headers); res.end(entry.raw); }
    });
  });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    return serveStatic(req, res, url);
  } catch (e) { if (!res.headersSent) fail(res, e); else res.end(); if (!e.status) log('err', e.stack || e.message); }
});
server.keepAliveTimeout = 65000;

hub.start().then(() => log('info', `hub synced: ${store.pub.size} devices, ${store.scenes.length} scenes`)).catch(e => { log('err', 'hub start: ' + e.message); process.exit(1); });
server.listen(cfg.port, cfg.bind, () => log('info', `Helios Express ${VERSION} on http://${cfg.bind}:${cfg.port} → hub ${cfg.hubIp || '(mDNS discovery)'}`));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { hub.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500); });
