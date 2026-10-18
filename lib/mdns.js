'use strict';
/* Tiny mDNS one-shot discovery (zero deps): asks the LAN for _ihsp._tcp (the DIRIGERA hub)
 * and returns the IPv4 addresses that answered. Only used when the configured hub IP stops working. */
const dgram = require('dgram');

function qname(name) {
  return Buffer.concat([...name.split('.').map(l => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
}

function readName(msg, off) {
  const labels = []; let jumped = false, next = off, guard = 0;
  for (;;) {
    if (++guard > 64) throw new Error('name loop');
    const len = msg[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) { const ptr = ((len & 0x3f) << 8) | msg[off + 1]; if (!jumped) next = off + 2; jumped = true; off = ptr; continue; }
    labels.push(msg.toString('utf8', off + 1, off + 1 + len)); off += 1 + len;
  }
  return { name: labels.join('.'), next: jumped ? next : off };
}

function parse(msg, service, found) {
  const qd = msg.readUInt16BE(4), an = msg.readUInt16BE(6) + msg.readUInt16BE(8) + msg.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) { off = readName(msg, off).next + 4; }
  let sawService = false; const ips = [];
  for (let i = 0; i < an; i++) {
    const n = readName(msg, off); off = n.next;
    const type = msg.readUInt16BE(off), rdlen = msg.readUInt16BE(off + 8); off += 10;
    if (type === 12 && n.name.toLowerCase() === service) sawService = true;
    if (type === 1 && rdlen === 4) ips.push([...msg.subarray(off, off + 4)].join('.'));
    off += rdlen;
  }
  if (sawService) ips.forEach(ip => found.add(ip));
}

function discover(service = '_ihsp._tcp.local', timeout = 4000) {
  return new Promise(resolve => {
    const found = new Set(); let done = false;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => { if (done) return; done = true; try { sock.close(); } catch (e) {} resolve([...found]); };
    sock.on('message', m => { try { parse(m, service, found); } catch (e) {} });
    sock.on('error', finish);
    sock.bind(0, () => {
      const header = Buffer.alloc(12); header.writeUInt16BE(1, 4);
      const q = Buffer.concat([qname(service), Buffer.from([0, 12, 0x80, 1])]); // PTR, class IN + unicast-response bit
      sock.send(Buffer.concat([header, q]), 5353, '224.0.0.251', e => { if (e) finish(); });
    });
    setTimeout(finish, timeout);
  });
}

module.exports = { discover };
