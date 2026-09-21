// Dino Run v1.0.0 — touch, UI, local progress and runtime diagnostics.
import { VERSION, WORLDS, createRun, steer, jump, tick, stars } from './engine.js';
import { DinoRenderer } from './renderer.js';
import { readProgress, completeLevel, addCoins, buySkin, selectSkin, SKINS, skinById } from './storage.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'dino-run-progress-v1';
const LOG_KEY = 'dino-run-last-log';
const FINALE_MS = { won: 1700, lost: 1300 };
let progress = readProgress(localStorageGet(SAVE_KEY));
let run, renderer, mode = 'home', lastTime = 0, soundContext, registration, waitingReload = false;
let soundOn = progress.sound, toastUntil = 0, startGesture = null, runFinished = false, dirtyLog = false, finaleUntil = 0, lastRating = 0;
const qaMode = ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('qa');
const session = { version: VERSION, started: new Date().toISOString(), events: [] };
function localStorageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function log(type, detail = {}) {
  session.events.push({ at: new Date().toISOString(), type, ...detail });
  if (session.events.length > 160) session.events.shift();
  dirtyLog = true;
}
function flushLog() {
  if (!dirtyLog) return;
  try { localStorage.setItem(LOG_KEY, JSON.stringify(session)); } catch { /* browser may disallow storage */ }
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    fetch('./api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(session), keepalive: true }).catch(() => {});
  }
  dirtyLog = false;
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); }
  catch (error) { log('storage-unavailable', { message: error.message }); toast('Opslag is niet beschikbaar. Houd deze pagina open.'); }
}
function tone(kind) {
  if (!soundOn) return;
  try {
    soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (soundContext.state === 'suspended') soundContext.resume();
    const notes = kind === 'win' ? [523, 659, 784] : kind === 'eat' ? [392, 587] : [kind === 'hit' ? 135 : kind === 'jump' ? 320 : kind === 'coin' ? 880 : 520];
    notes.forEach((f, index) => {
      const osc = soundContext.createOscillator(), gain = soundContext.createGain();
      osc.connect(gain); gain.connect(soundContext.destination);
      const now = soundContext.currentTime + index * .09;
      osc.type = kind === 'hit' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, now); osc.frequency.exponentialRampToValueAtTime(f * (kind === 'hit' ? .4 : 1.5), now + .12);
      gain.gain.setValueAtTime(.035, now); gain.gain.exponentialRampToValueAtTime(.001, now + .17);
      osc.start(now); osc.stop(now + .18);
    });
  } catch (error) { log('audio-unavailable', { message: error.message }); }
}
function toast(message, kind = '') { $('toast').textContent = message; $('toast').className = kind; $('toast').hidden = false; toastUntil = performance.now() + 1500; }
function flash() { const el = $('flash'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
function setSoundButton() { $('sound').textContent = soundOn ? '♫' : '♪'; $('sound').setAttribute('aria-label', soundOn ? 'Geluid uitzetten' : 'Geluid aanzetten'); $('sound').setAttribute('aria-pressed', String(soundOn)); }
function updateHome() {
  const next = Math.min(100, progress.unlocked), world = WORLDS[Math.floor((next - 1) / 10)];
  $('next-label').textContent = `Level ${next} · ${world.name}`;
  $('next-number').textContent = String(next).padStart(2, '0');
  const done = Object.keys(progress.best).length, total = Object.values(progress.best).reduce((a, b) => a + b, 0);
  $('completed').textContent = `${done} / 100 levels voltooid`;
  $('total-stars').textContent = `★ ${total} / 300`;
  $('home-progress-bar').style.width = `${done}%`;
  $('play').innerHTML = `${done ? 'Verder op avontuur' : 'Start avontuur'} <span>➜</span>`;
  $('bank').textContent = progress.bank;
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
const HINTS = [
  [0, 4, 'Veeg of tik ‹ › om van baan te wisselen'],
  [4, 9, 'Eten en groene poorten maken je groter'],
  [9, 14, 'Spring met ↑ (of veeg omhoog) over boomstammen'],
  [14, 19, 'Groen getal: opeten. Rood getal: ontwijken!']
];
function hintText() {
  if (run.level.number <= 2 && run.time < 19) return HINTS.find(([from, to]) => run.time >= from && run.time < to)?.[2];
  if (run.distance < run.level.length * .8) return run.time < 5 ? 'Verzamel voedsel en word sterker!' : null;
  const short = run.level.bossPower - Math.floor(run.power);
  return short > 0 ? `Nog ${short} kracht nodig voor de eindbaas!` : 'Je bent sterk genoeg voor de eindbaas!';
}
function updateGameUI() {
  $('hud-level').textContent = `LEVEL ${run.level.number} · ${WORLDS[run.level.world].name.toUpperCase()}`;
  $('run-progress').style.width = `${Math.min(100, run.distance / run.level.length * 100)}%`;
  $('coins').textContent = run.coins;
  $('power').textContent = Math.floor(run.power);
  $('boss').textContent = run.level.bossPower;
  $('power-card').classList.toggle('strong', run.power >= run.level.bossPower);
  $('growth').textContent = run.power >= 70 ? 'Eilandenreus' : run.power >= 40 ? 'Superdino' : run.power >= 22 ? 'Jonge jager' : 'Baby-dino';
  $('shield-badge').hidden = !run.shield;
  const hint = mode === 'playing' ? hintText() : null;
  $('game-hint').hidden = !hint;
  if (hint) $('game-hint').textContent = hint;
}
function startLevel(number) {
  if (!Number.isInteger(number) || number < 1 || number > progress.unlocked || number > 100) return;
  closeDialogs(); run = createRun(number); runFinished = false; mode = 'playing';
  renderer.loadLevel(run.level); $('home').hidden = true; $('header').hidden = true; $('hud').hidden = false; $('toast').hidden = true;
  document.body.classList.add('playing'); lastTime = performance.now();
  log('level-start', { level: number, bossPower: run.level.bossPower }); flushLog(); tone('start'); updateGameUI();
}
function home() {
  closeDialogs(); mode = 'home'; run = createRun(Math.min(progress.unlocked,100)); renderer.loadLevel(run.level);
  $('home').hidden = false; $('header').hidden = false; $('hud').hidden = true; $('toast').hidden = true;
  document.body.classList.remove('playing'); updateHome(); flushLog(); activateUpdate();
}
function pause(reason = 'button') {
  if (mode !== 'playing') return;
  mode = 'paused'; $('pause-dialog').showModal(); log('pause', { level: run.level.number, reason }); flushLog();
}
function resume() { if (mode !== 'paused') return; closeDialogs(); mode = 'playing'; lastTime = performance.now(); log('resume'); }
// The result is stored at once; the dialog waits until the boss finale has played.
function finish() {
  if (runFinished) return;
  runFinished = true; mode = 'finale'; const won = run.status === 'won';
  lastRating = won ? stars(run) : 0;
  if (won) progress = completeLevel(progress, run.level.number, lastRating);
  progress = addCoins(progress, run.coins); save();
  finaleUntil = performance.now() + FINALE_MS[won ? 'won' : 'lost'];
  $('toast').hidden = true; $('game-hint').hidden = true;
  tone(won ? 'win' : 'hit');
  log(won ? 'level-won' : 'level-lost', { level: run.level.number, stars: lastRating, power: run.power, boss: run.level.bossPower, coins: run.coins, hits: run.hits, seconds: Math.round(run.time) }); flushLog();
}
function showResult() {
  mode = 'result'; const won = run.status === 'won', rating = lastRating, last = run.level.number === 100;
  $('result-symbol').textContent = won ? '✦' : '↻';
  $('result-eyebrow').textContent = won ? `LEVEL ${run.level.number} VOLTOOID` : 'DE EINDBAAS WAS NOG TE STERK';
  $('result-title').textContent = won ? last ? 'Koning van de eilanden!' : rating === 3 ? 'Perfecte run!' : 'Eindbaas verslagen!' : 'Nog een avontuur?';
  $('result-stars').textContent = won ? '★'.repeat(rating) + '☆'.repeat(3 - rating) : '♡';
  $('result-power').textContent = Math.floor(run.power);
  $('result-boss').textContent = run.level.bossPower;
  $('result-coins').textContent = `+${run.coins} munten · pot ${progress.bank}`;
  const short = run.level.bossPower - Math.floor(run.power);
  $('result-detail').textContent = won
    ? last ? 'Alle 100 levels gehaald! Speel ze opnieuw voor drie sterren.' : rating === 3 ? 'Geen enkele botsing. Het volgende eiland ligt open.' : 'Drie sterren? Haal de finish zonder botsingen.'
    : `Nog ${short} kracht nodig. Eet meer, kies groene poorten en ontwijk botsingen: die maken je kleiner.`;
  $('next-level').hidden = !won || last;
  $('retry').className = won ? 'secondary' : 'primary';
  $('result-dialog').showModal();
}
function levelMenu() {
  const grid = $('level-grid'); grid.replaceChildren();
  WORLDS.forEach((world, wi) => {
    const title = document.createElement('h3'); title.className = 'world-title';
    const dot = document.createElement('i'); dot.style.background = world.accent; title.append(dot, document.createTextNode(`${String(wi + 1).padStart(2,'0')} · ${world.name}`)); grid.append(title);
    const row = document.createElement('div'); row.className = 'world-levels';
    for (let i = wi * 10 + 1; i <= wi * 10 + 10; i++) {
      const button = document.createElement('button'); button.className = 'level-button' + (i === progress.unlocked ? ' current' : '');
      button.disabled = i > progress.unlocked; button.setAttribute('aria-label', `Level ${i}${button.disabled ? ', vergrendeld' : ''}`);
      button.append(document.createTextNode(String(i))); const status = document.createElement('small');
      status.textContent = progress.best[i] ? '★'.repeat(progress.best[i]) : button.disabled ? 'SLOT' : 'SPEEL'; button.append(status);
      button.onclick = () => startLevel(i); row.append(button);
    } grid.append(row);
  }); $('level-dialog').showModal();
}
const hex = value => '#' + value.toString(16).padStart(6, '0');
function shopMenu() {
  $('shop-bank').textContent = progress.bank;
  const grid = $('shop-grid'); grid.replaceChildren();
  for (const skin of SKINS) {
    const owned = progress.skins.includes(skin.id), worn = progress.skin === skin.id;
    const card = document.createElement('div'); card.className = 'skin-card' + (worn ? ' worn' : '');
    const swatch = document.createElement('span'); swatch.className = 'skin-swatch';
    swatch.style.background = `radial-gradient(circle at 50% 70%, ${hex(skin.belly)} 0 32%, ${hex(skin.body)} 33%)`;
    swatch.style.borderColor = hex(skin.spikes);
    const name = document.createElement('strong'); name.textContent = skin.name;
    const button = document.createElement('button');
    button.className = worn ? 'text-button' : owned || progress.bank >= skin.price ? 'primary' : 'secondary';
    button.textContent = worn ? 'Gekozen' : owned ? 'Kies' : `● ${skin.price}`;
    button.disabled = worn || (!owned && progress.bank < skin.price);
    button.setAttribute('aria-label', worn ? `${skin.name} is gekozen` : owned ? `Kies ${skin.name}` : `Koop ${skin.name} voor ${skin.price} munten`);
    button.onclick = () => {
      const before = progress;
      progress = owned ? selectSkin(progress, skin.id) : buySkin(progress, skin.id);
      if (progress === before) return;
      save(); renderer.setSkin(skinById(progress.skin)); updateHome(); tone(owned ? 'start' : 'win');
      log(owned ? 'skin-select' : 'skin-buy', { skin: skin.id, bank: progress.bank }); shopMenu();
    };
    card.append(swatch, name, button); grid.append(card);
  }
  if (!$('shop-dialog').open) $('shop-dialog').showModal();
}
function move(delta) { if (mode === 'playing') steer(run, run.targetLane + delta); }
function doJump() { if (mode === 'playing' && jump(run)) tone('jump'); }
$('play').onclick = () => startLevel(progress.unlocked);
$('levels').onclick = levelMenu;
$('shop').onclick = shopMenu;
$('help').onclick = () => $('help-dialog').showModal();
$('sound').onclick = () => { soundOn = !soundOn; progress.sound = soundOn; setSoundButton(); save(); tone('start'); };
$('pause').onclick = () => pause(); $('resume').onclick = resume;
$('restart').onclick = $('retry').onclick = () => startLevel(run.level.number);
$('back-home').onclick = $('result-home').onclick = home;
$('next-level').onclick = () => startLevel(Math.min(100, run.level.number + 1));
$('left').onclick = () => move(-1); $('right').onclick = () => move(1); $('jump').onclick = doJump;
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
$('pause-dialog').addEventListener('cancel', event => { event.preventDefault(); resume(); });
$('result-dialog').addEventListener('cancel', event => { event.preventDefault(); home(); });
$('scene').addEventListener('pointerdown', event => { if (mode !== 'playing') return; startGesture = { id:event.pointerId, x:event.clientX, y:event.clientY, lane:run.targetLane, moved:false }; $('scene').setPointerCapture(event.pointerId); });
$('scene').addEventListener('pointermove', event => {
  if (!startGesture || event.pointerId !== startGesture.id || mode !== 'playing') return;
  const dx = event.clientX - startGesture.x, dy = event.clientY - startGesture.y;
  if (dy < -42 && Math.abs(dy) > Math.abs(dx) * 1.2 && !startGesture.moved) { doJump(); startGesture.moved = true; return; }
  const threshold = Math.max(28, Math.min(60, innerWidth * .06));
  if (Math.abs(dx) > threshold) { steer(run, Math.max(-1,Math.min(1,startGesture.lane + Math.round(dx / threshold)))); startGesture.moved = true; }
});
['pointerup','pointercancel','lostpointercapture'].forEach(name => $('scene').addEventListener(name, () => { startGesture = null; }));
document.addEventListener('keydown', event => {
  if (['ArrowLeft','ArrowRight','ArrowUp',' ','Escape','a','d','w','p','A','D','W','P'].includes(event.key) && (mode === 'playing' || mode === 'paused')) {
    event.preventDefault(); if (event.repeat) return;
    if (['Escape','p','P'].includes(event.key)) { mode === 'playing' ? pause('keyboard') : resume(); return; }
    if (['ArrowLeft','a','A'].includes(event.key)) move(-1);
    if (['ArrowRight','d','D'].includes(event.key)) move(1);
    if (['ArrowUp',' ','w','W'].includes(event.key)) doJump();
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause('background'); flushLog(); } lastTime = performance.now(); });
window.addEventListener('pagehide', flushLog);
window.addEventListener('resize', () => renderer?.resize());
window.addEventListener('error', event => { log('error', { message: event.message, file:event.filename, line:event.lineno }); flushLog(); });
window.addEventListener('unhandledrejection', event => { log('promise-error', { message: String(event.reason) }); flushLog(); });
$('download-log').onclick = () => {
  log('log-download'); flushLog();
  const blob = new Blob([JSON.stringify({ ...session, progress, lastRun:run ? { level:run.level.number,status:run.status,distance:run.distance,power:run.power } : null },null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download=`dino-run-v${VERSION}-laatste-run.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function activateUpdate() { if (registration?.waiting && mode === 'home') registration.waiting.postMessage({type:'ACTIVATE'}); }
async function offline() {
  if (new URLSearchParams(location.search).has('dev') && ['localhost','127.0.0.1'].includes(location.hostname)) { $('offline').textContent='Lokale ontwikkeltest'; return; }
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { $('offline').textContent = 'Offline installeren via HTTPS-link'; return; }
  try {
    registration = await navigator.serviceWorker.register('./sw.js');
    const ready = await navigator.serviceWorker.ready;
    if (ready.active) { $('offline').textContent = 'Offline klaar'; $('offline').className = 'ready'; log('offline-ready'); }
    registration.addEventListener('updatefound', () => { const w = registration.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') activateUpdate(); }); });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!waitingReload && mode === 'home' && navigator.serviceWorker.controller) { waitingReload = true; location.reload(); } });
    activateUpdate();
  } catch (error) { $('offline').textContent = 'Offline nog niet klaar · probeer online opnieuw'; log('offline-error', {message:error.message}); }
}
function frame(time) {
  const dt = Math.min(.05, Math.max(0, (time - (lastTime || time))/1000)); lastTime = time;
  try {
    if (mode === 'playing' && !qaMode) advanceSimulation(dt);
    if (mode === 'finale' && time >= finaleUntil) showResult();
    renderer.render(run, mode === 'paused' || mode === 'result' ? 0 : dt, {menu:mode === 'home'});
    if (toastUntil && time > toastUntil) $('toast').hidden = true;
  } catch (error) { mode='error'; log('render-error',{message:error.message,stack:error.stack}); flushLog(); $('error-detail').textContent='De 3D-weergave is gestopt. Probeer de pagina opnieuw te openen.'; closeDialogs(); $('error-dialog').showModal(); return; }
  requestAnimationFrame(frame);
}
const HURT = { hit: 'Botsing!', burn: 'Au, lava!', 'rival-hit': 'Te sterke rivaal!', 'gate-loss': 'Rode poort!' };
function advanceSimulation(dt) {
  if (mode !== 'playing') return;
  tick(run, dt);
  for (const event of run.events || []) {
    if (HURT[event.type]) { tone('hit'); flash(); toast(`${HURT[event.type]} ${event.message}`, 'bad'); }
    else if (event.type === 'rival-win') { tone('eat'); toast(event.message, 'good'); }
    else if (event.type === 'coin') tone('coin');
    else if (['food','gate','shield','shield-used'].includes(event.type)) { tone('collect'); if (event.type !== 'food') toast(event.message, 'good'); }
  }
  updateGameUI(); if (run.status !== 'running') finish();
}
try {
  renderer = new DinoRenderer($('scene')); renderer.setSkin(skinById(progress.skin)); home(); setSoundButton(); $('loading').hidden=true;
  log('boot', { width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,storage:!!localStorageGet(SAVE_KEY) }); flushLog();
  requestAnimationFrame(frame); offline(); setInterval(flushLog, 15000);
  if (qaMode) window.dinoTest = { state:()=>({mode,run,progress}), step:dt=>{advanceSimulation(dt);renderer.render(run,dt,{menu:mode==='home'});}, render:()=>renderer.render(run,0,{menu:mode==='home'}) };
  $('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); pause('graphics-context-lost'); toast('De 3D-weergave is onderbroken. Open de game opnieuw.'); log('webgl-context-lost'); flushLog(); });
} catch (error) {
  log('boot-error',{message:error.message,stack:error.stack}); flushLog(); $('loading').hidden=true;
  $('error-detail').textContent='Deze game heeft een browser met WebGL nodig. Open de link in een recente Safari-versie en probeer opnieuw.'; $('error-dialog').showModal();
}
