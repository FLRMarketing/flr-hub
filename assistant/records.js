/* ============================================================================
   FLR Hub Assistant: records. Read-only answers from everything the person asking
   can see in their tools, and nothing more:
     Fleet Management  administrators: any vehicle (MOT, tax, service, mileage,
                       history), what's due, any driver, the review list and the
                       worst incidents; a linked driver: their own vehicle and
                       driving
     Annual Leave      approvers: anyone's balance and requests, what's waiting
                       for a decision, who's off on any day or week; everyone
                       else: their own leave and who's off today (names only)
     Cost Estimator    any quotation, by number, client, site, estimator or state
   Each answer comes from the database function the tool's own page uses, called
   with the person's own sign-in, so the FLR database decides what they get,
   exactly as on the page. The figures use the pages' own rules, cut from the
   pages themselves: annual-leave/leave-core.js and speeding/speeding-core.js.
   Every card says where it came from (its source: the tool, and when that data
   was last synced, as the data itself says), which the chat shows under it.
   Nothing is changed, and answers aren't kept in the chat's saved history.
   Loaded only when someone asks.
   ========================================================================== */
const HERE = new URL('.', import.meta.url);
const HUB = new URL('../', HERE);
const AUTH_KEY = 'flr-estimator-auth';
const V = new URL(import.meta.url).searchParams.get('v') || '1';

class Refusal extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail || ''; } }

// One database function, as the signed-in person. Never refreshes the sign-in itself: the page's own client does that,
// and two clients refreshing the same sign-in could sign the person out.
async function rpc(name) {
  const cfg = window.FLR_CONFIG || {};
  let s = null;
  try { s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { /* no storage */ }
  if (!s || !s.access_token) throw new Refusal('FLR_SIGN_IN_REQUIRED');
  if (s.expires_at && s.expires_at * 1000 < Date.now() + 15000) throw new Refusal('EXPIRED');
  let r;
  try {
    r = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST', body: '{}',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
    });
  } catch (e) { throw new Refusal('OFFLINE'); }
  const body = await r.json().catch(() => null);
  if (r.ok) return body;
  const text = body ? `${body.message || ''} ${body.details || ''}` : '';
  const code = (/FLR_[A-Z_]+/.exec(text) || [])[0] || (r.status === 401 ? 'EXPIRED' : body && body.code === 'PGRST202' ? 'MISSING' : 'SERVER');
  throw new Refusal(code, body && body.details);
}
const once = new Map();   // each tool's data is read once per question, however many look-ups use it
const read = name => { if (!once.has(name)) once.set(name, rpc(name)); return once.get(name); };

// Where a card came from, for the line the chat shows under it (sourceLine in lines.js): the tool, when its data was last
// synced (at: only ever a time the data itself gives; none when it gives none) and whether the data says its latest sync
// failed (stale). A card that couldn't be looked up gets none: nothing was read.
const sourced = (card, source) => card && { ...card, source };

/* ---------------------------------------------------------------- wording */
const hubLink = (href, label) => ({ href: new URL(href, HUB).href, label });
const whole = n => Math.round(Number(n) || 0).toLocaleString('en-GB');
const one = n => (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = (n, word) => `${whole(n)} ${word}${Math.round(n) === 1 ? '' : 's'}`;
const gbp = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(n) || 0);
const dayMonth = (iso, withYear) => {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(+d)) return String(iso || '');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear || d.getUTCFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
const shortDate = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };

/* ---------------------------------------------------------------- names: words the help doesn't know, matched to real records */
const nameWords = s => String(s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const IGNORE = new Set('van vans car cars vehicle vehicles driver drivers staff team group person people leave holiday holidays quote quotes quotation mot tax service'.split(' '));
// The names in `names` that every useful slot word begins a word of: "sarah" → Sarah Jones, "fayes" → Faye Turner.
export function namesMatching(slots, names) {
  const want = slots.map(w => String(w).toLowerCase()).filter(w => w.length >= 2 && !IGNORE.has(w));
  if (!want.length) return [];
  const fits = (w, nw) => nw === w || (w.length >= 3 && nw.startsWith(w)) || (w.length > 3 && w.endsWith('s') && nw === w.slice(0, -1));
  return [...new Set(names.filter(Boolean))].filter(n => { const nw = nameWords(n); return want.every(w => nw.some(x => fits(w, x))); });
}
const plateKey = s => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
// The name as the question wrote it ("Ben Walsh", not "ben walsh"), for saying it wasn't found.
const asWritten = (q, slots) => { const m = new RegExp(slots.map(w => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean).join('[’\'s]*\\W+'), 'i').exec(q); return m ? m[0] : slots.join(' '); };
const PLATE = /\b[a-z]{2}\d{2}\s?[a-z]{3}\b|\b[a-z]\d{1,3}\s?[a-z]{3}\b/i;
// Does the question really name someone? "Sarah" written with a capital, or "Faye's": then a name that isn't found gets
// a clear answer ("no one called Sarah", or "only your own"). A stray word ("claim mileage") gets no answer at all.
const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameLike = (q, slots) => slots.some(w => w.length >= 2 && (new RegExp(`\\b${esc(w[0].toUpperCase() + w.slice(1))}\\b`).test(q) || new RegExp(`\\b${esc(w.replace(/s$/, ''))}['’]s\\b`, 'i').test(q)));

/* ---------------------------------------------------------------- dates: "today", "tomorrow", "on Friday", "next week", "12 Jan" */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const isoAdd = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);
const dow = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
export function when(q, today) {
  const s = String(q).toLowerCase();
  const week = start => ({ from: start, to: isoAdd(start, 4) });
  const monday = iso => isoAdd(iso, -((dow(iso) + 6) % 7));
  if (/\bnext week\b/.test(s)) return { ...week(isoAdd(monday(today), 7)), label: 'next week' };
  if (/\bthis week\b|\bthe week\b/.test(s)) return { ...week(monday(today)), label: 'this week' };
  if (/\btomorrow\b/.test(s)) return { from: isoAdd(today, 1), to: isoAdd(today, 1), label: 'tomorrow' };
  if (/\byesterday\b/.test(s)) return { from: isoAdd(today, -1), to: isoAdd(today, -1), label: 'yesterday' };
  const wd = DAYS.findIndex(d => new RegExp(`\\b${d}\\b`).test(s));
  if (wd >= 0) {
    let n = (wd - dow(today) + 7) % 7;
    if (/\bnext\b/.test(s) && n === 0) n = 7;
    const d = isoAdd(today, n);
    return { from: d, to: d, label: n === 0 ? 'today' : dayMonth(d) };
  }
  let m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/.exec(s)
    || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(s);
  let day = null, mon = null, year = null;
  if (m) { if (/^\d/.test(m[1])) { day = +m[1]; mon = MONTHS.indexOf(m[2]); } else { mon = MONTHS.indexOf(m[1]); day = +m[2]; } year = m[3] ? +m[3] : null; }
  else if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s))) { year = +m[1]; mon = +m[2] - 1; day = +m[3]; }
  else if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s))) { day = +m[1]; mon = +m[2] - 1; year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null; }
  if (day && mon >= 0 && mon < 12 && day <= 31) {
    let y = year || +today.slice(0, 4);
    let d = new Date(Date.UTC(y, mon, day)).toISOString().slice(0, 10);
    if (!year && d < isoAdd(today, -7)) d = new Date(Date.UTC(y + 1, mon, day)).toISOString().slice(0, 10);   // "12 Jan" in September: next January
    return { from: d, to: d, label: dayMonth(d, true) };
  }
  return { from: today, to: today, label: 'today' };
}

