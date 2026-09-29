/* ============================================================================
   FLR Hub Assistant: what Likkle Jeff says in his speech bubble when a page
   goes quiet (assistant.js decides when). Lines stay short (about 30
   characters, one line on a phone) and never offer what he can't do: he can
   explain how, show where and look up your own records, but he can't book,
   approve or change anything. Check changes with: node assistant/tests/lines.mjs
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
  fitters: ['Looking for a free fitter?', 'Jobs need a fitter? Ask me', 'Want one fitter’s fortnight?', 'What does Clash mean? Ask me'],
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
