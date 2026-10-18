'use strict';
/* DIRIGERA hub connection: REST over a keep-alive agent + the hub's own WebSocket event stream.
 * Emits:  'resync' ({devices, scenes, rooms, status})  'event' (hub event)  'ws' (bool)  'ip' (string) */
const https = require('https');
const { EventEmitter } = require('events');
const { WSClient } = require('./ws');
const { discover } = require('./mdns');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Hub extends EventEmitter {
  constructor({ ip, token, resyncMs = 60000, log = console.log }) {
    super();
    this.ip = ip; this.token = token; this.resyncMs = resyncMs; this.log = log;
    this.agent = new https.Agent({ keepAlive: true, maxSockets: 3, rejectUnauthorized: false, keepAliveMsecs: 15000 });
    this.ws = null; this.wsUp = false; this.backoff = 1000; this.failures = 0;
    this.stats = { restCalls: 0, restErrors: 0, wsReconnects: 0, events: 0, lastEventAt: 0, eventTypes: {}, resyncs: 0 };
    this.stopped = false;
  }

  /* ---------- REST ---------- */
  request(method, path, body, { timeout = 8000, retry = true } = {}) {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const once = () => new Promise((resolve, reject) => {
      this.stats.restCalls++;
      const req = https.request({
        host: this.ip, port: 8443, path: '/v1' + path, method, agent: this.agent, timeout,
        headers: Object.assign({ Authorization: 'Bearer ' + this.token, Accept: 'application/json' },
          payload != null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8'); let data = text;
          try { data = text ? JSON.parse(text) : null; } catch (e) { /* keep text */ }
          resolve({ status: res.statusCode, data });
        });
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('hub timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      if (payload != null) req.write(payload);
      req.end();
    });
    return once().catch(async e => {
      this.stats.restErrors++;
      if (retry && ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(e.code)) { await sleep(150); return once(); }
      throw e;
    });
  }

  async fetchAll() {
    const [d, s, r, h] = await Promise.all([
      this.request('GET', '/devices'), this.request('GET', '/scenes'), this.request('GET', '/rooms'),
      this.request('GET', '/hub/status').catch(() => ({ data: null })),
    ]);
    if (d.status !== 200 || !Array.isArray(d.data)) throw new Error('devices HTTP ' + d.status);
    return { devices: d.data, scenes: Array.isArray(s.data) ? s.data : [], rooms: Array.isArray(r.data) ? r.data : [], status: h.data };
  }

  async resync() {
    const all = await this.fetchAll();
    this.stats.resyncs++; this.failures = 0;
    this.emit('resync', all);
    return all;
  }

  /* ---------- lifecycle ---------- */
  async start() {
    this.stopped = false;
    if (!this.ip && !(await this._rediscover())) throw new Error('no hub found via mDNS; set HUB_IP');
    try { await this.resync(); } catch (e) { this.log('warn', 'first sync failed: ' + e.message); await this._rediscover(); }
    this._connectWs();
    this._timer = setInterval(() => this._tick(), this.resyncMs);
    this._wd = setInterval(() => this._watchdog(), 10000);
  }

  stop() { this.stopped = true; clearInterval(this._timer); clearInterval(this._wd); if (this.ws) this.ws.terminate(); }

  async _tick() {
    try { await this.resync(); } catch (e) {
      this.failures++; this.log('warn', `resync failed (${this.failures}): ${e.message}`);
      if (this.failures >= 3) await this._rediscover();
    }
  }

  async _rediscover() {
    this.log('info', 'hub unreachable, looking for it via mDNS …');
    const ips = await discover();
    for (const ip of ips) {
      if (ip === this.ip) continue;
      const prev = this.ip; this.ip = ip;
      try { await this.request('GET', '/devices', undefined, { retry: false, timeout: 4000 }); this.log('info', `hub found at ${ip}`); this.emit('ip', ip); this.failures = 0; return true; }
      catch (e) { this.ip = prev; }
    }
    return false;
  }

  /* ---------- websocket event stream ---------- */
  _connectWs() {
    if (this.stopped) return;
    const ws = new WSClient(`wss://${this.ip}:8443/v1`, { headers: { Authorization: 'Bearer ' + this.token } });
    this.ws = ws; let closed = false;
    ws.on('open', () => { this.wsUp = true; this.backoff = 1000; this.log('info', 'hub event stream connected'); this.emit('ws', true); this.resync().catch(() => {}); });
    ws.on('message', m => {
      let ev; try { ev = JSON.parse(m); } catch (e) { return; }
      this.stats.events++; this.stats.lastEventAt = Date.now();
      this.stats.eventTypes[ev.type] = (this.stats.eventTypes[ev.type] || 0) + 1;
      this.emit('event', ev);
    });
    ws.on('error', e => this.log('warn', 'event stream: ' + e.message));
    ws.on('close', () => {
      if (closed) return; closed = true;
      const was = this.wsUp; this.wsUp = false; if (was) this.emit('ws', false);
      if (this.stopped) return;
      this.stats.wsReconnects++;
      const wait = this.backoff; this.backoff = Math.min(this.backoff * 2, 30000);
      setTimeout(() => this._connectWs(), wait);
    });
    ws.connect();
    this._lastPing = Date.now();
  }

  _watchdog() {
    const ws = this.ws; if (!ws || !ws.open) return;
    ws.ping();
    if (Date.now() - ws.lastRx > 50000) { this.log('warn', 'event stream silent for 50 s, reconnecting'); ws.terminate(); }
  }
}

module.exports = { Hub };