/* ---------------------------------------------------------------- Annual Leave: the page's own rules */
async function leaveData() {
  const [h, core] = await Promise.all([read('leave_home'), import(new URL('../annual-leave/leave-core.js?v=' + V, HERE).href)]);
  // As the page reads the boards (bridge.js), then maps and counts them.
  const raw = { items: {}, missing: [] };
  for (const k of ['req', 'alw', 'grp', 'clo', 'oth']) raw.items[k] = (h.boards && h.boards[k]) || [];
  const data = core.mapData(raw);
  const ctx = core.buildContext({ requests: data.requests, staff: data.staff, groups: data.groups, bankHolidays: data.bankHolidays, today: data.today, otherLeave: data.other });
  const email = String((h.me && h.me.email) || '').trim().toLowerCase(), approver = h.access === 'approver';
  // Whose leave is "mine": as the page's own My Leave (mineFor).
  const me = !approver ? data.staff[0] || null : (email && data.staff.find(s => s.email === email)) || null;
  const requestsOf = s => (!approver && s === me) ? data.requests : data.requests.filter(r => { const o = ctx.staffOf(r); return o && String(o.id) === String(s.id); });
  return { h, core, data, ctx, email, approver, me, requestsOf };
}
const leaveOpen = hubLink('annual-leave/', 'Open Annual Leave');
// Someone's leave record on the Annual Leave page (approvers): its own address, as the Diary's names open it.
const recordLink = s => hubLink(`annual-leave/#person-${encodeURIComponent(s.id)}`, 'Open their leave record');
const PILL = { accepted: ['Accepted', 'ok'], denied: ['Denied', 'over'], review: ['Review', 'soon'], cancelled: ['Cancelled', 'none'], new: ['New request', 'soon'] };
const nameOf = (L, r) => { const s = L.ctx.staffOf(r); return s ? s.name : (r.employeeName || r.name || 'Someone'); };

// Who the question is about: someone named (approvers only), else the person asking.
function leaveWho(L, slots, q) {
  if (!slots.length) return { people: L.me ? [L.me] : [], own: true };
  const named = namesMatching(slots, L.data.staff.map(s => s.name));
  const people = L.data.staff.filter(s => named.includes(s.name));
  if (!L.approver) return people.length && L.me && people.includes(L.me) ? { people: [L.me], own: true } : nameLike(q, slots) ? { people: [], refused: true } : { people: [], unknown: true };
  return { people, own: people.length === 1 && people[0] === L.me, unknown: !people.length && !nameLike(q, slots) };
}
const notLinked = L => ({
  title: 'Your leave isn’t linked yet', link: leaveOpen, care: true,
  text: `Your FLR account isn’t linked to a staff record, so there’s no leave to show. Ask a leave approver to add ${L.email || 'your work email'} to your record on the FLR - Leave Allowances board.`,
});
const onlyYours = { care: true, title: 'Only your own leave', text: 'Leave approvers can see everyone’s leave. You can see your own: ask “how many days have I got left?”.', link: leaveOpen };

function balanceCard(L, s, own) {
  const year = L.ctx.currentYear, b = L.core.balanceFor(L.ctx, s, year), f = L.core.fmtNum;
  const title = own ? `Days left in ${year}` : `${s.name}: days left in ${year}`;
  if (b.allowanceMissing) return { title, text: `${own ? 'Your' : 'Their'} allowance isn’t on the FLR - Leave Allowances board yet.`, link: leaveOpen };
  const sum = [`${f(b.allowance)} days’ allowance`];
  if (b.reserved) sum.push(`− ${f(b.reserved)} for company close days`);
  if (b.carried) sum.push(`+ ${f(b.carried)} carried over`);
  return {
    title, big: f(b.remaining), unit: Math.abs(b.remaining) === 1 ? 'day' : 'days', neg: b.remaining < 0,
    rows: [['Bookable', f(b.entitlement)], ['Accepted', f(b.booked)], ['Waiting for a decision', f(b.pending)], ['Left if accepted', f(b.remainingIfPending)]],
    note: `${sum.join(' ')} = ${f(b.entitlement)} bookable. Bank holidays and the Jeff Day are on top.`,
    link: own ? hubLink('annual-leave/', 'Open My Leave') : recordLink(s),
  };
}
function requestItems(L, rs, withNames) {
  return rs.map(r => {
    const d = L.ctx.daysOf(r), bits = [L.core.plural(d.total, 'working day')];
    if (r.halfDay && r.halfDay !== 'none') bits.push(r.halfDay === 'am' ? 'morning off' : 'afternoon off');
    const [pill, tone] = PILL[r.decision] || PILL.new;
    return { title: (withNames ? nameOf(L, r) + ': ' : '') + L.core.fmtRange(d.from || r.from, d.to || r.to), meta: bits.join(' · '), pill, tone };
  });
}

