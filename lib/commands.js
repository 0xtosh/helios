'use strict';
/* High-level commands -> hub attribute patches, with per-device coalescing so a dragged
 * slider can't flood the (weak) hub: at most one request in flight per device, newest wins. */

const ALLOWED = new Set(['isOn', 'lightLevel', 'colorTemperature', 'colorHue', 'colorSaturation', 'blindsTargetLevel', 'blindsTargetTilt', 'customName']);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CommandError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* returns the attributes to send for this command (already validated against what the device can do) */
function plan(dev, body) {
  const cmd = String(body.command || '').toLowerCase(), v = body.value, s = dev.state || {};
  const needNum = () => { if (v === undefined || v === null || isNaN(Number(v))) throw new CommandError(`'${cmd}' needs a numeric value`); };
  let a = null;

  if (dev.type === 'blinds') {
    switch (cmd) {
      case 'open': a = { blindsTargetLevel: 0 }; break;
      case 'close': a = { blindsTargetLevel: 100 }; break;
      case 'stop': a = { blindsTargetLevel: clamp(s.level ?? 0, 0, 100) }; break;     // target = where it is now -> motor stops
      case 'toggle': a = { blindsTargetLevel: (s.target ?? s.level ?? 0) >= 50 ? 0 : 100 }; break;
      case 'set': case 'level': needNum(); a = { blindsTargetLevel: clamp(v, 0, 100) }; break;
      case 'tilt': needNum(); a = { blindsTargetTilt: clamp(v, 0, 100) }; break;
    }
  } else if (dev.type === 'light' || dev.type === 'outlet' || dev.type === 'smartplug') {
    switch (cmd) {
      case 'on': a = { isOn: true }; break;
      case 'off': a = { isOn: false }; break;
      case 'toggle': a = { isOn: !s.on }; break;
      case 'set': case 'level': case 'brightness': {
        needNum(); const l = clamp(v, 0, 100);
        a = l === 0 ? { isOn: false } : (dev.kind === 'switch' || dev.type !== 'light' ? { isOn: true } : s.on ? { lightLevel: l } : { isOn: true, lightLevel: l });
        break;
      }
      case 'temp': case 'temperature': {
        needNum(); if (dev.kind !== 'spectrum' && dev.kind !== 'color') throw new CommandError(`${dev.name} is not a white-spectrum bulb`);
        a = { colorTemperature: clamp(v, s.tempMin ?? 2200, s.tempMax ?? 4000) }; break;
      }
      case 'color': {
        if (dev.kind !== 'color') throw new CommandError(`${dev.name} is not a colour bulb`);
        let sat = Number(body.saturation); if (isNaN(sat)) sat = 1; if (sat > 1) sat /= 100;
        a = { colorHue: clamp(body.hue, 0, 360), colorSaturation: Math.max(0, Math.min(1, sat)) }; break;
      }
    }
  }
  if (!a) throw new CommandError(`'${cmd}' is not supported for ${dev.kind || dev.type}`);
  const send = {};
  for (const k of Object.keys(a)) if (ALLOWED.has(k) && dev.writable.includes(k)) send[k] = a[k];
  if (!Object.keys(send).length) throw new CommandError(`${dev.name} cannot do '${cmd}' (nothing writable)`);
  return send;
}

/* the hub accepts but silently ignores lightLevel (and other attributes) sent in the same PATCH as isOn,
 * so isOn always goes in its own request first; switching off drops the rest */
function splitAttrs(attrs) {
  if (!('isOn' in attrs) || Object.keys(attrs).length === 1) return [attrs];
  if (!attrs.isOn) return [{ isOn: false }];
  const rest = Object.assign({}, attrs); delete rest.isOn;
  return [{ isOn: true }, rest];
}

class Sender {
  constructor(hub, store, log) { this.hub = hub; this.store = store; this.log = log; this.lanes = new Map(); }

  send(id, attrs) {
    return new Promise((resolve, reject) => {
      let lane = this.lanes.get(id);
      if (!lane) { lane = { busy: false, pending: null }; this.lanes.set(id, lane); }
      if (lane.busy) {                                     // merge into the waiting request: newest value wins
        if (lane.pending) { Object.assign(lane.pending.attrs, attrs); lane.pending.waiters.push({ resolve, reject }); }
        else lane.pending = { attrs: Object.assign({}, attrs), waiters: [{ resolve, reject }] };
        return;
      }
      this._run(id, lane, { attrs, waiters: [{ resolve, reject }] });
    });
  }

  async _run(id, lane, job) {
    lane.busy = true;
    this.store.patchLocal(id, job.attrs);                  // optimistic: every connected UI updates immediately
    try {
      let r;
      for (const attributes of splitAttrs(job.attrs)) {
        r = await this.hub.request('PATCH', `/devices/${id}`, [{ attributes }]);
        if (r.status >= 300) throw new CommandError(`hub said ${r.status}: ${typeof r.data === 'string' ? r.data.slice(0, 120) : JSON.stringify(r.data)}`, 502);
      }
      job.waiters.forEach(w => w.resolve({ status: r.status, sent: job.attrs }));
    } catch (e) {
      this.log('warn', `command failed for ${id}: ${e.message}`);
      this.hub.resync().catch(() => {});                   // undo the optimistic guess
      job.waiters.forEach(w => w.reject(e.status ? e : new CommandError(e.message, 502)));
    }
    await sleep(90);                                       // breathing room for the zigbee mesh
    lane.busy = false;
    const next = lane.pending; lane.pending = null;
    if (next) this._run(id, lane, next); else this.lanes.delete(id);
  }
}

/* scope helpers for room / all commands */
function pickTargets(store, scope, filter) {
  return store.devices().filter(d => (d.type === 'light' || d.type === 'blinds' || d.type === 'outlet') && d.reachable
    && (scope.roomId ? d.room && d.room.id === scope.roomId : true) && filter(d));
}

const GROUP_COMMANDS = {
  lights_on: { filter: d => d.type === 'light', cmd: 'on' },
  lights_off: { filter: d => d.type === 'light', cmd: 'off' },
  blinds_open: { filter: d => d.type === 'blinds', cmd: 'open' },
  blinds_close: { filter: d => d.type === 'blinds', cmd: 'close' },
  blinds_stop: { filter: d => d.type === 'blinds', cmd: 'stop' },
  blinds_set: { filter: d => d.type === 'blinds', cmd: 'set' },
  lights_set: { filter: d => d.type === 'light' && d.kind !== 'switch', cmd: 'set' },
  everything_off: { filter: d => d.type === 'light' || d.type === 'outlet', cmd: 'off' },   // lights + outlets; blinds stay put
};

module.exports = { plan, Sender, CommandError, pickTargets, GROUP_COMMANDS };
