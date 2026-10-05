/* ============================================================================
   FLR Hub Assistant: what Likkle Jeff says.
   - His speech bubble when a page goes quiet (jeff.js decides when). Lines stay
     short (about 30 characters, one line on a phone) and never offer what he
     can't do: he can explain how, show where and look up your own records, but
     he can't book, approve or change anything, and he can't look up a tool's own
     lists (who's free, which jobs need a fitter). They don't quote a tool's date
     range either, which changes: the Fitter Schedule outgrew "a fortnight".
   - In the chat: what he can and can't do (CAN_DO), and under every answer,
     where it comes from (sourceLine).
   Check changes with: node assistant/tests/lines.mjs and node assistant/tests/sources.mjs
   ========================================================================== */
export const ANYWHERE = [
  'Ask me for help', 'Need a hand?', 'Stuck? Just ask me', 'Looking for something?', 'I’m here if you need me',
  'Go on, ask me anything', 'Questions? I’ve got answers',
  'The boss is in. Ask away', 'Thumbs up, or need a hand?', 'I don’t bite. Ask away', 'Two heads are better than one',
];
// For the page he's on (assistant.js's PAGE), once signed in. Signed out, a page is about signing in, unless it has its
// own way in.
export const ON_PAGE = {
  hub: ['Not sure where to start?', 'Which tool do you need?'],
  'annual-leave': ['Planning time off? Ask me', 'Days left? Just ask me'],
  speeding: ['When’s your MOT due? Ask me', 'Want to check your driving?'],
  estimator: ['Need a hand with a quote?', 'Stuck on an estimate?'],
  fitters: ['Looking for a free fitter?', 'New to the Jobs tab? Ask me', 'One fitter’s days? Ask me how', 'What does Clash mean? Ask me'],
};
// Pages with their own way in (the Fitter Schedule's passcode) keep their lines for people not signed in to the Hub.
export const OWN_ACCESS = new Set(['fitters']);
export const SIGNED_OUT = ['Can’t sign in? Ask me', 'Forgotten your password?'];
export const MORNING = 'Morning! Need anything?', AFTERNOON = 'Afternoon! Stuck on something?', FRIDAY = 'Happy Friday! Need a hand?';
export const named = first => [`Need a hand, ${first}?`, `Alright ${first}? Need anything?`];

// One line for now: half the time one for the page he's on (signed out: for signing in), a fifth of the time one with
// their first name or for the time of day or week, otherwise one from anywhere. Never the line he said last.
export function pickLine({ page = 'hub', signedIn = false, name = '', now = new Date(), last = '', random = Math.random } = {}) {
  const first = signedIn ? String(name).trim().split(/\s+/)[0] : '';
  const mine = signedIn || OWN_ACCESS.has(page) ? ON_PAGE[page] || [] : SIGNED_OUT;
  const extra = [];
  const h = now.getHours();
  if (h >= 5 && h < 12) extra.push(MORNING); else if (h >= 12 && h < 18) extra.push(AFTERNOON);
  if (now.getDay() === 5) extra.push(FRIDAY);
  if (first) extra.push(...named(first));
  const r = random();
  for (const pool of r < 0.5 ? [mine, ANYWHERE] : r < 0.7 ? [extra, ANYWHERE] : [ANYWHERE]) {
    const options = pool.filter(l => l !== last);
    if (options.length) return options[Math.floor(random() * options.length)];
  }
  return ANYWHERE[0];
}

// His face as he says it: the open hand ("here to help"), except where the line says otherwise.
export const moodFor = line => /^Thumbs up/.test(line) ? 'idle' : /^Happy Friday/.test(line) ? 'cheer' : 'care';

// What he can and can't do: a card at the start of every conversation, and with "What Likkle Jeff can do" (help.json's
// assistant-about, whose answer starts with the same sentence).
export const CAN_DO = {
  title: 'What I can do',
  lead: 'I can explain the Hub and look up your own figures. I can’t book, approve or change anything.',
  can: ['Show you how and where, with a link', 'Look up leave, driving, vehicles and quotations', 'Say where each answer comes from'],
  cant: ['Book, approve, cancel or edit anything', 'Guess: if I don’t know, I’ll say so'],
};

// The line under every answer: where it comes from. Help answers: "Hub help", with the day the answer was last updated
// when help.json gives one ("updated": "2026-10-01" shows "Hub help · updated 1 Oct"). Look-ups (records.js sets
// source on each card): "Live", the tool, when its data was last synced if the data says (UK time, with the day when it
// wasn't today), "may be out of date" if the data says its latest sync failed, and "read-only". A time only ever comes
// from the data: without one, the line says nothing about when.
const UK = 'Europe/London';
const valid = d => d instanceof Date && !Number.isNaN(+d);
const ukDay = d => {   // the UK date, "2026-10-05"
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: UK, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = t => p.find(x => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
};
const dayOf = (d, now, zone) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(ukDay(d).slice(0, 4) !== ukDay(now).slice(0, 4) ? { year: 'numeric' } : {}), timeZone: zone });
export function sourceLine(src, now = new Date()) {
  if (!src) return '';
  if (src.help) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(src.updated || '') ? new Date(src.updated + 'T12:00:00Z') : null;
    return valid(d) ? `Hub help · updated ${dayOf(d, now, 'UTC')}` : 'Hub help';
  }
  const bits = ['Live', src.tool], at = src.at ? new Date(src.at) : null;
  if (valid(at)) {
    const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK });
    bits.push(`synced ${ukDay(at) === ukDay(now) ? time : `${dayOf(at, now, UK)}, ${time}`}`);
  }
  if (src.stale) bits.push('may be out of date');
  bits.push('read-only');
  return bits.filter(Boolean).join(' · ');
}
