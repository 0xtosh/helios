'use strict';
/* Turns raw DIRIGERA device objects into the compact, UI-ready shape Helios serves.
 * The important part is capability detection: the hub advertises writable fields that a bulb
 * can't really render (e.g. hue/saturation on warm-white bulbs), so we decide the control set
 * from model + capabilities instead of trusting canReceive alone. */

const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

function lightKind(raw) {
  const a = raw.attributes || {}, recv = (raw.capabilities && raw.capabilities.canReceive) || [], model = a.model || '';
  if (recv.includes('colorHue') && /CWS|RGB|colou?r/i.test(model)) return 'color';   // true colour bulb
  if (recv.includes('colorTemperature')) return 'spectrum';                          // white spectrum (WS)
  if (recv.includes('lightLevel')) return 'dim';                                     // dimmable only (W / WW)
  return 'switch';
}

function tempRange(a) {
  const x = num(a.colorTemperatureMin), y = num(a.colorTemperatureMax);   // the hub reports these inverted
  if (x == null || y == null) return [2200, 4000];
  return [Math.min(x, y), Math.max(x, y)];
}

const KIND_LABEL = { color: 'colour light', spectrum: 'white spectrum', dim: 'dimmable light', switch: 'switch', blind: 'blind', remote: 'remote' };

function deviceName(raw, kind) {
  const a = raw.attributes || {};
  if (a.customName && a.customName.trim()) return a.customName.trim();
  const room = raw.room && raw.room.name;
  return room ? `${room} ${raw.type === 'light' ? 'light' : raw.type}` : (a.model || raw.type);
}

function normalize(raw) {
  const a = raw.attributes || {};
  const out = {
    id: raw.id, type: raw.type, deviceType: raw.deviceType,
    name: null, kind: null,
    model: a.model || null, manufacturer: a.manufacturer || null, firmware: a.firmwareVersion || null, serial: a.serialNumber || null,
    room: raw.room ? { id: raw.room.id, name: raw.room.name, icon: raw.room.icon, color: raw.room.color } : null,
    reachable: raw.isReachable !== false, lastSeen: raw.lastSeen || null,
    battery: num(a.batteryPercentage),
    ota: a.otaStatus ? { status: a.otaStatus, state: a.otaState, progress: num(a.otaProgress), policy: a.otaPolicy } : null,
    links: raw.remoteLinks || [],
    writable: (raw.capabilities && raw.capabilities.canReceive) || [],
    state: {},
  };
  switch (raw.type) {
    case 'light': {
      out.kind = lightKind(raw);
      const [lo, hi] = tempRange(a);
      out.state = { on: !!a.isOn, level: num(a.lightLevel) ?? 0, temp: num(a.colorTemperature), tempMin: lo, tempMax: hi,
        hue: num(a.colorHue), sat: num(a.colorSaturation), mode: a.colorMode || null };
      break;
    }
    case 'blinds': {
      out.kind = 'blind';
      const level = num(a.blindsCurrentLevel), target = num(a.blindsTargetLevel);
      const st = a.blindsState || 'stopped';
      out.state = { level: level ?? target ?? 0, target: target ?? level ?? 0, hubState: st, tilt: num(a.blindsTargetTilt),
        moving: st !== 'stopped' && st !== '' ? true : (level != null && target != null && level !== target) };
      break;
    }
    case 'controller':
      out.kind = 'remote';
      out.state = { on: !!a.isOn, level: num(a.lightLevel), blindsState: a.blindsState || null };
      break;
    case 'gateway':
      out.kind = 'hub';
      out.state = { sunRise: a.nextSunRise || null, sunSet: a.nextSunSet || null, sunPosition: a.sunPosition || null,
        backend: a.backendConnected, firmware: a.firmwareVersion || null, lat: a.coordinates && a.coordinates.latitude, lon: a.coordinates && a.coordinates.longitude };
      break;
    case 'outlet':
    case 'smartplug':
      out.kind = 'outlet'; out.state = { on: !!a.isOn };
      break;
    default:
      out.kind = raw.type; out.state = { on: !!a.isOn };
  }
  out.name = deviceName(raw, out.kind);
  out.kindLabel = KIND_LABEL[out.kind] || out.kind;
  return out;
}

function normalizeScene(s) {
  const trig = (s.triggers || []).filter(t => t.type === 'time');
  const next = trig.filter(t => !t.disabled && t.nextTriggerAt).map(t => t.nextTriggerAt).sort()[0] || null;
  return {
    id: s.id, name: ((s.info && s.info.name) || 'Scene').trim(), icon: (s.info && s.info.icon) || '', type: s.type || 'userScene',
    actions: (s.actions || []).length,
    schedule: trig.map(t => ({ time: t.trigger && t.trigger.time, days: t.trigger && t.trigger.days, disabled: !!t.disabled, next: t.nextTriggerAt || null })),
    next, lastTriggered: (s.triggers || []).map(t => t.triggeredAt).filter(Boolean).sort().pop() || null,
  };
}

const sortName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
function sortDevices(a, b) {   // lights first, then blinds (Left before Right), then remotes
  const order = { light: 0, blinds: 1, controller: 2 };
  const d = (order[a.type] ?? 9) - (order[b.type] ?? 9);
  if (d) return d;
  const l = n => (/left/i.test(n) ? 0 : /right/i.test(n) ? 2 : 1);
  return l(a.name) - l(b.name) || sortName(a, b);
}

module.exports = { normalize, normalizeScene, sortDevices, sortName, lightKind, tempRange };
