'use strict';
/* Minimal RFC 6455 WebSocket client over TLS, zero dependencies.
 * Enough for the DIRIGERA event stream: text frames, ping/pong, close, fragmentation. */
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class WSClient extends EventEmitter {
  constructor(url, { headers = {}, insecure = true } = {}) {
    super();
    this.url = new URL(url);
    this.headers = headers;
    this.insecure = insecure;
    this.socket = null;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = false;
    this.lastRx = 0;
  }

  connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const req = https.request({
      host: this.url.hostname, port: this.url.port || 443, path: this.url.pathname + this.url.search,
      method: 'GET', rejectUnauthorized: !this.insecure, timeout: 10000,
      headers: Object.assign({
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
      }, this.headers),
    });
    req.on('upgrade', (res, socket, head) => {
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (res.headers['sec-websocket-accept'] !== accept) { socket.destroy(); return this.emit('error', new Error('bad handshake')); }
      this.socket = socket; this.open = true; this.lastRx = Date.now();
      socket.setNoDelay(true); socket.setKeepAlive(true, 15000);
      socket.on('data', d => this._data(d));
      socket.on('close', () => this._closed());
      socket.on('error', e => this.emit('error', e));
      this.emit('open');
      if (head && head.length) this._data(head);
    });
    req.on('response', res => { this.emit('error', new Error('upgrade refused: HTTP ' + res.statusCode)); res.resume(); this._closed(); });
    req.on('timeout', () => req.destroy(new Error('connect timeout')));
    req.on('error', e => { this.emit('error', e); this._closed(); });
    req.end();
    return this;
  }

  _closed() {
    if (this._done) return; this._done = true; this.open = false;
    this.emit('close');
  }

  _data(chunk) {
    this.lastRx = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = b.subarray(off + len);
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, payload) {
    if (op === 0x9) return this._send(0xA, payload);            // ping -> pong
    if (op === 0xA) return this.emit('pong');
    if (op === 0x8) { this._send(0x8, payload); return this.close(); }
    if (op === 0x1 || op === 0x2) this.frag = { op, parts: [payload] };
    else if (op === 0x0 && this.frag) this.frag.parts.push(payload);
    else return;
    if (fin) {
      const data = Buffer.concat(this.frag.parts); const isText = this.frag.op === 0x1; this.frag = null;
      this.emit('message', isText ? data.toString('utf8') : data);
    }
  }

  _send(op, payload) {
    if (!this.socket || !this.open) return false;
    const len = payload.length, mask = crypto.randomBytes(4);
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, 0x80 | len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
    const body = Buffer.from(payload); for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    this.socket.write(Buffer.concat([head, mask, body]));
    return true;
  }

  send(text) { return this._send(0x1, Buffer.from(text, 'utf8')); }
  ping() { return this._send(0x9, Buffer.alloc(0)); }
  close() { if (this.socket) { try { this.socket.end(); } catch (e) {} setTimeout(() => this.socket && this.socket.destroy(), 500); } }
  terminate() { if (this.socket) this.socket.destroy(); else this._closed(); }
}

module.exports = { WSClient };