// Annual Leave reads the FLR server's copy of monday.com: lastFullSync is when it last read every board, and syncError
// says a read has failed since (the page then shows "This may be out of date").
async function leave(kind, q, slots) {
  const L = await leaveData();
  return sourced(leaveCard(kind, q, slots, L), { tool: 'Annual Leave', at: L.h.lastFullSync || null, stale: !!L.h.syncError });
}
function leaveCard(kind, q, slots, L) {
  if (kind === 'balance' || kind === 'requests') {
    const w = leaveWho(L, slots, q);
    if (w.refused) return onlyYours;
    if (w.unknown) return { empty: true };
    if (!w.people.length) return slots.length ? { unsure: true, title: 'No one by that name', text: `I couldn’t find “${asWritten(q, slots)}” on the FLR - Leave Allowances board.`, link: leaveOpen } : notLinked(L);
    if (w.people.length > 1) {
      return { unsure: true, title: 'Which person?', list: w.people.slice(0, 8).map(s => { const b = L.core.balanceFor(L.ctx, s, L.ctx.currentYear); return { title: s.name, meta: `${L.core.fmtNum(b.remaining)} days left in ${L.ctx.currentYear}` }; }), note: 'Ask again with their full name.', link: leaveOpen };
    }
    const s = w.people[0];
    if (kind === 'balance') return balanceCard(L, s, w.own);
    const rs = L.requestsOf(s).slice().sort((a, z) => (z.from || '').localeCompare(a.from || ''));
    const title = w.own ? 'Your leave requests' : `${s.name}’s leave requests`;
    if (!rs.length) return { title, text: w.own ? 'You haven’t sent any leave requests yet.' : 'No leave requests.', link: w.own ? leaveOpen : recordLink(s) };
    return { title, list: requestItems(L, rs.slice(0, 8), false), note: rs.length > 8 ? `And ${rs.length - 8} more in Annual Leave.` : '', link: w.own ? leaveOpen : recordLink(s) };
  }

  if (kind === 'pending') {
    const rs = (L.approver ? L.data.requests : L.me ? L.requestsOf(L.me) : []).filter(r => L.core.isPending(r)).sort((a, z) => (a.from || '').localeCompare(z.from || ''));
    if (!L.approver && !L.me) return notLinked(L);
    const title = L.approver ? 'Waiting for a decision' : 'Your requests waiting for a decision';
    if (!rs.length) return { title, big: '0', unit: 'requests', text: L.approver ? 'All caught up: nothing is waiting for a decision.' : 'None of your requests is waiting.', link: leaveOpen };
    return {
      title, big: String(rs.length), unit: rs.length === 1 ? 'request' : 'requests',
      list: rs.slice(0, 8).map(r => {
        const d = L.ctx.daysOf(r), ev = L.approver ? L.core.evaluateRequest(L.ctx, r) : null;
        const sug = ev && ev.suggested ? `Suggested: ${ev.suggested}` : (PILL[r.decision] || PILL.new)[0];
        return { title: (L.approver ? nameOf(L, r) + ': ' : '') + L.core.fmtRange(d.from || r.from, d.to || r.to), meta: L.core.plural(d.total, 'working day'), pill: sug, tone: ev ? { Accept: 'ok', Review: 'soon', Deny: 'over' }[ev.suggested] || 'soon' : 'soon' };
      }),
      note: (rs.length > 8 ? `And ${rs.length - 8} more. ` : '') + (L.approver ? 'The suggestion is Annual Leave’s own check; you decide on the Approvals tab.' : ''),
      link: L.approver ? hubLink('annual-leave/', 'Open Approvals') : leaveOpen,
    };
  }

  if (kind === 'balances') {
    if (!L.approver) return L.me ? balanceCard(L, L.me, true) : notLinked(L);
    const groups = namesMatching(slots, L.data.groups.map(g => g.name));
    const inGroup = groups.length ? new Set(L.data.groups.filter(g => groups.includes(g.name)).flatMap(g => [...(L.ctx.membersByGroup.get(String(g.id)) || [])])) : null;
    const people = L.data.staff.filter(s => !inGroup || inGroup.has(String(s.id))).map(s => ({ s, b: L.core.balanceFor(L.ctx, s, L.ctx.currentYear) }));
    const most = /\bmost\b/i.test(q), least = /\b(least|fewest|lowest)\b/i.test(q);
    people.sort((a, z) => most ? z.b.remaining - a.b.remaining : least ? a.b.remaining - z.b.remaining : a.s.name.localeCompare(z.s.name));
    return {
      title: `Days left in ${L.ctx.currentYear}` + (groups.length ? `: ${groups.join(', ')}` : ''),
      list: people.slice(0, 15).map(({ s, b }) => ({ title: s.name, meta: `Bookable ${L.core.fmtNum(b.entitlement)} · accepted ${L.core.fmtNum(b.booked)} · waiting ${L.core.fmtNum(b.pending)}`, pill: `${L.core.fmtNum(b.remaining)} left`, tone: b.remaining < 0 ? 'over' : b.remaining <= 3 ? 'soon' : 'ok' })),
      note: `${people.length > 15 ? `And ${people.length - 15} more. ` : ''}Select a name in the Diary for that person’s leave record.`,
      link: leaveOpen,
    };
  }

  // Who's off: approvers any day or week, with the kind of leave, as their Today and Diary show it; everyone else today,
  // names only, as their Today tab shows it.
  const today = L.core.todayInLondon(), span = when(q, today), PART = { all: 'All day', am: 'Morning', pm: 'Afternoon' };
  const title = span.label === 'today' ? 'Who’s off today' : `Who’s off ${span.label}`;
  if (!L.approver) {
    if (span.from !== today || span.to !== today) return { title, text: 'Annual Leave shows you who’s off today. Leave approvers can see other days in the Diary.', link: leaveOpen };
    const t = L.h.today;
    if (!t) return { title, text: 'Annual Leave can’t show who’s off today yet: the FLR server hasn’t been updated for it. Try again later.', link: leaveOpen };
    if (t.closure) return { title, text: `The office is closed today: ${/shutdown|close day/i.test(t.closure.kind || '') ? 'Company close day' : t.closure.name}.`, link: leaveOpen };
    if (t.weekend) return { title, text: 'It’s the weekend: no one is working today.', link: leaveOpen };
    const off = (t.off || []).map(p => ({ title: p.name, meta: PART[p.part] || PART.all })).sort((a, z) => a.title.localeCompare(z.title));
    if (!off.length) return { title, big: '0', unit: 'people off', text: 'Everyone’s in today.', link: leaveOpen };
    return { title, big: String(off.length), unit: off.length === 1 ? 'person off' : 'people off', list: off.slice(0, 15), note: 'Names only, not the kind of leave.', link: leaveOpen };
  }
  const people = new Map();
  for (let d = span.from; d <= span.to; d = isoAdd(d, 1)) {
    const add = (staff, name, kindOf, amount, half) => {
      const key = staff ? 's' + staff.id : 'n' + L.core.normaliseName(name), p = people.get(key) || { name: staff ? staff.name : name, days: [], kinds: new Set() };
      p.days.push({ d, part: amount === 0.5 ? (half === 'pm' ? 'pm' : 'am') : 'all' }); p.kinds.add(kindOf); people.set(key, p);
    };
    for (const e of L.core.whoIsOff(L.ctx, d, { includePending: false })) add(e.staff, e.request.employeeName || e.request.name, 'Annual leave', e.amount, e.request.halfDay);
    for (const e of L.core.whoIsOffOther(L.ctx, d)) add(e.staff, e.entry.employeeName, e.type, e.amount, e.entry.halfDay);
  }
  const closure = span.from === span.to ? L.ctx.bankHolidays.get(span.from) : null;
  if (closure) return { title, text: `The office is closed: ${closure}.`, link: leaveOpen };
  if (span.from === span.to && L.core.isWeekend(span.from)) return { title, text: 'That’s a weekend: no one is working.', link: leaveOpen };
  const list = [...people.values()].sort((a, z) => a.name.localeCompare(z.name)).map(p => ({
    title: p.name,
    meta: [[...p.kinds].join(', '), span.from === span.to ? PART[p.days[0].part] : p.days.length === 1 ? `${dayMonth(p.days[0].d)}, ${PART[p.days[0].part].toLowerCase()}` : `${dayMonth(p.days[0].d)} – ${dayMonth(p.days[p.days.length - 1].d)}`].join(' · '),
  }));
  if (!list.length) return { title, big: '0', unit: 'people off', text: 'No one has leave booked.', link: leaveOpen };
  return { title, big: String(list.length), unit: list.length === 1 ? 'person off' : 'people off', list: list.slice(0, 15), note: (list.length > 15 ? `And ${list.length - 15} more. ` : '') + 'Accepted annual leave and other leave, as the Diary shows it.', link: leaveOpen };
}

