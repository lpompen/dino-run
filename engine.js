import { DINOS, MAX_LEVEL, dinoByTier, levelPower } from './dinos.js';

export const VERSION = '2.0.0';

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
// The leader is always a Lv 1 dino (power 1); every run starts with one Lv 1 companion.
const LEADER_POWER = 1;
const START_TEAM = Object.freeze([0]);
const MAX_TEAM = 9;
const FIRST_BOSS_LEVEL = 6;

export function bossLevelFor(number) {
  return FIRST_BOSS_LEVEL + Math.round((MAX_LEVEL - FIRST_BOSS_LEVEL) * (number - 1) / 99);
}

// Rocks, logs, lava and red gates take a percentage of the current team power.
// Damage is temporary for this run and never goes below the leader's own power.
function hazardDamage(type, world) {
  return type === 'lava' ? 24 + world : 14 + world;
}

export function hazardLoss(power, percent) {
  return Math.max(1, Math.ceil(power * percent / 100));
}

// A rival can be beaten up to one level above the team: at most twice the team power.
// Only the boss asks for the team's full strength.
export function canBeat(power, value) {
  return power * 2 >= value;
}

// A stronger rival knocks off half the difference, but never more than 40% of your power.
export function rivalLoss(power, value) {
  return Math.min(Math.max(1, Math.ceil((value - power) / 2)), Math.max(1, Math.ceil(power * 0.4)));
}

function sanitizeTeam(team) {
  const clean = Array.isArray(team)
    ? team.filter(tier => Number.isInteger(tier) && dinoByTier(tier)).slice(0, MAX_TEAM)
    : [];
  return clean.length ? clean : [...START_TEAM];
}

function fullPower(run) {
  return LEADER_POWER + sanitizeTeam(run.team).reduce((sum, tier) => sum + dinoByTier(tier).power, 0);
}

