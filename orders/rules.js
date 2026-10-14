/* ============================================================================
   FLR Order Tracker: what an order's state is, from what the Monday "FLR - Goods
   In" board says, and nothing more. Used by orders.js and by tests/rules.test.mjs.
   "Today" is always the day in Europe/London.

   - Received: Received is ticked on the order and nothing is outstanding.
   - Outstanding materials: a product line not ticked as received, or one with
     "Item missing" logged against it; or "Item missing" logged on the order.
     An order with something received and something outstanding is "part
     received": it stays with the orders still to come, never with the received.
   - Overdue: its date has passed and something is still outstanding.
   - Delayed: its date was moved later on Monday after its first date had come
     (it should have arrived by now). Only while something is outstanding.
   - Date moved: moved later, but its first date hasn't come yet. Not late.
   Once an order has fully arrived, neither "Delayed" nor "Date moved" applies;
   the order's history still shows the move.
   ========================================================================== */
(function (root) {
  'use strict';
  const TZ = 'Europe/London';
  const MISSING = 'Item missing';

  const parts = (d, o) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).formatToParts(d).map(p => [p.type, p.value]));
  const londonDay = (d = new Date()) => { const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

  /** kind: received | overdue | today | upcoming | nodate, plus what's outstanding and any date move. */
  function status(o, today) {
    const lines = o.items || [];
    const lineMissing = i => (i.issues || []).includes(MISSING);
    const got = lines.filter(i => i.received && !lineMissing(i));
    const outstanding = lines.filter(i => !i.received || lineMissing(i));
    const missingReported = (o.issues || []).includes(MISSING);
    const anyIn = !!o.received || got.length > 0;
    const partial = anyIn && (outstanding.length > 0 || missingReported);
    const moved = !!(o.firstDay && o.day && o.day > o.firstDay);
    const lastMove = (o.moves || []).length ? o.moves[o.moves.length - 1] : null;
    const base = { lines: lines.length, got: got.length, outstanding, missingReported, partial, moved, lastMove, delay: null };
    if (o.received && !partial) {
      return { ...base, kind: 'received', recDay: o.receivedAt ? londonDay(new Date(o.receivedAt)) : o.receivedDay || null };
    }
    const delay = moved ? (o.firstDay <= today ? 'active' : 'moved') : null;
    if (!o.day) return { ...base, delay, kind: 'nodate' };
    if (o.day < today) return { ...base, delay, kind: 'overdue', late: daysBetween(o.day, today) };
    if (o.day === today) return { ...base, delay, kind: 'today' };
    return { ...base, delay, kind: 'upcoming' };
  }

  /** Where an order goes on the screens. Every outstanding order is in exactly one of the outstanding lists. */
  function bucket(o, s, today) {
    if (s.kind === 'received') return s.recDay === today ? 'receivedToday' : 'receivedEarlier';
    if (s.kind === 'overdue') return 'late';
    if (s.kind === 'today') return 'dueToday';
    if (s.kind === 'upcoming') return s.delay === 'active' ? 'late' : 'upcoming';
    return 'nodate';
  }

  /** Receipts recorded on the Hub are the record of what arrived, as the database treats them; a correction (Order
   *  Tracker 1.2) changes that record without changing the receipt. What the Hub says about each material comes from
   *  every receipt and correction in the order they were made: the database works it out (orders_board's 'hub', the
   *  same as private.orders_hub_state) and foldHub does the same here when it isn't given. Monday's order is then
   *  shown as the Hub has it, whether or not Monday shows it yet: arrived (with its condition) or back to still to
   *  arrive; a problem the Hub recorded comes off a material when the Hub no longer has it, and off the order when no
   *  material still has it. Each order also gets its receipts and corrections (for History), the notes as they now
   *  stand, whether a change is still being written (pending/failed), and a mismatch when Monday has been read since a
   *  change was written but doesn't show it (someone changed it there, or the change didn't stick). */
  const PROBLEMS = ['Damaged', 'Wrong colour', 'Wrong quantity', 'Wrong location'];
  function foldHub(events) {
    const lines = {}, notes = {};
    const evs = [...events].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    for (const r of evs) {
      const corr = r.kind === 'correction' || r.kind === 'untick';   // an untick (1.6) is like a correction with no receipt
      if (r.kind === 'receipt' || !r.kind) notes[r.id] = r.note ?? null; else if (r.noteChanged) notes[r.corrects] = r.note ?? null;
      for (const l of r.lines || []) {
        const cur = lines[l.id] || { id: l.id, name: l.name, labels: [] };
        const to = corr ? l.to : l.condition;
        if (to === 'outstanding') Object.assign(cur, { received: false, condition: null, at: null, receipt: null, event: r.id });
        else Object.assign(cur, { received: true, condition: to, event: r.id, at: corr ? cur.at : r.at, receipt: corr ? cur.receipt : r.id,
          labels: !PROBLEMS.includes(to) || cur.labels.includes(to) ? cur.labels : [...cur.labels, to] });
        lines[l.id] = cur;
      }
    }
    return { lines, notes };
  }
  function applyReceipts(orders, receipts, readAt, hub) {
    const by = new Map();
    for (const r of receipts || []) { if (!by.has(r.order)) by.set(r.order, []); by.get(r.order).push(r); }
    const read = readAt ? Date.parse(readAt) : 0;
    return (orders || []).map(o => {
      const rs = by.get(o.id);
      if (!rs) return o;
      const st = (hub && hub[o.id]) || foldHub(rs);
      const n = { ...o, items: (o.items || []).map(i => ({ ...i, issues: [...(i.issues || [])] })), issues: [...(o.issues || [])], hubReceipts: rs,
        hubPending: rs.some(r => r.state === 'pending'), hubFailed: rs.some(r => r.state === 'failed') };
      const xs = Object.values(st.lines || {});
      const everLabels = new Set(xs.flatMap(x => x.labels || []));
      const now = [];   // problems the Hub records now
      let backOut = false, latest = null, mismatch = false;
      for (const x of xs) {
        const want = x.received && PROBLEMS.includes(x.condition) ? [x.condition] : [];
        now.push(...want);
        if (!x.received) backOut = true; else if (!latest || String(x.at) > latest) latest = x.at;
        const ev = rs.find(r => r.id === x.event) || (x.event == null ? rs[rs.length - 1] : null);
        const sent = ev && ev.state === 'sent' && ev.sentAt && Date.parse(ev.sentAt) < read;
        if (x.id === 'order') {
          if (sent && !!o.received !== !!x.received) mismatch = true;
          n.received = !!x.received; n.receivedAt = x.received ? (o.receivedAt || x.at) : null;
          continue;
        }
        const i = n.items.find(y => y.id === x.id);
        if (!i) continue;
        const onMon = !!((o.items || []).find(y => y.id === x.id) || {}).received;
        if (sent && onMon !== !!x.received) mismatch = true;
        i.received = !!x.received;
        i.receivedAt = x.received ? (i.receivedAt || x.at) : null;
        i.issues = [...new Set([...i.issues.filter(b => !(x.labels || []).includes(b)), ...want])];
      }
      const onItems = new Set(n.items.flatMap(i => i.issues));
      n.issues = [...new Set([...n.issues.filter(b => !everLabels.has(b) || onItems.has(b)), ...now])];
      if (backOut && n.items.length) { n.received = false; n.receivedAt = null; }
      else if (n.items.length && n.items.every(i => i.received)) { n.received = true; n.receivedAt = n.receivedAt || latest; }
      n.hubMismatch = mismatch;
      n.hubNotes = rs.filter(r => r.kind !== 'correction').map(r => {
        const fix = [...rs].reverse().find(c => c.kind === 'correction' && c.corrects === r.id && c.noteChanged);
        const text = Object.prototype.hasOwnProperty.call(st.notes || {}, r.id) ? st.notes[r.id] : r.note;
        return text ? { text, at: fix ? fix.at : r.at, by: fix ? fix.by : r.by } : null;
      }).filter(Boolean);
      n.hubState = st;
      return n;
    });
  }

  const api = { TZ, MISSING, PROBLEMS, londonDay, daysBetween, status, bucket, foldHub, applyReceipts };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FLR_ORDER_RULES = api;
})(typeof window !== 'undefined' ? window : globalThis);
