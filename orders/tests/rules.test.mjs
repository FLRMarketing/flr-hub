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

test('a receipt shows at once: arrived products and their condition; the rest stay to come; whole means received', () => {
  const o = order({ id: '7', day: T, items: [{ id: 'a', name: 'A', received: false, issues: [] }, { id: 'b', name: 'B', received: false, issues: [] }] });
  const part = { order: '7', at: '2026-10-12T09:00:00Z', state: 'pending', whole: false, lines: [{ id: 'a', condition: 'Damaged' }] };
  const [p] = R.applyReceipts([o], [part], '2026-10-12T08:55:00Z');
  const s = R.status(p, T);
  assert.equal(s.partial, true); assert.deepEqual(s.outstanding.map(i => i.id), ['b']);
  assert.deepEqual(p.items[0].issues, ['Damaged']); assert.deepEqual(p.issues, ['Damaged']);
  assert.equal(p.hubPending, true); assert.equal(R.bucket(p, s, T), 'dueToday');
  const rest = { order: '7', at: '2026-10-12T10:00:00Z', state: 'failed', whole: true, lines: [{ id: 'b', condition: 'good' }] };
  const [w] = R.applyReceipts([o], [part, rest], '2026-10-12T08:55:00Z');
  const ws = R.status(w, T);
  assert.equal(ws.kind, 'received'); assert.equal(R.bucket(w, ws, T), 'receivedToday');
  assert.deepEqual(w.issues, ['Damaged'], 'a damaged delivery that has all arrived keeps its flag');
  assert.equal(w.hubFailed, true);
  // written and read back from Monday: still recorded, no warning
  const sent = { ...part, state: 'sent', sentAt: '2026-10-12T09:00:05Z' };
  const onMon = { ...o, items: [{ id: 'a', name: 'A', received: true, issues: ['Damaged'] }, o.items[1]], issues: ['Damaged'] };
  const [m] = R.applyReceipts([onMon], [sent], '2026-10-12T09:01:00Z');
  assert.equal(m.items[0].received, true); assert.equal(m.hubMismatch, false); assert.equal(m.hubPending, false);
  // Monday read since the write but doesn't show it (unticked there, or the board was reset): the Hub's record stays,
  // with a warning, so the page and the database agree on what can still be recorded
  const [x] = R.applyReceipts([o], [sent], '2026-10-12T09:01:00Z');
  assert.equal(x.items[0].received, true); assert.equal(x.hubMismatch, true);
  assert.deepEqual(R.status(x, T).outstanding.map(i => i.id), ['b']);
  // written but not read back yet: no warning
  assert.equal(R.applyReceipts([o], [sent], '2026-10-12T08:59:00Z')[0].hubMismatch, false);
  assert.equal(m.hubReceipts.length, 1);
  assert.deepEqual(R.applyReceipts([o], [], null), [o]);
});

