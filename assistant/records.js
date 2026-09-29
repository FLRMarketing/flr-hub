/* ============================================================================
   FLR Hub Assistant: your own records. Read-only answers to "how many days have
   I got left?", "has my holiday been approved?", "who's off today?", "how's my
   driving?" and "find quote Q-2026-041".
   Each comes from the database function the tool's own page uses, called with
   the signed-in person's own sign-in, so the FLR database decides what they
   see, exactly as on the page: staff get their own leave, drivers their own
   driving, and nobody gets more than their page would show them. Leave figures
   use the Annual Leave page's own rules (annual-leave/leave-core.js, built from
   the page), so they match the page to the day. Nothing is changed, and the
   answers aren't kept in the chat's history. Loaded only when someone asks.
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

const hubLink = (href, label) => ({ href: new URL(href, HUB).href, label });
const whole = n => Math.round(n).toLocaleString('en-GB');
const one = n => n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });   // rates: 1.0, 2.0
const shortDate = iso => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};

/* ---------------------------------------------------------------- leave: the Annual Leave page's own rules */
async function leave(kind) {
  const [h, core] = await Promise.all([rpc('leave_home'), import(new URL('../annual-leave/leave-core.js?v=' + V, HERE).href)]);
  // As the page reads the boards (bridge.js), then maps and counts them.
  const raw = { items: {}, missing: [] };
  for (const k of ['req', 'alw', 'grp', 'clo', 'oth']) raw.items[k] = (h.boards && h.boards[k]) || [];
  const data = core.mapData(raw);
  const ctx = core.buildContext({ requests: data.requests, staff: data.staff, groups: data.groups, bankHolidays: data.bankHolidays, today: data.today, otherLeave: data.other });
  // Whose leave is "mine": as the page's own My Leave (mineFor).
  const email = String((h.me && h.me.email) || '').trim().toLowerCase(), staffView = h.access === 'staff';
  const me = staffView ? data.staff[0] || null : (email && data.staff.find(s => s.email === email)) || null;
  const mine = me ? (staffView ? data.requests : data.requests.filter(r => { const o = ctx.staffOf(r); return o && String(o.id) === String(me.id); })) : [];
  const open = hubLink('annual-leave/', 'Open My Leave');
  const notLinked = {
    title: 'Your leave isn’t linked yet', link: open,
    text: `Your FLR account isn’t linked to a staff record, so there’s no leave to show. Ask a leave approver to add ${email || 'your work email'} to your record on the FLR - Leave Allowances board.`,
  };

  if (kind === 'balance') {
    if (!me) return notLinked;
    const year = ctx.currentYear, b = core.balanceFor(ctx, me, year);
    if (b.allowanceMissing) return { title: `Days left in ${year}`, text: 'Your allowance isn’t on the FLR - Leave Allowances board yet. Ask a leave approver to add it.', link: open };
    const sum = [`${core.fmtNum(b.allowance)} days’ allowance`];
    if (b.reserved) sum.push(`− ${core.fmtNum(b.reserved)} for the Christmas shutdown`);
    if (b.carried) sum.push(`+ ${core.fmtNum(b.carried)} carried over`);
    return {
      title: `Days left in ${year}`, big: core.fmtNum(b.remaining), unit: Math.abs(b.remaining) === 1 ? 'day' : 'days', neg: b.remaining < 0,
      rows: [['Bookable', core.fmtNum(b.entitlement)], ['Accepted', core.fmtNum(b.booked)], ['Waiting for a decision', core.fmtNum(b.pending)], ['Left if accepted', core.fmtNum(b.remainingIfPending)]],
      note: `${sum.join(' ')} = ${core.fmtNum(b.entitlement)} bookable. Bank holidays and the Jeff Day are on top.`,
      link: open,
    };
  }

  if (kind === 'requests') {
    if (!me) return notLinked;
    const PILL = { accepted: 'Accepted', denied: 'Denied', review: 'Review', cancelled: 'Cancelled', new: 'New request' };
    const rows = mine.slice().sort((a, z) => (z.from || '').localeCompare(a.from || ''));
    if (!rows.length) return { title: 'Your leave requests', text: 'You haven’t sent any leave requests yet. They appear here once they reach monday.com.', link: open };
    return {
      title: 'Your leave requests',
      list: rows.slice(0, 6).map(r => {
        const d = ctx.daysOf(r), bits = [core.plural(d.total, 'working day')];
        if (r.halfDay && r.halfDay !== 'none') bits.push(r.halfDay === 'am' ? 'morning off' : 'afternoon off');
        return { title: core.fmtRange(d.from || r.from, d.to || r.to), meta: bits.join(' · '), pill: PILL[r.decision] || PILL.new, tone: r.decision };
      }),
      note: rows.length > 6 ? `And ${rows.length - 6} more on My Leave.` : '',
      link: open,
    };
  }

  // Who's off today: names only, never the kind of leave, the same for approvers as for everyone else.
  const day = core.todayInLondon(), today = hubLink('annual-leave/', 'Open Annual Leave');
  const PART = { all: 'All day', am: 'Morning', pm: 'Afternoon' };
  let off = [], closure = null, weekend = core.isWeekend(day);
  if (staffView) {
    const t = h.today;
    if (!t) return { title: 'Who’s off today', text: 'Annual Leave can’t show who’s off today yet: the FLR server hasn’t been updated for it. Try again later.', link: today };
    closure = t.closure ? t.closure.name : null; weekend = !!t.weekend;
    off = (t.off || []).map(p => ({ name: p.name, part: p.part }));
  } else {
    closure = ctx.bankHolidays.get(day) || null;
    const people = new Map();
    const add = (staff, name, part) => {
      const key = staff ? 's' + staff.id : 'n' + core.normaliseName(name), cur = people.get(key);
      people.set(key, { name: staff ? staff.name : name, part: cur && cur.part !== part ? 'all' : part });
    };
    for (const e of core.whoIsOff(ctx, day, { includePending: false })) add(e.staff, e.request.employeeName || e.request.name, e.amount === 0.5 ? (e.request.halfDay === 'pm' ? 'pm' : 'am') : 'all');
    for (const e of core.whoIsOffOther(ctx, day)) add(e.staff, e.entry.employeeName, e.amount === 0.5 ? (e.entry.halfDay === 'pm' ? 'pm' : 'am') : 'all');
    off = [...people.values()];
  }
  if (closure) return { title: 'Who’s off today', text: `The office is closed today: ${closure}.`, link: today };
  if (weekend) return { title: 'Who’s off today', text: 'It’s the weekend: no one is working today.', link: today };
  off.sort((a, z) => a.name.localeCompare(z.name));
  if (!off.length) return { title: 'Who’s off today', big: '0', unit: 'people off', text: 'Everyone’s in today.', link: today };
  return {
    title: 'Who’s off today', big: String(off.length), unit: off.length === 1 ? 'person off' : 'people off',
    list: off.slice(0, 12).map(p => ({ title: p.name, meta: PART[p.part] || PART.all })),
    note: (off.length > 12 ? `And ${off.length - 12} more. ` : '') + 'Names only, not the kind of leave.',
    link: today,
  };
}