/* ---------------------------------------------------------------- Fleet Management: the report's own rules */
async function fleetData() {
  let d;
  try { d = await read('speeding_data'); } catch (e) {
    if (e.code === 'FLR_FORBIDDEN' && /unlinked/.test(e.detail)) return { card: { care: true, title: 'Nothing to show you yet', text: 'Your FLR account isn’t linked to your FleetView driver name. Ask an FLR administrator to link it; then you can see your own driving and vehicle.' } };
    if (e.code === 'FLR_FORBIDDEN' && /off/.test(e.detail)) return { card: { care: true, title: 'Fleet Management is switched off', text: 'Ask an FLR administrator if you need it.' } };
    throw e;
  }
  const core = await import(new URL('../speeding/speeding-core.js?v=' + V, HERE).href);
  const rep = d.docs && d.docs['reports/latest'], meta = (d.docs && d.docs['fleet/meta']) || null, scope = d.scope || {};
  const avg = rep && rep.fleet && rep.fleet.miles ? rep.fleet.flagged / rep.fleet.miles * 100 : 0;
  const fleetScore = rep && rep.perf && rep.perf.avg && rep.perf.avg.score != null ? rep.perf.avg.score : null;
  // As the report's own 30-day view: each vehicle's FleetView score and review status.
  const rows = ((rep && rep.drivers) || []).map(r => {
    const p = rep.perf && rep.perf.byReg ? rep.perf.byReg[r.reg] : null, x = { ...r, score: p && p.score != null ? p.score : null };
    x.st = core.reviewStatusOf(x, avg, fleetScore);
    return x;
  });
  const docs = new Map(((d.collections && d.collections.vehicles) || []).map(v => [v.id, v]));
  const vehicles = ((meta && meta.vehicles) || []).map(v => ({ ...v, ...(docs.get(v.id) || {}) }));
  // When each half was last synced, as the page tells it. The Monday fleet board (syncState): the last good sync, else
  // fleet/meta's own time; a failed sync since then is stale. FleetView's figures (renderMeta): when FleetView was last
  // checked, which is the report's own time unless a good check since found nothing new; a failed one since is stale.
  const st = (d.docs && d.docs['status/mondaySync']) || null, run = (d.docs && d.docs['status/lastRun']) || null;
  const mondayAt = (st && st.ok && st.lastSuccessAt) || (meta && meta.fetchedAt) || null, gen = (rep && rep.generatedAt) || null;
  const later = (a, b) => !!(a && b && new Date(a) > new Date(b));
  const monday = { at: mondayAt, stale: !!(st && st.ok === false && later(st.at, mondayAt)) };
  const fleetView = { at: run && run.ok && later(run.at, gen) ? run.at : gen, stale: !!(run && run.ok === false && later(run.at, gen)) };
  return { core, rep, meta, scope, avg, fleetScore, rows, vehicles, admin: scope.kind === 'all', driver: scope.kind === 'driver' ? scope.driver : null, monday, fleetView };
}
const period = F => F.rep && F.rep.periodEnd ? `The 30 days to ${dayMonth(F.rep.periodEnd)}` : '';
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');   // as the report's own slug()
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// The Vehicles page's own MOT, tax and service rule (dueState in speeding-core.js, cut from the page): a date that has
// passed while Monday doesn't say Overdue reads "Date overdue by N days — Monday status needs checking", never OK and
// never the plain "Overdue", which means the board agrees.
const DUE_TONE = { over: 'over', dated: 'over', check: 'soon', soon: 'soon', exempt: 'none', ok: 'ok' };
function due(x, F, key) {
  const u = F.core.dueState(x, key, todayIso(), (F.meta && F.meta.dueDays) || 30);
  return { tone: DUE_TONE[u.cls] || 'none', label: u.short, days: u.days, kind: u.kind, cls: u.cls };
}
const STATUS_TONE = { priority: 'over', above: 'soon', limited: 'none', within: 'ok' };
const WHAT = { mot: 'MOT', tax: 'Tax', service: 'Service' };

