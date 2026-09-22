import { dinoByTier } from './dinos.js';

// Stable key schema; do not change across application updates. New fields are optional.
export const SKINS = Object.freeze([
  { id: 'groen', name: 'Palmgroen', price: 0, body: 0x71dc52, belly: 0xd5f59c, spikes: 0xffd744 },
  { id: 'oceaan', name: 'Oceaanblauw', price: 25, body: 0x46b7f0, belly: 0xd4f3ff, spikes: 0xff8fb8 },
  { id: 'zonsondergang', name: 'Zonsondergang', price: 60, body: 0xff9a3d, belly: 0xffe3a8, spikes: 0xd8435e },
  { id: 'kristal', name: 'Kristalpaars', price: 120, body: 0x9a74f0, belly: 0xe7dcff, spikes: 0x63f4ff },
  { id: 'lava', name: 'Lavarood', price: 200, body: 0xe8483f, belly: 0xffc36b, spikes: 0x3a2433 },
  { id: 'goud', name: 'Gouden legende', price: 320, body: 0xf2c230, belly: 0xfff1b8, spikes: 0xffffff }
]);
const SKIN_IDS = new Set(SKINS.map(skin => skin.id));
const MAX_BANK = 1_000_000;
const MAX_TEAM = 9;
// v2.3 changed the power rules (power = level). A team saved under older rules (no or another
// teamVersion) is not loaded; the game then gives a team that fits the unlocked level.
export const TEAM_VERSION = 3;

// The collection book: every dino form (tier) the player has ever had in the team or beaten as boss.
function cleanSeen(seen) {
  const clean = Array.isArray(seen) ? seen.filter(tier => Number.isInteger(tier) && dinoByTier(tier)) : [];
  return [...new Set([0, ...clean])].sort((a, b) => a - b);
}

// v2.2: the team travels from level to level. null = not saved yet (older saves); the game then picks a fitting team.
function cleanTeam(team) {
  return Array.isArray(team) ? team.filter(tier => Number.isInteger(tier) && dinoByTier(tier)).slice(0, MAX_TEAM) : null;
}

export function skinById(id) {
  return SKINS.find(skin => skin.id === id) || SKINS[0];
}

export function readProgress(raw) {
  let value; try { value = JSON.parse(raw); } catch { value = null; }
  const result = { unlocked:1, best:{}, sound:false, bank:0, skins:['groen'], skin:'groen', seen:[0], team:null, teamVersion:TEAM_VERSION };
  if (!value || typeof value !== 'object') return result;
  const unlocked = Number(value.unlocked);
  if (Number.isInteger(unlocked)) result.unlocked = Math.max(1, Math.min(100, unlocked));
  if (value.best && typeof value.best === 'object') for (const [key,rating] of Object.entries(value.best)) {
    const level=Number(key); if (Number.isInteger(level) && level>=1 && level<=100 && Number.isInteger(rating) && rating>=1 && rating<=3) result.best[level]=rating;
  }
  result.sound = value.sound === true;
  if (Number.isInteger(value.bank)) result.bank = Math.max(0, Math.min(MAX_BANK, value.bank));
  if (Array.isArray(value.skins)) result.skins = ['groen', ...new Set(value.skins.filter(id => SKIN_IDS.has(id) && id !== 'groen'))];
  if (result.skins.includes(value.skin)) result.skin = value.skin;
  // Forms of an old team still count as discovered, even when the team itself is not loaded.
  const savedTeam = cleanTeam(value.team);
  result.team = value.teamVersion === TEAM_VERSION ? savedTeam : null;
  result.seen = cleanSeen([...(Array.isArray(value.seen) ? value.seen : []), ...(savedTeam || [])]);
  return result;
}
// Stores the team as it is now (wins, losses and merges all count) and adds its forms to the collection book.
// Returns the same object when nothing changed, so callers can skip saving.
export function keepTeam(progress, team) {
  const clean = cleanTeam(team) || [];
  const same = Array.isArray(progress.team) && progress.team.length === clean.length && progress.team.every((tier, index) => tier === clean[index]);
  const discovered = discover(progress, clean);
  return same ? discovered : { ...discovered, team: clean };
}
// Returns the same object when nothing new was discovered, so callers can skip saving.
export function discover(progress, tiers) {
  const seen = cleanSeen([...progress.seen, ...(Array.isArray(tiers) ? tiers : [])]);
  return seen.length === progress.seen.length ? progress : { ...progress, seen };
}
export function completeLevel(progress, number, rating) {
  if (!Number.isInteger(number) || number < 1 || number > 100 || number > progress.unlocked) return progress;
  return { ...progress, unlocked:Math.min(100,Math.max(progress.unlocked,number+1)), best:{...progress.best,[number]:Math.max(progress.best[number]||0,Math.max(1,Math.min(3,Math.floor(rating))))} };
}
// Coins from every run (won or lost) go into the bank, so trying again always pays off.
export function addCoins(progress, coins) {
  if (!Number.isInteger(coins) || coins <= 0) return progress;
  return { ...progress, bank: Math.min(MAX_BANK, progress.bank + coins) };
}
export function buySkin(progress, id) {
  const skin = SKINS.find(item => item.id === id);
  if (!skin || progress.skins.includes(id) || progress.bank < skin.price) return progress;
  return { ...progress, bank: progress.bank - skin.price, skins: [...progress.skins, id], skin: id };
}
export function selectSkin(progress, id) {
  if (!progress.skins.includes(id)) return progress;
  return { ...progress, skin: id };
}
