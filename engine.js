import { DINOS, MAX_LEVEL, dinoByTier, levelPower } from './dinos.js';

export const VERSION = '2.1.0';

export const WORLDS = Object.freeze([
  { name: 'Palmenbaai', sky: '#65d8ff', water: '#169bd5', ground: '#f4cf67', accent: '#ff5f57' },
  { name: 'Bamboebos', sky: '#91e8bb', water: '#35aab2', ground: '#59b95f', accent: '#ffe066' },
  { name: 'Koraalkust', sky: '#70ddf2', water: '#087fa9', ground: '#ef9f75', accent: '#ff4f9a' },
  { name: 'Kristalgrotten', sky: '#8076d9', water: '#293b91', ground: '#695a8d', accent: '#63f4ff' },
  { name: 'Ambermoeras', sky: '#d4cf68', water: '#438b75', ground: '#8c8349', accent: '#ffb347' },
  { name: 'Vulkaanrand', sky: '#dd6b52', water: '#49385f', ground: '#4a4145', accent: '#ffcf40' },
  { name: 'Wolkenriffen', sky: '#b9e8ff', water: '#689ed4', ground: '#8ed1a1', accent: '#ff7fa7' },
  { name: 'Sterrentoendra', sky: '#7189d8', water: '#3b70a0', ground: '#b4d9de', accent: '#f6f08a' },
  { name: 'Oerwoudtempel', sky: '#4bbf91', water: '#187f83', ground: '#547b45', accent: '#ffc857' },
  { name: 'Komeeteiland', sky: '#463c84', water: '#283664', ground: '#745b7e', accent: '#8bffcf' }
]);

const LANES = Object.freeze([-1, 0, 1]);
const OBJECT_TYPES = Object.freeze(['food', 'coin', 'rock', 'log', 'lava', 'rival', 'gate', 'shield']);
const MAX_DT = 0.25;
const MAX_STEP = 1 / 60;
const LANE_SPEED = 6;
const JUMP_VELOCITY = 8.8;
const GRAVITY = 20;
const MAX_EVENTS = 8;
const LANE_HIT_RADIUS = 0.45;
const LAVA_FROM_LEVEL = 4;
const RED_GATE_FROM_LEVEL = 11;
// The leader is always a Lv 1 dino (power 1); every run starts with one Lv 1 companion.
const LEADER_POWER = 1;
const START_TEAM = Object.freeze([0]);
const MAX_TEAM = 9;
const FIRST_BOSS_LEVEL = 6;

export function bossLevelFor(number) {
  return FIRST_BOSS_LEVEL + Math.round((MAX_LEVEL - FIRST_BOSS_LEVEL) * (number - 1) / 99);
}

// Traps knock dinos out of the team, smallest first: rocks, logs and red gates one, lava two.
export function trapLoss(type) {
  return type === 'lava' ? 2 : 1;
}

// A rival can be beaten up to one level above the team: at most twice the team power.
// Touching a stronger rival ends the run.
export function canBeat(power, value) {
  return power * 2 >= value;
}

function sanitizeTeam(team) {
  const clean = Array.isArray(team)
    ? team.filter(tier => Number.isInteger(tier) && dinoByTier(tier)).slice(0, MAX_TEAM)
    : [];
  return clean.length ? clean : [...START_TEAM];
}

export function teamPower(run) {
  if (!run) return LEADER_POWER;
  return LEADER_POWER + (Array.isArray(run.team) ? run.team : []).reduce((sum, tier) => sum + (dinoByTier(tier)?.power || 0), 0);
}

// Level of the strongest team dino right now (the leader alone counts as Lv 1).
export function strongestLevel(run) {
  return run?.team?.length ? Math.max(...run.team) + 1 : 1;
}

// The highest level the team can reach by merging everything: power doubles per
// level, so equal pairs always combine into the binary form of the team's total.
export function reachableLevel(run) {
  const total = (run?.team || []).reduce((sum, tier) => sum + (dinoByTier(tier)?.power || 0), 0);
  return total > 0 ? Math.floor(Math.log2(total)) + 1 : 1;
}

