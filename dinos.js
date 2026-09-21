const SHAPES = new Set(['raptor', 'frill', 'armored', 'plates', 'sail', 'longneck', 'wing']);

const catalog = [
  ['Mosflits', 0.72, 0x76d65b, 0xd9f3a7, 0xffdf55, 'raptor', false, 'Een kleine, alerte sprinter met lange achterpoten en een gestreepte staart.'],
  ['Kraagknabbel', 0.78, 0x43c9a5, 0xcdf8ce, 0xff8c6b, 'frill', false, 'Een ronde planteneter met een korte snuit en een opvallende waaiervormige nekkraag.'],
  ['Keikop', 0.84, 0x8ac45c, 0xe7e09d, 0x7f6f55, 'armored', false, 'Een lage viervoeter met zware wenkbrauwplaten en een knotsvormige staart.'],
  ['Zonplaat', 0.91, 0xf0a747, 0xffe2a1, 0xd95763, 'plates', false, 'Een stevige rugdrager met hoge, warmgekleurde platen van nek tot staart.'],
  ['Rivierkam', 0.99, 0x47b6c9, 0xc9f0e9, 0x275f8b, 'sail', false, 'Een lenige oeverjager met een golvende rugkam en brede zwemvoeten.'],
  ['Bladnek', 1.08, 0x65b56e, 0xd4efad, 0xf3ca52, 'longneck', false, 'Een jonge langnek met bladachtige huidflappen en een rustige, hoge tred.'],
  ['Vonksprong', 1.17, 0xd96b49, 0xffc783, 0x572e58, 'raptor', false, 'Een gespierde tweebenige jager met sikkelklauwen en vonkvormige rugveren.'],
  ['Wolkveer', 1.27, 0x70c8ef, 0xe4f5ff, 0xff8fb8, 'wing', true, 'Een lichte zwever met brede veren, een lange staartwaaier en kleine grijppoten.'],
  ['Schilddoorn', 1.38, 0x738f55, 0xd6d09a, 0xc45b45, 'armored', false, 'Een brede pantserdino met schouderstekels en een rij benige knobbels.'],
  ['Stormsnavel', 1.50, 0x6676cb, 0xd9defb, 0xf1b84b, 'wing', true, 'Een krachtige vlieger met een geknikte snavel en puntige stormvleugels.'],
  ['Maanzeil', 1.63, 0x6752a8, 0xded1f2, 0x76e0dc, 'sail', false, 'Een lange visjager met een halve-maanvormig zeil en een smalle krokodillensnuit.'],
  ['Koraalkroon', 1.77, 0xe76c83, 0xffd5bd, 0x6c3f8f, 'frill', false, 'Een forse kuddebeschermer met een geschulpte kraag en drie stompe kroonthoorns.'],
  ['Hemelrog', 1.92, 0x4fa4bb, 0xcfedf0, 0xffcd63, 'wing', true, 'Een grote zwever met rogachtige vleugels en een lange balanskam.'],
  ['IJzerstaart', 2.08, 0x596b65, 0xbec7aa, 0xe47b4f, 'armored', false, 'Een massieve grondloper met overlappende platen en een dubbele staartknots.'],
  ['Donderplaat', 2.25, 0x397783, 0xb7e1d3, 0xf0bf46, 'plates', false, 'Een reusachtige planteneter met bliksemvormige rugplaten en zware voorpoten.'],
  ['Auroravlerk', 2.43, 0x7168d9, 0xe4dcff, 0x62e1b4, 'wing', true, 'Een hoogvlieger met lichtende vleugelranden en een gekuifde kop.'],
  ['Oerwoudtoren', 2.62, 0x4d9453, 0xcce49d, 0xf1a64c, 'longneck', false, 'Een torenhoge langnek met een bladerdakpatroon en zuilvormige poten.'],
  ['Lavaklauw', 2.82, 0xb9433f, 0xf5a06a, 0x342d42, 'raptor', false, 'Een enorme jager met basaltkleurige klauwen en een vurige verenmantel.'],
  ['Gletsjerkraag', 3.03, 0x82c9dc, 0xeaf8f3, 0x536db4, 'frill', false, 'Een kolossale viervoeter met een ijskristalachtige kraag en brede sneeuwpoten.'],
  ['Komeetwiek', 3.25, 0x51468f, 0xcac5ec, 0x72f2cf, 'wing', true, 'Een gigantische hemelheerser met sikkelvleugels en een fonkelende staartsluier.'],
  ['Eilanddrager', 3.50, 0x39705c, 0xd8d09b, 0xffcf57, 'longneck', false, 'De grootste vorm: een kalme oerreus met rotsrug, boomkruinpatroon en een eindeloze nek.']
];

// Dino level = tier + 1. Power doubles per level (Lv 1 = 1, Lv 6 = 32, Lv 21 = 1.048.576),
// so evolving two equal dinos into one of the next level never loses power; it frees a team slot.
export const MAX_LEVEL = catalog.length;

export function levelPower(level) {
  return 2 ** (level - 1);
}

export const DINOS = Object.freeze(catalog.map(([name, size, body, belly, spikes, shape, flying, description], tier) => {
  if (!SHAPES.has(shape)) throw new Error(`Ongeldige dinovorm: ${shape}`);
  return Object.freeze({ tier, level: tier + 1, id: `dino-${String(tier).padStart(2, '0')}`, name, power: levelPower(tier + 1), size, body, belly, spikes, shape, flying, description });
}));

export function dinoByTier(tier) {
  return Number.isInteger(tier) && tier >= 0 && tier < DINOS.length ? DINOS[tier] : null;
}