export function teamPower(run) {
  if (!run) return LEADER_POWER;
  const full = fullPower(run);
  const damage = Number.isFinite(run.teamDamage) ? clamp(run.teamDamage, 0, full - LEADER_POWER) : 0;
  return full - damage;
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
  run.merges = (run.merges || 0) + 1;
  pushEvent(run, 'merge', `${dinoByTier(tier + 1).name} · Lv ${tier + 2} ontstaan!`);
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
    run.merges = (run.merges || 0) + 1;
    pushEvent(run, 'merge', `${dinoByTier(incoming + 1).name} · Lv ${incoming + 2} ontstaan!`);
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
 * boss, in rising order. Beating each one doubles the team roughly, so the next
 * is just within reach; the last step brings the team exactly to boss strength.
 * Some levels appear twice (spare rivals): in level 1 all of them, in level 100
 * about a third. Spares are what make up for a missed rival or a bump.
 */
function rivalLadder(bossTier, number) {
  const steps = bossTier;
  const spareShare = 1 - 0.65 * (number - 1) / 99;
  const spares = Math.round(steps * spareShare);
  const spareTiers = new Set();
  for (let index = 0; index < spares; index += 1) spareTiers.add(steps - 1 - Math.floor(index * steps / spares));
  const ladder = [];
  for (let tier = 0; tier < steps; tier += 1) {
    ladder.push(tier);
    if (spareTiers.has(tier)) ladder.push(tier);
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
  const encounterCount = 12 + Math.floor((number - 1) / 4);
  const bossLevel = bossLevelFor(number);
  const bossTier = bossLevel - 1;
  const bossPower = levelPower(bossLevel);
  const ladder = rivalLadder(bossTier, number);
  const jumpEvery = 7 - Math.floor((number - 1) / 25);
  const isJump = index => index > 0 && (index + number) % jumpEvery === 0;
  const forkSet = total => new Set([Math.floor(total / 3), Math.floor(total * 2 / 3)]);
  const slotsFor = total => {
    const forkIndexes = forkSet(total);
    return Array.from({ length: total }, (_, index) => index).filter(index => forkIndexes.has(index) || !isJump(index));
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

  for (let index = 0; index < totalEncounters; index += 1) {
    const encounterZ = startZ + spacing * index;
    const rewardSelector = (index + number + world) % 4;
    const rewardType = ['food', 'coin', 'gate', 'shield'][rewardSelector];
    const rewardValue = rewardType === 'food'
      ? 6 + ((index + number) % 3) * 2
      : rewardType === 'gate'
        ? 12 + Math.floor(world / 2)
        : 1 + (rewardType === 'coin' && (index + number) % 5 === 0 ? 1 : 0);

    if (forks.has(index)) {
      const tier = rivalAt.get(index);
      ladderTier = tier;
      const recruitLane = (number + index) % 2 === 0 ? -1 : 1;
      addObject(encounterZ, recruitLane, 'rival', rivalValue(tier), tier);
      addObject(encounterZ, -recruitLane, 'coin', 3);
      addObject(encounterZ, 0, 'rock', hazardDamage('rock', world));
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
      const jumpHazards = ['log', 'rock', 'lava'];
      let hazardType = jumpHazards[(index + world) % jumpHazards.length];
      if (hazardType === 'lava' && number < LAVA_FROM_LEVEL) hazardType = 'rock';
      for (const lane of LANES) addObject(encounterZ, lane, hazardType, hazardDamage(hazardType, world));
      addObject(encounterZ + 1.6, safeLane, rewardType, rewardValue);
      route.push({ z: Number((encounterZ - 4).toFixed(3)), lane: safeLane, jump: true });
    } else {
      if (rivalAt.has(index)) {
        ladderTier = rivalAt.get(index);
        addObject(encounterZ, safeLane, 'rival', rivalValue(ladderTier), ladderTier);
        addObject(encounterZ + 2.2, safeLane, 'coin', 1); // a coin behind every ladder rival keeps the shop reachable
      } else {
        addObject(encounterZ, safeLane, rewardType, rewardValue);
      }
      const blockedLanes = LANES.filter(lane => lane !== safeLane);
      const blockerCount = number <= 20 ? 1 : 2;
      if (random() > 0.5) blockedLanes.reverse();
      for (let blocker = 0; blocker < blockerCount; blocker += 1) {
        const lane = blockedLanes[blocker];
        const redGate = number >= 21 && (index + blocker + number) % 5 === 0;
        const hazardIndex = (index + blocker + world + number) % 4;
        let type = redGate ? 'gate' : ['rock', 'log', 'lava', 'rival'][hazardIndex];
        if (type === 'lava' && number < LAVA_FROM_LEVEL) type = 'rock';
        // Blocking rivals are three levels above the ladder: red for a normal run, a prize when you are well ahead.
        const eliteTier = Math.min(MAX_LEVEL - 1, ladderTier + 3);
        const value = redGate
          ? -(10 + world + ((index + number) % 3))
          : type === 'rival' ? rivalValue(eliteTier) : hazardDamage(type, world);
        addObject(encounterZ, lane, type, value, type === 'rival' ? eliteTier : null);
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
    teamDamage: 0,
    pendingRecruit: null,
    recruited: 0,
    merges: 0,
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

// Damage drains the team for this run only, never the leader's own power.
function takeDamage(run, damage, event) {
  const loss = Math.min(damage, Math.max(0, teamPower(run) - LEADER_POWER));
  run.hits += 1;
  run.teamDamage += loss;
  pushEvent(run, event, `-${loss} teamkracht`);
  return loss;
}

// Food and green gates restore a percentage of the team's full strength.
function heal(run, percent, event, label) {
  const amount = Math.min(run.teamDamage, Math.ceil(fullPower(run) * percent / 100));
  run.teamDamage -= amount;
  pushEvent(run, event, amount > 0 ? `${label} +${amount} kracht` : `${label}: team is fit`);
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
      heal(run, object.value, 'food', 'Smikkel');
      break;
    case 'coin':
      collect();
      run.coins += object.value;
      pushEvent(run, 'coin', `+${object.value} munt`);
      break;
    case 'gate':
      collect();
      if (object.value >= 0) heal(run, object.value, 'gate', 'Herstelpoort');
      else takeDamage(run, hazardLoss(teamPower(run), Math.abs(object.value)), 'gate-loss');
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
      if (!useShield(run, object.type === 'rock' ? 'de rots' : 'de boomstam')) {
        takeDamage(run, hazardLoss(teamPower(run), object.value), 'hit');
      }
      break;
    }
    case 'lava':
      if (collisionY >= 0.58) break;
      if (!useShield(run, 'de lava')) takeDamage(run, hazardLoss(teamPower(run), object.value), 'burn');
      break;
    case 'rival':
      if (collisionY >= 1.05) break;
      collect();
      if (canBeat(teamPower(run), object.value)) {
        pushEvent(run, 'rival-win', `${dinoByTier(object.tier).name} verslagen!`);
        recruitDino(run, object.tier);
      } else if (!useShield(run, 'de rivaal')) {
        takeDamage(run, rivalLoss(teamPower(run), object.value), 'rival-hit');
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

function finish(run) {
  if (run.status !== 'running') return;
  run.distance = run.level.length;
  if (teamPower(run) >= run.level.bossPower) {
    run.status = 'won';
    pushEvent(run, 'boss-win', 'Eindbaas verslagen!');
  } else {
    run.status = 'lost';
    pushEvent(run, 'boss-loss', `Nog ${run.level.bossPower - teamPower(run)} teamkracht nodig.`);
  }
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
    if (run.status === 'running' && run.distance >= run.level.length) finish(run);
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
