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

  const api = { TZ, MISSING, londonDay, daysBetween, status, bucket };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FLR_ORDER_RULES = api;
})(typeof window !== 'undefined' ? window : globalThis);
