'use strict';
/* HELIOS — UI. Vanilla JS, no framework: one SSE stream, tiles updated in place,
   rooms packed into masonry columns (priority rooms first, out-of-range devices last). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const BASE = new URL('.', location.href);
const pad = n => String(n).padStart(2, '0');
const hhmm = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (ms = 10) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function throttle(fn, ms) {
  let last = 0, t = null, args;
  return (...a) => { args = a; const wait = ms - (Date.now() - last);
    if (wait <= 0) { last = Date.now(); fn(...args); } else if (!t) t = setTimeout(() => { t = null; last = Date.now(); fn(...args); }, wait); };
}

/* ---------- icons ---------- */
const I = (body, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  bulb: I('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  bulbOn: I('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill="currentColor" fill-opacity=".25"/>'),
  bulbOff: I('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/><path d="M3 3l18 18"/>'),
  up: I('<path d="M6 15l6-6 6 6"/><path d="M6 20h12"/>'),
  down: I('<path d="M6 9l6 6 6-6"/><path d="M6 4h12"/>'),
  stop: I('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>'),
  power: I('<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>'),
  moon: I('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>'),
  sunrise: I('<path d="M3 18h18M7 18a5 5 0 0 1 10 0"/><path d="M12 6v3M4.5 10l2 2M19.5 10l-2 2M8 6l1.5 1.5M16 6l-1.5 1.5"/>'),
  sparkle: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'),
  blinds: I('<path d="M4 4h16M6 4v12M18 4v12M4 8h16M4 12h16"/><path d="M12 12v6"/><circle cx="12" cy="19.5" r="1.4"/>'),
  remote: I('<rect x="8" y="2" width="8" height="20" rx="4"/><circle cx="12" cy="8" r="1.6"/><path d="M12 13v.01M12 17v.01"/>'),
  sofa: I('<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z"/><path d="M5 18v2M19 18v2"/>'),
  bed: I('<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>'),
  desk: I('<rect x="3" y="7" width="18" height="3" rx="1"/><path d="M5 10v9M19 10v9M9 10v4h6v-4"/>'),
  door: I('<path d="M6 21V4h12v17M4 21h16"/><circle cx="15" cy="12.5" r=".9" fill="currentColor"/>'),
  table: I('<ellipse cx="12" cy="8" rx="9" ry="2.6"/><path d="M6 10l-1 9M18 10l1 9M12 10.6V19"/>'),
  home: I('<path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
};
const sceneIcon = s => /blind/i.test(s.name) ? ICON.blinds : /moon|dusk|sleep|out/i.test(s.icon + ' ' + s.name) ? ICON.moon : /sun|rise|shine|wake/i.test(s.icon + ' ' + s.name) ? ICON.sunrise : ICON.sparkle;
const ROOM_HUES = [28, 152, 205, 340, 46, 268];
function roomIcon(name) {
  const k = /living|sofa|lounge/i.test(name) ? 'sofa' : /bed|sleep/i.test(name) ? 'bed' : /office|study|desk/i.test(name) ? 'desk' : /hall|entry/i.test(name) ? 'door' : /table|dining|kitchen/i.test(name) ? 'table' : 'home';
  return `<span class="roomicon" style="--h:${ROOM_HUES[hash(name) % ROOM_HUES.length]}">${ICON[k]}</span>`;
}
/* the rooms you use most come first; everything else follows alphabetically */
const PRIORITY = (CFG.priorityRooms || []).map(n => new RegExp(n, 'i'));
const roomRank = r => { const i = PRIORITY.findIndex(re => re.test(r.name)); return i < 0 ? 99 : i; };

/* ---------- colour helpers ---------- */
function kelvin(k) {   // Tanner Helland approximation
  const t = clamp(k, 1000, 12000) / 100; const c = v => clamp(Math.round(v), 0, 255);
  const r = t <= 66 ? 255 : c(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? c(99.4708025861 * Math.log(t) - 161.1195681661) : c(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : c(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return `rgb(${r},${g},${b})`;
}
const hueCss = (h, s = 1, l = 55) => `hsl(${h} ${Math.round(s * 100)}% ${l}%)`;
const lightColor = d => {
  const s = d.state;
  if (d.kind === 'color' && s.mode === 'color' && s.hue != null) return hueCss(s.hue, s.sat ?? 1);
  return kelvin(d.kind === 'spectrum' ? (s.temp || 2700) : 2700);
};
const HUES = [['Red', 0], ['Orange', 24], ['Amber', 42], ['Lime', 88], ['Green', 130], ['Cyan', 180], ['Blue', 220], ['Violet', 272], ['Pink', 322]];

/* ---------- state ---------- */
const S = { devices: new Map(), rooms: [], scenes: [], hub: null, link: { sse: false, ws: false, synced: false }, filter: localStorage.getItem('helios-room') || 'all',
  tiles: new Map(), cards: [], dragging: new Set(), sig: '', cols: 0 };

async function api(path, body, method) {
  const r = await fetch(new URL('api/' + path, BASE), body === undefined && !method ? undefined : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
let toastT;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 4200 : 2200); }
const cmd = (id, body) => api(`devices/${encodeURIComponent(id)}/command`, body).catch(e => toast(e.message, true));

/* ---------- theme / clock ---------- */
function renderTheme() {
  const mode = document.documentElement.dataset.mode, theme = document.documentElement.dataset.theme;
  $('#themeIco').innerHTML = mode === 'auto' ? I('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>') : theme === 'dark' ? ICON.moon : I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>');
  $('#modeLabel').textContent = mode === 'auto' ? `Auto · ${theme}` : theme === 'dark' ? 'Dark' : 'Light';
  $$('.sky').forEach(s => s.className = 'sky ' + (isDay() ? 'day' : 'night'));
}
$('#themeBtn').onclick = () => {
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[themeMode()];
  try { localStorage.setItem('theme-mode', next); } catch (e) {}
  applyTheme(); renderTheme();
};
const isDay = () => (S.hub && S.hub.sunPosition ? S.hub.sunPosition === 'sunUp' : document.documentElement.dataset.theme === 'light');

function tickClock() {
  const n = new Date(), h = n.getHours();
  $('#clock').textContent = hhmm(n);
  const hi = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('#greet').innerHTML = `${hi} · <b>${n.toLocaleDateString('en-GB', { weekday: 'long' })}</b> ${n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
}

/* ---------- tiles ---------- */
const WHITES = d => { const lo = d.state.tempMin, hi = d.state.tempMax, set = new Set([lo, 2700, 3000, 3500, hi].filter(v => v >= lo && v <= hi)); return [...set].sort((a, b) => a - b); };
const whiteName = (k, d) => k === d.state.tempMin ? 'Candle' : k === d.state.tempMax ? 'Cool' : k <= 2800 ? 'Warm' : k <= 3200 ? 'Soft' : 'Neutral';
const deadText = dev => 'Out of range' + (dev.room ? ' · ' + dev.room.name : '');

function lightTile(d) {
  const t = document.createElement('div'); t.className = 'tile light'; t.dataset.id = d.id;
  const spectrum = d.kind === 'spectrum', color = d.kind === 'color', dim = d.kind === 'dim', sw = d.kind === 'switch';
  const canTemp = (spectrum || color) && d.writable.includes('colorTemperature');
  const whites = canTemp ? WHITES(d) : [];
  t.innerHTML = `
    <div class="t-head"><button class="porthole" type="button" aria-label="Toggle ${esc(d.name)}" aria-pressed="false">${ICON.bulb}</button>
      <div class="t-name"><b>${esc(d.name)}</b><span></span></div></div>
    <span class="t-badge" hidden>Unreachable</span>
    <div class="ctl">
      ${sw ? '' : `<div class="row"><span class="lbl">Light</span><input class="tube" type="range" min="1" max="100" step="1" data-k="level" aria-label="Brightness"><span class="val" data-v="level"></span></div>`}
      ${canTemp ? `<div class="row"><span class="lbl">Tone</span><input class="tube grad" type="range" min="${d.state.tempMin}" max="${d.state.tempMax}" step="1" data-k="temp" aria-label="Colour temperature" style="--grad:linear-gradient(90deg,${kelvin(d.state.tempMin)},${kelvin((d.state.tempMin + d.state.tempMax) / 2)},${kelvin(d.state.tempMax)})"><span class="val" data-v="temp"></span></div>
        <div class="dots" data-dots="white">${whites.map(k => `<button class="dot" type="button" data-temp="${k}" style="--c:${kelvin(k)}" title="${whiteName(k, d)} ${k}K" aria-label="${whiteName(k, d)}"></button>`).join('')}</div>` : ''}
      ${color ? `<div class="row"><span class="lbl">Hue</span><input class="tube grad" type="range" min="0" max="360" step="1" data-k="hue" aria-label="Hue" style="--grad:linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#63f,#f3c,#f33)"><span class="val" data-v="hue"></span></div>
        <div class="dots" data-dots="hue">${HUES.map(([n, h]) => `<button class="dot" type="button" data-hue="${h}" style="--c:${hueCss(h)}" title="${n}" aria-label="${n}"></button>`).join('')}</div>` : ''}
      ${dim ? `<div class="dots" data-dots="lvl" style="padding-left:0">${[10, 25, 50, 75, 100].map(v => `<button class="dot num" type="button" data-lvl="${v}" aria-label="${v} percent">${v}</button>`).join('')}</div>` : ''}
    </div>`;
  const q = s => $(s, t), porthole = q('.porthole'), status = q('.t-name span');
  const send = throttle(b => cmd(d.id, b), 140);
  porthole.onclick = () => { buzz(); const cur = S.devices.get(d.id); applyDevice(Object.assign({}, cur, { state: Object.assign({}, cur.state, { on: !cur.state.on }) })); cmd(d.id, { command: 'toggle' }); };
  $$('input.tube', t).forEach(inp => {
    const k = inp.dataset.k, v = $(`[data-v=${k}]`, t);
    const body = val => k === 'level' ? { command: 'set', value: val } : k === 'temp' ? { command: 'temp', value: val } : { command: 'color', hue: val, saturation: 1 };
    inp.addEventListener('input', () => { S.dragging.add(d.id); inp.style.setProperty('--p', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%'); v.textContent = k === 'level' ? inp.value + '%' : k === 'temp' ? inp.value + 'K' : inp.value + '°'; send(body(+inp.value)); });
    inp.addEventListener('change', () => { S.dragging.delete(d.id); cmd(d.id, body(+inp.value)); });
  });
  t.addEventListener('click', e => {
    const b = e.target.closest('.dot'); if (!b) return; buzz();
    if (b.dataset.temp) cmd(d.id, { command: 'temp', value: +b.dataset.temp });
    else if (b.dataset.hue) cmd(d.id, { command: 'color', hue: +b.dataset.hue, saturation: 1 });
    else if (b.dataset.lvl) cmd(d.id, { command: 'set', value: +b.dataset.lvl });
  });
  return {
    el: t,
    update(dev) {
      const s = dev.state, on = s.on && dev.reachable, col = lightColor(dev);
      t.classList.toggle('on', on); t.classList.toggle('dead', !dev.reachable);
      t.style.setProperty('--lc', col); t.style.setProperty('--k', on ? (s.level / 100) : 0);
      porthole.innerHTML = on ? ICON.bulbOn : ICON.bulb; porthole.setAttribute('aria-pressed', on);
      q('.t-badge').hidden = true;
      status.textContent = !dev.reachable ? deadText(dev) : !s.on ? 'Off' : `${s.level}%${dev.kind === 'spectrum' && s.temp ? ' · ' + s.temp + 'K' : dev.kind === 'color' && s.mode === 'color' ? ' · hue ' + s.hue + '°' : ''}`;
      if (S.dragging.has(dev.id)) return;
      $$('input.tube', t).forEach(inp => {
        const k = inp.dataset.k, val = k === 'level' ? s.level : k === 'temp' ? (s.temp ?? s.tempMin) : (s.hue ?? 0);
        inp.value = k === 'level' ? Math.max(1, val) : val; inp.style.setProperty('--p', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%');
        inp.style.setProperty('--fill', col);
        const v = $(`[data-v=${k}]`, t); if (v) v.textContent = k === 'level' ? s.level + '%' : k === 'temp' ? (s.temp ?? '–') + 'K' : (s.hue ?? '–') + '°';
      });
      $$('[data-temp]', t).forEach(b => b.classList.toggle('sel', on && s.temp != null && Math.abs(s.temp - +b.dataset.temp) < 60 && s.mode !== 'color'));
      $$('[data-hue]', t).forEach(b => b.classList.toggle('sel', on && s.mode === 'color' && Math.abs((s.hue ?? -99) - +b.dataset.hue) < 12));
      $$('[data-lvl]', t).forEach(b => b.classList.toggle('sel', on && Math.abs(s.level - +b.dataset.lvl) < 4));
    },
  };
}

function batteryHtml(p) {
  if (p == null) return '';
  return `<span class="bat${p < 20 ? ' low' : ''}" title="Battery ${p}%"><i style="--b:${p / 100}"></i>${p}%</span>`;
}

function blindTile(d) {
  const t = document.createElement('div'); t.className = 'tile blind'; t.dataset.id = d.id;
  t.innerHTML = `
    <div class="t-head" style="justify-content:space-between"><div class="t-name"><b>${esc(d.name)}</b><span></span></div><span data-bat></span></div>
    <div class="win" role="slider" aria-label="Blind position" aria-valuemin="0" aria-valuemax="100"><div class="sky ${isDay() ? 'day' : 'night'}"></div><div class="shade"></div><div class="cass"><b></b><b></b><b></b></div><div class="arrows"></div><span class="win-pct"></span></div>
    <div class="ctl">
      <div class="bbtns"><button class="rbtn" type="button" data-a="open" aria-label="Open" title="Open">${ICON.up}</button><button class="rbtn stop" type="button" data-a="stop" aria-label="Stop" title="Stop">${ICON.stop}</button><button class="rbtn" type="button" data-a="close" aria-label="Close" title="Close">${ICON.down}</button></div>
      <div class="row"><span class="lbl">Closed</span><input class="tube" type="range" min="0" max="100" step="1" aria-label="Closed percent"><span class="val"></span></div>
      <div class="dots" style="padding-left:0">${[[0, 'Open'], [25, '25'], [50, '50'], [75, '75'], [100, 'Shut']].map(([v, l]) => `<button class="dot num" type="button" data-lvl="${v}" aria-label="${l === 'Open' || l === 'Shut' ? l : v + ' percent'}" style="width:auto;min-width:38px;padding:0 9px;border-radius:999px">${l}</button>`).join('')}</div>
    </div>`;
  const q = s => $(s, t), shade = q('.shade'), win = q('.win'), inp = q('input.tube'), val = q('.val'), pct = q('.win-pct'), status = q('.t-name span');
  let last = null, scrub = false;
  const set = lv => cmd(d.id, { command: 'set', value: lv });
  const send = throttle(set, 160);
  t.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'), dot = e.target.closest('[data-lvl]');
    if (a) { buzz(14); cmd(d.id, { command: a.dataset.a }); } else if (dot) { buzz(); set(+dot.dataset.lvl); }
  });
  inp.addEventListener('input', () => { S.dragging.add(d.id); const v = +inp.value; draw(v, true); send(v); });
  inp.addEventListener('change', () => { S.dragging.delete(d.id); set(+inp.value); });
  const fromPointer = e => { const r = win.getBoundingClientRect(); return clamp(Math.round((e.clientY - r.top - 6) / (r.height - 12) * 100), 0, 100); };
  win.addEventListener('pointerdown', e => { scrub = true; win.setPointerCapture(e.pointerId); S.dragging.add(d.id); const v = fromPointer(e); draw(v, true); inp.value = v; });
  win.addEventListener('pointermove', e => { if (!scrub) return; const v = fromPointer(e); draw(v, true); inp.value = v; send(v); });
  const end = e => { if (!scrub) return; scrub = false; S.dragging.delete(d.id); buzz(); set(fromPointer(e)); };
  win.addEventListener('pointerup', end); win.addEventListener('pointercancel', () => { scrub = false; S.dragging.delete(d.id); });

  function draw(level, instant) {                     // level = % closed
    const dur = instant ? .08 : Math.max(.4, Math.abs(level - (last ?? level)) * 0.28);   // about the motor's real travel speed
    shade.style.setProperty('--dur', dur + 's'); shade.style.setProperty('--h', level + '%'); shade.style.setProperty('--hn', level > 6 && level < 100 ? 1 : 0);
    pct.textContent = level === 0 ? 'Open' : level === 100 ? 'Shut' : level + '%'; win.setAttribute('aria-valuenow', level);
    inp.style.setProperty('--p', level + '%'); val.textContent = level + '%'; last = level;
  }
  return {
    el: t,
    update(dev) {
      const s = dev.state, shown = s.moving ? s.target : s.level;
      t.classList.toggle('dead', !dev.reachable);
      t.classList.toggle('moving', !!s.moving); t.classList.toggle('opening', !!s.moving && s.target < s.level); t.classList.toggle('closing', !!s.moving && s.target > s.level);
      q('[data-bat]').innerHTML = batteryHtml(dev.battery);
      status.textContent = !dev.reachable ? deadText(dev) : s.moving ? `${s.target > s.level ? 'Closing' : 'Opening'} → ${s.target}%` : s.level === 0 ? 'Fully open' : s.level === 100 ? 'Fully closed' : `${s.level}% closed`;
      if (S.dragging.has(dev.id)) return;
      draw(shown); inp.value = shown; inp.style.setProperty('--fill', 'var(--accent)');
      $$('[data-lvl]', t).forEach(b => b.classList.toggle('sel', Math.abs(shown - +b.dataset.lvl) < 3));
      q('.sky').className = 'sky ' + (isDay() ? 'day' : 'night');
    },
  };
}

/* ---------- rooms ---------- */
function roomSummary(room, devs, total) {
  const lights = devs.filter(d => d.type === 'light'), blinds = devs.filter(d => d.type === 'blinds');
  const on = lights.filter(d => d.state.on).length, parts = [];
  if (lights.length) parts.push(`${on}/${lights.length} light${lights.length > 1 ? 's' : ''} on`);
  if (blinds.length) { const avg = Math.round(blinds.reduce((a, d) => a + (d.state.moving ? d.state.target : d.state.level), 0) / blinds.length); parts.push(`blinds ${avg === 0 ? 'open' : avg === 100 ? 'shut' : avg + '% shut'}`); }
  if (total > devs.length) parts.push(`${total - devs.length} out of range`);
  return parts.join(' · ');
}

function roomCard(room, devs, total) {
  const hasL = devs.some(d => d.type === 'light'), hasB = devs.some(d => d.type === 'blinds');
  const sec = document.createElement('section'); sec.className = 'card room'; sec.dataset.room = room.id;
  sec.innerHTML = `<div class="room-head">${roomIcon(room.name)}
      <div class="room-title"><h2>${esc(room.name)}</h2><div class="sum"></div></div>
      <div class="quick">
        ${hasL ? `<button class="qbtn" type="button" data-g="lights_on" title="All lights on" aria-label="All lights on">${ICON.bulbOn}<span class="ql">All on</span></button><button class="qbtn" type="button" data-g="lights_off" title="All lights off" aria-label="All lights off">${ICON.bulbOff}<span class="ql">All off</span></button>` : ''}
        ${hasB ? `<button class="qbtn" type="button" data-g="blinds_open" title="Open all blinds" aria-label="Open all blinds">${ICON.up}<span class="ql">Open</span></button><button class="qbtn" type="button" data-g="blinds_close" title="Close all blinds" aria-label="Close all blinds">${ICON.down}<span class="ql">Close</span></button>` : ''}
      </div></div><div class="devs"></div>`;
  const grid = $('.devs', sec);
  devs.forEach(d => { const tile = d.type === 'light' ? lightTile(d) : blindTile(d); S.tiles.set(d.id, tile); grid.appendChild(tile.el); tile.update(d); });
  sec._sum = () => { const live = room.devices.map(id => S.devices.get(id)).filter(x => x && (x.type === 'light' || x.type === 'blinds')); $('.sum', sec).textContent = roomSummary(room, live.filter(x => x.reachable), live.length); };
  sec._sum();
  sec.addEventListener('click', e => {
    const b = e.target.closest('[data-g]'); if (!b) return; buzz(14);
    api(`rooms/${encodeURIComponent(room.id)}/command`, { command: b.dataset.g }).then(() => toast(`${room.name}: ${b.title.toLowerCase()}`)).catch(err => toast(err.message, true));
  });
  return sec;
}

/* build everything: priority rooms first, inactive devices collected into one card at the bottom */
function buildLayout() {
  S.tiles.clear(); S.dragging.clear();
  const rooms = [...S.rooms].sort((a, b) => roomRank(a) - roomRank(b) || a.name.localeCompare(b.name));
  const far = []; S.cards = [];
  rooms.forEach(r => {
    const devs = r.devices.map(id => S.devices.get(id)).filter(d => d && (d.type === 'light' || d.type === 'blinds'));
    const up = devs.filter(d => d.reachable); far.push(...devs.filter(d => !d.reachable));
    if (up.length) S.cards.push(roomCard(r, up, devs.length));
  });
  layoutRooms(); renderFar(far); renderNav();
}

function renderFar(devs) {
  const box = $('#far');
  if (!devs.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = `<div class="far-head"><h2>Out of range</h2><span>${devs.length} device${devs.length > 1 ? 's' : ''} not responding</span></div><div class="devs"></div>`;
  const grid = $('.devs', box);
  devs.forEach(d => { const tile = d.type === 'light' ? lightTile(d) : blindTile(d); S.tiles.set(d.id, tile); grid.appendChild(tile.el); tile.update(d); });
  box.hidden = S.filter !== 'all';
}

/* masonry: each room card goes into the currently shortest column, so the first rooms form the top row */
function layoutRooms() {
  const box = $('#rooms'), w = box.clientWidth || innerWidth, n = w >= 1300 ? 3 : w >= 740 ? 2 : 1;
  S.cards.forEach(c => c.remove());
  box.innerHTML = '';
  const cols = Array.from({ length: n }, () => { const d = document.createElement('div'); d.className = 'mcol'; box.appendChild(d); return d; });
  S.cards.filter(c => S.filter === 'all' || c.dataset.room === S.filter).forEach(c => {
    cols.reduce((a, b) => (a.offsetHeight <= b.offsetHeight ? a : b)).appendChild(c);
  });
  S.cols = n;
}
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { const n = ($('#rooms').clientWidth || innerWidth) >= 1300 ? 3 : ($('#rooms').clientWidth || innerWidth) >= 740 ? 2 : 1; if (n !== S.cols && S.cards.length) layoutRooms(); }, 160); });

function renderNav() {
  const nav = $('#nav'), items = [['all', 'All rooms'], ...S.cards.map(c => [c.dataset.room, $('h2', c).textContent])];
  if (!items.some(([id]) => id === S.filter)) S.filter = 'all';
  nav.innerHTML = items.map(([id, name]) => `<button type="button" data-r="${esc(id)}" class="${S.filter === id ? 'on' : ''}">${esc(name)}</button>`).join('');
}
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('[data-r]'); if (!b) return; S.filter = b.dataset.r; try { localStorage.setItem('helios-room', S.filter); } catch (x) {}
  $$('#nav button').forEach(x => x.classList.toggle('on', x === b)); layoutRooms(); $('#far').hidden = S.filter !== 'all' || !$('#far .devs'); buzz(6);
});

/* ---------- quick controls ---------- */
let qaActions = [];
function renderQuick() {
  const living = S.rooms.find(r => /living/i.test(r.name)); qaActions = [];
  const add = (path, body, msg) => qaActions.push({ path, body, msg }) - 1;
  const grp = (label, btns) => `<div class="qg"><span class="qgl">${esc(label)}</span><div class="qbs">${btns.map(([icon, text, i]) => `<button class="qb" type="button" data-q="${i}">${icon}${text}</button>`).join('')}</div></div>`;
  let html = '';
  if (living) html += grp(`${living.name} lights`, [[ICON.bulbOn, 'On', add(`rooms/${encodeURIComponent(living.id)}/command`, { command: 'lights_on' }, `${living.name} lights on`)], [ICON.bulbOff, 'Off', add(`rooms/${encodeURIComponent(living.id)}/command`, { command: 'lights_off' }, `${living.name} lights off`)]]);
  html += grp('All lights', [[ICON.bulbOn, 'On', add('all/command', { command: 'lights_on' }, 'All lights on')], [ICON.bulbOff, 'Off', add('all/command', { command: 'lights_off' }, 'All lights off')]]);
  html += grp('All blinds', [[ICON.up, 'Open', add('all/command', { command: 'blinds_open' }, 'Opening all blinds')], [ICON.down, 'Close', add('all/command', { command: 'blinds_close' }, 'Closing all blinds')]]);
  html += `<button class="qall" type="button" data-q="${add('all/command', { command: 'everything_off' }, 'Everything is off')}">${ICON.power}Everything off</button>`;
  $('#qa').innerHTML = html;
}
$('#qa').addEventListener('click', async e => {
  const b = e.target.closest('[data-q]'); if (!b) return; const a = qaActions[+b.dataset.q]; if (!a) return;
  buzz(16); b.classList.add('busy');
  try { await api(a.path, a.body); b.classList.add('ok'); toast(a.msg); } catch (err) { toast(err.message, true); }
  b.classList.remove('busy'); setTimeout(() => b.classList.remove('ok'), 1300);
});

function renderScenes() {
  const box = $('#scenes');
  box.innerHTML = S.scenes.map(s => {
    const sched = s.schedule[0]; const off = sched && sched.disabled;
    const sub = !sched ? '' : off ? 'auto off' : `auto ${sched.time || ''}`;
    return `<button class="scene${off ? ' off' : ''}" type="button" data-s="${esc(s.id)}" aria-label="Run ${esc(s.name)}"><span class="orb">${sceneIcon(s)}</span><span class="nm">${esc(s.name)}</span><span class="sub">${esc(sub)}</span></button>`;
  }).join('');
}
$('#scenes').addEventListener('click', async e => {
  const b = e.target.closest('[data-s]'); if (!b || b.classList.contains('firing')) return;
  const sc = S.scenes.find(s => s.id === b.dataset.s);
  if (sc.type === 'wakeUpScene' && !confirm(`"${sc.name}" starts the slow sunrise simulation. Run it now?`)) return;
  buzz(18); b.classList.add('firing');
  try { await api(`scenes/${encodeURIComponent(sc.id)}/trigger`, {}); toast(`${sc.name} started`); } catch (err) { toast(err.message, true); }
  setTimeout(() => b.classList.remove('firing'), 1400);
});

function renderRemotes() {
  const r = [...S.devices.values()].filter(d => d.type === 'controller');
  const low = r.filter(d => (d.battery != null && d.battery < 20) || !d.reachable).length;
  $('#remotesSum').textContent = `${r.length} remotes${low ? ` · ${low} need attention` : ''}`;
  $('#remotes').innerHTML = r.sort((a, b) => (b.reachable - a.reachable) || a.name.localeCompare(b.name)).map(d => `<div class="remote${d.reachable ? '' : ' dead'}"><span style="width:26px;height:26px;color:var(--accent)">${ICON.remote}</span><div><b>${esc(d.name)}</b><span>${esc(d.room ? d.room.name : '')}${d.reachable ? '' : ' · out of range'}</span></div>${batteryHtml(d.battery)}</div>`).join('');
}

/* ---------- applying server state ---------- */
const structureSig = s => s.rooms.map(r => r.id + ':' + r.devices.join(',')).join('|') + '#' + s.devices.map(d => d.id + d.kind + d.name + d.reachable + (d.type === 'light' ? d.state.tempMin + '-' + d.state.tempMax : '')).join(',') + '#' + s.scenes.map(x => x.id + x.name).join(',');

function applySnapshot(s) {
  S.devices = new Map(s.devices.map(d => [d.id, d])); S.rooms = s.rooms; S.scenes = s.scenes; S.hub = s.hub;
  const sig = structureSig(s);
  if (sig !== S.sig) { S.sig = sig; buildLayout(); renderScenes(); renderQuick(); }
  else s.devices.forEach(d => { const t = S.tiles.get(d.id); if (t) t.update(d); });
  refreshHeaders(); renderRemotes(); renderSun(); renderTheme(); renderStatus();
}
function applyDevice(d) {
  const prev = S.devices.get(d.id); S.devices.set(d.id, d);
  if (prev && prev.reachable !== d.reachable && (d.type === 'light' || d.type === 'blinds')) { buildLayout(); }   // moves it between its room and "Out of range"
  else { const t = S.tiles.get(d.id); if (t) t.update(d); }
  if (d.type === 'controller') renderRemotes();
  refreshHeaders();
}
const refreshHeaders = () => S.cards.forEach(c => c._sum && c._sum());

function renderSun() {
  const h = S.hub, box = $('#sun'); if (!h || !h.sunRise) { box.hidden = true; return; }
  const up = h.sunPosition === 'sunUp';
  $('#sunIco').textContent = up ? '☀️' : '🌙';
  $('#sunTxt').textContent = up ? `sets ${hhmm(h.sunSet)}` : `rises ${hhmm(h.sunRise)}`;
  box.hidden = false;
}
function renderStatus() {
  const b = $('#status'), L = S.link; let cls, txt;
  if (!L.sse) { cls = 'sync'; txt = 'Reconnecting'; }
  else if (!L.synced) { cls = 'sync'; txt = 'Syncing'; }
  else if (!L.ws) { cls = 'dead'; txt = 'Hub link lost'; }
  else { cls = 'live'; txt = 'Live'; }
  b.className = 'chip status ' + cls; $('#statusTxt').textContent = txt;
}

/* ---------- activity ticker ---------- */
const logText = e => `${hhmm(e.t)} · ${e.room ? e.room + ' · ' : ''}${e.name} ${e.text}`;
const pushLog = e => { $('#tickerTxt').textContent = logText(e); };

/* ---------- system sheet ---------- */
async function openSheet() {
  const sheet = $('#sheet'), body = $('#sheetBody'); sheet.hidden = false; body.innerHTML = '<div class="boot">Loading…</div>';
  try {
    const [st, lg] = await Promise.all([fetch(new URL('api/stats', BASE)).then(r => r.json()), fetch(new URL('api/log?limit=40', BASE)).then(r => r.json())]);
    const up = s => s > 86400 ? Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h' : s > 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    const kv = [['Version', st.version], ['Uptime', up(st.uptimeSec)], ['Memory', st.rssMB + ' MB'], ['Hub', st.hub.ip], ['Event stream', st.hub.ws ? 'connected' : 'down'], ['Hub events', st.hub.events], ['Hub requests', st.hub.restCalls], ['Reconnects', st.hub.wsReconnects], ['Open screens', st.sseClients], ['Devices', S.devices.size]];
    body.innerHTML = `<div class="kv">${kv.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
      <div style="display:flex;gap:10px;margin-bottom:14px"><button class="chip" id="resync" type="button">⟳ Resync hub</button></div>
      ${lg.length ? lg.map(e => `<div class="logline"><time>${hhmm(e.t)}</time><b>${esc(e.name)}</b><span>${esc(e.room ? e.room + ' · ' : '')}${esc(e.text)}</span></div>`).join('') : '<div class="logline"><span>No activity recorded since startup.</span></div>'}`;
    $('#resync').onclick = () => api('resync', {}).then(() => { toast('Hub resynced'); openSheet(); }).catch(e => toast(e.message, true));
  } catch (e) { body.innerHTML = `<div class="boot">Unavailable: ${esc(e.message)}</div>`; }
}
$('#status').onclick = openSheet;
$('#sheetClose').onclick = () => { $('#sheet').hidden = true; };
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#sheet').hidden = true; });

/* ---------- live connection ---------- */
function connect() {
  const es = new EventSource(new URL('api/events', BASE));
  es.onopen = () => { S.link.sse = true; renderStatus(); };
  es.onerror = () => { S.link.sse = false; renderStatus(); };
  es.addEventListener('snapshot', e => { S.link.synced = true; applySnapshot(JSON.parse(e.data)); });
  es.addEventListener('patch', e => applyDevice(JSON.parse(e.data).device));
  es.addEventListener('hub', e => { const h = JSON.parse(e.data); S.link.ws = h.ws; S.link.synced = h.synced; renderStatus(); });
  es.addEventListener('log', e => pushLog(JSON.parse(e.data)));
}
async function bootstrap() {
  tickClock(); renderTheme(); connect();
  setTimeout(async () => { if (!S.devices.size) { try { applySnapshot(await (await fetch(new URL('api/state', BASE))).json()); } catch (e) { $('#rooms').innerHTML = '<div class="boot">The hub is not answering. Retrying…</div>'; } } }, 3500);
  try { const lg = await (await fetch(new URL('api/log?limit=1', BASE))).json(); if (lg[0]) pushLog(lg[0]); } catch (e) {}
}
setInterval(tickClock, 1000);
setInterval(() => { applyTheme(); renderTheme(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { applyTheme(); renderTheme(); tickClock(); } });
bootstrap();