// The vehicles a question names: by registration anywhere in it, or by the driver's name.
function vehiclesNamed(q, slots, F) {
  const qk = plateKey(q);
  let hits = F.vehicles.filter(v => [v.plate, v.fvReg, v.formerReg].some(p => { const k = plateKey(p); return k.length >= 5 && qk.includes(k); }));
  if (!hits.length && slots.length) {
    const names = namesMatching(slots, [...F.vehicles.map(v => v.assigned), ...F.rows.map(r => r.d)]);
    if (names.length) hits = F.vehicles.filter(v => names.includes(v.assigned) || F.rows.some(r => names.includes(r.d) && plateKey(r.reg) === plateKey(v.fvReg || v.plate)));
  }
  return hits;
}
function rowsNamed(q, slots, F) {
  const qk = plateKey(q);
  let hits = F.rows.filter(r => { const k = plateKey(r.reg); return k.length >= 5 && qk.includes(k); });
  if (!hits.length) {
    const byPlate = F.vehicles.filter(v => { const k = plateKey(v.plate); return k.length >= 5 && qk.includes(k); }).map(v => plateKey(v.fvReg || v.plate));
    hits = F.rows.filter(r => byPlate.includes(plateKey(r.reg)));
  }
  if (!hits.length && slots.length) { const names = namesMatching(slots, F.rows.map(r => r.d)); hits = F.rows.filter(r => names.includes(r.d)); }
  return hits;
}

