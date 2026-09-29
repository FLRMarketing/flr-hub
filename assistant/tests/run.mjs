// Checks the Hub Assistant's help library and how well it answers.
//   node assistant/tests/run.mjs           checks help.json, then asks every question in questions.json
//   node assistant/tests/run.mjs --sweep   also shows how other confidence thresholds would do
// A question with "expect": null must NOT get a confident answer: the assistant should say it doesn't know.
// Exits 1 on any problem in help.json, any confident wrong answer, or any confident answer that should have been "I don't know".
import { readFileSync } from 'node:fs';
import { buildIndex, search, searchSlots, maybes, hubWords, properNames, unaddressed, MIN_SCORE, MIN_COVERAGE } from '../engine.js';

const help = JSON.parse(readFileSync(new URL('../help.json', import.meta.url), 'utf8'));
// questions.json is the tuning set; heldout.json was written by someone who never saw the help text (run with --heldout).
// records.json: questions about records, with names and registrations, routed as the chat routes them (--records).
const setName = process.argv.includes('--heldout') ? 'heldout.json' : process.argv.includes('--records') ? 'records.json' : 'questions.json';
const cases = JSON.parse(readFileSync(new URL('./' + setName, import.meta.url), 'utf8'));
const TOOLS = new Set(['hub', 'estimator', 'speeding', 'annual-leave', 'fitters']);
const problems = [];

