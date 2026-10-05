// Checks that every answer from Likkle Jeff says where it comes from, and his "What I can do" card:
//   node assistant/tests/sources.mjs
// - sourceLine (lines.js) words it: "Hub help", "Hub help · updated 1 Oct", "Live · Annual Leave · synced 10:42 ·
//   read-only" (UK time, with the day when it wasn't today), "may be out of date" when the data says its latest sync
//   failed, and nothing about when if the data gives no time.
// - Every look-up in records.js, run on made-up data with this file standing in for the FLR database (nothing goes
//   over the network): each card names its tool and carries exactly the time its data gives, never one of its own,
//   and a card that couldn't be looked up carries none.
// - help.json: any "updated" is a real day that has happened; "What Likkle Jeff can do" says the card's sentence.
// - CAN_DO: the agreed sentence, and items short enough for one line in the chat.
import { readFileSync } from 'node:fs';
import { sourceLine, CAN_DO } from '../lines.js';

const problems = [];
const same = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };

/* ---------------------------------------------------------------- the wording */
const NOW = new Date('2026-10-05T12:00:00Z');   // 13:00 in the UK (summer time)
const words = [
  [{ help: true }, 'Hub help'],
  [{ help: true, updated: '2026-10-01' }, 'Hub help · updated 1 Oct'],
  [{ help: true, updated: '2025-12-24' }, 'Hub help · updated 24 Dec 2025'],
  [{ help: true, updated: '1 Oct' }, 'Hub help'],                                    // not a day it can read: no date
  [{ tool: 'Annual Leave', at: '2026-10-05T09:42:13.123456+00:00' }, 'Live · Annual Leave · synced 10:42 · read-only'],
  [{ tool: 'Annual Leave', at: '2026-10-04T23:30:00Z' }, 'Live · Annual Leave · synced 00:30 · read-only'],   // already the 5th in the UK
  [{ tool: 'Fleet Management', at: '2026-10-02T16:05:00Z' }, 'Live · Fleet Management · synced 2 Oct, 17:05 · read-only'],
  [{ tool: 'Fleet Management', at: '2025-12-31T23:30:00Z' }, 'Live · Fleet Management · synced 31 Dec 2025, 23:30 · read-only'],
  [{ tool: 'Fleet Management', at: '2026-10-05T08:15:00Z', stale: true }, 'Live · Fleet Management · synced 09:15 · may be out of date · read-only'],
  [{ tool: 'Cost Estimator', at: null }, 'Live · Cost Estimator · read-only'],
  [{ tool: 'Annual Leave', at: 'not a time' }, 'Live · Annual Leave · read-only'],     // never a made-up time
];
for (const [src, want] of words) same(`sourceLine(${JSON.stringify(src)})`, sourceLine(src, NOW), want);

/* ---------------------------------------------------------------- what he can and can't do */
same('CAN_DO.lead', CAN_DO.lead, 'I can explain the Hub and look up your own figures. I can’t book, approve or change anything.');
if (CAN_DO.can.length < 2 || CAN_DO.cant.length < 1) problems.push('CAN_DO: needs what he can do and what he can’t');
for (const t of [...CAN_DO.can, ...CAN_DO.cant]) if (t.length > 50) problems.push(`CAN_DO: "${t}" is ${t.length} characters; keep items to 50 (one line in the chat)`);
if (!/\bbook\b/i.test(CAN_DO.cant.join(' ')) || !/\bapprove\b/i.test(CAN_DO.cant.join(' '))) problems.push('CAN_DO: what he can’t do must say booking and approving');

/* ---------------------------------------------------------------- the help */
const help = JSON.parse(readFileSync(new URL('../help.json', import.meta.url), 'utf8'));
for (const e of help.entries) {
  if (!('updated' in e)) continue;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(e.updated || '') ? new Date(e.updated + 'T12:00:00Z') : null;
  if (!d || Number.isNaN(+d) || d.toISOString().slice(0, 10) !== e.updated) problems.push(`entry ${e.id}: "updated" must be a day, as YYYY-MM-DD`);
  else if (d > new Date()) problems.push(`entry ${e.id}: "updated" is in the future`);
}
const about = help.entries.find(e => e.id === 'assistant-about');
if (!about || !about.answer.includes(CAN_DO.lead.replace(/\.$/, ''))) problems.push('help.json: "What Likkle Jeff can do" (assistant-about) must say the card’s sentence');

