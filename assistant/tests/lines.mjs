// Checks what Likkle Jeff says in his speech bubble (lines.js): short enough for a phone, the right lines in the right
// places at the right times, never the same line twice running, and about half the time one for the page he's on.
//   node assistant/tests/lines.mjs
import { ANYWHERE, ON_PAGE, SIGNED_OUT, MORNING, AFTERNOON, FRIDAY, named, pickLine, moodFor } from '../lines.js';

const problems = [];
const MAX = 30;   // one line on a phone
const fixed = [...ANYWHERE, ...Object.values(ON_PAGE).flat(), ...SIGNED_OUT, MORNING, AFTERNOON, FRIDAY];
for (const l of [...fixed, ...named('Faye')]) if (l.length > MAX) problems.push(`"${l}" is ${l.length} characters; keep lines to ${MAX}`);
if (new Set(fixed).size !== fixed.length) problems.push('a line appears twice in lines.js');

let seed = 7;   // a repeatable random, so a failure can be run again
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const monday10 = new Date(2026, 8, 28, 10), friday15 = new Date(2026, 9, 2, 15), sunday21 = new Date(2026, 9, 4, 21);
const N = 4000;
function run(opts) {
  const seen = new Map();
  let last = '';
  for (let i = 0; i < N; i++) {
    const l = pickLine({ random, ...opts, last });
    if (l === last) problems.push(`said "${l}" twice running`);
    last = l;
    seen.set(l, (seen.get(l) || 0) + 1);
  }
  return seen;
}

// Signed out: lines about signing in, never a tool's line or a name.
const out = run({ page: 'speeding', signedIn: false, name: 'Faye Turner', now: monday10 });
for (const l of out.keys()) if (Object.values(ON_PAGE).flat().includes(l) || /Faye/.test(l)) problems.push(`signed out, he said "${l}"`);
if (!SIGNED_OUT.every(l => out.has(l))) problems.push('signed out, the lines about signing in never came');

// Each page: its own lines about half the time, never another page's; her first name now and then.
for (const [page, mine] of Object.entries(ON_PAGE)) {
  const seen = run({ page, signedIn: true, name: 'Faye Turner', now: monday10 });
  if (!mine.every(l => seen.has(l))) problems.push(`${page}: its own lines never came`);
  for (const [other, theirs] of Object.entries(ON_PAGE)) if (other !== page && theirs.some(l => seen.has(l))) problems.push(`${page}: said a line for ${other}`);
  const share = mine.reduce((n, l) => n + (seen.get(l) || 0), 0) / N;
  if (share < 0.4 || share > 0.6) problems.push(`${page}: its own lines came ${(share * 100).toFixed(0)}% of the time, meant to be about half`);
  if (!named('Faye').every(l => seen.has(l))) problems.push(`${page}: never used her first name`);
}

// A page without lines of its own, and nobody's name: lines from anywhere and for the time only.
const bare = run({ page: 'fitters', signedIn: true, name: '', now: monday10 });
for (const l of bare.keys()) if (![...ANYWHERE, MORNING].includes(l)) problems.push(`no page lines and no name, yet he said "${l}"`);

// The time of day and week.
const fri = run({ page: 'hub', signedIn: true, now: friday15 });
if (!fri.has(AFTERNOON) || !fri.has(FRIDAY) || fri.has(MORNING)) problems.push('Friday afternoon: the wrong lines for the time');
const mon = run({ page: 'hub', signedIn: true, now: monday10 });
if (!mon.has(MORNING) || mon.has(AFTERNOON) || mon.has(FRIDAY)) problems.push('Monday morning: the wrong lines for the time');
const late = run({ page: 'hub', signedIn: true, now: sunday21 });
if ([MORNING, AFTERNOON, FRIDAY].some(l => late.has(l))) problems.push('Sunday evening: a line for another time');

// His face as he says it.
if (moodFor('Thumbs up, or need a hand?') !== 'idle' || moodFor(FRIDAY) !== 'cheer' || moodFor('Need a hand?') !== 'care') problems.push('moodFor: the wrong face');

console.log(`lines.js: ${fixed.length} lines, plus two with a first name; ${N} picks for each case`);
if (problems.length) { console.log('PROBLEMS'); for (const p of [...new Set(problems)].slice(0, 20)) console.log('  ' + p); process.exit(1); }
console.log('all good: short enough, in the right places at the right times, never twice running, about half for the page');
