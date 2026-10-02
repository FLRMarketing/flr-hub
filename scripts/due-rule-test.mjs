// Checks Fleet Management's MOT, tax and service rule (dueState, the page's DUE block, as speeding/speeding-core.js
// carries it) against the cases agreed with FLR on 2 Oct 2026: every live case from the board that day, then each step
// of the rule. Exits 1 on any difference.
//   node scripts/due-rule-test.mjs
import { dueState, dueDay } from '../speeding/speeding-core.js';

const TODAY = '2026-10-02';   // the day the cases were read from the Monday fleet board
const problems = [];
const check = (name, x, key, want, today = TODAY) => {
  const u = dueState(x, key, today, 30);
  for (const [k, v] of Object.entries(want)) if (u[k] !== v) problems.push(`${name}: ${k} is ${JSON.stringify(u[k])}, expected ${JSON.stringify(v)}`);
  // Never green once the date has passed, and solid red only when Monday says Overdue too.
  if (u.days != null && u.days < 0 && u.cls === 'ok') problems.push(`${name}: a passed date shows green`);
  if (u.cls === 'over' && !/^overdue$/i.test(String(x.status || ''))) problems.push(`${name}: solid red without Monday saying Overdue`);
  return u;
};
const dated = (what, n) => ({ kind: 'check', cls: 'dated', label: `${what} date overdue by ${n} ${n === 1 ? 'day' : 'days'} — Monday status needs checking`,
  short: `Date overdue by ${n} ${n === 1 ? 'day' : 'days'} — Monday status needs checking` });

// ---- every live case on 2 Oct 2026 (the rule table on the plan, "Every live case, now and proposed")
check('32 FLR tax', { status: 'Overdue', date: '2026-10-01' }, 'tax', { kind: 'action', cls: 'over', label: 'Overdue by 1 day' });
check('P9 FLR tax', { status: 'Overdue', date: '2026-10-01' }, 'tax', { kind: 'action', cls: 'over', label: 'Overdue by 1 day' });
check('X7 FLR service', { status: 'OK', date: '2026-07-07' }, 'service', dated('Service', 87));
check('M3 FLR service', { status: 'Due soon', date: '2026-09-15' }, 'service', dated('Service', 17));
check('L7 FLR service', { status: 'Due soon', date: '2026-09-04' }, 'service', dated('Service', 28));
check('K8 FLR service', { status: 'OK', date: '2026-09-12' }, 'service', dated('Service', 20));
check('K6 FLR service', { status: 'OK', date: '2026-04-01' }, 'service', dated('Service', 184));
check('X3 FLR tax', { status: 'Exempt', date: '2026-10-01' }, 'tax', dated('Tax', 1));
check('X6 FLR tax', { status: 'Exempt', date: '2026-10-01' }, 'tax', dated('Tax', 1));
check('K3 FLR tax', { status: 'Exempt', date: '2026-11-01' }, 'tax', { kind: 'exempt', cls: 'exempt', label: 'Exempt', upcoming: true, days: 30 });
check('X7 FLR tax', { status: 'Exempt', date: '2027-03-01' }, 'tax', { kind: 'exempt', cls: 'exempt', label: 'Exempt', upcoming: false });
check('X6 FLR MOT', { status: 'Due soon', date: '2026-10-12' }, 'mot', { kind: 'soon', cls: 'soon', label: 'Due in 10 days', upcoming: true });
check('K7 FLR MOT', { status: 'Due soon', date: '2026-10-13' }, 'mot', { kind: 'soon', label: 'Due in 11 days' });
check('A6 FLR MOT', { status: 'Due soon', date: '2026-10-14' }, 'mot', { kind: 'soon', label: 'Due in 12 days' });
check('K3 FLR MOT', { status: 'Due soon', date: '2026-10-30' }, 'mot', { kind: 'soon', label: 'Due in 28 days' });
check('K8 FLR tax', { status: 'OK', date: '2026-11-01' }, 'tax', { kind: 'soon', cls: 'soon', label: 'Due in 30 days', monday: 'OK' });
check('32 FLR service', { status: 'OK', date: '2026-12-01' }, 'service', { kind: 'ok', cls: 'ok', label: 'OK' });
check('X7 FLR MOT', { status: 'OK', date: '2027-03-05' }, 'mot', { kind: 'ok', cls: 'ok', label: 'OK' });
check('6 FLR service', { status: null, date: null }, 'service', { kind: 'check', cls: 'check', label: 'No date on the board', short: 'No date' });

// ---- each step of the rule
check('1. no date, Exempt', { status: 'Exempt', date: null }, 'tax', { kind: 'exempt', label: 'Exempt' });
check('1. no date, nothing', {}, 'mot', { kind: 'check', label: 'No date on the board' });
check('1. no record at all', null, 'mot', { kind: 'check', label: 'No date on the board' });
check('2. unreadable date', { status: 'OK', date: '01/10/2026' }, 'mot', { kind: 'check', cls: 'check', label: "Date can't be read — needs checking" });
check('2. impossible date', { status: 'OK', date: '2026-02-30' }, 'mot', { kind: 'check', label: "Date can't be read — needs checking" });
check('3. passed, blank status', { status: '', date: '2026-09-30' }, 'mot', dated('MOT', 2));
check('3. passed, lower-case overdue', { status: 'overdue', date: '2026-09-30' }, 'mot', { kind: 'action', cls: 'over', label: 'Overdue by 2 days' });
check('3. passed, a date with a time', { status: 'Overdue', date: '2026-10-01 09:30' }, 'tax', { kind: 'action', label: 'Overdue by 1 day' });
check('4. Overdue on the day', { status: 'Overdue', date: '2026-10-02' }, 'tax', { kind: 'action', cls: 'over', label: 'Overdue · due today' });
check('4. Overdue before the day', { status: 'Overdue', date: '2026-11-14' }, 'tax', { kind: 'check', cls: 'check', label: 'Monday says Overdue — date not reached, needs checking' });
check('5. Exempt, 31 days away', { status: 'Exempt', date: '2026-11-02' }, 'tax', { kind: 'exempt', upcoming: false });
check('5. Exempt, due today', { status: 'Exempt', date: '2026-10-02' }, 'tax', { kind: 'exempt', upcoming: true, days: 0 });
check('6. due today, OK', { status: 'OK', date: '2026-10-02' }, 'mot', { kind: 'soon', label: 'Due today', days: 0 });
check('6. 30 days, blank', { status: null, date: '2026-11-01' }, 'service', { kind: 'soon', label: 'Due in 30 days' });
check('7. 31 days, Due soon', { status: 'Due soon', date: '2026-11-02' }, 'service', { kind: 'ok', cls: 'ok', label: 'OK', monday: 'Due soon' });
// A year's turn and a clock change are whole days.
check('clock change', { status: 'OK', date: '2026-10-26' }, 'mot', { kind: 'soon', label: 'Due in 24 days' });
check('across the year', { status: 'OK', date: '2027-01-01' }, 'mot', { kind: 'soon', label: 'Due in 2 days' }, '2026-12-30');
for (const [s, want] of [['2026-10-02', '2026-10-02'], ['2026-10-02T08:00', '2026-10-02'], [' 2026-10-02 ', '2026-10-02'], ['2026-13-01', null], ['2/10/2026', null], ['', null], [null, null]])
  if (dueDay(s) !== want) problems.push(`dueDay(${JSON.stringify(s)}) is ${JSON.stringify(dueDay(s))}, expected ${JSON.stringify(want)}`);

if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
console.log('MOT, tax and service rule: all cases as agreed');
