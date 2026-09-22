import { DINOS, MAX_LEVEL, dinoByTier, levelPower } from './dinos.js';

export const VERSION = '2.2.0';

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
// The leader is always a Lv 1 dino (power 1); a brand-new player gets one Lv 1 companion.
const LEADER_POWER = 1;
const START_TEAM = Object.freeze([0]);
const MAX_TEAM = 9;
const MAX_TIER = MAX_LEVEL - 1;
// Boss fight timing in seconds: a short stand-off, then exchanges of blows (team first, the boss answers).
const FIGHT_INTRO = 1.1;
const FIGHT_EXCHANGE = 0.9;
const FIGHT_OUTRO = 0.8;
const FIGHT_SWING = Object.freeze([1.15, 0.8, 1.05, 0.9, 1.25, 0.85, 1.1, 0.95, 1.2, 0.75]);
// A boss is several times as strong as a normal dino of its own level.
const BOSS_MULTIPLIERS = Object.freeze([2, 2.5, 3, 3.5]);
const HELPER_FLOOR = 0.9;
const HELPER_RETRY_STEP = 0.02;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateLevelNumber(number) {
  if (!Number.isInteger(number) || number < 1 || number > 100) {
    throw new RangeError('Level number must be an integer from 1 through 100.');
  }
}

const sumPower = tiers => tiers.reduce((sum, tier) => sum + (dinoByTier(tier)?.power || 0), 0);

/**
 * Economy
 * -------
 * The team travels with the player from level to level. REFERENCE follows a player who
 * beats every rival on the route: the power they bring into a level, the rivals of that
 * level and the power at the finish. Team power grows along a smooth curve from 17 after
 * level 1 to about four million after level 100 (a few Lv 21 dinos).
 *
 * The boss asks a share of the reference power at the finish; the rest is room for missed
 * rivals and dinos lost to traps. Its dino level is chosen so that it is 2 to 7 times (on
 * average about 4 times) as strong as a normal dino of that level: only the whole team
 * together can beat it.
 */
function targetPower(number) {
  return 2 ** (4.1 + 17.9 * ((number - 1) / 99) ** 0.75);
}

// Share of the reference power the boss does not ask: generous at the start, tight at the end.
export function slackFor(number) {
  return 0.3 - 0.12 * (number - 1) / 99;
}

// Level offsets around a base level for three or four rivals, in rising order. Their
// weights (sum of 2^offset) cover a whole doubling, so a level's total can follow the
// growth curve closely instead of jumping by powers of two.
const RIVAL_SHAPES = Object.freeze({
  3: [[-1, 0, 1], [0, 0, 1], [-1, 1, 1], [0, 1, 1], [-1, 0, 2], [0, 0, 2]],
  4: [[-1, -1, 0, 1], [-1, 0, 0, 1], [0, 0, 0, 1], [-1, 0, 1, 1], [0, 0, 1, 1], [-1, 0, 0, 2], [0, 1, 1, 1]]
});

// Three or four rivals per level whose power adds up to the growth of that level.
function planRivals(number, start) {
  if (number === 1) return [0, 1, 2, 3];
  const wanted = Math.max(1, targetPower(number) - start);
  let best = null;
  for (const shape of RIVAL_SHAPES[number % 3 === 0 ? 3 : 4]) {
    const weight = shape.reduce((sum, offset) => sum + 2 ** offset, 0);
    for (const base of [Math.floor(Math.log2(wanted / weight)), Math.ceil(Math.log2(wanted / weight))]) {
      const tiers = shape.map(offset => clamp(base + offset, 0, MAX_TIER));
      const miss = Math.abs(Math.log(sumPower(tiers) / wanted));
      if (!best || miss < best.miss - 1e-9) best = { tiers, miss };
    }
  }
  return best.tiers;
}

const REFERENCE = (() => {
  const table = [];
  let start = LEADER_POWER + 1;
  let bossLevel = 1;
  for (let number = 1; number <= 100; number += 1) {
    const rivals = Object.freeze(planRivals(number, start));
    const end = start + sumPower(rivals);
    const bossPower = Math.round(end * (1 - slackFor(number)));
    const multiplier = BOSS_MULTIPLIERS[(number + 3) % BOSS_MULTIPLIERS.length];
    // Boss levels never go down from one level to the next.
    bossLevel = clamp(Math.max(bossLevel, Math.floor(Math.log2(bossPower / multiplier)) + 1), 1, MAX_LEVEL);
    table.push(Object.freeze({ start, rivals, end, bossPower, bossLevel }));
    start = end;
  }
  return Object.freeze(table);
})();