function recordMerge(run, slot, removed, tier) {
  run.merges = (run.merges || 0) + 1;
  run.lastMerge = { id: run.merges, slot, removed, tier };
  pushEvent(run, 'merge', `${dinoByTier(tier).name} · Lv ${tier + 1} ontstaan!`);
}

export function mergeTeam(run, indexA, indexB) {
  if (!run || !Array.isArray(run.team) || !Number.isInteger(indexA) || !Number.isInteger(indexB)) return false;
  if (indexA === indexB || indexA < 0 || indexB < 0 || indexA >= run.team.length || indexB >= run.team.length) return false;
  const tier = run.team[indexA];
  if (tier !== run.team[indexB] || tier >= DINOS.length - 1) return false;
  const keep = Math.min(indexA, indexB);
  const remove = Math.max(indexA, indexB);
  run.team[keep] = tier + 1;
  run.team.splice(remove, 1);
  recordMerge(run, keep, remove, tier + 1);
  // Merging frees a slot: a dino that was waiting for room joins right away.
  if (dinoByTier(run.pendingRecruit) && run.team.length < MAX_TEAM) {
    const waiting = run.pendingRecruit;
    run.pendingRecruit = null;
    run.team.push(waiting);
    run.recruited = (run.recruited || 0) + 1;
    pushEvent(run, 'recruit', `${dinoByTier(waiting).name} (Lv ${waiting + 1}) sluit zich aan.`);
  }
  return true;
}

export function recruitDino(run, tier) {
  if (!run || !dinoByTier(tier) || run.pendingRecruit !== null) return false;
  if (run.team.length >= MAX_TEAM) {
    run.pendingRecruit = tier;
    pushEvent(run, 'recruit-pending', `${dinoByTier(tier).name} (Lv ${tier + 1}) wil bij je team.`);
    return false;
  }
  run.team.push(tier);
  run.recruited = (run.recruited || 0) + 1;
  pushEvent(run, 'recruit', `${dinoByTier(tier).name} (Lv ${tier + 1}) sluit zich aan.`);
  return true;
}

