// Small, original vector portraits. Geometry follows the playable 3D species.
export function dinoPortrait(dino) {
  const color = n => `#${n.toString(16).padStart(6, '0')}`;
  const horn = (x, y, h = 15) => `<path d="M${x - 5} ${y}l5 -${h} 5 ${h}z" fill="${color(dino.spikes)}"/>`;
  const wings = dino.flying ? `<path d="M62 48L9 ${20 - dino.tier / 3}l10 34 24 -3 18 12M65 47l39 -31 -4 37 -19 1 -16 10" fill="${color(dino.spikes)}" stroke="${color(dino.body)}" stroke-width="4"/>` : '';
  const long = dino.shape === 'longneck';
  const headY = long ? 22 : 40;
  const plates = ['plates', 'sail', 'armored'].includes(dino.shape)
    ? Array.from({length: 3 + dino.tier % 3}, (_, i) => horn(34 + i * 9, 43, dino.shape === 'sail' ? 22 : 10 + i % 2 * 6)).join('') : '';
  const frill = dino.shape === 'frill' ? `<ellipse cx="78" cy="${headY}" rx="16" ry="20" fill="${color(dino.spikes)}"/>${horn(91, headY - 8, 12 + dino.tier % 8)}` : '';
  const club = dino.shape === 'armored' ? `<ellipse cx="13" cy="54" rx="9" ry="7" fill="${color(dino.spikes)}"/>` : '';
  const beak = dino.flying ? `<path d="M92 ${headY - 1}l22 6 -23 5" fill="${color(dino.spikes)}"/>` : '';
  return `<svg viewBox="0 0 128 94" aria-hidden="true" focusable="false"><ellipse cx="62" cy="83" rx="43" ry="5" fill="#194b3e15"/>${wings}<path d="M45 61Q20 65 10 45Q28 52 47 43" fill="${color(dino.body)}"/>${club}${plates}<ellipse cx="59" cy="56" rx="29" ry="21" fill="${color(dino.body)}"/><ellipse cx="67" cy="61" rx="17" ry="13" fill="${color(dino.belly)}"/><path d="M45 66l-5 14h15l4 -14M72 66l1 14h16l-9 -17" stroke="${color(dino.body)}" stroke-width="9" stroke-linejoin="round" fill="none"/>${long ? `<path d="M75 55Q83 33 82 23" stroke="${color(dino.body)}" stroke-width="17" fill="none"/>` : ''}${frill}<ellipse cx="88" cy="${headY}" rx="18" ry="14" fill="${color(dino.body)}"/>${beak}<ellipse cx="98" cy="${headY + 5}" rx="13" ry="8" fill="${color(dino.belly)}"/><circle cx="93" cy="${headY - 4}" r="5" fill="white"/><circle cx="95" cy="${headY - 4}" r="2.5" fill="#193c35"/>${dino.shape === 'raptor' ? horn(77, headY - 10, 6 + dino.tier % 11) : ''}</svg>`;
}