// ---- the library itself: complete, linked up, and safe to publish (this site is public)
const ids = new Set();
for (const e of help.entries) {
  const at = `entry ${e.id || '(no id)'}`;
  if (!/^[a-z0-9-]+$/.test(e.id || '')) problems.push(`${at}: id must be lower-case words and dashes`);
  if (ids.has(e.id)) problems.push(`${at}: duplicate id`);
  ids.add(e.id);
  if (!TOOLS.has(e.tool)) problems.push(`${at}: unknown tool "${e.tool}"`);
  if (!e.title || !e.answer) problems.push(`${at}: needs a title and an answer`);
  if (!Array.isArray(e.ask) || e.ask.length < 2) problems.push(`${at}: needs at least two ways of asking`);
  if (e.link) {
    const h = e.link.href || '', t = e.link.tile || '';
    if (!h && !t) problems.push(`${at}: link needs an href or a tile`);
    if (h && /^[a-z]+:/i.test(h)) problems.push(`${at}: link must stay on the Hub (relative), or name a tile`);
    if (t && !TOOLS.has(t)) problems.push(`${at}: unknown tile "${t}"`);
  }
  const text = JSON.stringify(e);
  if (/@|https?:\/\/(?!flrmarketing\.github\.io\/flr-hub\/)/i.test(text)) problems.push(`${at}: no email addresses or outside links in public help`);
  if (/(access code|passcode|code)\s+(is|=)\s*[:"“‘']/i.test(text)) problems.push(`${at}: never put a code in the help`);
  if (e.answer && e.answer.length > 420) problems.push(`${at}: answer is ${e.answer.length} characters; keep it under 420`);
}
for (const e of help.entries) for (const r of e.related || []) if (!ids.has(r)) problems.push(`entry ${e.id}: related "${r}" doesn't exist`);
for (const c of cases) for (const id of [c.expect, ...(c.alt || [])]) if (id && !ids.has(id)) problems.push(`question "${c.q}": names unknown entry "${id}"`);
for (const id of ['about-estimator', 'about-leave', 'about-fleet', 'about-fitters', 'signin', 'account-new', 'password-forgot']) {
  if (!ids.has(id)) problems.push(`the assistant's own chips need an entry "${id}"`);
}

// ---- the questions
const index = buildIndex(help.entries);
const PLATE = /\b[a-z]{2}\d{2}\s?[a-z]{3}\b|\b[a-z]\d{1,3}\s?[a-z]{3}\b/gi;
const byId = new Map(help.entries.map(e => [e.id, e]));
const words = hubWords(help);
// As assistant.js (ask): his name said to him is left out; a registration reads as "registration"; people named with a
// capital are set aside, and stay names only if what's left is a question about records; an answer found only by setting
// names aside counts only when that answer looks records up (the records then check the names).
const route = (said, page) => {
  const q = unaddressed(said) || said, asked = q.replace(PLATE, ' registration '), people = properNames(q, words);
  if (people.length) {
    const r = searchSlots(index, people.reduce((t, n) => t.replace(n, ' '), asked), { page });
    if (r.confident && byId.get(r.results[0].entry.id).data) return { ...r, slots: [...people.flatMap(n => n.toLowerCase().split(' ')), ...r.slots] };
  }
  const r = searchSlots(index, asked, { page });
  return r.slots.length && !r.confident ? search(index, asked, { page }) : r;
};
const runs = cases.map(c => ({ c, r: setName === 'records.json' ? route(c.q, c.page || 'hub') : search(index, c.q, { page: c.page || 'hub' }) }));
function grade(minScore, minCov) {
  const out = { right: 0, wrong: [], refused: [], leaked: [], held: 0 };
  for (const { c, r } of runs) {
    const top = r.results[0];
    const confident = !!top && top.score >= minScore && top.coverage >= minCov;
    // "names": the names that must reach the records look-up ([] for none: the question is about the person asking)
    const named = r.slots || [], namesOk = !c.names || (c.names.length ? c.names.every(n => named.includes(n)) : !named.length);
    const ok = top && (top.entry.id === c.expect || (c.alt || []).includes(top.entry.id)) && namesOk;
    // A confident answer that rests on names set aside is only given when the look-up finds those names in the person's
    // own records (records.js); a question that should be declined names no one, so it's declined there.
    if (c.expect == null) { if (confident && !ok && !(r.slots && r.slots.length)) out.leaked.push({ c, top }); else out.held++; continue; }
    if (!confident) { if (c.declineOk) out.right++; else out.refused.push({ c, top }); continue; }
    else if (ok) out.right++;
    else out.wrong.push({ c, top });
  }
  return out;
}
const g = grade(MIN_SCORE, MIN_COVERAGE);
const answerable = cases.filter(c => c.expect != null).length, unanswerable = cases.length - answerable;
const show = x => `  "${x.c.q}"${x.c.page ? ` [on ${x.c.page}]` : ''} -> ${x.top ? `${x.top.entry.id} (${x.top.score}, cover ${x.top.coverage})` : 'nothing'}${x.c.expect ? `, wanted ${x.c.expect}` : ''}${x.c.names ? ` with names [${x.c.names}]` : ''}`;

if (problems.length) { console.log('HELP LIBRARY PROBLEMS'); for (const p of problems) console.log('  ' + p); console.log(); }
console.log(`${setName}: ${help.entries.length} answers, ${cases.length} questions (${answerable} answerable, ${unanswerable} it should decline)`);
console.log(`thresholds: score >= ${MIN_SCORE}, coverage >= ${MIN_COVERAGE}`);
console.log(`answered right: ${g.right}/${answerable}   said "not sure" instead: ${g.refused.length}   WRONG: ${g.wrong.length}`);
console.log(`declined correctly: ${g.held}/${unanswerable}   ANSWERED WHEN IT SHOULDN'T: ${g.leaked.length}`);
const offered = runs.filter(({ c, r }) => c.expect == null && !r.confident && maybes(r).length);
const helped = runs.filter(({ c, r }) => c.expect != null && !r.confident && maybes(r).some(x => x.entry.id === c.expect || (c.alt || []).includes(x.entry.id)));
console.log(`when not confident: right answer among the suggestions ${helped.length}/${runs.filter(({ c, r }) => c.expect != null && !r.confident).length}; suggestions offered for questions it should decline ${offered.length}/${unanswerable}`);
for (const { c, r } of offered) console.log(`  "${c.q}" -> ${maybes(r).map(x => x.entry.id).join(', ')}`);
if (g.wrong.length) { console.log('\nWrong answers:'); g.wrong.forEach(x => console.log(show(x))); }
if (g.leaked.length) { console.log('\nShould have said it didn\'t know:'); g.leaked.forEach(x => console.log(show(x))); }
if (g.refused.length) { console.log('\nNot confident (the person sees suggestions instead):'); g.refused.forEach(x => console.log(show(x))); }

if (process.argv.includes('--sweep')) {
  console.log('\nscore  cover   right  unsure  wrong  leaked');
  for (const s of [4, 5, 6, 7, 8, 9, 10, 11, 12]) for (const cv of [0.4, 0.45, 0.5, 0.55, 0.6]) {
    const x = grade(s, cv);
    console.log(`${String(s).padStart(5)}  ${cv.toFixed(2).padStart(5)}  ${String(x.right).padStart(6)}  ${String(x.refused.length).padStart(6)}  ${String(x.wrong.length).padStart(5)}  ${String(x.leaked.length).padStart(6)}`);
  }
}
process.exit(problems.length || g.wrong.length || g.leaked.length ? 1 : 0);