export function bossLevelFor(number) {
  validateLevelNumber(number);
  return REFERENCE[number - 1].bossLevel;
}

/**
 * A team with the reference power at the start of a level, for players whose save has no
 * team yet (v2.1 and older) and for tests. Power sits in a few big dinos plus some small
 * ones in front of them, because traps take the smallest dino first.
 */
export function referenceTeam(number) {
  validateLevelNumber(number);
  let rest = REFERENCE[number - 1].start - LEADER_POWER;
  const team = [];
  while (rest >= 1 && team.length < MAX_TEAM) {
    const tier = Math.min(MAX_TIER, Math.floor(Math.log2(rest)));
    team.push(tier);
    rest -= levelPower(tier + 1);
  }
  while (team.length < 6) {
    const smallest = team.reduce((best, tier, index) => tier > 0 && (best < 0 || tier < team[best]) ? index : best, -1);
    if (smallest < 0) break;
    team[smallest] -= 1;
    team.push(team[smallest]);
  }
  team.sort((left, right) => right - left);
  return team.length ? team : [...START_TEAM];
}

// Traps knock dinos out of the team, smallest first: rocks, logs and red gates one, lava two.
export function trapLoss(type) {
  return type === 'lava' ? 2 : 1;
}

// A rival can be beaten up to twice the team power. Touching a stronger rival ends the run.
export function canBeat(power, value) {
  return power * 2 >= value;
}

function sanitizeTeam(team) {
  const clean = Array.isArray(team)
    ? team.filter(tier => Number.isInteger(tier) && dinoByTier(tier)).slice(0, MAX_TEAM)
    : [];
  return clean.length ? clean : [...START_TEAM];
}

/**
 * Safety net. Traps take dinos for good, and they take the smallest first, which are
 * usually the rivals just won. A team can therefore shrink over many levels until the
 * next boss (or even the rivals) is out of reach for good. A team that starts a level
 * below HELPER_FLOOR of the boss power gets up to three helper dinos, up to that floor
 * (never above the reference start, so level 1 always starts small). From the floor a
 * team still has to win most rivals of the level without many traps to beat the boss.
 * Every failed try of the same level (`retries`) lifts the floor a little, up to the boss
 * power itself after five: then keeping more than the traps take is enough.
 */
export function helpersFor(number, team, retries = 0) {
  validateLevelNumber(number);
  const reference = REFERENCE[number - 1];
  const share = Math.min(1, HELPER_FLOOR + HELPER_RETRY_STEP * Math.max(0, Math.floor(retries) || 0));
  const floor = Math.round(Math.min(reference.start, reference.bossPower * share));
  const result = [...team];
  const helpers = [];
  let power = LEADER_POWER + sumPower(result);
  for (let k = 0; k < 3 && power < floor; k += 1) {
    const tier = clamp(Math.floor(Math.log2(floor - power)), 0, MAX_TIER);
    if (result.length >= MAX_TEAM) {
      const ascending = result.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
      const pair = ascending.findIndex(([value], index) => index + 1 < ascending.length && value === ascending[index + 1][0] && value < MAX_TIER);
      if (pair >= 0) {
        const [keep, remove] = [ascending[pair][1], ascending[pair + 1][1]].sort((a, b) => a - b);
        result[keep] += 1;
        result.splice(remove, 1);
      } else if (tier > ascending[0][0]) {
        power -= levelPower(ascending[0][0] + 1);
        result.splice(ascending[0][1], 1);
      } else break;
    }
    result.push(tier);
    helpers.push(tier);
    power += levelPower(tier + 1);
  }
  return { team: result, helpers };
}

// The whole team fights together: the leader plus every team dino.
export function teamPower(run) {
  if (!run) return LEADER_POWER;
  return LEADER_POWER + sumPower(Array.isArray(run.team) ? run.team : []);
}

