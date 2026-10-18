'use strict';
/* In-memory state. Raw hub objects go in, UI-ready objects come out; changes are emitted as
 *   'device' (device)  'snapshot' ()  'log' (entry)  so the server can push them over SSE. */
const { EventEmitter } = require('events');
const { normalize, normalizeScene, sortDevices, sortName } = require('./model');

class Store extends EventEmitter {
  constructor() {
    super();
    this.raw = new Map();       // id -> raw hub device
    this.pub = new Map();       // id -> normalized device (+ cached json for diffing)
    this.json = new Map();
    this.scenes = []; this.rooms = []; this.hubStatus = null;
    this.rev = 0; this.at = 0; this.structure = '';
    this.log = [];              // activity ring buffer
    this.ready = false;
  }

  bump() { this.rev++; this.at = Date.now(); return this.rev; }

  /* full resync from the hub; emits per-device patches for plain changes, a snapshot if the layout changed */
  load({ devices, scenes, rooms, status }) {
    const seen = new Set(); const changed = [];
    for (const raw of devices) {
      seen.add(raw.id); this.raw.set(raw.id, raw);
      const n = normalize(raw), j = JSON.stringify(n);
      if (this.json.get(raw.id) !== j) { if (this.json.has(raw.id)) changed.push(n); this.json.set(raw.id, j); this.pub.set(raw.id, n); }
    }
    for (const id of [...this.raw.keys()]) if (!seen.has(id)) { this.raw.delete(id); this.pub.delete(id); this.json.delete(id); }
    this.scenes = scenes.map(normalizeScene); this.rooms = rooms; this.hubStatus = status;
    const structure = [...this.pub.keys()].sort().join() + '|' + this.scenes.map(s => s.id + s.name + s.next).join() + '|' + rooms.map(r => r.id + r.name).join();
    const layoutChanged = structure !== this.structure; this.structure = structure;
    const first = !this.ready; this.ready = true; this.bump();
    if (first || layoutChanged) this.emit('snapshot');
    else changed.forEach(n => this.emitDevice(n));
  }

  emitDevice(n, silent) {
    this.bump();
    if (!silent) this.addLog(n);
    this.emit('device', n);
  }

  /* hub websocket event */
  applyEvent(ev) {
    const d = ev.data;
    switch (ev.type) {
      case 'deviceStateChanged': {
        const cur = this.raw.get(d.id); if (!cur) return false;
        const attrs = Object.assign({}, cur.attributes, d.attributes || {});
        const merged = Object.assign({}, cur, d, { attributes: attrs });
        if (!d.capabilities) merged.capabilities = cur.capabilities;
        if (!d.room) merged.room = cur.room;
        return this._set(merged, d.attributes);
      }
      case 'deviceAdded': case 'deviceRemoved': case 'sceneCreated': case 'sceneUpdated': case 'sceneDeleted': case 'sceneTriggered':
        this.emit('needResync', ev.type); return false;
      default: return false;
    }
  }

  /* optimistic local update after a command (the hub's event will confirm or correct it) */
  patchLocal(id, attrs) {
    const cur = this.raw.get(id); if (!cur) return;
    this._set(Object.assign({}, cur, { attributes: Object.assign({}, cur.attributes, attrs) }), attrs, true);
  }

  _set(raw, changedAttrs, silent) {
    this.raw.set(raw.id, raw);
    const n = normalize(raw), j = JSON.stringify(n);
    if (this.json.get(raw.id) === j) return false;
    const before = this.pub.get(raw.id);
    this.json.set(raw.id, j); this.pub.set(raw.id, n);
    this.emitDevice(n, silent || !before);
    return true;
  }

  addLog(n) {
    if (n.type === 'gateway') return;
    let text;
    if (n.type === 'light') text = !n.reachable ? 'unreachable' : n.state.on ? `on · ${n.state.level}%${n.state.temp && n.kind !== 'dim' ? ' · ' + n.state.temp + 'K' : ''}` : 'off';
    else if (n.type === 'blinds') text = n.state.moving ? `${n.state.target > n.state.level ? 'closing' : 'opening'} → ${n.state.target}%` : `at ${n.state.level}%`;
    else text = n.reachable ? 'activity' : 'unreachable';
    const e = { t: Date.now(), id: n.id, name: n.name, room: n.room && n.room.name, type: n.type, text };
    this.log.push(e); if (this.log.length > 300) this.log.shift();
    this.emit('log', e);
  }

  device(id) { return this.pub.get(id) || null; }
  devices() { return [...this.pub.values()]; }

  snapshot() {
    const devices = this.devices().sort(sortDevices);
    const hubDev = devices.find(d => d.type === 'gateway') || null;
    const byRoom = new Map();
    for (const r of this.rooms) byRoom.set(r.id, { id: r.id, name: r.name, icon: r.icon, color: r.color, devices: [] });
    for (const d of devices) {
      if (!d.room || d.type === 'gateway') continue;
      if (!byRoom.has(d.room.id)) byRoom.set(d.room.id, { id: d.room.id, name: d.room.name, icon: d.room.icon, color: d.room.color, devices: [] });
      byRoom.get(d.room.id).devices.push(d.id);
    }
    const rooms = [...byRoom.values()].filter(r => r.devices.length).sort(sortName);
    return { rev: this.rev, at: this.at, rooms, devices: devices.filter(d => d.type !== 'gateway'), scenes: this.scenes, hub: hubDev && Object.assign({}, hubDev.state, { name: hubDev.name, reachable: hubDev.reachable, status: this.hubStatus ? { firmware: this.hubStatus.firmwareVersion, uptime: this.hubStatus.uptimeSecs || null } : null }) };
  }
}

module.exports = { Store };
