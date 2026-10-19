'use strict';
/* Simulated DIRIGERA hub with fictitious rooms, lights, blinds, remotes and scenes.
 * Same interface as Hub, so the whole UI works without hardware (DEMO=1). Commands are applied
 * in memory and echoed back as hub events; blinds move gradually like the real motors. */
const { EventEmitter } = require('events');

const LIGHT = {
  color: { model: 'TRADFRI bulb E27 CWS 806lm', recv: ['isOn', 'lightLevel', 'colorTemperature', 'colorHue', 'colorSaturation', 'customName'] },
  spectrum: { model: 'TRADFRI bulb E27 WS globe 1055lm', recv: ['isOn', 'lightLevel', 'colorTemperature', 'customName'] },
  dim: { model: 'TRADFRI bulb E14 W op/ch 400lm', recv: ['isOn', 'lightLevel', 'customName'] },
};

const ROOMS = [
  { id: 'r-living', name: 'Living Room', icon: 'rooms_sofa', color: 'ikea_green_no_65' },
  { id: 'r-kitchen', name: 'Kitchen', icon: 'rooms_kitchen', color: 'ikea_yellow_no_24' },
  { id: 'r-dining', name: 'Dining Room', icon: 'rooms_dining', color: 'ikea_orange_no_1' },
  { id: 'r-bedroom', name: 'Bedroom', icon: 'rooms_bed', color: 'ikea_blue_no_31' },
  { id: 'r-office', name: 'Office', icon: 'rooms_desk', color: 'ikea_pink_no_8' },
  { id: 'r-hall', name: 'Hallway', icon: 'rooms_door', color: 'ikea_beige_1' },
];

function light(id, room, name, kind, s) {
  const a = { customName: name, model: LIGHT[kind].model, manufacturer: 'IKEA of Sweden', firmwareVersion: '1.0.021',
    isOn: !!s.on, lightLevel: s.level ?? 100 };
  if (kind !== 'dim') Object.assign(a, { colorTemperature: s.temp ?? 2700, colorTemperatureMin: 4000, colorTemperatureMax: 2202, colorMode: 'temperature' });
  if (kind === 'color' && s.hue != null) Object.assign(a, { colorHue: s.hue, colorSaturation: s.sat ?? 0.8, colorMode: 'color' });
  return { id, type: 'light', deviceType: 'light', room: ROOMS.find(r => r.id === room), isReachable: s.reachable !== false,
    attributes: a, capabilities: { canReceive: LIGHT[kind].recv }, remoteLinks: [] };
}

function blind(id, room, name, level) {
  return { id, type: 'blinds', deviceType: 'blinds', room: ROOMS.find(r => r.id === room), isReachable: true,
    attributes: { customName: name, model: 'PRAEKTLYSING cellular blind', manufacturer: 'IKEA of Sweden', firmwareVersion: '24.4.13',
      blindsCurrentLevel: level, blindsTargetLevel: level, blindsState: 'stopped', batteryPercentage: 80 },
    capabilities: { canReceive: ['blindsTargetLevel', 'blindsState', 'customName'] }, remoteLinks: [] };
}

function remote(id, room, name, battery, reachable = true) {
  return { id, type: 'controller', deviceType: 'lightController', room: ROOMS.find(r => r.id === room), isReachable: reachable,
    attributes: { customName: name, model: 'STYRBAR remote control', manufacturer: 'IKEA of Sweden', batteryPercentage: battery, isOn: false },
    capabilities: { canReceive: [] }, remoteLinks: [] };
}

function today(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }

