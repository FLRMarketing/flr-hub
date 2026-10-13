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

  /** Receipts recorded on the Hub, shown before Monday has caught up: a receipt not yet written to Monday, or written
   *  after the last read, marks its products as arrived (with their condition) and the order as received if it was
   *  the last of them. Every order gets its Hub receipts (for History) and whether one is still being written. */
  const PROBLEMS = ['Damaged', 'Wrong colour', 'Wrong quantity', 'Wrong location'];
  function applyReceipts(orders, receipts, readAt) {
    const by = new Map();
    for (const r of receipts || []) { if (!by.has(r.order)) by.set(r.order, []); by.get(r.order).push(r); }
    const read = readAt ? Date.parse(readAt) : 0;
    return (orders || []).map(o => {
      const rs = by.get(o.id);
      if (!rs) return o;
      const fresh = rs.filter(r => r.state !== 'sent' || !r.sentAt || Date.parse(r.sentAt) > read);
      const n = { ...o, items: (o.items || []).map(i => ({ ...i, issues: [...(i.issues || [])] })), issues: [...(o.issues || [])], hubReceipts: rs,
        hubPending: fresh.some(r => r.state === 'pending'), hubFailed: fresh.some(r => r.state === 'failed') };
      for (const r of fresh) {
        for (const l of r.lines || []) {
          const bad = PROBLEMS.includes(l.condition) ? [l.condition] : [];
          if (l.id === 'order') { n.received = true; n.receivedAt = n.receivedAt || r.at; }
          const i = n.items.find(x => x.id === l.id);
          if (i) { i.received = true; i.receivedAt = i.receivedAt || r.at; for (const b of bad) if (!i.issues.includes(b)) i.issues.push(b); }
          for (const b of bad) if (!n.issues.includes(b)) n.issues.push(b);
        }
        if (r.whole) { n.received = true; n.receivedAt = n.receivedAt || r.at; }
      }
      return n;
    });
  }

  const api = { TZ, MISSING, PROBLEMS, londonDay, daysBetween, status, bucket, applyReceipts };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FLR_ORDER_RULES = api;
})(typeof window !== 'undefined' ? window : globalThis);