/* ---------------------------------------------------------------- driving: the report's own figures */
async function driving() {
  let d;
  try { d = await rpc('speeding_data'); } catch (e) {
    if (e.code === 'FLR_FORBIDDEN' && /unlinked/.test(e.detail)) {
      return { title: 'Nothing to show you yet', text: 'Your FLR account isn’t linked to your FleetView driver name. Ask an FLR administrator to link it; then you can see your own driving.' };
    }
    if (e.code === 'FLR_FORBIDDEN' && /off/.test(e.detail)) return { title: 'Fleet Management is switched off', text: 'Ask an FLR administrator if you need it.' };
    throw e;
  }
  const rep = d && d.docs && d.docs['reports/latest'], scope = (d && d.scope) || {};
  if (!rep || !rep.fleet) return { title: 'No driving data yet', text: 'The speeding report hasn’t been loaded yet. It updates every morning.', link: hubLink('speeding/', 'Open Fleet Management') };
  const period = `The 30 days to ${shortDate(rep.periodEnd + 'T12:00:00')}`;
  const fleetRate = rep.fleet.miles ? rep.fleet.flagged / rep.fleet.miles * 100 : 0;
  if (scope.kind === 'driver') {
    const rows = rep.drivers || [];
    const flag = rows.reduce((n, r) => n + (r.flag || 0), 0), o20 = rows.reduce((n, r) => n + (r.o20 || 0), 0), mi = rows.reduce((n, r) => n + (r.mi || 0), 0);
    return {
      title: 'Your driving', sub: period, big: whole(flag), unit: flag === 1 ? 'incident' : 'incidents',
      rows: [['Serious (20 mph or more over)', whole(o20)], ['Miles driven', whole(mi)], ['Incidents per 100 miles', one(mi ? flag / mi * 100 : 0)], ['Fleet average', one(fleetRate)]],
      note: (mi < 150 ? 'Under 150 miles, so the rate says little on its own. ' : '') + 'Only you and FLR administrators can see this.',
      link: hubLink('speeding/', 'Open My driving'),
    };
  }
  // Administrators: the fleet's totals here; each driver is on the Drivers page.
  return {
    title: 'The fleet', sub: period, big: whole(rep.fleet.flagged || 0), unit: 'incidents',
    rows: [['Vehicles', whole(rep.fleet.vehicles || 0)], ['Serious (20 mph or more over)', whole(rep.fleet.o20 || 0)], ['Miles driven', whole(rep.fleet.miles || 0)], ['Incidents per 100 miles', one(fleetRate)]],
    note: 'Each driver, in review order, is on the Drivers page.',
    link: hubLink('speeding/#report', 'Open Drivers'),
  };
}