function devices() {
  return [
    { id: 'hub', type: 'gateway', deviceType: 'gateway', isReachable: true,
      attributes: { customName: 'Demo Hub', model: 'DIRIGERA Hub for smart products', firmwareVersion: '2.615.4', nextSunRise: today(7, 12), nextSunSet: today(18, 34), backendConnected: true },
      capabilities: { canReceive: [] } },

    light('l1', 'r-living', 'Ceiling Lamp', 'spectrum', { on: true, level: 80, temp: 2700 }),
    light('l2', 'r-living', 'Floor Lamp', 'color', { on: true, level: 55, hue: 28, sat: 0.75 }),
    light('l3', 'r-living', 'Reading Light', 'spectrum', { on: false, level: 100, temp: 3500 }),
    light('l4', 'r-living', 'TV Backlight', 'color', { on: true, level: 40, hue: 260, sat: 0.9 }),
    blind('b1', 'r-living', 'Window Left', 0),
    blind('b2', 'r-living', 'Window Right', 35),

    light('l5', 'r-kitchen', 'Spots', 'spectrum', { on: true, level: 100, temp: 4000 }),
    light('l6', 'r-kitchen', 'Counter Strip', 'dim', { on: true, level: 65 }),
    light('l7', 'r-kitchen', 'Pendant', 'spectrum', { on: false, level: 70, temp: 2700 }),
    blind('b3', 'r-kitchen', 'Kitchen Blind', 70),

    light('l8', 'r-dining', 'Table Pendant', 'spectrum', { on: true, level: 45, temp: 2200 }),
    light('l9', 'r-dining', 'Cabinet Light', 'dim', { on: false, level: 30 }),

    light('l10', 'r-bedroom', 'Bedside Left', 'color', { on: true, level: 20, hue: 12, sat: 0.6 }),
    light('l11', 'r-bedroom', 'Bedside Right', 'spectrum', { on: false, level: 50, temp: 2200 }),
    light('l12', 'r-bedroom', 'Wardrobe', 'dim', { on: false, level: 100 }),
    blind('b4', 'r-bedroom', 'Bedroom Blind', 100),

    light('l13', 'r-office', 'Desk Lamp', 'spectrum', { on: true, level: 90, temp: 4000 }),
    light('l14', 'r-office', 'Shelf Light', 'color', { on: true, level: 60, hue: 190, sat: 0.7 }),
    blind('b5', 'r-office', 'Office Blind', 50),

    light('l15', 'r-hall', 'Entrance', 'dim', { on: false, level: 100 }),
    light('l16', 'r-hall', 'Garden Lantern', 'dim', { on: false, level: 100, reachable: false }),

    remote('c1', 'r-living', 'Living Room Remote', 86),
    remote('c2', 'r-bedroom', 'Bedroom Remote', 42),
    remote('c3', 'r-office', 'Blind Remote', 12),
    remote('c4', 'r-hall', 'Hallway Dimmer', 0, false),
  ];
}

function scene(id, name, icon, type = 'userScene', time) {
  return { id, type, info: { name, icon }, actions: [{}, {}, {}],
    triggers: time ? [{ type: 'time', trigger: { time, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }, disabled: false, nextTriggerAt: null }] : [] };
}

const SCENES = [
  scene('s1', 'Good Morning', 'scenes_wake_up', 'wakeUpScene', '06:45'),
  scene('s2', 'Focus', 'scenes_book'),
  scene('s3', 'Dinner', 'scenes_cutlery'),
  scene('s4', 'Movie Night', 'scenes_tv'),
  scene('s5', 'Relax', 'scenes_heart'),
  scene('s6', 'Good Night', 'scenes_moon'),
];

/* what each scene does: device id -> attributes */
const SCENE_ACTIONS = {
  s2: { l13: { isOn: true, lightLevel: 100, colorTemperature: 4000 }, l14: { isOn: true, lightLevel: 70 }, b5: { blindsTargetLevel: 30 } },
  s3: { l8: { isOn: true, lightLevel: 60, colorTemperature: 2200 }, l9: { isOn: true, lightLevel: 40 }, l7: { isOn: true, lightLevel: 50 } },
  s4: { l1: { isOn: false }, l3: { isOn: false }, l2: { isOn: true, lightLevel: 25 }, l4: { isOn: true, lightLevel: 60, colorHue: 250, colorSaturation: 1 }, b1: { blindsTargetLevel: 100 }, b2: { blindsTargetLevel: 100 } },
  s5: { l1: { isOn: true, lightLevel: 40, colorTemperature: 2200 }, l2: { isOn: true, lightLevel: 50, colorHue: 30, colorSaturation: 0.7 } },
  s6: Object.fromEntries([...devices().filter(d => d.type === 'light').map(d => [d.id, { isOn: false }]), ...['b1', 'b2', 'b3', 'b4', 'b5'].map(id => [id, { blindsTargetLevel: 100 }])]),
};

