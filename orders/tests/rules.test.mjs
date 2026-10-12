// The Order Tracker’s rules (orders/rules.js): node --test orders/tests/rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../rules.js');

const T = '2026-10-12';
const line = (name, received = false, issues = []) => ({ name, received, issues });
const order = o => ({ id: '1', job: 'JOB', items: [line('A')], issues: [], moves: [], received: false, ...o });
const look = o => { const s = R.status(o, T); return { ...s, bucket: R.bucket(o, s, T) }; };

test('"today" is the day in London, in summer and winter time', () => {
  assert.equal(R.londonDay(new Date('2026-10-12T23:30:00Z')), '2026-10-13');   // BST: 00:30 on the 13th
  assert.equal(R.londonDay(new Date('2026-10-12T22:59:00Z')), '2026-10-12');
  assert.equal(R.londonDay(new Date('2026-12-31T23:30:00Z')), '2026-12-31');   // GMT
  assert.equal(R.londonDay(new Date('2026-10-25T00:30:00Z')), '2026-10-25');   // the night the clocks go back
});

test('moved later after its first date had come, still to arrive: Delayed, on the main screen', () => {
  const s = look(order({ firstDay: '2026-10-09', day: '2026-10-14' }));
  assert.equal(s.delay, 'active'); assert.equal(s.kind, 'upcoming'); assert.equal(s.bucket, 'late');
  const t = look(order({ firstDay: '2026-10-09', day: T }));
  assert.equal(t.delay, 'active'); assert.equal(t.bucket, 'dueToday');
  assert.equal(look(order({ firstDay: T, day: '2026-10-13' })).delay, 'active', 'due today, moved to tomorrow');
});

test('moved later before its first date came: "Date moved", not late, under Coming up', () => {
  const s = look(order({ firstDay: '2026-10-14', day: '2026-10-16' }));
  assert.equal(s.delay, 'moved'); assert.equal(s.bucket, 'upcoming');
  assert.equal(look(order({ firstDay: '2026-10-16', day: '2026-10-14' })).delay, null, 'moved earlier is not a delay');
});

test('once it has all arrived, a moved order is just received', () => {
  const s = look(order({ firstDay: '2026-10-09', day: '2026-10-14', received: true, receivedAt: '2026-10-12T09:00:00Z', items: [line('A', true)] }));
  assert.equal(s.kind, 'received'); assert.equal(s.delay, null); assert.equal(s.bucket, 'receivedToday');
  assert.equal(s.moved, true, 'the history still knows it moved');
  const later = R.status(order({ firstDay: '2026-10-01', day: '2026-10-05', received: true, receivedAt: '2026-10-05T09:00:00Z', items: [line('A', true)] }), T);
  assert.equal(later.kind, 'received'); assert.equal(R.bucket({}, later, T), 'receivedEarlier');
});

test('part received: never received, never gone from the outstanding lists', () => {
  // Received ticked on the order but one product isn't
  const a = look(order({ day: T, received: true, receivedAt: '2026-10-12T08:00:00Z', items: [line('A', true), line('B')] }));
  assert.equal(a.kind, 'today'); assert.equal(a.partial, true); assert.deepEqual(a.outstanding.map(i => i.name), ['B']); assert.equal(a.bucket, 'dueToday');
  // Some products ticked, the order not
  const b = look(order({ day: '2026-10-09', items: [line('A', true), line('B'), line('C')] }));
  assert.equal(b.kind, 'overdue'); assert.equal(b.got, 1); assert.equal(b.outstanding.length, 2); assert.equal(b.bucket, 'late');
  // A product ticked but logged "Item missing"
  const c = look(order({ day: T, received: true, items: [line('A', true), line('B', true, ['Item missing'])] }));
  assert.equal(c.partial, true); assert.deepEqual(c.outstanding.map(i => i.name), ['B']);
  // Everything ticked but "Item missing" logged on the order
  const d = look(order({ day: T, received: true, issues: ['Item missing'], items: [line('A', true)] }));
  assert.equal(d.partial, true); assert.equal(d.missingReported, true); assert.notEqual(d.kind, 'received');
  // Other problems don't make anything outstanding
  const e = look(order({ day: T, received: true, issues: ['Damaged'], items: [line('A', true, ['Damaged'])] }));
  assert.equal(e.kind, 'received'); assert.equal(e.partial, false);
  // A partial order whose date was moved after its first date: still Delayed, and part received
  const f = look(order({ firstDay: '2026-10-09', day: '2026-10-15', items: [line('A', true), line('B')] }));
  assert.equal(f.partial, true); assert.equal(f.delay, 'active'); assert.equal(f.bucket, 'late');
});

test('every order is in exactly one list, and only fully received ones in the received lists', () => {
  const days = [null, '2026-10-09', T, '2026-10-14'];
  const lines = [[], [line('A')], [line('A', true)], [line('A', true), line('B')]];
  for (const day of days) for (const first of [null, '2026-10-08', '2026-10-13']) for (const items of lines) for (const received of [false, true]) {
    const o = order({ day, firstDay: first && day && first < day ? first : null, items, received, receivedAt: received ? '2026-10-12T10:00:00Z' : null });
    const s = R.status(o, T), b = R.bucket(o, s, T);
    assert.ok(['dueToday', 'late', 'upcoming', 'nodate', 'receivedToday', 'receivedEarlier'].includes(b));
    if (b.startsWith('received')) assert.ok(o.received && !s.partial, JSON.stringify(o));
    if (s.partial) assert.ok(!b.startsWith('received'));
  }
});