test('a correction: a material put back to still to arrive, a condition changed, damage kept while another has it', () => {
  const items = [{ id: 'a', name: 'A', received: true, issues: ['Damaged'] }, { id: 'b', name: 'B', received: true, issues: ['Damaged'] }, { id: 'c', name: 'C', received: true, issues: [] }];
  const o = order({ id: '8', day: T, received: true, receivedAt: '2026-10-12T09:00:05Z', items, issues: ['Damaged'] });   // Monday after the receipt was written
  const rec = { id: 1, order: '8', kind: 'receipt', at: '2026-10-12T09:00:00Z', by: 'Ola', state: 'sent', sentAt: '2026-10-12T09:00:05Z', whole: true, note: 'Two boxes crushed.',
    lines: [{ id: 'a', name: 'A', condition: 'Damaged' }, { id: 'b', name: 'B', condition: 'Damaged' }, { id: 'c', name: 'C', condition: 'good' }] };
  const back = { id: 2, order: '8', kind: 'correction', corrects: 1, at: '2026-10-12T11:00:00Z', by: 'Sam', state: 'pending', reason: 'C went to another job', lines: [{ id: 'c', name: 'C', from: 'good', to: 'outstanding' }] };
  const [p] = R.applyReceipts([o], [rec, back], '2026-10-12T10:00:00Z');
  const s = R.status(p, T);
  assert.equal(p.received, false, 'no longer received, though Monday still has it ticked');
  assert.equal(s.kind, 'today'); assert.equal(s.partial, true); assert.deepEqual(s.outstanding.map(i => i.id), ['c']);
  assert.equal(R.bucket(p, s, T), 'dueToday'); assert.equal(p.hubPending, true); assert.equal(p.hubMismatch, false);
  // the adhesive was fine: Damaged comes off A, the order keeps it (B is still damaged); then B too, and it comes off the order
  const fixA = { id: 3, order: '8', kind: 'correction', corrects: 1, at: '2026-10-12T11:05:00Z', by: 'Sam', state: 'pending', reason: 'A is fine', lines: [{ id: 'a', from: 'Damaged', to: 'good' }] };
  const [q] = R.applyReceipts([o], [rec, back, fixA], '2026-10-12T10:00:00Z');
  assert.deepEqual(q.items.map(i => i.issues), [[], ['Damaged'], []]); assert.deepEqual(q.issues, ['Damaged']);
  const fixB = { id: 4, order: '8', kind: 'correction', corrects: 1, at: '2026-10-12T11:06:00Z', by: 'Sam', state: 'pending', reason: 'B is the wrong colour', noteChanged: true, note: 'B is grey, not white.', lines: [{ id: 'b', from: 'Damaged', to: 'Wrong colour' }] };
  const [r] = R.applyReceipts([o], [rec, back, fixA, fixB], '2026-10-12T10:00:00Z');
  assert.deepEqual(r.items.map(i => i.issues), [[], ['Wrong colour'], []]); assert.deepEqual(r.issues, ['Wrong colour']);
  assert.deepEqual(r.hubNotes, [{ text: 'B is grey, not white.', at: '2026-10-12T11:06:00Z', by: 'Sam' }], 'the note as it now stands, by who changed it');
  assert.equal(r.hubReceipts.length, 4, 'the receipt and every correction stay for History');
  // the order of events decides, whatever order they arrive in
  assert.deepEqual(R.applyReceipts([o], [fixB, back, rec, fixA], '2026-10-12T10:00:00Z')[0].items.map(i => [i.received, i.issues]), r.items.map(i => [i.received, i.issues]));
  // the database's state, when given, is used
  const hub = { '8': R.foldHub([rec, back, fixA, fixB]) };
  assert.deepEqual(R.applyReceipts([o], [rec, back, fixA, fixB], '2026-10-12T10:00:00Z', hub)[0].items, r.items);
  // the correction written and Monday read since, but Monday still shows C received: a warning
  const sent = { ...back, state: 'sent', sentAt: '2026-10-12T11:00:05Z' };
  const [m] = R.applyReceipts([o], [rec, sent], '2026-10-12T11:01:00Z');
  assert.equal(m.hubMismatch, true); assert.equal(m.items[2].received, false);
  const onMon = { ...o, received: false, receivedAt: null, items: [items[0], items[1], { ...items[2], received: false }] };
  assert.equal(R.applyReceipts([onMon], [rec, sent], '2026-10-12T11:01:00Z')[0].hubMismatch, false);
  // recorded again when it does come: received again, whole
  const again = { id: 5, order: '8', kind: 'receipt', at: '2026-10-13T08:00:00Z', by: 'Ola', state: 'pending', whole: true, lines: [{ id: 'c', name: 'C', condition: 'good' }] };
  const [g] = R.applyReceipts([onMon], [rec, sent, again], '2026-10-12T11:01:00Z');
  assert.equal(R.status(g, T).kind, 'received');
});

test('a whole delivery with no products, put back to still to arrive', () => {
  const o = order({ id: '9', day: T, received: true, receivedAt: '2026-10-12T09:00:05Z', items: [] });
  const rec = { id: 1, order: '9', at: '2026-10-12T09:00:00Z', state: 'sent', sentAt: '2026-10-12T09:00:05Z', whole: true, lines: [{ id: 'order', condition: 'good' }] };
  const back = { id: 2, order: '9', kind: 'correction', corrects: 1, at: '2026-10-12T10:00:00Z', state: 'pending', reason: 'Wrong job', lines: [{ id: 'order', from: 'good', to: 'outstanding' }] };
  const [p] = R.applyReceipts([o], [rec, back], '2026-10-12T09:30:00Z');
  assert.equal(p.received, false); assert.equal(R.status(p, T).kind, 'today');
});

test('a tick (arrived) is received with no label; Undo puts it back', () => {
  const o = order({ id: '10', day: T, items: [{ id: 'a', name: 'A', received: false, issues: [] }, { id: 'b', name: 'B', received: false, issues: [] }] });
  const tick = { id: 1, order: '10', kind: 'receipt', at: '2026-10-12T09:00:00Z', by: 'Ola', state: 'pending', whole: false, lines: [{ id: 'a', name: 'A', condition: 'arrived' }] };
  const [p] = R.applyReceipts([o], [tick], null);
  assert.equal(p.items[0].received, true); assert.deepEqual(p.items[0].issues, []); assert.deepEqual(p.issues, []);
  assert.deepEqual(R.foldHub([tick]).lines.a.labels, []);
  assert.equal(R.status(p, T).partial, true);
  const undo = { id: 2, order: '10', kind: 'correction', corrects: 1, at: '2026-10-12T09:01:00Z', by: 'Ola', state: 'pending', reason: 'Ticked by mistake', lines: [{ id: 'a', from: 'arrived', to: 'outstanding' }] };
  const [q] = R.applyReceipts([o], [tick, undo], null);
  assert.equal(q.items[0].received, false); assert.equal(R.status(q, T).partial, false);
});