// Level of the strongest team dino right now (the leader alone counts as Lv 1).
export function strongestLevel(run) {
  return run?.team?.length ? Math.max(...run.team) + 1 : 1;
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

function moveTowards(value, target, maximumDelta) {
  if (Math.abs(target - value) <= maximumDelta) return target;
  return value + Math.sign(target - value) * maximumDelta;
}

function pushEvent(run, type, message) {
  if (run.events.length >= MAX_EVENTS) return;
  const event = message ? { type, message } : { type };
  run.events.push(event);
}

/**
 * Route semantics
 * ---------------
 * `level.route` is an ordered list of controls which is known to finish the
 * generated level without a hit and while beating every rival on it. At the
 * instant `run.distance >= point.z`, a controller should call
 * `steer(run, point.lane)` and, when `jump` is true, call `jump(run)` once.
 * Route data is guidance, never special-cased by the simulation.
 *
 * Dinos on the road: only the three or four rivals of the level, two of them on
 * the bridges of the forks. (A red dino that the team cannot beat would have to be
 * more than twice the team, and so stronger than the boss; v2.2 has none. A team
 * far below the reference can still meet a rival it cannot beat.)
 */
export function generateLevel(number) {
  validateLevelNumber(number);

  const reference = REFERENCE[number - 1];
  const world = Math.floor((number - 1) / 10);
  const random = mulberry32((number * 0x9E3779B1) >>> 0);
  const speed = Number((8.5 + (number - 1) * 0.035).toFixed(3));
  const totalEncounters = 14 + Math.floor((number - 1) / 4);
  const length = Number((220 + (number - 1) * 3.2).toFixed(1));
  const startZ = 28;
  const endZ = length - 26;
  const spacing = (endZ - startZ) / (totalEncounters - 1);
  const jumpEvery = 5 - Math.floor((number - 1) / 34);
  const isJump = index => index > 0 && (index + number) % jumpEvery === 0;
  const forks = new Set([Math.floor(totalEncounters / 3), Math.floor(totalEncounters * 2 / 3)]);
  const open = Array.from({ length: totalEncounters }, (_, index) => index).filter(index => index > 0 && !forks.has(index) && !isJump(index));
  const used = new Set();
  const pick = fraction => {
    let best = null;
    for (const index of open) {
      if (used.has(index)) continue;
      if (best === null || Math.abs(index / (totalEncounters - 1) - fraction) < Math.abs(best / (totalEncounters - 1) - fraction)) best = index;
    }
    used.add(best);
    return best;
  };

  // Rivals in rising order: the smallest near the start, the forks in the middle, the biggest near the end.
  const extra = reference.rivals.length - forks.size;
  const rivalRows = [...forks, ...Array.from({ length: extra }, (_, k) => pick(extra === 1 ? 0.1 : 0.1 + 0.8 * k / (extra - 1)))].sort((a, b) => a - b);
  const rivalAt = new Map(rivalRows.map((index, k) => [index, reference.rivals[k]]));

  const objects = [];
  const route = [];
  const forkList = [];
  let objectSequence = 0;
  let previousLane = 0;

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
        const tier = rivalAt.get(index);
        addObject(encounterZ, safeLane, 'rival', rivalValue(tier), tier);
        addObject(encounterZ + 2.2, safeLane, 'coin', 1);
      } else if (index > 0) {
        addObject(encounterZ, safeLane, rewardType, rewardValue);
      }
      // Two of the three lanes are always blocked by traps.
      for (const lane of LANES.filter(item => item !== safeLane)) {
        const [type, value] = trapFor(index, lane);
        addObject(encounterZ, lane, type, value);
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
    bossLevel: reference.bossLevel,
    bossTier: reference.bossLevel - 1,
    bossPower: reference.bossPower,
    rivals: reference.rivals,
    reference: { start: reference.start, end: reference.end },
    objects,
    route,
    forks: forkList
  };
}

