// Dino Run v2.3.0 — touch, UI, local progress and runtime diagnostics.
import { VERSION, WORLDS, createRun, steer, jump, tick, stars, teamPower, mergeTeam, resolveRecruit, fightBoss, strongestLevel, referenceTeam, bestRecruit, applyBestRecruit } from './engine.js';
import { DinoRenderer } from './renderer.js';
import { readProgress, completeLevel, addCoins, buySkin, selectSkin, SKINS, skinById, discover, keepTeam } from './storage.js';

import { DINOS, dinoByTier } from './dinos.js';
import { dinoPortrait } from './portraits.js';

const $ = id => document.getElementById(id);
const powerText = value => new Intl.NumberFormat('nl-NL', {notation:value >= 10000 ? 'compact' : 'standard',maximumFractionDigits:1}).format(value);
const qaMode = ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('qa');
const SAVE_KEY = qaMode ? 'dino-run-qa-progress-v2' : 'dino-run-progress-v1';
const LOG_KEY = 'dino-run-last-log';
const FINALE_MS = { won: 1700, lost: 1300 };
let progress = readProgress(localStorageGet(SAVE_KEY));
let run, renderer, mode = 'home', lastTime = 0, soundContext, registration, waitingReload = false;
let soundOn = progress.sound, toastUntil = 0, startGesture = null, runFinished = false, dirtyLog = false, finaleUntil = 0, lastRating = 0;
// Failed tries of the same level in a row (this session): each one brings a little more help.
let retryStreak = { level: 0, count: 0 };
const session = { version: VERSION, started: new Date().toISOString(), events: [] };
// Saves from before v2.2 have no team yet: start with the team a player normally has at that level.
if (!progress.team) {
  progress = { ...progress, team: referenceTeam(Math.min(100, progress.unlocked)) };
  log('team-migrated', { unlocked: progress.unlocked, team: progress.team });
  save();
}
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
  $('home-team-count').textContent = `${progress.seen.length}/${DINOS.length}`;
  const team = progress.team || [];
  $('home-team-power').textContent = `Jouw team: ${team.length} dino${team.length === 1 ? '' : '’s'} · ⚡ ${powerText(teamPower({ team }))}`;
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(d => d.close()); }
const HINTS = [
  [0, 4, 'Veeg of tik ‹ › om van baan te wisselen'],
  [4, 9, 'Groen Lv? Versla die dino: hij komt in je team'],
  [9, 14, 'Vallen kosten je kleinste dino, en die komt niet terug!'],
  [14, 19, 'Bij de finish vecht je hele team samen tegen de eindbaas']
];
function hintText() {
  const fork = run.level.forks?.find(f => run.distance >= f.start - 24 && run.distance < f.end);
  if (fork) return `← ${fork.leftLabel} · ${fork.rightLabel} →`;
  if (run.level.number <= 2 && run.time < 19) return HINTS.find(([from, to]) => run.time >= from && run.time < to)?.[2];
  const power = teamPower(run), boss = run.level.bossPower;
  if (run.distance < run.level.length * .8) return run.time < 5 ? `Eindbaas Lv ${run.level.bossLevel} heeft ⚡ ${powerText(boss)}. Jouw team: ⚡ ${powerText(power)}` : null;
  return power >= boss ? `Samen ⚡ ${powerText(power)} tegen ⚡ ${powerText(boss)}: jullie kunnen het!` : `Nog ⚡ ${powerText(boss - power)} tekort voor de eindbaas`;
}
function updateGameUI() {
  const power = teamPower(run), boss = run.level.bossPower;
  $('hud-level').textContent = `LEVEL ${run.level.number} · ${WORLDS[run.level.world].name.toUpperCase()}`;
  $('run-progress').style.width = `${Math.min(100, run.distance / run.level.length * 100)}%`;
  $('coins').textContent = run.coins;
  $('power').textContent = `⚡ ${powerText(power)}`;
  $('boss').textContent = `⚡ ${powerText(boss)}`;
  $('boss-label').textContent = `EINDBAAS LV ${run.level.bossLevel}`;
  $('power-card').classList.toggle('strong', power >= boss);
  $('growth').textContent = `${run.team.length}/9 dino’s · sterkste Lv ${strongestLevel(run)}`;
  updateTeamStrip();
  $('shield-badge').hidden = !run.shield;
  const hint = mode === 'playing' ? hintText() : null;
  $('game-hint').hidden = !hint;
  if (hint) $('game-hint').textContent = hint;
}
// Every level starts with the player's own team; a team that fell far behind gets helpers.
function startLevel(number) {
  if (!Number.isInteger(number) || number < 1 || number > progress.unlocked || number > 100) return;
  const retries = retryStreak.level === number ? retryStreak.count : 0;
  closeDialogs(); run = createRun(number, progress.team, { retries }); runFinished = false; mode = 'playing';
  renderer.loadLevel(run.level); $('home').hidden = true; $('header').hidden = true; $('hud').hidden = false; $('toast').hidden = true;
  hideFight(); document.body.classList.add('playing'); lastTime = performance.now();
  log('level-start', { level: number, bossLevel: run.level.bossLevel, bossPower: run.level.bossPower, teamPower: teamPower(run), team: run.team, helpers: run.helpers, retries }); flushLog(); tone('start'); updateGameUI();
  if (run.helpers.length) {
    syncTeam();
    toast(`${run.helpers.length === 1 ? 'Een hulpdino sluit' : `${run.helpers.length} hulpdino’s sluiten`} aan: je team was klein geworden.`, 'good');
  }
}
function home() {
  closeDialogs(); mode = 'home'; run = createRun(Math.min(progress.unlocked,100)); run.team = progress.team?.length ? [...progress.team] : [0]; renderer.loadLevel(run.level);
  $('home').hidden = false; $('header').hidden = false; $('hud').hidden = true; $('toast').hidden = true;
  hideFight(); document.body.classList.remove('playing'); updateHome(); flushLog(); activateUpdate();
}
// Boss fight overlay: both health bars, a trailing bar that shows the last blow, and damage numbers.
function hideFight() { $('fight').hidden = true; document.body.classList.remove('fighting'); }
function showFight() {
  const fight = run.fight;
  $('fight-boss-name').textContent = `EINDBAAS LV ${run.level.bossLevel}`;
  $('fight').hidden = false; document.body.classList.add('fighting');
  for (const side of ['team', 'boss']) { $(`fight-${side}-trail`).style.width = '100%'; $(`fight-${side}-fill`).style.width = '100%'; }
  updateFight(fight);
}
function updateFight(fight = run.fight) {
  if (!fight) return;
  for (const [side, hp, max] of [['team', fight.teamHp, fight.teamMax], ['boss', fight.bossHp, fight.bossMax]]) {
    const width = `${Math.max(0, hp / max * 100)}%`;
    $(`fight-${side}-hp`).textContent = `⚡ ${powerText(hp)}`;
    $(`fight-${side}-fill`).style.width = width;
    $(`fight-${side}-trail`).style.width = width;
  }
}
function fightHit(event) {
  // The team hits the boss (number over the boss bar) or the boss hits the team.
  const target = $(event.side === 'team' ? 'fight-boss' : 'fight-team');
  const pop = document.createElement('b'); pop.className = 'dmg'; pop.textContent = event.damage > 0 ? `−${powerText(event.damage)}` : 'tik';
  target.append(pop); setTimeout(() => pop.remove(), 900);
  target.classList.remove('hit'); void target.offsetWidth; target.classList.add('hit');
  if (event.side === 'boss') { tone('hit'); flash(); } else tone('eat');
}
function pause(reason = 'button') {
  if (mode !== 'playing') return;
  mode = 'paused'; $('pause-dialog').showModal(); log('pause', { level: run.level.number, reason }); flushLog();
}
function resume() { if (mode !== 'paused') return; closeDialogs(); mode = 'playing'; lastTime = performance.now(); log('resume'); }
// The result is stored at once; the dialog waits until the boss finale has played.
// The result is stored at once (the team is kept, won or lost); the dialog waits until the boss finale has played.
function finish() {
  if (runFinished) return;
  runFinished = true; mode = 'finale'; const won = run.status === 'won', number = run.level.number;
  lastRating = won ? stars(run) : 0;
  retryStreak = won ? { level: 0, count: 0 } : { level: number, count: (retryStreak.level === number ? retryStreak.count : 0) + 1 };
  if (won) progress = completeLevel(progress, number, lastRating);
  progress = keepTeam(discover(addCoins(progress, run.coins), won ? [run.level.bossTier] : []), run.team); save();
  finaleUntil = performance.now() + FINALE_MS[won ? 'won' : 'lost'];
  $('toast').hidden = true; $('game-hint').hidden = true;
  tone(won ? 'win' : 'hit');
  log(won ? 'level-won' : 'level-lost', { level: number, stars: lastRating, cause: run.cause, team: run.team, teamPower: teamPower(run), strongest: strongestLevel(run), bossLevel: run.level.bossLevel, bossPower: run.level.bossPower, fightLeft: run.fight ? { team: run.fight.teamHp, boss: run.fight.bossHp } : null, coins: run.coins, hits: run.hits, lost: run.lost, merges: run.merges, retries: retryStreak.count, seconds: Math.round(run.time) }); flushLog();
}
function showResult() {
  mode = 'result'; const won = run.status === 'won', rating = lastRating, last = run.level.number === 100;
  const power = teamPower(run), boss = run.level.bossPower;
  $('result-symbol').textContent = won ? '✦' : '↻';
  $('result-eyebrow').textContent = won ? `LEVEL ${run.level.number} VOLTOOID` : run.cause === 'boss' ? 'DE EINDBAAS WAS NOG TE STERK' : 'OEPS, JE BENT AF';
  $('result-title').textContent = won ? last ? 'Koning van de eilanden!' : rating === 3 ? 'Perfecte run!' : 'Eindbaas verslagen!' : 'Nog een avontuur?';
  $('result-stars').textContent = won ? '★'.repeat(rating) + '☆'.repeat(3 - rating) : '♡';
  $('result-power').textContent = `⚡ ${powerText(power)}`;
  $('result-boss').textContent = `⚡ ${powerText(boss)}`;
  $('result-coins').textContent = `+${run.coins} munten · pot ${progress.bank}`;
  const lostWhy = run.cause === 'rival' ? 'Een te sterke dino ving je. Rood Lv betekent: uitwijken! De dino’s die je al versloeg blijven in je team.'
    : run.cause === 'trap' ? 'Je had geen dino’s meer om je te beschermen tegen de val. Nog een keer?'
    : `Jouw team had ⚡ ${powerText(power)}, de eindbaas ⚡ ${powerText(boss)}. De dino’s die je versloeg blijven in je team: probeer het nog eens!`;
  $('result-detail').textContent = won
    ? last ? 'Alle 100 levels gehaald! Speel ze opnieuw voor drie sterren.' : rating === 3 ? 'Geen enkele botsing. Je team reist mee naar het volgende eiland.' : 'Je team reist mee naar het volgende eiland. Drie sterren? Haal de finish zonder botsingen.'
    : lostWhy;
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
let teamReturnMode = 'home', selectedSlot = null, teamSignature = '', dragDino = null, suppressTeamClickUntil = 0;
function evolvePair(first, second) {
  const tier = run.team[first], waiting = run.pendingRecruit;
  if (!mergeTeam(run, first, second)) return false;
  log('team-evolve', {from:tier,to:tier+1,team:run.team,input:'drag-or-select'});
  tone('win'); syncTeam(); selectedSlot = null;
  const joined = waiting !== null && waiting !== undefined && run.pendingRecruit === null;
  toast(joined ? `Lv ${tier + 2}! ${dinoByTier(waiting).name} sluit aan.` : `${dinoByTier(tier+1).name} · Lv ${tier + 2}!`, 'good'); renderTeamMenu(); updateGameUI();
  return true;
}
function bindDinoDrag(card, index, tier) {
  card.style.touchAction = 'none';
  card.onpointerdown = event => {
    if (event.button !== 0 || dragDino || tier >= 20) return;
    dragDino = {index,tier,pointer:event.pointerId,x:event.clientX,y:event.clientY,source:card,ghost:null,target:null};
    card.setPointerCapture(event.pointerId);
  };
  card.onpointermove = event => {
    if (!dragDino || dragDino.pointer !== event.pointerId) return;
    const drag = dragDino;
    if (!drag.ghost && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 8) return;
    if (!drag.ghost) {
      drag.ghost = document.createElement('div'); drag.ghost.className = 'dino-drag-ghost';
      drag.ghost.innerHTML = dinoPortrait(dinoByTier(tier)); $('team-dialog').append(drag.ghost);
      card.classList.add('dragging');
      document.querySelectorAll('[data-team-slot]').forEach(target=>target.classList.toggle('drop-ready',Number(target.dataset.tier)===tier && Number(target.dataset.teamSlot)!==index));
    }
    drag.ghost.style.left=`${event.clientX-46}px`; drag.ghost.style.top=`${event.clientY-40}px`;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-team-slot]');
    document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));
    drag.target=target && Number(target.dataset.tier)===tier && Number(target.dataset.teamSlot)!==index ? Number(target.dataset.teamSlot) : null;
    if (drag.target !== null) target.classList.add('drop-over');
    event.preventDefault();
  };
  const end = (event, cancelled) => {
    if (!dragDino || dragDino.pointer !== event.pointerId) return;
    const drag=dragDino; dragDino=null;
    drag.source.classList.remove('dragging'); drag.ghost?.remove();
    document.querySelectorAll('.drop-ready,.drop-over').forEach(el=>el.classList.remove('drop-ready','drop-over'));
    if (!drag.ghost) return;
    suppressTeamClickUntil=performance.now()+400;
    if (!cancelled && drag.target !== null) {
      if (drag.index === -1) {resolveRecruit(run,drag.target);syncTeam();log('recruit-drag-evolve',{tier,slot:drag.target,team:run.team});tone('win');renderTeamMenu();updateGameUI();}
      else evolvePair(drag.index,drag.target);
    } else if (!cancelled) toast('Sleep op een dino van precies dezelfde vorm.');
  };
  card.onpointerup=event=>end(event,false);
  card.onpointercancel=card.onlostpointercapture=event=>end(event,true);
}
// The team is saved as soon as it changes (recruits, merges and trap losses all stay), and every
// form that ever joins it is written into the collection book. The home preview is never saved.
function syncTeam() {
  if (!run || mode === 'home') return;
  const before = progress;
  progress = keepTeam(progress, run.team);
  if (progress === before) return;
  save(); updateHome();
  if (progress.seen.length > before.seen.length) log('discovered', { tier: Math.max(...run.team), seen: progress.seen.length });
}
function mergePair() {
  for (let i = 0; i < run.team.length; i++) {
    if (run.team[i] >= 20) continue;
    const other = run.team.indexOf(run.team[i], i + 1);
    if (other >= 0) return [i, other];
  }
  return null;
}
function updateTeamStrip() {
  const signature = run.team.join(',');
  if (signature === teamSignature) return;
  teamSignature = signature;
  $('team-strip').innerHTML = Array.from({length: 9}, (_, index) => {
    const tier = run.team[index];
    return tier === undefined ? '<i class="empty-slot">·</i>' : `<i title="${dinoByTier(tier).name}">${dinoPortrait(dinoByTier(tier))}<small>Lv${tier + 1}</small></i>`;
  }).join('');
  // Evolving costs power now (two Lv N become one Lv N+1), so the strip no longer invites it;
  // a full team gets its choice when a newcomer arrives.
  $('team-action').textContent = `Team ${run.team.length}/9 · beheren`;
  $('team-toggle').classList.remove('can-merge');
}
function teamCard(tier, index, isAtlas = false) {
  const dino = dinoByTier(tier), card = document.createElement(isAtlas ? 'article' : 'button');
  card.className = 'dino-card' + (selectedSlot === index && !isAtlas ? ' selected' : '');
  const selectedTier = selectedSlot === null ? null : run.team[selectedSlot];
  if (!isAtlas && selectedTier === tier && selectedSlot !== index && tier < 20) card.classList.add('match');
  const locked = isAtlas && !progress.seen.includes(tier);
  if (locked) card.classList.add('locked');
  card.innerHTML = locked
    ? `${dinoPortrait(dino)}<strong>Lv ${dino.level} · ???</strong><span>Nog niet ontdekt</span><b>⚡ ${powerText(dino.power)}</b><p>Voeg twee Lv ${dino.level - 1}-dino’s samen of versla er een.</p>`
    : `${dinoPortrait(dino)}<strong>${dino.name}</strong><span>Lv ${dino.level} · ${dino.flying ? 'vliegend' : 'lopend'}</span><b>⚡ ${powerText(dino.power)}</b>${isAtlas ? `<p>${dino.description}</p>` : ''}`;
  if (!isAtlas) {
    card.dataset.teamSlot = index; card.dataset.tier = tier;
    bindDinoDrag(card,index,tier);
    const incoming = run.pendingRecruit;
    if (incoming !== null && incoming !== undefined) {
      const merge = incoming === tier && tier < 20;
      const gain = merge ? 1 : incoming - tier;
      card.classList.toggle('match', merge);
      const action = document.createElement('em');
      action.textContent = merge ? `Samen → Lv ${tier + 2} (⚡ +1)` : `Vervangen door nieuwkomer (⚡ ${gain > 0 ? '+' : gain < 0 ? '−' : '±'}${Math.abs(gain)})`;
      card.append(action);
      card.setAttribute('aria-label', `${dino.name}, ${action.textContent}`);
      card.onclick = () => {
        if (performance.now() < suppressTeamClickUntil) return;
        resolveRecruit(run, index); syncTeam();
        log('recruit-choice', { slot: index, incoming, evolved: merge, team: run.team });
        tone(merge ? 'win' : 'eat'); selectedSlot = null; renderTeamMenu(); updateGameUI();
      };
    } else {
      card.setAttribute('aria-label', `${dino.name}, level ${dino.level}, kracht ${dino.power}, teamplaats ${index + 1}`);
      card.onclick = () => {
        if (performance.now() < suppressTeamClickUntil) return;
        if (selectedSlot !== null && selectedSlot !== index && run.team[selectedSlot] === tier && tier < 20) {
          evolvePair(selectedSlot,index); return;
        } else selectedSlot = selectedSlot === index ? null : index;
        renderTeamMenu(); updateGameUI();
      };
    }
  }
  return card;
}
function renderTeamMenu() {
  const incoming = run.pendingRecruit;
  const pending = incoming !== null && incoming !== undefined;
  const boss = run.status === 'boss';
  const power = teamPower(run), bossPower = run.level.bossPower, bossLevel = run.level.bossLevel, enough = power >= bossPower;
  $('team-title').textContent = boss ? `Eindbaas Lv ${bossLevel} · ⚡ ${powerText(bossPower)}` : 'Samen worden ze groter.';
  $('team-summary').textContent = boss
    ? `Een gewone Lv ${bossLevel} heeft ⚡ ${powerText(dinoByTier(bossLevel - 1).power)}; deze eindbaas is veel sterker. Jouw hele team vecht samen: ⚡ ${powerText(power)}.`
    : `${run.team.length} / 9 teamleden · samen ⚡ ${powerText(power)} · eindbaas ⚡ ${powerText(bossPower)}`;
  $('recruit-offer').hidden = !pending;
  $('team-close').hidden = pending || boss;
  $('team-done').hidden = pending;
  $('team-done').textContent = boss ? (enough ? '⚔ Vecht tegen de eindbaas!' : `⚔ Toch vechten (⚡ ${powerText(power)} tegen ⚡ ${powerText(bossPower)})`) : 'Klaar · verder ➜';
  $('team-done').className = boss && enough ? 'primary' : 'secondary';
  $('team-dialog').classList.toggle('boss-prep', boss);
  // At the boss evolving would only weaken the team, so the button is hidden there.
  $('team-merge').hidden = boss;
  $('team-merge').disabled = !mergePair();
  $('team-instruction').textContent = boss
    ? enough ? 'Samen zijn jullie sterk genoeg. Vecht!'
      : `Jullie komen ⚡ ${powerText(bossPower - power)} tekort. Vecht toch: de dino’s die je versloeg blijven in je team voor de volgende poging.`
    : pending ? 'Je team is vol. ✦ Beste keuze doet het slimste (meestal: je zwakste dino vervangen). Je kunt ook zelf een teamlid aantikken. Samenvoegen maakt plek, maar kost kracht: twee Lv 5 (⚡ 10) worden één Lv 6 (⚡ 6).'
      : selectedSlot === null ? 'Sleep een dino op een dino van hetzelfde level: samen worden ze 1 level hoger (⚡ +1), maar je team verliest de kracht van de tweede. Handig als je team vol is. Twee keer tikken werkt ook.'
        : run.team[selectedSlot] === 20 ? 'Deze dino is Lv 21: het hoogste level.' : `Sleep op nog een Lv ${run.team[selectedSlot] + 1}. Groen omlijnde dino’s passen bij elkaar.`;
  if (pending) $('incoming-dino').innerHTML = `${dinoPortrait(dinoByTier(incoming))}<div><small>WIL BIJ JOUW TEAM</small><strong>${dinoByTier(incoming).name}</strong><span>Lv ${incoming + 1} · ⚡ ${powerText(dinoByTier(incoming).power)}</span></div>`;
  if (pending) {
    const plan = bestRecruit(run);
    const what = {
      evolve: `samen met je Lv ${incoming + 1} → Lv ${incoming + 2}`,
      replace: `vervang je Lv ${(run.team[plan.index] ?? 0) + 1}`,
      merge: `voeg je twee Lv ${(run.team[plan.pair?.[0]] ?? 0) + 1} samen, dan kan hij erbij`,
      release: 'laat hem gaan, je team is al sterker'
    }[plan.action] || 'neem hem erbij';
    $('best-recruit').textContent = `✦ Beste keuze: ${what}${plan.gain > 0 ? ` (⚡ +${plan.gain})` : ''}`;
  }
  if (pending) bindDinoDrag($('incoming-dino'),-1,incoming);
  const grid = $('team-grid'); grid.replaceChildren();
  run.team.forEach((tier, index) => grid.append(teamCard(tier, index)));
  for (let index = run.team.length; index < 9; index++) {
    const slot = document.createElement('div'); slot.className = 'dino-card empty-card'; slot.textContent = `Vrije plek ${index + 1}`; grid.append(slot);
  }
}
function openTeam() {
  if (!run || mode === 'error' || mode === 'finale' || run.status === 'fight') return;
  if (mode !== 'team') teamReturnMode = mode;
  mode = 'team'; selectedSlot = null; renderTeamMenu(); document.body.classList.add('team-open');
  if (!$('team-dialog').open) $('team-dialog').showModal();
  log('team-open', { pending: run.pendingRecruit, team: run.team }); flushLog();
}
function closeTeam() {
  if (run.pendingRecruit !== null && run.pendingRecruit !== undefined) return;
  $('team-dialog').close(); document.body.classList.remove('team-open'); selectedSlot = null; syncTeam(); updateHome(); updateGameUI();
  // The fight plays out over several seconds; advanceSimulation finishes the run when it is over.
  if (run.status === 'boss') {
    mode = 'playing'; fightBoss(run); showFight(); lastTime = performance.now(); tone('start');
    log('boss-fight', { teamPower: run.fight.teamMax, bossPower: run.fight.bossMax, bossLevel: run.level.bossLevel, winner: run.fight.winner, blows: run.fight.hits.length, seconds: run.fight.endAt });
    return;
  }
  mode = teamReturnMode; lastTime = performance.now();
  if (mode === 'playing' && run.status !== 'running') finish();
}
function openBossPrep() {
  if (mode === 'team') return;
  tone('start'); openTeam();
  log('boss-prep', { team: run.team, teamPower: teamPower(run), bossLevel: run.level.bossLevel, bossPower: run.level.bossPower });
}
$('team-toggle').onclick = openTeam;
$('team-close').onclick = $('team-done').onclick = closeTeam;
$('team-dialog').addEventListener('cancel', event => { event.preventDefault(); if (run.status !== 'boss') closeTeam(); });
$('release-recruit').onclick = () => { const tier = run.pendingRecruit; resolveRecruit(run, null); log('recruit-released', {tier}); renderTeamMenu(); closeTeam(); };
// One tap for a full team: the same choice the reference player (and the balance tests) make.
$('best-recruit').onclick = () => {
  const incoming = run.pendingRecruit, plan = bestRecruit(run);
  if (!plan || !applyBestRecruit(run)) return;
  syncTeam(); log('recruit-best', { incoming, action: plan.action, gain: plan.gain, team: run.team });
  tone(plan.action === 'release' ? 'collect' : 'win'); selectedSlot = null; renderTeamMenu(); updateGameUI(); closeTeam();
};
$('team-merge').onclick = () => { const pair = mergePair(); if (pair) evolvePair(...pair); };
function openAtlas() {
  const grid = $('atlas-grid'); grid.replaceChildren();
  $('atlas-count').textContent = `${progress.seen.length} van de ${DINOS.length} vormen ontdekt.`;
  DINOS.forEach((dino, index) => grid.append(teamCard(dino.tier,index,true)));
  if (!$('atlas-dialog').open) $('atlas-dialog').showModal();
}
$('open-atlas').onclick = $('home-team').onclick = openAtlas;

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
  if (['ArrowLeft','ArrowRight','ArrowUp',' ','Escape','a','d','w','p','A','D','W','P','t','T'].includes(event.key) && (mode === 'playing' || mode === 'paused')) {
    event.preventDefault(); if (event.repeat) return;
    if (['t','T'].includes(event.key) && mode === 'playing') { openTeam(); return; }
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
  const blob = new Blob([JSON.stringify({ ...session, progress, lastRun:run ? { level:run.level.number,status:run.status,distance:run.distance,team:run.team,teamPower:teamPower(run),bossPower:run.level.bossPower,branchChoices:run.branchChoices } : null },null,2)], {type:'application/json'});
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
    renderer.render(run, ['paused','result'].includes(mode) ? 0 : dt, {menu:mode === 'home', teamView:mode === 'team'});
    if (toastUntil && time > toastUntil) $('toast').hidden = true;
  } catch (error) { mode='error'; log('render-error',{message:error.message,stack:error.stack}); flushLog(); $('error-detail').textContent='De 3D-weergave is gestopt. Probeer de pagina opnieuw te openen.'; closeDialogs(); $('error-dialog').showModal(); return; }
  requestAnimationFrame(frame);
}
const HURT = { hit: 'Botsing!', burn: 'Au, lava!', 'gate-loss': 'Rode poort!', death: '' };
function advanceSimulation(dt) {
  if (mode !== 'playing') return;
  tick(run, dt);
  for (const event of run.events || []) {
    if (event.type === 'fight-hit') fightHit(event);
    else if (event.type in HURT) { tone('hit'); flash(); toast(`${HURT[event.type]} ${event.message}`.trim(), 'bad'); }
    else if (['rival-win','recruit','merge'].includes(event.type)) { tone('eat'); toast(event.message, 'good'); }
    else if (event.type === 'coin') tone('coin');
    else if (['food','gate','shield','shield-used'].includes(event.type)) { tone('collect'); if (event.type !== 'food') toast(event.message, 'good'); }
  }
  if (run.fight) updateFight();
  syncTeam(); updateGameUI();
  if (run.pendingRecruit !== null && run.pendingRecruit !== undefined) { openTeam(); return; }
  if (run.status === 'boss') { openBossPrep(); return; }
  if (!['running', 'fight'].includes(run.status)) finish();
}
try {
  renderer = new DinoRenderer($('scene')); renderer.setSkin(skinById(progress.skin)); home(); setSoundButton(); $('loading').hidden=true;
  log('boot', { width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,storage:!!localStorageGet(SAVE_KEY) }); flushLog();
  requestAnimationFrame(frame); offline(); setInterval(flushLog, 15000);
  if (qaMode) {
    window.dinoTest = {
      state:()=>({mode,run,progress}),
      renderer,
      step:dt=>{advanceSimulation(dt);renderer.render(run,dt,{menu:mode==='home',teamView:mode==='team'});},
      render:()=>renderer.render(run,0,{menu:mode==='home'}),
      fixture:(number,team)=>{progress={...progress,unlocked:100};save();startLevel(number);if(team)run.team=team.slice();updateGameUI();},
      offer:tier=>{run.level.objects=[{id:'qa-recruit-'+run.distance,type:'rival',tier,value:dinoByTier(tier).power,z:run.distance+0.2,lane:run.targetLane}];advanceSimulation(.05);},
    };
    import('./tests/qa-controls.js').then(module=>module.mount(window.dinoTest)).catch(error=>log('qa-error',{message:error.message}));
  }
  $('scene').addEventListener('webglcontextlost', event => { event.preventDefault(); pause('graphics-context-lost'); toast('De 3D-weergave is onderbroken. Open de game opnieuw.'); log('webgl-context-lost'); flushLog(); });
} catch (error) {
  log('boot-error',{message:error.message,stack:error.stack}); flushLog(); $('loading').hidden=true;
  $('error-detail').textContent='Deze game heeft een browser met WebGL nodig. Open de link in een recente Safari-versie en probeer opnieuw.'; $('error-dialog').showModal();
}