class DemoHub extends EventEmitter {
  constructor({ resyncMs = 60000, log = console.log } = {}) {
    super();
    this.ip = 'demo'; this.log = log; this.resyncMs = resyncMs;
    this.wsUp = false; this.stopped = false;
    this.stats = { restCalls: 0, restErrors: 0, wsReconnects: 0, events: 0, lastEventAt: 0, eventTypes: {}, resyncs: 0 };
    this.devs = new Map(devices().map(d => [d.id, d]));
    this.motors = new Map();
  }

  async start() {
    await this.resync();
    this.wsUp = true; this.emit('ws', true);
    this.log('info', 'demo hub: ' + (this.devs.size - 1) + ' fictitious devices');
  }

  stop() { this.stopped = true; for (const t of this.motors.values()) clearInterval(t); }

  async resync() {
    this.stats.resyncs++;
    const all = { devices: [...this.devs.values()].map(d => JSON.parse(JSON.stringify(d))), scenes: SCENES, rooms: ROOMS, status: { firmwareVersion: '2.615.4', uptimeSecs: 86400 * 12 } };
    this.emit('resync', all);
    return all;
  }

  async request(method, path, body) {
    this.stats.restCalls++;
    let m;
    if (method === 'GET' && path === '/devices') return { status: 200, data: [...this.devs.values()] };
    if (method === 'GET' && path === '/scenes') return { status: 200, data: SCENES };
    if (method === 'GET' && path === '/rooms') return { status: 200, data: ROOMS };
    if (method === 'PATCH' && (m = path.match(/^\/devices\/([^/]+)$/))) {
      if (!this.devs.has(m[1])) return { status: 404, data: 'not found' };
      for (const item of body || []) this._apply(m[1], item.attributes || {});
      return { status: 202, data: null };
    }
    if (method === 'POST' && (m = path.match(/^\/scenes\/([^/]+)\/trigger$/))) {
      for (const [id, attrs] of Object.entries(SCENE_ACTIONS[m[1]] || {})) setTimeout(() => this._apply(id, attrs), 100 + Math.random() * 400);
      return { status: 202, data: null };
    }
    return { status: 404, data: 'not available in demo mode' };
  }

  _apply(id, attrs) {
    const d = this.devs.get(id); if (!d || !d.isReachable) return;
    if (d.type === 'blinds' && attrs.blindsTargetLevel != null) {
      d.attributes.blindsTargetLevel = attrs.blindsTargetLevel;
      this._event(id, { blindsTargetLevel: attrs.blindsTargetLevel });
      this._move(d);
      return;
    }
    if ('isOn' in attrs) attrs = { isOn: attrs.isOn };     // like the real hub: other attributes next to isOn are ignored
    Object.assign(d.attributes, attrs);
    if (attrs.colorHue != null) d.attributes.colorMode = 'color';
    else if (attrs.colorTemperature != null) d.attributes.colorMode = 'temperature';
    this._event(id, attrs);
  }

  _move(d) {   // motor: 5 % every 250 ms towards the target
    clearInterval(this.motors.get(d.id));
    const a = d.attributes;
    const t = setInterval(() => {
      const diff = a.blindsTargetLevel - a.blindsCurrentLevel;
      if (diff === 0) { clearInterval(t); this.motors.delete(d.id); a.blindsState = 'stopped'; this._event(d.id, { blindsState: 'stopped' }); return; }
      a.blindsCurrentLevel += Math.sign(diff) * Math.min(5, Math.abs(diff));
      a.blindsState = diff > 0 ? 'down' : 'up';
      this._event(d.id, { blindsCurrentLevel: a.blindsCurrentLevel, blindsState: a.blindsState });
    }, 250);
    this.motors.set(d.id, t);
  }

  _event(id, attributes) {
    this.stats.events++; this.stats.lastEventAt = Date.now();
    this.emit('event', { type: 'deviceStateChanged', data: { id, attributes } });
  }
}

module.exports = { DemoHub };