export function resolveRecruit(run, replaceIndex = null) {
  if (!run || !dinoByTier(run.pendingRecruit)) return false;
  const incoming = run.pendingRecruit;
  if (replaceIndex === null) {
    run.pendingRecruit = null;
    pushEvent(run, 'recruit-release', `${dinoByTier(incoming).name} reist verder.`);
    return true;
  }
  if (!Number.isInteger(replaceIndex) || replaceIndex < 0 || replaceIndex >= run.team.length) return false;
  const current = run.team[replaceIndex];
  if (current === incoming && incoming < DINOS.length - 1) {
    run.team[replaceIndex] = incoming + 1;
    recordMerge(run, replaceIndex, -1, incoming + 1);
  } else {
    run.team[replaceIndex] = incoming;
    pushEvent(run, 'recruit-replace', `${dinoByTier(incoming).name} neemt een teamplek over.`);
  }
  run.recruited = (run.recruited || 0) + 1;
  run.pendingRecruit = null;
  return true;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function moveTowards(value, target, maximumDelta) {
  if (Math.abs(target - value) <= maximumDelta) return target;
  return value + Math.sign(target - value) * maximumDelta;
}

function pushEvent(run, type, message) {
  if (run.events.length >= MAX_EVENTS) return;
  const event = message ? { type, message } : { type };
  run.events.push(event);
}

function validateLevelNumber(number) {
  if (!Number.isInteger(number) || number < 1 || number > 100) {
    throw new RangeError('Level number must be an integer from 1 through 100.');
  }
}

/**
 * The rival ladder: one rival of every dino level from Lv 1 up to one below the
 * boss, in rising order. Together with the starting Lv 1 they merge into exactly
 * one dino of the boss level, so every ladder rival counts. A few spare rivals of
 * the lowest levels (those are lost first to traps) give some room for mistakes:
 * three in level 1, none from about level 70.
 */
function rivalLadder(bossTier, number) {
  const spares = Math.max(0, Math.round(3 - 3.2 * (number - 1) / 70));
  const ladder = [];
  for (let tier = 0; tier < bossTier; tier += 1) {
    ladder.push(tier);
    if (tier < spares) ladder.push(tier);
  }
  return ladder;
}

/**
 * Route semantics
 * ---------------
 * `level.route` is an ordered list of controls which is known to finish the
 * generated level without a hit and while beating every ladder rival. At the
 * instant `run.distance >= point.z`, a controller should call
 * `steer(run, point.lane)` and, when `jump` is true, call `jump(run)` once.
 * Route data is guidance, never special-cased by the simulation.
 */
export function generateLevel(number) {
  validateLevelNumber(number);

  const world = Math.floor((number - 1) / 10);
  const random = mulberry32((number * 0x9E3779B1) >>> 0);
  const speed = Number((8.5 + (number - 1) * 0.035).toFixed(3));
  const encounterCount = 14 + Math.floor((number - 1) / 4);
  const bossLevel = bossLevelFor(number);
  const bossTier = bossLevel - 1;
  const bossPower = levelPower(bossLevel);
  const ladder = rivalLadder(bossTier, number);
  const jumpEvery = 5 - Math.floor((number - 1) / 34);
  const isJump = index => index > 0 && (index + number) % jumpEvery === 0;
  const forkSet = total => new Set([Math.floor(total / 3), Math.floor(total * 2 / 3)]);
  const slotsFor = total => {
    const forkIndexes = forkSet(total);
    return Array.from({ length: total }, (_, index) => index).filter(index => index > 0 && (forkIndexes.has(index) || !isJump(index)));
  };

  // Every ladder rival needs its own encounter; long ladders stretch the level.
  let totalEncounters = encounterCount;
  while (slotsFor(totalEncounters).length < ladder.length) totalEncounters += 1;
  const length = Number((220 + (number - 1) * 3.2 + (totalEncounters - encounterCount) * 13).toFixed(1));
  const startZ = 28;
  const endZ = length - 26;
  const spacing = (endZ - startZ) / Math.max(1, totalEncounters - 1);
  const forks = forkSet(totalEncounters);
  const slots = slotsFor(totalEncounters);

  // Forks always hold a ladder rival; the others are spread evenly over the remaining slots.
  const rivalAt = new Map();
  const regular = slots.filter(index => !forks.has(index));
  const others = ladder.length - forks.size;
  const chosen = new Set(forks);
  for (let k = 0; k < others; k += 1) chosen.add(regular[Math.round(k * (regular.length - 1) / Math.max(1, others - 1))]);
  [...chosen].sort((a, b) => a - b).forEach((index, k) => rivalAt.set(index, ladder[k]));

  const objects = [];
  const route = [];
  const forkList = [];
  let objectSequence = 0;
  let previousLane = 0;
  let ladderTier = 0;

  const addObject = (z, lane, type, value, tier = null) => {
    const object = { id: `L${number}-O${++objectSequence}`, z: Number(z.toFixed(3)), lane, type, value };
    if (tier !== null) object.tier = tier;
    objects.push(object);
  };
  const rivalValue = tier => dinoByTier(tier).power;
  const trapFor = (index, lane) => {
    const kinds = ['rock', 'log', 'lava', 'rock', 'log'];
    let type = kinds[(index * 3 + lane + 1 + number) % kinds.length];
    if (type === 'lava' && number < LAVA_FROM_LEVEL) type = 'log';
    if (number >= RED_GATE_FROM_LEVEL && (index + lane + number) % 6 === 0) return ['gate', -1];
    return [type, trapLoss(type)];
  };

  for (let index = 0; index < totalEncounters; index += 1) {
    const encounterZ = startZ + spacing * index;
    const rewardType = (index + number) % 4 === 0 ? 'shield' : 'coin';
    const rewardValue = 1 + ((index + number) % 5 === 0 ? 1 : 0);

    if (forks.has(index)) {
      const tier = rivalAt.get(index);
      ladderTier = tier;
      const recruitLane = (number + index) % 2 === 0 ? -1 : 1;
      addObject(encounterZ, recruitLane, 'rival', rivalValue(tier), tier);
      addObject(encounterZ, -recruitLane, 'coin', 3);
      addObject(encounterZ, 0, 'rock', trapLoss('rock'));
      const dino = `${dinoByTier(tier).name} Lv ${tier + 1}`;
      forkList.push({
        start: Number((encounterZ - 4).toFixed(3)),
        end: Number((encounterZ + 3).toFixed(3)),
        leftLabel: recruitLane < 0 ? dino : 'Muntbrug',
        rightLabel: recruitLane < 0 ? 'Muntbrug' : dino,
        leftKind: recruitLane < 0 ? 'recruit' : 'coins',
        rightKind: recruitLane < 0 ? 'coins' : 'recruit'
      });
      route.push({ z: Number((encounterZ - 9).toFixed(3)), lane: recruitLane });
      previousLane = recruitLane;
      continue;
    }

    const laneChoices = LANES.filter(lane => lane !== previousLane || random() > 0.35);
    const safeLane = laneChoices[Math.floor(random() * laneChoices.length)] ?? previousLane;
    if (isJump(index)) {
      const [type, value] = trapFor(index, 0);
      for (const lane of LANES) addObject(encounterZ, lane, type === 'gate' ? 'log' : type, type === 'gate' ? 1 : value);
      addObject(encounterZ + 1.6, safeLane, 'coin', rewardValue);
      route.push({ z: Number((encounterZ - 4).toFixed(3)), lane: safeLane, jump: true });
    } else {
      if (rivalAt.has(index)) {
        ladderTier = rivalAt.get(index);
        addObject(encounterZ, safeLane, 'rival', rivalValue(ladderTier), ladderTier);
        addObject(encounterZ + 2.2, safeLane, 'coin', 1); // a coin behind every ladder rival keeps the shop reachable
      } else if (index > 0) {
        addObject(encounterZ, safeLane, rewardType, rewardValue);
      }
      // Two of the three lanes are always blocked: traps, and now and then a deadly elite rival.
      for (const lane of LANES.filter(item => item !== safeLane)) {
        const elite = index > 1 && (index * 7 + lane + number) % 9 === 0;
        if (elite) {
          const eliteTier = Math.min(MAX_LEVEL - 1, ladderTier + 3);
          addObject(encounterZ, lane, 'rival', rivalValue(eliteTier), eliteTier);
        } else {
          const [type, value] = trapFor(index, lane);
          addObject(encounterZ, lane, type, value);
        }
      }
      route.push({ z: Number((encounterZ - 9).toFixed(3)), lane: safeLane });
    }
    previousLane = safeLane;
  }

  objects.sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  return {
    number,
    world,
    name: `${WORLDS[world].name} ${((number - 1) % 10) + 1}`,
    speed,
    length,
    bossLevel,
    bossTier,
    bossPower,
    ladder,
    objects,
    route,
    forks: forkList
  };
}

// Every run starts small: the leader plus one Lv 1 dino. `team` is only for tests and QA.
export function createRun(number, team = START_TEAM) {
  const level = generateLevel(number);
  return {
    level,
    distance: 0,
    x: 0,
    lane: 0,
    targetLane: 0,
    y: 0,
    vy: 0,
    power: LEADER_POWER,
    team: sanitizeTeam(team),
    pendingRecruit: null,
    recruited: 0,
    merges: 0,
    lastMerge: null,
    lost: 0,
    lastLoss: null,
    cause: null,
    branchChoices: [],
    coins: 0,
    hits: 0,
    shield: 0,
    time: 0,
    status: 'running',
    events: [],
    collected: new Set()
  };
}

export function steer(run, lane) {
  if (!run || run.status !== 'running' || !Number.isFinite(lane)) return run;
  const requested = clamp(Math.round(lane), -1, 1);
  const activeChoice = run.branchChoices.find(choice => {
    const fork = run.level.forks?.[choice.forkIndex];
    return fork && run.distance >= fork.start && run.distance <= fork.end;
  });
  if (activeChoice && ((activeChoice.side === 'left' && requested >= 0) || (activeChoice.side === 'right' && requested <= 0))) return run;
  run.targetLane = requested;
  return run;
}

export function jump(run) {
  if (!run || run.status !== 'running' || run.y > 0 || run.vy !== 0) return false;
  run.vy = JUMP_VELOCITY;
  return true;
}

function useShield(run, source) {
  if (run.shield <= 0) return false;
  run.shield -= 1;
  pushEvent(run, 'shield-used', `Schild blokkeert ${source}.`);
  return true;
}

function die(run, cause, message) {
  run.status = 'lost';
  run.cause = cause;
  pushEvent(run, 'death', message);
}

// Each point of trap damage costs the smallest team dino; with no dino left to lose, the run ends.
function hitTrap(run, count, event, source) {
  run.hits += 1;
  if (useShield(run, source)) return;
  const lostTiers = [];
  for (let point = 0; point < count; point += 1) {
    if (!run.team.length) {
      die(run, 'trap', `Au, ${source}! Je hebt geen dino’s meer om je te beschermen.`);
      break;
    }
    const smallest = run.team.indexOf(Math.min(...run.team));
    lostTiers.push(run.team[smallest]);
    run.team.splice(smallest, 1);
  }
  if (lostTiers.length) {
    run.lost += lostTiers.length;
    run.lastLoss = { id: run.lost, tiers: lostTiers };
    pushEvent(run, event, `${lostTiers.map(tier => `Lv ${tier + 1}`).join(' en ')} kwijt`);
  }
}

/**
 * `run.collected` holds every object that was consumed or smashed: pickups,
 * gates, defeated rivals and hazards that hit the team. A hazard that is
 * jumped over or dodged is not collected, so it stays visible behind the
 * player. Objects are only ever crossed once because distance only grows.
 */
function applyObject(run, object, collisionY) {
  const collect = () => run.collected.add(object.id);
  switch (object.type) {
    case 'food':
      collect();
      pushEvent(run, 'food', 'Smikkel!');
      break;
    case 'coin':
      collect();
      run.coins += object.value;
      pushEvent(run, 'coin', `+${object.value} munt`);
      break;
    case 'gate':
      collect();
      if (object.value < 0) hitTrap(run, Math.abs(object.value), 'gate-loss', 'de rode poort');
      break;
    case 'shield':
      collect();
      run.shield += Math.max(1, Math.round(object.value));
      pushEvent(run, 'shield', 'Schild klaar');
      break;
    case 'rock':
    case 'log': {
      const clearance = object.type === 'rock' ? 0.78 : 1;
      if (collisionY >= clearance) break;
      collect();
      hitTrap(run, object.value, 'hit', object.type === 'rock' ? 'de rots' : 'de boomstam');
      break;
    }
    case 'lava':
      if (collisionY >= 0.58) break;
      hitTrap(run, object.value, 'burn', 'de lava');
      break;
    case 'rival':
      if (collisionY >= 1.05) break;
      collect();
      if (canBeat(teamPower(run), object.value)) {
        pushEvent(run, 'rival-win', `${dinoByTier(object.tier).name} verslagen!`);
        recruitDino(run, object.tier);
      } else if (!useShield(run, 'de sterke dino')) {
        run.hits += 1;
        die(run, 'rival', `${dinoByTier(object.tier).name} (Lv ${object.tier + 1}) was te sterk!`);
      }
      break;
    default:
      throw new Error(`Unsupported level object type: ${object.type}`);
  }
}

function resolveObjects(run, fromDistance, toDistance, fromX, toX, fromY, toY) {
  const distanceDelta = toDistance - fromDistance;
  if (distanceDelta <= 0) return;

  for (const object of run.level.objects) {
    if (run.status !== 'running' || run.pendingRecruit !== null) break;
    if (run.collected.has(object.id) || object.z <= fromDistance || object.z > toDistance) continue;
    const progress = clamp((object.z - fromDistance) / distanceDelta, 0, 1);
    const collisionX = fromX + (toX - fromX) * progress;
    if (Math.abs(collisionX - object.lane) > LANE_HIT_RADIUS) continue;
    const collisionY = fromY + (toY - fromY) * progress;
    applyObject(run, object, collisionY);
  }
}

function resolveForkChoices(run, fromDistance, toDistance) {
  (run.level.forks || []).forEach((fork, forkIndex) => {
    if (fork.start <= fromDistance || fork.start > toDistance || run.branchChoices.some(choice => choice.forkIndex === forkIndex)) return;
    const side = run.x < 0 || run.targetLane < 0
      ? 'left'
      : run.x > 0 || run.targetLane > 0
        ? 'right'
        : fork.leftKind === 'coins' ? 'left' : 'right';
    run.targetLane = side === 'left' ? -1 : 1;
    run.branchChoices.push({
      forkIndex,
      side,
      kind: side === 'left' ? fork.leftKind : fork.rightKind,
      label: side === 'left' ? fork.leftLabel : fork.rightLabel
    });
    pushEvent(run, 'branch', `${side === 'left' ? 'Links' : 'Rechts'}: ${side === 'left' ? fork.leftLabel : fork.rightLabel}`);
  });
}

// At the finish the run waits in 'boss' status: the player evolves the team first, then calls fightBoss.
function reachBoss(run) {
  if (run.status !== 'running') return;
  run.distance = run.level.length;
  run.status = 'boss';
  pushEvent(run, 'boss-ready', `Eindbaas Lv ${run.level.bossLevel}! Evolueer je team.`);
}

// The strongest single dino has to be at least as high as the boss.
export function fightBoss(run) {
  if (!run || run.status !== 'boss') return false;
  run.events = [];
  if (strongestLevel(run) >= run.level.bossLevel) {
    run.status = 'won';
    pushEvent(run, 'boss-win', 'Eindbaas verslagen!');
  } else {
    run.status = 'lost';
    run.cause = 'boss';
    pushEvent(run, 'boss-loss', `Je sterkste dino is Lv ${strongestLevel(run)}; de eindbaas is Lv ${run.level.bossLevel}.`);
  }
  return true;
}

export function tick(run, dt) {
  if (!run) throw new TypeError('tick requires a run.');
  if (run.pendingRecruit !== null) return run;
  run.events = [];
  if (run.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return run;

  const simulatedDt = Math.min(dt, MAX_DT);
  const substeps = Math.ceil(simulatedDt / MAX_STEP);
  const step = simulatedDt / substeps;

  for (let index = 0; index < substeps && run.status === 'running'; index += 1) {
    const previousDistance = run.distance;
    const previousX = run.x;
    const previousY = run.y;

    run.x = moveTowards(run.x, run.targetLane, LANE_SPEED * step);
    if (run.x === run.targetLane) run.lane = run.targetLane;

    if (run.y > 0 || run.vy > 0) {
      run.y += run.vy * step - 0.5 * GRAVITY * step * step;
      run.vy -= GRAVITY * step;
      if (run.y <= 0) {
        run.y = 0;
        run.vy = 0;
      }
    }

    run.distance = Math.min(run.level.length, run.distance + run.level.speed * step);
    run.time += step;
    resolveObjects(run, previousDistance, run.distance, previousX, run.x, previousY, run.y);
    resolveForkChoices(run, previousDistance, run.distance);
    if (run.pendingRecruit !== null) break;
    if (run.status === 'running' && run.distance >= run.level.length) reachBoss(run);
  }

  return run;
}

export function stars(run) {
  if (!run || run.status !== 'won') return 1;
  if (run.hits === 0) return 3;
  if (run.hits <= 2) return 2;
  return 1;
}

export const ENGINE_LIMITS = Object.freeze({
  maxDt: MAX_DT,
  maxStep: MAX_STEP,
  laneSpeed: LANE_SPEED,
  jumpVelocity: JUMP_VELOCITY,
  gravity: GRAVITY,
  maxEvents: MAX_EVENTS,
  maxTeam: MAX_TEAM,
  leaderPower: LEADER_POWER,
  firstBossLevel: FIRST_BOSS_LEVEL,
  objectTypes: OBJECT_TYPES
});