/* ---------------------------------------------------------------- quotations: the Estimator's own list */
const QUOTE_REF = /\b(?:[a-z]{1,5}-)?\d{4}-\d{1,5}\b/gi;
const DROP = new Set(('quote quotes quotation quotations estimate estimates estimator find finding search look looking show open get see need want ' +
  'the a an for of my me mine i im ive id can could would should will you your please thanks with about where how why when who whose which what whats ' +
  'wheres hows is are was were be been am it its this that these those there here into onto over out up down some any all every just only also too very ' +
  'really so then than but if not no yes job jobs project projects client clients customer customers site called named number ref reference latest ' +
  'recent last new old older previous earlier and or to on in at by from done did do does have has had we our us they their them list lot please ' +
  'one ones thing things way give tell know let lets made make').split(' '));
export const quoteQuery = q => ({
  refs: [...String(q).matchAll(QUOTE_REF)].map(m => m[0].toLowerCase()),
  terms: String(q).toLowerCase().replace(QUOTE_REF, ' ').replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !DROP.has(w)),
  mine: /\b(my|mine|i did|i made|i created)\b/i.test(q),
});
async function quotations(q, who) {
  const list = (await rpc('list_projects')) || [];
  const { refs, terms, mine } = quoteQuery(q);
  let hits, title;
  if (refs.length) { hits = list.filter(p => refs.some(r => String(p.quoteId).toLowerCase().includes(r))); title = 'Quotations matching ' + refs.map(r => r.toUpperCase()).join(', '); }
  else if (terms.length) { hits = list.filter(p => terms.every(t => `${p.quoteId} ${p.client || ''} ${p.site || ''}`.toLowerCase().includes(t))); title = `Quotations matching “${terms.join(' ')}”`; }
  else if (mine) { hits = list.filter(p => (p.createdBy && p.createdBy.oid === who.uid) || (who.name && p.estimator === who.name)); title = 'Your latest quotations'; }
  else { hits = list; title = 'Latest quotations'; }
  const gbp = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
  const link = hubLink('estimator/', 'Open the Cost Estimator');
  if (!hits.length) return { title, empty: true, text: refs.length ? 'No quotation has that reference. Check it on the Estimator’s Projects page.' : 'No quotations match. Try the client’s name, the site or the quote number.', link };
  return {
    title,
    list: hits.slice(0, 6).map(p => ({
      title: String(p.quoteId),
      meta: [p.client || 'No client yet', p.site, p.approved && p.priceExVat ? `${gbp(p.priceExVat)} ex VAT` : '', p.updatedAt ? 'updated ' + shortDate(p.updatedAt) : ''].filter(Boolean).join(' · '),
      pill: p.archived ? 'Archived' : p.approved ? 'Approved' : 'Draft', tone: p.archived ? 'cancelled' : p.approved ? 'accepted' : 'new',
    })),
    note: (hits.length > 6 ? `And ${hits.length - 6} more. ` : '') + 'Search for the quote number on the Estimator’s Projects page to open one.',
    link,
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
export async function lookUp(kind, q, who) {
  try {
    if (kind === 'leave.balance') return await leave('balance');
    if (kind === 'leave.requests') return await leave('requests');
    if (kind === 'leave.today') return await leave('today');
    if (kind === 'fleet.me') return await driving();
    if (kind === 'quotes.find') return await quotations(q, who);
  } catch (e) {
    return { title: 'I couldn’t look that up', text: WHY[e.code] || 'The FLR database didn’t answer as expected. Try again in a moment.', error: true };
  }
  return null;
}
