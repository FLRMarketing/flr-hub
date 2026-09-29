/* ============================================================================
   FLR Hub Assistant: the search engine.
   Finds the approved help answer that best fits a question, entirely in the
   browser: no AI model, no server and no records. Everyday words are mapped to
   the Hub's own ("holiday" is leave, "quote" is an estimate), small typos are
   forgiven, and when nothing fits well enough it says so instead of guessing.
   Also runs under Node for the tests in assistant/tests/.
   ========================================================================== */

// Phrases are folded before single words, so "log in" isn't read as a log, "bank holiday" isn't annual leave and
// "work from home" isn't the Hub's home screen.
const PHRASES = [
  [/\bhow (much|many) (days? (of )?)?(annual leave|holidays?|leave|time off|days?( off)?)\b/g, ' balance leave '],
  [/\bbank (holidays?|hols?)\b/g, ' closure '],
  [/\b(book|take|have|get|put) (me |myself |us |some |a |the |in )?(days? |time )?off\b/g, ' request leave '],
  [/\b(who is|whos|who are) (off|away|out|absent|on (annual leave|holidays?|leave|vacation))\b/g, ' whosoff leave '],
  [/\b(annual leave|time off|days? off|holidays?|vacations?|annual holidays?)\b/g, ' leave '],
  [/\bwork(ing)? (from|at) home\b/g, ' wfh '],
  [/\bget (it|them|that|this) back\b/g, ' restore '],
  [/\b(in|up|through|there|ready) yet\b|\b(up to|out of) date\b|\bhow often\b/g, ' refresh '],
  [/\bgr[ae]y(ed)? out\b/g, ' locked '],
  [/\bby (accident|mistake)\b/g, ' '],
  [/\b(wasnt|was not|werent|were not|isnt|is not) (me|us|mine)\b|\b(someone|somebody) else\b/g, ' otherdriver '],
  [/\bwho (else )?(can|could|will|would) (see|view|look at|access)\b/g, ' privacy '],
  [/\b(can|could|will|do) (other|others|anyone|everyone|other people|people|my manager|managers|the office) (else )?(see|view)\b/g, ' privacy '],
  [/\b(has|have|is|was|did|are|were) (my|our)\b|\bmy own\b/g, ' self '],
  [/\b(log ?in|sign ?in|logon|log on)\b/g, ' signin '],
  [/\b(log ?out|sign ?out|logoff|log off)\b/g, ' signout '],
  [/\b(sign ?up|register)\b/g, ' account '],   // not "registration": that's a number plate here
  [/\bpass ?code\b/g, ' passcode '],
  [/\bpass ?word\b/g, ' password '],
  [/\bfleet ?view\b/g, ' fleetview '],
  [/\bwork ?programme\b/g, ' workprogramme '],
  [/\bmonday(\.com| boards?| items?)\b/g, ' mondaycom '],   // plain "Monday" is a day of the week
];

const STOP = new Set(('a an the i im ive id me my mine we weve our us you youre your yours he she they theyre them his her their it its this that thats these those ' +
  'do does did done doing to of in on for and or but is are was were be been being am can could would should will shall may might must ' +
  'cant dont doesnt didnt isnt arent wasnt werent wont wouldnt couldnt shouldnt havent hasnt ill ' +
  'how what where when which who whom why whats wheres hows whos there theres here with at from as by into onto about up out over if so just ' +
  'get got have has had please want wanted need needed any some much many more most very really also still then than too yet already ' +
  'find see show look looking go going thing things way ok okay hi hello hey thanks thank cheers able let lets tell know help put enter fill ' +
  'today tomorrow yesterday tonight morning afternoon week weeks month months year years ' +
  'actually literally basically only even ever again another one ones other others someone somebody anyone anybody everyone everybody ' +
  'something anything everything come came comes coming keep keeps kept say says said saying use using used made take took taken ' +
  'give gave given try tried trying bit lot lots loads stuff sort kind info information lads lad guys mate lol pls plz thx ta oh um erm ' +
  'like right sure maybe guess think sorry quick quickly now currently soon later anymore never since until till while during via per etc ' +
  'difference different between mistake mistakes accident accidentally problem problems issue issues almost nearly exactly ' +
  'monday tuesday wednesday thursday friday saturday sunday').split(/\s+/));