/* ---------------------------------------------------------------- the look-ups, on made-up data */
// The FLR database, played here: each function's reply (or { refuse: [status, code, detail] }, or 'offline').
let db = {};
globalThis.window = { FLR_CONFIG: { supabaseUrl: 'https://flr.example.test', supabaseAnonKey: 'anon-key' } };
globalThis.localStorage = { getItem: k => k === 'flr-estimator-auth' ? JSON.stringify({ access_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-faye' } }) : null };
globalThis.fetch = async url => {
  const x = db[String(url).split('/rpc/')[1]];
  if (x === 'offline') throw new TypeError('fetch failed');
  if (x && x.refuse) return { ok: false, status: x.refuse[0], json: async () => ({ message: x.refuse[1], details: x.refuse[2] }) };
  if (x === undefined) return { ok: false, status: 404, json: async () => ({ code: 'PGRST202', message: 'no such function' }) };
  return { ok: true, status: 200, json: async () => structuredClone(x) };
};
const { lookUp } = await import('../records.js');

// Annual Leave: two made-up people on the allowances board, one request each.
const person = (id, name, email) => ({ id, name, column_values: [{ id: 'numeric_mm7mkptt', text: '20' }, { id: 'email_mm7mfw2y', text: email }] });
const request = (id, name, staff, from, to, decision) => ({ id, name, created_at: '2026-09-30T10:00:00Z', column_values: [
  { id: 'multi_selectfix3go54', text: name }, { id: 'date_rangeguqisxa9', value: JSON.stringify({ from, to }) },
  { id: 'color_mm7m6q47', label: decision }, { id: 'board_relation_mm7ms0ah', linked_item_ids: [staff] }] });
const SYNCED = '2026-10-05T09:42:13.123456+00:00';
const leaveHome = access => ({
  me: { name: 'Faye Turner', email: 'faye.turner@example.com' }, access, linked: true, version: 7, lastFullSync: SYNCED, syncError: null,
  today: { off: [{ name: 'Pat Example', part: 'all' }], weekend: false, closure: null }, wpIssues: [],
  boards: {
    req: [request('201', 'Faye Turner', '101', '2027-02-01', '2027-02-03', 'Accepted'), ...(access === 'approver' ? [request('202', 'Pat Example', '102', '2027-03-01', '2027-03-01', '')] : [])],
    alw: [person('101', 'Faye Turner', 'faye.turner@example.com'), ...(access === 'approver' ? [person('102', 'Pat Example', 'pat.example@example.com')] : [])],
    grp: [], clo: [], oth: [],
  },
});
// Fleet Management, as an administrator sees it: one van, its driving, and both sync records.
const GEN = '2026-10-05T08:30:00Z', CHECKED = '2026-10-05T09:15:00Z', MONDAY = '2026-10-05T09:45:00Z';
const speeding = (mondaySync, lastRun) => ({
  scope: { kind: 'all', admin: true },
  docs: {
    'reports/latest': { generatedAt: GEN, periodStart: '2026-09-05', periodEnd: '2026-10-04',
      fleet: { vehicles: 1, flagged: 3, o20: 1, miles: 500 },
      drivers: [{ d: 'Faye Turner', reg: 'TE57 FAY', flag: 3, o20: 1, mi: 500, per100: 0.6 }],
      top: [{ speed: 52, limit: 30, d: 'Faye Turner', reg: 'TE57 FAY', date: '01/10/2026', time: '09:00' }], perf: { byReg: {}, avg: {} } },
    'fleet/meta': { fetchedAt: '2026-10-05T09:30:00Z', dueDays: 30, vehicles: [{ id: 'v1', plate: 'TE57 FAY', kind: 'current', assigned: 'Faye Turner', make: 'Ford', model: 'Transit',
      mot: { date: '2027-03-01', status: 'OK' }, tax: { date: '2027-01-01', status: 'OK' }, service: { date: '2027-02-01', status: 'OK' } }] },
    ...(mondaySync ? { 'status/mondaySync': mondaySync } : {}), ...(lastRun ? { 'status/lastRun': lastRun } : {}),
  },
  collections: { vehicles: [] },
});
const goodMonday = { ok: true, at: MONDAY, message: '', lastSuccessAt: MONDAY, fetchedAt: MONDAY }, goodRun = { ok: true, at: CHECKED, message: '', generatedAt: GEN };
const projects = [
  { quoteId: 'Q-2026-041', client: 'Example Homes', site: 'Test Street', estimator: 'Faye Turner', approved: false, archived: false, rooms: 3, area: 120, updatedAt: '2026-10-01T10:00:00Z', createdBy: { oid: 'u-faye', name: 'Faye Turner' } },
  { quoteId: 'Q-2026-042', client: 'Sample Builders', site: 'Demo Road', estimator: 'Faye Turner', approved: true, archived: false, rooms: 5, area: 300, priceExVat: 12000, updatedAt: '2026-10-02T10:00:00Z', createdBy: { oid: 'u-faye', name: 'Faye Turner' } },
];

const LEAVE = { tool: 'Annual Leave', at: SYNCED, stale: false };
const VANS = { tool: 'Fleet Management', at: MONDAY, stale: false }, DRIVING = { tool: 'Fleet Management', at: CHECKED, stale: false };
const QUOTES = { tool: 'Cost Estimator', at: null, stale: false };
const cases = [
  // [what's set up, look-up, question, names, the source wanted (null: none), the line it shows at NOW]
  ['staff', 'leave.balance', 'how many days have I got left', [], LEAVE, 'Live · Annual Leave · synced 10:42 · read-only'],
  ['staff', 'leave.requests', 'has my leave been approved', [], LEAVE],
  ['staff', 'leave.pending', 'what is waiting for a decision', [], LEAVE],
  ['staff', 'leave.off', 'who is off today', [], LEAVE],
  ['staff', 'leave.balance', 'how many days has Pat got left', ['pat'], LEAVE],              // only your own: still from Annual Leave
  ['approver', 'leave.balances', 'everyone’s leave balances', [], LEAVE],
  ['approver', 'leave.off', 'who is off on 1 Mar 2027', [], LEAVE],
  ['approver', 'leave.pending', 'what is waiting for a decision', [], LEAVE],
  ['leave failing', 'leave.balance', 'how many days have I got left', [], { ...LEAVE, stale: true }, 'Live · Annual Leave · synced 10:42 · may be out of date · read-only'],
  ['leave never synced', 'leave.balance', 'how many days have I got left', [], { ...LEAVE, at: null }, 'Live · Annual Leave · read-only'],
  ['fleet', 'fleet.vehicles', 'when is the MOT due on TE57 FAY', [], VANS, 'Live · Fleet Management · synced 10:45 · read-only'],
  ['fleet', 'fleet.vehicles', 'which vans need an MOT this month', [], VANS],
  ['fleet', 'fleet.me', 'what does Faye drive', ['faye'], VANS],                               // a vehicle question asked as driving
  ['fleet', 'fleet.me', 'how is the fleet driving', [], DRIVING, 'Live · Fleet Management · synced 10:15 · read-only'],
  ['fleet', 'fleet.me', 'how is Faye driving', ['faye'], DRIVING],
  ['fleet', 'fleet.review', 'who needs reviewing', [], DRIVING],
  ['fleet', 'fleet.serious', 'worst speeding incidents', [], DRIVING],
  ['fleet, Monday failing', 'fleet.vehicles', 'when is the MOT due on TE57 FAY', [], { ...VANS, at: '2026-10-05T09:30:00Z', stale: true }],
  ['fleet, FleetView failing', 'fleet.me', 'how is the fleet driving', [], { ...DRIVING, at: GEN, stale: true }],
  ['fleet, nothing newer', 'fleet.me', 'how is the fleet driving', [], { ...DRIVING, at: GEN }],
  ['fleet, no sync records', 'fleet.vehicles', 'when is the MOT due on TE57 FAY', [], { ...VANS, at: '2026-10-05T09:30:00Z' }],
  ['fleet unlinked', 'fleet.me', 'how is my driving', [], { tool: 'Fleet Management', at: null, stale: false }],
  ['quotes', 'quotes.find', 'show the draft quotes', [], QUOTES, 'Live · Cost Estimator · read-only'],
  ['quotes', 'quotes.find', 'my quotes', [], QUOTES],
  ['offline', 'leave.balance', 'how many days have I got left', [], null],                   // couldn't look it up: no source
  ['leave refused', 'leave.balance', 'how many days have I got left', [], null],
];
const SETUP = {
  staff: () => ({ leave_home: leaveHome('staff') }),
  approver: () => ({ leave_home: leaveHome('approver') }),
  'leave failing': () => ({ leave_home: { ...leaveHome('staff'), syncError: 'monday.com did not answer' } }),
  'leave never synced': () => ({ leave_home: { ...leaveHome('staff'), lastFullSync: null } }),
  fleet: () => ({ speeding_data: speeding(goodMonday, goodRun) }),
  'fleet, Monday failing': () => ({ speeding_data: speeding({ ok: false, at: '2026-10-05T10:00:00Z', message: 'monday.com did not answer', lastSuccessAt: MONDAY }, goodRun) }),
  'fleet, FleetView failing': () => ({ speeding_data: speeding(goodMonday, { ok: false, at: '2026-10-05T10:00:00Z', message: 'FleetView needs signing in again' }) }),
  'fleet, nothing newer': () => ({ speeding_data: speeding(goodMonday, { ok: true, at: '2026-10-05T08:00:00Z', message: '', generatedAt: GEN }) }),
  'fleet, no sync records': () => ({ speeding_data: speeding(null, null) }),
  'fleet unlinked': () => ({ speeding_data: { refuse: [400, 'FLR_FORBIDDEN', 'speeding.unlinked'] } }),
  quotes: () => ({ list_projects: projects }),
  offline: () => ({ leave_home: 'offline' }),
  'leave refused': () => ({ leave_home: { refuse: [400, 'FLR_FORBIDDEN', 'app.annual-leave'] } }),
};
let looked = 0;
for (const [setup, kind, q, names, want, line] of cases) {
  db = SETUP[setup]();
  const card = await lookUp(kind, q, { uid: 'u-faye', name: 'Faye Turner' }, names);
  const at = `${setup}: ${kind} "${q}"`;
  if (!card) { problems.push(`${at}: no card`); continue; }
  looked++;
  if (want === null) { if (!card.error || card.source) problems.push(`${at}: couldn’t be looked up, so no source (got ${JSON.stringify(card.source)})`); continue; }
  if (card.error) { problems.push(`${at}: the look-up failed: ${card.text}`); continue; }
  same(`${at} (card "${card.title}") source`, card.source, want);
  if (line) same(`${at} line`, sourceLine(card.source, NOW), line);
}
const kinds = new Set(cases.map(c => c[1])), dataKinds = new Set(help.entries.filter(e => e.data).map(e => e.data.replace(/^leave\.today$/, 'leave.off')));
for (const k of dataKinds) if (!kinds.has(k)) problems.push(`help.json's look-up "${k}" isn’t checked here`);

console.log(`sourceLine: ${words.length} wordings; look-ups: ${looked} cards on made-up data, covering all ${dataKinds.size} kinds in help.json`);
if (problems.length) { console.log('PROBLEMS'); for (const p of problems) console.log('  ' + p); process.exit(1); }
console.log('all good: every answer says where it comes from, with only the data’s own times, and the card says what he can’t do');