function vehicleCard(v, F) {
  const rows = [];
  for (const k of ['mot', 'tax', 'service']) { const u = due(v[k], F, k); rows.push([WHAT[k], v[k] && v[k].date ? `${dayMonth(v[k].date, true)} · ${u.label}` : u.label, u.tone]); }
  rows.push(['Make and model', [v.make, v.model].filter(Boolean).join(' ') || 'Not on the board']);
  rows.push(['Assigned to', v.assigned || 'Not assigned']);
  if (v.group) rows.push(['Group', v.group]);
  if (v.latestMileage && v.latestMileage.miles) rows.push(['Latest mileage', `${whole(v.latestMileage.miles)}${v.latestMileage.date ? ` (${dayMonth(v.latestMileage.date)})` : ''}`]);
  const r = F.rows.find(x => plateKey(x.reg) === plateKey(v.fvReg || v.plate));
  if (r) rows.push(['Speeding (30 days)', `${plural(r.flag, 'incident')}${r.o20 ? ` · ${r.o20} serious` : ''}`]);
  if (F.admin && v.totalCost) rows.push(['Total cost on the board', gbp(v.totalCost)]);
  const history = (Array.isArray(v.log) ? v.log : []).filter(x => x && x.date).sort((a, z) => String(z.date).localeCompare(String(a.date))).slice(0, 4);
  return {
    title: v.plate, sub: [[v.make, v.model].filter(Boolean).join(' '), v.kind === 'historical' ? 'no longer in the fleet' : ''].filter(Boolean).join(' · '),
    rows,
    list: history.length ? history.map(x => ({ title: `${dayMonth(x.date, true)} · ${x.type || x.name || 'Entry'}`, meta: [x.where, x.status, F.admin && x.cost ? gbp(x.cost) : ''].filter(Boolean).join(' · ') })) : null,
    note: 'From the Monday fleet board' + (history.length ? '; the latest entries in its log are listed.' : '.'),
    link: F.admin ? hubLink(`speeding/#vehicle/${encodeURIComponent(v.id)}`, 'Open vehicle') : hubLink('speeding/', 'Open My vehicle'),
  };
}
function dueList(q, F) {
  const kinds = ['mot', 'tax', 'service'].filter(k => new RegExp(k === 'service' ? '\\bservic' : `\\b${k}\\b`, 'i').test(q));
  const want = kinds.length ? kinds : ['mot', 'tax', 'service'];
  const overdueOnly = /\bover ?due\b|\blate\b|\bexpired\b/i.test(q);
  const horizon = /\b(this|next) week\b|\b7 days\b/i.test(q) ? 7 : /\b(this|next) month\b|\b30 days\b/i.test(q) ? 30 : 60;   // the Vehicles page's "Coming up": 60 days
  const out = [];
  for (const v of F.vehicles.filter(x => x.kind === 'current')) for (const k of want) {
    const x = v[k]; if (!x || !x.date) continue;
    const u = due(x, F, k); if (u.days == null || (overdueOnly ? u.days >= 0 : u.days > horizon)) continue;
    out.push({ v, k, u, x });
  }
  out.sort((a, z) => a.u.days - z.u.days || a.v.plate.localeCompare(z.v.plate));
  const what = kinds.length === 1 ? WHAT[kinds[0]] : 'MOT, tax and service';
  const title = overdueOnly ? `${what}: overdue` : `${what}: due in the next ${horizon === 7 ? '7' : horizon === 30 ? '30' : '60'} days`;
  if (!out.length) return { title, text: overdueOnly ? 'Nothing is overdue.' : 'Nothing is due in that time, and nothing is overdue.', link: hubLink(F.admin ? 'speeding/#vehicles' : 'speeding/', F.admin ? 'Open Vehicles' : 'Open My vehicle') };
  return {
    title, big: String(out.length), unit: out.length === 1 ? 'date' : 'dates',
    list: out.slice(0, 12).map(({ v, k, u, x }) => ({ title: `${v.plate} · ${WHAT[k]}`, meta: `${dayMonth(x.date, true)} · ${u.cls === 'dated' ? `Monday says ${x.status || 'nothing'} · ` : ''}${v.assigned || 'not assigned'}`,
      pill: u.cls === 'dated' ? 'Check Monday' : u.days < 0 ? `${plural(-u.days, 'day')} over` : u.kind === 'exempt' ? 'Exempt' : u.days === 0 ? 'Today' : `In ${plural(u.days, 'day')}`, tone: u.tone })),
    note: (out.length > 12 ? `And ${out.length - 12} more. ` : '') + 'From the Monday fleet board.',
    link: hubLink(F.admin ? 'speeding/#vehicles' : 'speeding/', F.admin ? 'Open Vehicles' : 'Open My vehicle'),
  };
}
function driverCard(rs, F, own) {
  const flag = rs.reduce((n, r) => n + (r.flag || 0), 0), o20 = rs.reduce((n, r) => n + (r.o20 || 0), 0), mi = rs.reduce((n, r) => n + (r.mi || 0), 0);
  const per100 = mi ? flag / mi * 100 : 0, fleetRate = F.avg;
  const rows = [['Serious (20 mph or more over)', whole(o20)], ['Miles driven', whole(mi)], ['Incidents per 100 miles', one(per100)], ['Fleet average', one(fleetRate)]];
  if (!own) {   // what administrators see on the Drivers page: status and how the rate compares
    rows.unshift(['Status', rs.map(r => F.core.STATUS[r.st].label).filter((x, i, a) => a.indexOf(x) === i).join(', '), STATUS_TONE[rs[0].st]]);
    rows.push(['Compared with the fleet', F.core.vsFleet({ per100 }, F.avg) || '–']);
    const scores = rs.map(r => r.score).filter(x => x != null);
    if (scores.length) rows.push(['FleetView driver score', scores.join(', ') + (F.fleetScore != null ? ` (fleet ${F.fleetScore})` : '')]);
    rows.push(['Vehicle', rs.map(r => r.reg).join(', ')]);
  }
  return {
    title: own ? 'Your driving' : rs[0].d, sub: period(F), big: whole(flag), unit: flag === 1 ? 'incident' : 'incidents', rows,
    note: (mi < F.core.LOW_MILES ? `Under ${F.core.LOW_MILES} miles, so the rate says little on its own. ` : '') + (own ? 'Only you and FLR administrators can see this.' : ''),
    link: own ? hubLink('speeding/', 'Open My driving') : hubLink(`speeding/#driver/${slug(rs[0].reg)}`, 'Open driver'),
  };
}
const onlyYourDriving = { care: true, title: 'Only your own driving', text: 'Fleet Management shows you your own driving and vehicle. FLR administrators see every driver.' };