// Words that only break ties: a match adds a little, a miss costs nothing.
const SOFT = new Set(['self']);

// Everyday wording -> the words the Hub's help is written in.
const SYN = new Map(Object.entries({
  quote: 'estimate', quotes: 'estimate', quotation: 'estimate', quotations: 'estimate', estimate: 'estimate', estimates: 'estimate',
  estimator: 'estimate', estimating: 'estimate', costing: 'estimate', costings: 'estimate', tender: 'estimate', tenders: 'estimate',
  price: 'price', prices: 'price', pricing: 'price', priced: 'price', rate: 'price', rates: 'price',
  project: 'project', projects: 'project', job: 'job', jobs: 'job', site: 'job', sites: 'job',
  client: 'client', clients: 'client', customer: 'client', customers: 'client',
  reassign: 'reassign', move: 'reassign', moving: 'reassign', moved: 'reassign', transfer: 'reassign',
  similar: 'similar', identical: 'similar', template: 'similar',
  leave: 'leave', holiday: 'leave', holidays: 'leave', hol: 'leave', hols: 'leave', absence: 'leave', absences: 'leave', vacation: 'leave',
  closure: 'closure', closures: 'closure', shutdown: 'closure', christmas: 'closure',
  sick: 'sickness', sickness: 'sickness', illness: 'sickness',
  speeding: 'speed', speed: 'speed', speeds: 'speed', mph: 'speed', fast: 'speed', limit: 'speed',
  driving: 'drive', driver: 'drive', drivers: 'drive', drive: 'drive', drove: 'drive', driven: 'drive',
  van: 'vehicle', vans: 'vehicle', car: 'vehicle', cars: 'vehicle', vehicle: 'vehicle', vehicles: 'vehicle', lorry: 'vehicle', truck: 'vehicle',
  fleet: 'fleet', telematics: 'fleet', tracker: 'fleet', tracking: 'fleet',
  reg: 'registration', registration: 'registration', plate: 'registration', numberplate: 'registration',
  mot: 'mot', service: 'service', servicing: 'service', insurance: 'insurance', tax: 'tax',
  incident: 'incident', incidents: 'incident', event: 'incident', events: 'incident', offence: 'incident', offences: 'incident',
  score: 'score', scores: 'score', performance: 'score', braking: 'score', harsh: 'score', cornering: 'score', acceleration: 'score',
  map: 'map', maps: 'map', location: 'map', locations: 'map', hotspot: 'map', hotspots: 'map',
  fitter: 'fitter', fitters: 'fitter', fit: 'fitter', fitting: 'fitter', fitted: 'fitter', installer: 'fitter', installers: 'fitter', operative: 'fitter', operatives: 'fitter', floorer: 'fitter',
  schedule: 'schedule', schedules: 'schedule', rota: 'schedule', rotas: 'schedule', planner: 'schedule', allocation: 'schedule',
  calendar: 'calendar', diary: 'calendar', calender: 'calendar',
  free: 'free', available: 'free', availability: 'free', spare: 'free', unassigned: 'free',
  approve: 'approve', approval: 'approve', approvals: 'approve', approver: 'approve', approvers: 'approve', approving: 'approve',
  authorise: 'approve', authorize: 'approve', accept: 'approve', accepted: 'approve', sanction: 'approve', signoff: 'approve',
  decline: 'decline', reject: 'decline', refuse: 'decline', deny: 'decline', denied: 'decline',
  request: 'request', requests: 'request', book: 'request', booking: 'request', apply: 'request', application: 'request', submit: 'request',
  new: 'new', start: 'new', create: 'new', begin: 'new', make: 'new', add: 'new', raise: 'new',
  cancel: 'cancel', withdraw: 'cancel', remove: 'cancel', delete: 'cancel', undo: 'cancel',
  change: 'edit', edit: 'edit', amend: 'edit', update: 'edit', alter: 'edit',
  balance: 'balance', remaining: 'balance', left: 'balance', allowance: 'balance', allowances: 'balance', entitlement: 'balance', entitled: 'balance',
  password: 'password', forgot: 'forgot', forgotten: 'forgot', reset: 'forgot', lost: 'forgot',
  account: 'account', accounts: 'account', profile: 'account',
  admin: 'admin', administrator: 'admin', administrators: 'admin', manager: 'admin', managers: 'admin', boss: 'admin',
  link: 'link', linked: 'link', linking: 'link', connect: 'link', unlinked: 'link',
  access: 'access', permission: 'access', permissions: 'access', allowed: 'access', blocked: 'access',
  private: 'privacy', privacy: 'privacy', confidential: 'privacy',
  print: 'print', pdf: 'print', export: 'print', download: 'print',
  search: 'search', filter: 'search', filters: 'search',
  size: 'measurement', sizes: 'measurement', measure: 'measurement', measurements: 'measurement', dimensions: 'measurement', sqm: 'measurement',
  last: 'previous', old: 'previous', older: 'previous', past: 'previous', earlier: 'previous', previous: 'previous', previously: 'previous',
  assistant: 'assistant', chat: 'assistant', chatbot: 'assistant', bot: 'assistant', ai: 'assistant',
}));