// A run starts with the player's own team, which is kept between levels (plus helpers when it fell far behind).
// `retries` counts the failed tries of this level in a row.
export function createRun(number, team = START_TEAM, { retries = 0 } = {}) {
  const level = generateLevel(number);
  const start = helpersFor(number, sanitizeTeam(team), retries);
  return {
    level,
    distance: 0,
    x: 0,
    lane: 0,
    targetLane: 0,
    y: 0,
    vy: 0,
    power: LEADER_POWER,
    team: start.team,
    helpers: start.helpers,
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
    fight: null,
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

// At the finish the run waits in 'boss' status until the player starts the fight (fightBoss).
function reachBoss(run) {
  if (run.status !== 'running') return;
  run.distance = run.level.length;
  run.status = 'boss';
  pushEvent(run, 'boss-ready', `Eindbaas Lv ${run.level.bossLevel} met ⚡ ${run.level.bossPower}!`);
}

/**
 * The boss fight: the power of the whole team against the boss. The team wins when its
 * power is at least the boss power, but the fight is played out in 6 to 10 exchanges
 * (closer fights last longer). Every blow is proportional to the attacker's power, so the
 * loser's health runs out on the last exchange and the winner keeps 1 - (loser/winner)²
 * of its health. `run.fight.hits` is the complete script; `tick` plays it out, and the
 * run becomes 'won' or 'lost' shortly after the last blow.
 */
export function fightBoss(run) {
  if (!run || run.status !== 'boss') return false;
  run.events = [];
  const team = teamPower(run);
  const boss = run.level.bossPower;
  const teamWins = team >= boss;
  const winner = Math.max(team, boss);
  const loser = Math.min(team, boss);
  const exchanges = Math.round(6 + 4 * loser / winner);
  const swing = FIGHT_SWING.slice(0, exchanges);
  const scale = loser / (winner * swing.reduce((sum, weight) => sum + weight, 0));
  const hits = [];
  let teamHp = team;
  let bossHp = boss;
  let teamLeft = team;
  let bossLeft = boss;
  for (let k = 0; k < exchanges; k += 1) {
    const at = FIGHT_INTRO + k * FIGHT_EXCHANGE;
    const last = k === exchanges - 1;
    bossLeft -= team * scale * swing[k];
    const nextBoss = teamWins && last ? 0 : Math.max(0, Math.round(bossLeft));
    hits.push({ at, side: 'team', damage: bossHp - nextBoss, teamHp, bossHp: nextBoss });
    bossHp = nextBoss;
    if (teamWins && last) break;
    teamLeft -= boss * scale * swing[k];
    const nextTeam = !teamWins && last ? 0 : Math.max(teamWins ? 1 : 0, Math.round(teamLeft));
    hits.push({ at: at + FIGHT_EXCHANGE / 2, side: 'boss', damage: teamHp - nextTeam, teamHp: nextTeam, bossHp });
    teamHp = nextTeam;
  }
  run.fight = {
    time: 0,
    hits,
    next: 0,
    endAt: Number((hits[hits.length - 1].at + FIGHT_OUTRO).toFixed(3)),
    teamMax: team,
    bossMax: boss,
    teamHp: team,
    bossHp: boss,
    winner: teamWins ? 'team' : 'boss',
    lastHit: null
  };
  run.status = 'fight';
  pushEvent(run, 'fight-start', `⚡ ${team} tegen ⚡ ${boss}`);
  return true;
}

function advanceFight(run, dt) {
  const fight = run.fight;
  fight.time += dt;
  while (fight.next < fight.hits.length && fight.hits[fight.next].at <= fight.time) {
    const hit = fight.hits[fight.next];
    fight.next += 1;
    fight.teamHp = hit.teamHp;
    fight.bossHp = hit.bossHp;
    fight.lastHit = { id: fight.next, side: hit.side, damage: hit.damage, at: hit.at };
    if (run.events.length < MAX_EVENTS) run.events.push({ type: 'fight-hit', side: hit.side, damage: hit.damage });
  }
  if (fight.time < fight.endAt) return;
  if (fight.winner === 'team') {
    run.status = 'won';
    pushEvent(run, 'boss-win', 'Eindbaas verslagen!');
  } else {
    run.status = 'lost';
    run.cause = 'boss';
    pushEvent(run, 'boss-loss', `Je team had ⚡ ${fight.teamMax}, de eindbaas ⚡ ${fight.bossMax}.`);
  }
}

export function tick(run, dt) {
  if (!run) throw new TypeError('tick requires a run.');
  if (run.pendingRecruit !== null) return run;
  run.events = [];
  if (!Number.isFinite(dt) || dt <= 0) return run;
  if (run.status === 'fight') {
    advanceFight(run, Math.min(dt, MAX_DT));
    return run;
  }
  if (run.status !== 'running') return run;

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
  objectTypes: OBJECT_TYPES,
  fight: Object.freeze({ intro: FIGHT_INTRO, exchange: FIGHT_EXCHANGE, outro: FIGHT_OUTRO, minExchanges: 6, maxExchanges: 10 })
});