// Vehicle details come from the Monday fleet board and driving from FleetView's figures: each card says when its own half
// was last synced. A refusal (not linked, switched off) read no data, so it gives no time.
async function fleet(kind, q, slots) {
  const F = await fleetData();
  if (F.card) return sourced(F.card, { tool: 'Fleet Management', at: null, stale: false });
  if (kind === 'me' && /\bwhat\b[^?]*\bdrives?\b|\bwhich (van|vehicle|car)\b/i.test(q) && !/\bdriving\b|\bspeed/i.test(q)) kind = 'vehicles';   // "what does Dan drive?"
  const half = kind === 'vehicles' && F.rep && F.rep.fleet ? F.monday : F.fleetView;   // no report at all: "No driving data yet"
  return sourced(fleetCard(kind, q, slots, F), { tool: 'Fleet Management', ...half });
}
function fleetCard(kind, q, slots, F) {
  if (!F.rep || !F.rep.fleet) return { care: true, title: 'No driving data yet', text: 'The speeding report hasn’t been loaded yet. It updates every 15 minutes through the working day.', link: hubLink('speeding/', 'Open Fleet Management') };
  const plate = PLATE.test(q), named = slots.length || plate;
  // Nothing by that name or registration: say so when the question clearly named something, else no answer at all.
  const notFound = what => plate || nameLike(q, slots)
    ? (F.admin ? { unsure: true, title: `No ${what} found`, text: `I couldn’t find “${(q.match(PLATE) || [asWritten(q, slots)])[0]}” in Fleet Management.` } : onlyYourDriving)
    : { empty: true };

  if (kind === 'vehicles') {
    if (named) {
      const vs = vehiclesNamed(q, slots, F);
      if (!vs.length) return notFound('vehicle');
      if (vs.length === 1) return vehicleCard(vs[0], F);
      return { title: 'Vehicles', list: vs.slice(0, 10).map(v => { const s = ['mot', 'tax', 'service'].map(k => due(v[k], F, k)).filter(u => u.days != null).sort((a, z) => a.days - z.days)[0]; return { title: v.plate, meta: [[v.make, v.model].filter(Boolean).join(' '), v.assigned].filter(Boolean).join(' · '), pill: s ? s.label : '', tone: s ? s.tone : '' }; }), note: 'Ask about one registration for its details.', link: hubLink(F.admin ? 'speeding/#vehicles' : 'speeding/', F.admin ? 'Open Vehicles' : 'Open My vehicle') };
    }
    if (!F.admin) {   // a driver: their own vehicle, which shows every date and how soon it's due
      const mine = F.vehicles.filter(v => v.kind === 'current');
      if (mine.length === 1) return vehicleCard(mine[0], F);
      if (!mine.length) return { care: true, title: 'No vehicle details for you yet', text: 'The Monday fleet board doesn’t match a vehicle to you at the moment. Ask your fleet manager.', link: hubLink('speeding/', 'Open My vehicle') };
    }
    return dueList(q, F);
  }

  if (kind === 'me') {
    if (named) {
      const rs = rowsNamed(q, slots, F);
      if (!rs.length) return notFound('driver');
      if (!F.admin) return driverCard(rs, F, true);
      const drivers = [...new Set(rs.map(r => r.d))];
      if (drivers.length === 1) return driverCard(rs, F, false);
      return { unsure: true, title: 'Which driver?', list: drivers.slice(0, 8).map(d => ({ title: d, meta: F.rows.filter(r => r.d === d).map(r => r.reg).join(', ') })), note: 'Ask again with their full name or registration.' };
    }
    if (F.admin) {
      return {
        title: 'The fleet', sub: period(F), big: whole(F.rep.fleet.flagged || 0), unit: 'incidents',
        rows: [['Vehicles', whole(F.rep.fleet.vehicles || 0)], ['Serious (20 mph or more over)', whole(F.rep.fleet.o20 || 0)], ['Miles driven', whole(F.rep.fleet.miles || 0)], ['Incidents per 100 miles', one(F.avg)]],
        note: 'Ask about a driver by name or registration, or “who needs reviewing?”.', link: hubLink('speeding/#report', 'Open Drivers'),
      };
    }
    return driverCard(F.rows, F, true);
  }

  if (kind === 'review') {
    if (!F.admin) return onlyYourDriving;
    const rs = F.rows.slice().sort(F.core.SORTS.review), n = st => rs.filter(r => r.st === st).length;
    return {
      title: 'Review order', sub: period(F),
      list: rs.slice(0, 10).map(r => ({ title: `${r.d} · ${r.reg}`, meta: `${plural(r.flag, 'incident')} · ${r.o20} serious · ${one(r.per100)} per 100 miles`, pill: F.core.STATUS[r.st].label, tone: STATUS_TONE[r.st] })),
      note: `${n('priority')} priority review, ${n('above')} above fleet average, ${n('limited')} limited evidence, ${n('within')} at or below. “How this report works” on the Drivers page explains the order.`,
      link: hubLink('speeding/#report', 'Open Drivers'),
    };
  }

  if (kind === 'serious') {
    const top = ((F.rep.top) || []).slice(0, 10);
    const title = F.admin ? 'Worst speeding incidents' : 'Your worst speeding incidents';
    if (!top.length) return { title, text: 'No incidents in the report’s 30 days.', link: hubLink('speeding/', 'Open Fleet Management') };
    return {
      title, sub: period(F),
      list: top.map(t => ({ title: `${t.speed} mph in a ${t.limit}`, meta: [F.admin ? t.d : '', t.reg, [t.date, t.time].filter(Boolean).join(' ')].filter(Boolean).join(' · '), pill: `+${t.speed - t.limit}`, tone: t.speed - t.limit >= F.core.SERIOUS ? 'over' : 'soon' })),
      note: 'Speed limits come from FleetView’s mapping and can be wrong: check the location before acting.',
      link: hubLink(F.admin ? 'speeding/#map' : 'speeding/', F.admin ? 'Open the map' : 'Open My driving'),
    };
  }
  return null;
}

/* ---------------------------------------------------------------- quotations: the Estimator's own list */
const QUOTE_REF = /\b(?:[a-z]{1,5}-)?\d{4}-\d{1,5}\b/gi;
const DROP = new Set(('quote quotes quotation quotations estimate estimates estimator find finding search look looking show open get see need want ' +
  'the a an for of my me mine i im ive id can could would should will you your please thanks with about where how why when who whose which what whats ' +
  'wheres hows is are was were be been am it its this that these those there here into onto over out up down some any all every just only also too very ' +
  'really so then than but if not no yes job jobs project projects client clients customer customers site called named number ref reference latest ' +
  'recent last new old older previous earlier and or to on in at by from done did do does have has had we our us they their them list lot please ' +
  'one ones thing things way give tell know let lets made make draft drafts approved archived month week today year price prices cost costs value').split(' '));