// A light stemmer, so "approve", "approves", "approved" and "approving" are one word: plurals first, then -ing/-ed, then
// a final e.
function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 4 && /(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else return s.length > 4 && s.endsWith('e') ? s.slice(0, -1) : s;
  if (s.length === 3 && /[^aeiou][aeiouy][^aeiouwxy]$/.test(s)) return s + 'e';   // "making", "saved": back to "make", "save"
  return s.length > 4 && s.endsWith('e') ? s.slice(0, -1) : s;
}
const SYN_STEM = new Map([...SYN].map(([k, v]) => [stem(k), v]));
const canon = raw => SYN.get(raw) || SYN_STEM.get(stem(raw)) || stem(raw);
const keep = w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w);

// The words of a question after folding phrases and dropping filler, as typed (for typo matching) and as understood.
function words(text) {
  let s = ' ' + String(text || '').toLowerCase().replace(/[’'‘`]/g, '').replace(/[^a-z0-9\s.-]/g, ' ') + ' ';
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  const out = [];
  for (const raw of s.split(/[\s.-]+/)) {
    if (!raw || STOP.has(raw)) continue;
    const w = canon(raw);
    if (keep(w)) out.push([raw, w]);
  }
  return out;
}
export const tokens = text => words(text).map(p => p[1]);

const pairs = t => t.slice(1).map((w, i) => t[i] + ' ' + w);

// Everything a help entry can be found by, weighted: the ways people ask it and its keywords most, its title next,
// and the answer text least.
export function buildIndex(entries) {
  const lex = new Map();   // every word the help knows, as written -> as understood, for forgiving typos
  for (const [k, v] of SYN) lex.set(k, v);
  const docs = entries.map(e => {
    const all = [...(e.ask || []), ...(e.keys || []), e.title, e.answer, ...(e.steps || [])].join(' ');
    for (const [raw, w] of words(all)) lex.set(raw, w);
    const ask = (e.ask || []).map(tokens);
    return {
      e, ask,
      askSet: new Set(ask.flat()), askPairs: new Set(ask.flatMap(pairs)),
      keys: new Set((e.keys || []).flatMap(tokens)), title: new Set(tokens(e.title)),
      body: new Set(tokens([e.answer, ...(e.steps || [])].join(' '))),
    };
  });
  const df = new Map();
  for (const d of docs) for (const t of new Set([...d.askSet, ...d.keys, ...d.title, ...d.body])) df.set(t, (df.get(t) || 0) + 1);
  return { docs, df, n: docs.length, lex: [...lex] };
}

// Optimal string alignment distance, giving up once it's over the limit.
function near(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}
// A word the help doesn't know is probably a typo of one it does ("holliday", "estimater"), if one is close enough.
function understood(index, raw, w) {
  if (index.df.has(w) || SOFT.has(w) || raw.length < 5) return w;
  const max = raw.length >= 8 ? 2 : 1;
  let best = null, bestD = max + 1;
  for (const [k, v] of index.lex) {
    if (k[0] !== raw[0] && k[1] !== raw[1]) continue;   // typos rarely change both of the first two letters
    const dd = near(raw, k, max);
    if (dd < bestD && index.df.has(v)) { best = v; bestD = dd; }
  }
  return best || w;
}

// How much a word says: rare words more than common ones. A word no answer uses counts as rare, so a question that is
// mostly about something the help doesn't cover (a person's name, the weather) is not "confidently" answered.
const idfOf = (index, t) => Math.log(1 + index.n / (index.df.get(t) || 1));

export const MIN_SCORE = 8;        // tuned on assistant/tests/questions.json (node assistant/tests/run.mjs --sweep)
export const MIN_COVERAGE = 0.55;   // a question must be mostly about what the answer covers
// Below that, close matches are offered as "Did you mean" suggestions, but only these: anything weaker gets "I couldn't
// find that" rather than a list of unrelated answers.
export const MAYBE_SCORE = 9, MAYBE_COVERAGE = 0.3;
export const maybes = r => {
  const top = r.results[0];
  if (!top || top.score < MAYBE_SCORE || top.coverage < MAYBE_COVERAGE) return [];
  return r.results.filter(x => x.score >= Math.max(MAYBE_SCORE, top.score * 0.6) && x.coverage >= 0.25).slice(0, 3);
};

// While someone is still typing, the last word may be unfinished: "estim" could be estimate or estimator. Each word the
// help knows that starts that way is tried, and the one that fits the rest of the question best wins.
function completions(index, raw, w) {
  if (index.df.has(w) || raw.length < 3) return [w];
  const out = new Set();
  for (const [k, v] of index.lex) if (k.startsWith(raw) && index.df.has(v)) out.add(v);
  return out.size ? [...out].slice(0, 8) : [w];
}

export function search(index, query, ctx = {}) {
  const ws = words(query);
  const typing = ctx.typing && ws.length && !/\s$/.test(query);
  const head = (typing ? ws.slice(0, -1) : ws).map(([raw, w]) => understood(index, raw, w));
  if (!typing) return rank(index, head, ctx);
  const [raw, w] = ws[ws.length - 1];
  let best = null;
  for (const c of completions(index, raw, w)) {
    const r = rank(index, [...head, c], ctx);
    if (!best || (r.results[0] ? r.results[0].score : 0) > (best.results[0] ? best.results[0].score : 0)) best = r;
  }
  return best;
}

function rank(index, all, ctx) {
  const q = [...new Set(all)];
  if (!q.length) return { terms: q, confident: false, results: [] };
  const qPairs = new Set(pairs(all));
  const total = q.reduce((n, t) => n + (SOFT.has(t) ? 0 : idfOf(index, t)), 0);
  const results = [];
  for (const d of index.docs) {
    let s = 0, hit = 0;
    for (const t of q) {
      // [how much it scores, how much it counts as "covering" the question]: a word only in the answer text covers less
      const [f, c] = d.keys.has(t) ? [3, 1] : d.askSet.has(t) ? [2.5, 1] : d.title.has(t) ? [2, 1] : d.body.has(t) ? [0.8, 0.5] : [0, 0];
      if (!f) continue;
      if (SOFT.has(t)) { s += f * 0.5; continue; }
      const w = idfOf(index, t);
      s += f * w; hit += c * w;
    }
    if (!s) continue;
    let close = 0;
    for (const a of d.ask) {
      if (!a.length) continue;
      const inter = a.filter(t => q.includes(t)).length;
      close = Math.max(close, inter / (new Set([...a, ...q]).size));
    }
    for (const p of qPairs) if (d.askPairs.has(p)) s += 1.5;
    const coverage = total ? hit / total : 0;
    let score = s * (0.4 + 0.6 * coverage) + 6 * close;
    if (ctx.page && d.e.tool === ctx.page) score *= 1.12;   // the page you're on breaks near-ties
    results.push({ entry: d.e, score: Math.round(score * 100) / 100, coverage: Math.round(coverage * 100) / 100 });
  }
  results.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const top = results[0];
  return { terms: q, confident: !!top && top.score >= MIN_SCORE && top.coverage >= MIN_COVERAGE, results: results.slice(0, 5) };
}
