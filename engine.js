export const VERSION = '1.0.0';

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
const START_POWER = 10;

// Rocks, logs and lava store the percentage of the current power they take,
// so a hit shrinks the dinosaur instead of ending the run. Lava burns hardest.
function hazardDamage(type, world) {
  return type === 'lava' ? 30 + world : 20 + world;
}

export function hazardLoss(power, percent) {
  return Math.max(1, Math.ceil(power * percent / 100));
}

// A stronger rival knocks off half the difference, but never more than 40% of your power.
export function rivalLoss(power, value) {
  return Math.min(Math.max(2, Math.ceil((value - power) / 2)), Math.max(1, Math.ceil(power * 0.4)));
}

export function rivalReward(value) {
  return Math.max(2, Math.round(value * 0.25));
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
 * Route semantics
 * ---------------
 * `level.route` is an ordered list of controls which is known to finish the
 * generated level without a hit. At the instant `run.distance >= point.z`, a
 * controller should call `steer(run, point.lane)` and, when `jump` is true,
 * call `jump(run)` once. `z` is deliberately the action point before the
 * encounter rather than the object's position. Generated lane changes have at
 * least 7 world units of lead and jumps about 4, leaving useful touch-input
 * margin at every level speed. Route data is guidance, never special-cased by
 * the simulation.
 */
export function generateLevel(number) {
  validateLevelNumber(number);

  const world = Math.floor((number - 1) / 10);
  const random = mulberry32((number * 0x9E3779B1) >>> 0);
  const speed = Number((6 + (number - 1) * 0.035).toFixed(3));
  const length = Number((220 + (number - 1) * 3.2).toFixed(1));
  // Share of the growth on the safe route the player may miss and still beat
  // the boss: 70% in level 1, easing down to 22% in level 100.
  const progress = (number - 1) / 99;
  const slack = 0.22 + 0.48 * (1 - progress) ** 2;
  const encounterCount = 12 + Math.floor((number - 1) / 4);
  const jumpEvery = 7 - Math.floor((number - 1) / 25);
  const startZ = 28;
  const endZ = length - 26;
  const spacing = (endZ - startZ) / Math.max(1, encounterCount - 1);
  const objects = [];
  const route = [];
  let objectSequence = 0;
  let previousLane = 0;
  let routePower = START_POWER;

  const addObject = (z, lane, type, value) => {
    objects.push({
      id: `L${number}-O${++objectSequence}`,
      z: Number(z.toFixed(3)),
      lane,
      type,
      value
    });
  };

  for (let index = 0; index < encounterCount; index += 1) {
    const encounterZ = startZ + spacing * index;
    const laneChoices = LANES.filter(lane => lane !== previousLane || random() > 0.35);
    const safeLane = laneChoices[Math.floor(random() * laneChoices.length)] ?? previousLane;
    const mandatoryJump = index > 0 && (index + number) % jumpEvery === 0;
    const rewardSelector = (index + number + world) % 4;
    const rewardType = ['food', 'coin', 'gate', 'shield'][rewardSelector];
    const rewardValue = rewardType === 'food'
      ? 2 + ((index + number) % 3) + Math.floor(world / 4)
      : rewardType === 'gate'
        ? 4 + Math.floor(world / 2)
        : 1 + (rewardType === 'coin' && (index + number) % 5 === 0 ? 1 : 0);
    if (rewardType === 'food' || rewardType === 'gate') routePower += rewardValue;

    if (mandatoryJump) {
      const jumpHazards = ['log', 'rock', 'lava'];
      let hazardType = jumpHazards[(index + world) % jumpHazards.length];
      if (hazardType === 'lava' && number < LAVA_FROM_LEVEL) hazardType = 'rock';
      for (const lane of LANES) {
        addObject(encounterZ, lane, hazardType, hazardDamage(hazardType, world));
      }
      addObject(encounterZ + 1.6, safeLane, rewardType, rewardValue);
      route.push({ z: Number((encounterZ - 4).toFixed(3)), lane: safeLane, jump: true });
    } else {
      addObject(encounterZ, safeLane, rewardType, rewardValue);
      const blockedLanes = LANES.filter(lane => lane !== safeLane);
      const blockerCount = number <= 20 ? 1 : 2;
      // Vary which alternative is left open in the introductory worlds.
      if (random() > 0.5) blockedLanes.reverse();
      for (let blocker = 0; blocker < blockerCount; blocker += 1) {
        const lane = blockedLanes[blocker];
        const redGate = number >= 21 && (index + blocker + number) % 5 === 0;
        const hazardIndex = (index + blocker + world + number) % 4;
        let type = redGate ? 'gate' : ['rock', 'log', 'lava', 'rival'][hazardIndex];
        if (type === 'lava' && number < LAVA_FROM_LEVEL) type = 'rock';
        const value = redGate
          ? -(3 + world + ((index + number) % 3))
          : type === 'rival'
            ? 9 + world * 4 + index
            : hazardDamage(type, world);
        addObject(encounterZ, lane, type, value);
      }
      route.push({ z: Number((encounterZ - 7).toFixed(3)), lane: safeLane });
    }
    previousLane = safeLane;
  }

  objects.sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  const bossPower = START_POWER + Math.round((routePower - START_POWER) * (1 - slack));

  return {
    number,
    world,
    name: `${WORLDS[world].name} ${((number - 1) % 10) + 1}`,
    speed,
    length,
    bossPower,
    objects,
    route
  };
}

export function createRun(number) {
  const level = generateLevel(number);
  return {
    level,
    distance: 0,
    x: 0,
    lane: 0,
    targetLane: 0,
    y: 0,
    vy: 0,
    power: START_POWER,
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
  run.targetLane = clamp(Math.round(lane), -1, 1);
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

// Damage shrinks the dinosaur but never below 1 power: every run reaches the
// finish, where the boss decides. Failing therefore never costs a life.
function takeDamage(run, damage, event) {
  const loss = Math.min(damage, Math.max(0, run.power - 1));
  run.hits += 1;
  run.power -= loss;
  pushEvent(run, event, `-${loss} kracht`);
  return loss;
}

/**
 * `run.collected` holds every object that was consumed or smashed: pickups,
 * gates, eaten rivals and hazards that hit the dinosaur. A hazard that is
 * jumped over or dodged is not collected, so it stays visible behind the
 * player. Objects are only ever crossed once because distance only grows.
 */
function applyObject(run, object, collisionY) {
  const collect = () => run.collected.add(object.id);
  switch (object.type) {
    case 'food':
      collect();
      run.power += object.value;
      pushEvent(run, 'food', `+${object.value} kracht`);
      break;
    case 'coin':
      collect();
      run.coins += object.value;
      pushEvent(run, 'coin', `+${object.value} munt`);
      break;
    case 'gate':
      collect();
      if (object.value >= 0) {
        run.power += object.value;
        pushEvent(run, 'gate', `Groeipoort +${object.value}`);
      } else {
        const loss = Math.abs(object.value);
        takeDamage(run, loss, 'gate-loss');
      }
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
        const damage = hazardLoss(run.power, object.value);
        takeDamage(run, damage, 'hit');
      }
      break;
    }
    case 'lava':
      if (collisionY >= 0.58) break;
      if (!useShield(run, 'de lava')) {
        const damage = hazardLoss(run.power, object.value);
        takeDamage(run, damage, 'burn');
      }
      break;
    case 'rival':
      if (collisionY >= 1.05) break;
      collect();
      if (run.power >= object.value) {
        const reward = rivalReward(object.value);
        run.power += reward;
        pushEvent(run, 'rival-win', `Rivaal opgegeten: +${reward} kracht`);
      } else if (!useShield(run, 'de rivaal')) {
        const damage = rivalLoss(run.power, object.value);
        takeDamage(run, damage, 'rival-hit');
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
    if (run.status !== 'running') break;
    if (run.collected.has(object.id) || object.z <= fromDistance || object.z > toDistance) continue;
    const progress = clamp((object.z - fromDistance) / distanceDelta, 0, 1);
    const collisionX = fromX + (toX - fromX) * progress;
    if (Math.abs(collisionX - object.lane) > LANE_HIT_RADIUS) continue;
    const collisionY = fromY + (toY - fromY) * progress;
    applyObject(run, object, collisionY);
  }
}

function finish(run) {
  if (run.status !== 'running') return;
  run.distance = run.level.length;
  if (run.power >= run.level.bossPower) {
    run.status = 'won';
    pushEvent(run, 'boss-win', 'Eindbaas verslagen!');
  } else {
    run.status = 'lost';
    pushEvent(run, 'boss-loss', `Nog ${run.level.bossPower - run.power} kracht nodig.`);
  }
}

export function tick(run, dt) {
  if (!run) throw new TypeError('tick requires a run.');
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
    if (run.status === 'running' && run.distance >= run.level.length) finish(run);
  }

  return run;
}

export function stars(run) {
  if (!run || run.status !== 'won') return 1;
  const parTime = run.level.length / run.level.speed;
  if (run.hits === 0 && run.power >= run.level.bossPower && run.time <= parTime * 1.08) return 3;
  if (run.hits <= 2 && run.power >= run.level.bossPower && run.time <= parTime * 1.25) return 2;
  return 1;
}

export const ENGINE_LIMITS = Object.freeze({
  maxDt: MAX_DT,
  maxStep: MAX_STEP,
  laneSpeed: LANE_SPEED,
  jumpVelocity: JUMP_VELOCITY,
  gravity: GRAVITY,
  maxEvents: MAX_EVENTS,
  objectTypes: OBJECT_TYPES
});