export const quoteQuery = q => ({
  refs: [...String(q).matchAll(QUOTE_REF)].map(m => m[0].toLowerCase()),
  terms: String(q).toLowerCase().replace(QUOTE_REF, ' ').replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !DROP.has(w)),
  mine: /\b(my|mine|i did|i made|i created)\b/i.test(q),
  state: /\bdrafts?\b/i.test(q) ? 'draft' : /\bapproved\b/i.test(q) ? 'approved' : /\barchived\b/i.test(q) ? 'archived' : '',
  month: /\bthis month\b/i.test(q),
});
async function quotations(q, who) {
  const list = (await read('list_projects')) || [];
  const x = quoteQuery(q), link = hubLink('estimator/', 'Open the Cost Estimator');
  let hits = list, bits = [];
  if (x.refs.length) { hits = hits.filter(p => x.refs.some(r => String(p.quoteId).toLowerCase().includes(r))); bits.push(x.refs.map(r => r.toUpperCase()).join(', ')); }
  if (x.terms.length) {
    // client, site or quote number; or the estimator, by name
    const byText = hits.filter(p => x.terms.every(t => `${p.quoteId} ${p.client || ''} ${p.site || ''}`.toLowerCase().includes(t)));
    const est = namesMatching(x.terms, list.map(p => p.estimator));
    hits = byText.length ? byText : hits.filter(p => est.includes(p.estimator));
    bits.push(byText.length || !est.length ? `“${x.terms.join(' ')}”` : `by ${est.join(', ')}`);
  }
  if (x.mine) { hits = hits.filter(p => (p.createdBy && p.createdBy.oid === who.uid) || (who.name && p.estimator === who.name)); bits.push('yours'); }
  if (x.state) { hits = hits.filter(p => x.state === 'archived' ? p.archived : x.state === 'approved' ? p.approved && !p.archived : !p.approved && !p.archived); bits.push(x.state); }
  if (x.month) { const m = new Date().toISOString().slice(0, 7); hits = hits.filter(p => String(p.updatedAt || '').slice(0, 7) === m); bits.push('updated this month'); }
  const title = bits.length ? `Quotations: ${bits.join(', ')}` : 'Latest quotations';
  if (!hits.length) return { title, empty: true, text: x.refs.length ? 'No quotation has that reference. Check it on the Estimator’s Projects page.' : 'No quotations match. Try the client’s name, the site or the quote number.', link };
  if (hits.length === 1) {
    const p = hits[0];
    return {
      title: String(p.quoteId), sub: [p.client, p.site].filter(Boolean).join(' · '),
      rows: [['Status', p.archived ? 'Archived' : p.approved ? 'Approved' : 'Draft', p.archived ? 'none' : p.approved ? 'ok' : 'soon'], ['Client', p.client || 'No client yet'], ['Site', p.site || '–'],
        ['Estimator', p.estimator || '–'], ['Created by', (p.createdBy && p.createdBy.name) || '–'], ['Rooms', whole(p.rooms || 0)], ['Area', `${one(p.area || 0)} m²`],
        ...(p.approved && p.priceExVat ? [['Price ex VAT', gbp(p.priceExVat)]] : []), ['Last updated', p.updatedAt ? shortDate(p.updatedAt) : '–']],
      note: 'Search for the quote number on the Estimator’s Projects page to open it.', link,
    };
  }
  return {
    title,
    list: hits.slice(0, 8).map(p => ({
      title: String(p.quoteId), meta: [p.client || 'No client yet', p.site, p.estimator, p.approved && p.priceExVat ? `${gbp(p.priceExVat)} ex VAT` : '', p.updatedAt ? 'updated ' + shortDate(p.updatedAt) : ''].filter(Boolean).join(' · '),
      pill: p.archived ? 'Archived' : p.approved ? 'Approved' : 'Draft', tone: p.archived ? 'none' : p.approved ? 'ok' : 'soon',
    })),
    note: (hits.length > 8 ? `And ${hits.length - 8} more. ` : '') + 'Ask about one quote number for its details.', link,
  };
}

/* ---------------------------------------------------------------- one answer: the card, or why there isn't one */
const WHY = {
  FLR_SIGN_IN_REQUIRED: 'Sign in to the Hub first, then ask again.',
  EXPIRED: 'Your sign-in needs refreshing: reload the page, then ask again.',
  FLR_ACCOUNT_DISABLED: 'Your FLR account is switched off. Ask an FLR administrator to switch it back on.',
  FLR_NO_PROFILE: 'Your account isn’t set up for FLR tools yet. Ask an FLR administrator.',
  FLR_FORBIDDEN: 'Your account can’t see that.',
  MISSING: 'That isn’t set up in the FLR database yet.',
  OFFLINE: 'The FLR database didn’t answer. Check your connection, then try again.',
};
// Why a look-up can stop that isn't anything wrong: who's asking, and what they may see. Anything else (no connection, the
// server, a function the database hasn't got, a mistake in this file) is a fault on the Hub's side, and the card says so
// (fault), so the assistant can react to it as one; its face never blames the person for these.
const ACCESS = new Set(['FLR_SIGN_IN_REQUIRED', 'EXPIRED', 'FLR_ACCOUNT_DISABLED', 'FLR_NO_PROFILE', 'FLR_FORBIDDEN']);
// kind: what to look up (from help.json's "data"); slots: names the question mentions that the help doesn't know.
// Besides what to show, a card can say how it lands: unsure (not found, or which one?), care (privacy, not linked, no data
// yet), error (it couldn't be looked up) and fault (because something broke).
export async function lookUp(kind, q, who, slots = []) {
  once.clear();
  try {
    const [tool, what] = kind.split('.');
    if (tool === 'leave') return await leave({ today: 'off', off: 'off' }[what] || what, q, slots);
    if (tool === 'fleet') return await fleet(what, q, slots);
    // The Estimator's quotations are the FLR database itself, not a synced copy: there's no sync time to give.
    if (tool === 'quotes') return sourced(await quotations(q, who), { tool: 'Cost Estimator', at: null, stale: false });
  } catch (e) {
    return { title: 'I couldn’t look that up', text: WHY[e.code] || 'The FLR database didn’t answer as expected. Try again in a moment.', error: true, fault: !(e instanceof Refusal && ACCESS.has(e.code)) };
  }
  return null;
}
