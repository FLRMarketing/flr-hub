/* ============================================================================
   Activity in Hub settings: each change-log entry (public.audit_events, read
   through admin_activity(), Hub migration 2.9) as a plain sentence, with its
   details as labelled lines instead of code. Pure wording: no network, no
   page. settings.js draws it.
     FLRActivity.describe(entry, ctx) -> { parts, details }
       parts    the sentence after the person's name: strings, and {b: text}
                for the things to stand out (a quotation, a person, an app)
       details  [label, value] pairs for the "Details" line under it
     ctx: { personName(id) -> name or '', appTitle(id), roleName(role), roleAs(role) ('an Admin'), teamName(id) }
   A kind this file doesn't know yet still reads as a sentence ("did
   something in Quotes: room repriced") with its details listed.
   ========================================================================== */
(function () {
  'use strict';
  const AREA = { quotes: 'Quotes', accounts: 'Accounts', leave: 'Annual Leave', fleet: 'Fleet Management', orders: 'Order Tracker',
    warehouse: 'Warehouse Tasks', teams: 'Teams', nearby: 'Nearby', other: 'the Hub' };
  const CHECKED = { phone: 'checked by phone', teams: 'checked on Teams', it: 'checked by IT' };
  const b = text => ({ b: String(text) });
  const money = n => typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }) : String(n);
  const num = n => typeof n === 'number' ? n.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(n);
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
  // A person in a detail: {oid, name}, an account id, or nothing.
  function who(v, ctx) {
    if (!v) return '';
    if (typeof v === 'object') return (v.name || '').trim() || ctx.personName(v.oid || v.id) || 'someone';
    return ctx.personName(v) || 'someone';
  }
  // camelCase / snake_case keys as words: finalExVat -> "Final ex VAT".
  function label(k) {
    const words = String(k).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      .replace(/\bex vat\b/, 'ex VAT').replace(/\bvat\b/, 'VAT').replace(/\bid\b/, 'ID').replace(/\bmot\b/, 'MOT');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  const MONEY_KEY = /price|total|vat|cost|amount|value|sell/i;
  // A detail value as words, never code.
  function value(k, v, ctx) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return MONEY_KEY.test(k) ? money(v) : /area/i.test(k) ? `${num(v)} m²` : /hours/i.test(k) ? `${num(v)} hours` : num(v);
    if (Array.isArray(v)) return v.length ? v.map(x => (typeof x === 'object' && x ? value(k, x, ctx) : ctx.appTitle(String(x)) || String(x))).join(', ') : 'none';
    if (typeof v === 'object') {
      if ('oid' in v || ('name' in v && Object.keys(v).length <= 2)) return who(v, ctx);
      const keys = Object.keys(v);
      if (!keys.length) return '—';
      return keys.slice(0, 6).map(x => `${label(x)}: ${value(x, v[x], ctx)}`).join(' · ') + (keys.length > 6 ? ` · and ${keys.length - 6} more` : '');
    }
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : s;
  }
  // Keys the sentence already says, or that mean nothing to a person reading the log.
  const QUIET = new Set(['forced', 'version', 'user', 'oid', 'requestedId', 'diff']);
  function details(d, ctx, skip = []) {
    const out = [];
    for (const [k, v] of Object.entries(d || {})) {
      if (QUIET.has(k) || skip.includes(k)) continue;
      out.push([label(k), value(k, v, ctx)]);
    }
    if (d && d.forced) out.push(['Overwrote', 'a newer copy someone else had saved']);
    if (d && d.diff && typeof d.diff === 'object') { const n = Array.isArray(d.diff) ? d.diff.length : Object.keys(d.diff).length; if (n) out.push(['Changes', plural(n, 'setting', 'settings')]); }
    if (d && typeof d.version === 'number') out.push(['Version', num(d.version)]);
    return out;
  }
  const quote = e => e.quoteId ? b(e.quoteId) : 'a quotation';
  const room = e => e.roomId ? b(`room ${e.roomId}`) : 'a room';

  // kind -> (entry, detail, ctx) -> parts. Each says what happened, in the past tense, after the person's name.
  const SAY = {
    // Quotes (Cost Estimator)
    'project.create': (e) => ['created quotation ', quote(e)],
    'project.import': (e) => ['imported quotation ', quote(e)],
    'project.setup': (e, d) => [d.forced ? 'saved the job details of ' : 'edited the job details of ', quote(e)],
    'project.save': (e) => ['saved ', quote(e)],
    'project.approve': (e) => ['approved ', quote(e)],
    'project.unapprove': (e) => ['took back the approval of ', quote(e)],
    'approval.save': (e) => ['approved ', quote(e)],
    'project.delete': (e, d) => ['deleted quotation ', quote(e), d.rooms != null ? ` (${plural(d.rooms, 'room', 'rooms')}${d.approved ? ', approved' : ''})` : ''],
    'project.archive': (e) => ['archived ', quote(e)],
    'project.restore': (e) => ['restored ', quote(e), ' from the archive'],
    'project.reassign': (e, d, ctx) => ['reassigned ', quote(e), ' from ', b(who(d.from, ctx) || 'nobody'), ' to ', b(who(d.to, ctx))],
    'project.reviewed': (e, d) => ['marked ', quote(e), ' as reviewed', d.finalExVat != null ? ` at ${money(d.finalExVat)} ex VAT` : ''],
    'project.review.cleared': (e) => ['cleared the review on ', quote(e)],
    'project.recovered': (e, d) => ['kept their copy of ', b(d.from || e.quoteId || 'a quotation'), ' after it was deleted elsewhere', e.quoteId && d.from && e.quoteId !== d.from ? [' (now ', quote(e), ')'] : ''],
    'project.discarded': (e) => ['dropped their copy of ', quote(e), ' after it was deleted elsewhere'],
    'project.duplicate': (e) => ['duplicated ', quote(e)],
    'project.revision': (e) => ['started a new revision of ', quote(e)],
    'project.export': (e) => ['exported ', quote(e)],
    'room.save': (e, d) => ['saved ', room(e), d.name ? [' “', b(d.name), '”'] : '', ' on ', quote(e)],
    'room.delete': (e) => ['deleted ', room(e), ' from ', quote(e)],
    'room.duplicate': (e, d) => ['duplicated ', room(e), d.count > 1 ? ` ${d.count} times` : '', ' on ', quote(e)],
    'room.reprice': (e, d) => ['repriced ', room(e), ' on ', quote(e), d.oldPrice != null && d.newPrice != null ? ` from ${money(d.oldPrice)} to ${money(d.newPrice)}` : ''],
    'override.meta': (e, d) => ['set a price override (', b(label(d.field || 'price')), ') on ', quote(e)],
    'override.remove': (e, d) => ['removed the ', b(label(d.field || 'price')), ' override on ', quote(e)],
    'supplyonly.acknowledge': (e, d) => [d.confirmed === false ? 'unconfirmed ' : 'confirmed ', quote(e), ' as supply only'],
    'rules.change': (e, d) => ['changed the commercial rules', d.reason ? [': ', b(d.reason)] : ''],
    'defaults.change': (e, d) => ['changed the quotation settings', d.reason ? [': ', b(d.reason)] : ''],
    'testdata.import': (e, d) => ['imported test data', d.rooms != null ? ` (${plural(d.rooms, 'room', 'rooms')})` : ''],
    'data.repair': () => ['repaired saved quotations'],
    // Accounts and Hub settings
    'account.role': (e, d, ctx) => ['made ', b(who(d.user, ctx)), ' ', ctx.roleAs(d.to), d.from ? ` (was ${ctx.roleAs(d.from)})` : ''],
    'account.status': (e, d, ctx) => [d.to === 'disabled' ? 'switched off ' : 'switched on ', b(who(d.user, ctx)), '’s account'],
    'account.app': (e, d, ctx) => d.allowed ? ['gave ', b(who(d.user, ctx) || d.email), ' ', b(ctx.appTitle(d.app))] : ['took ', b(ctx.appTitle(d.app)), ' away from ', b(who(d.user, ctx) || d.email)],
    'account.approved': (e, d, ctx) => ['approved ', b(who(d.user, ctx) || d.email), '’s new account as ', b(ctx.roleName(d.role)), d.checkedHow ? ` (${CHECKED[d.checkedHow] || d.checkedHow})` : ''],
    'account.refused': (e, d, ctx) => ['didn’t approve ', b(who(d.user, ctx) || d.email), '’s new account'],
    'account.preassign': (e, d, ctx) => ['set up ', b(d.email), ' to be ', b(ctx.roleName(d.role)), ' once approved'],
    'account.preassign.remove': (e, d) => ['removed the role set up for ', b(d.email)],
    'account.name': (e, d) => ['renamed ', b(d.from || d.email), ' to ', b(d.to)],
    'profile.name': (e, d) => ['changed their name to ', b(d.name)],
    'settings.default_apps': (e, d, ctx) => ['changed what new accounts get: ', b((d.apps || []).map(a => ctx.appTitle(a)).join(', ') || 'nothing')],
    'settings.registration': (e, d) => [d.open ? 'opened' : 'closed', ' registration for new accounts'],
    'settings.access_code': () => ['changed the registration access code'],
    'settings.assistant': (e, d) => ['switched Likkle Jeff ', b(d.on ? 'on' : 'off'), ' for everyone'],
    'hub.tile.set': (e, d, ctx) => ['updated the ', b(d.title || ctx.appTitle(d.id || d.tile) || 'app'), ' tile on the Hub'],
    'hub.tile.person': (e, d, ctx) => [d.allowed === false || d.on === false ? 'took ' : 'gave ', b(ctx.appTitle(d.tile || d.app || d.id)), d.allowed === false || d.on === false ? ' away from ' : ' to ', b(d.email || who(d.user, ctx))],
    // Teams
    'team.created': (e, d) => ['created the team ', b(d.name)],
    'team.changed': (e, d) => ['changed the team ', b(d.name)],
    'team.deleted': (e, d) => ['deleted the team ', b(d.name)],
    'team.members': (e, d, ctx) => ['changed who is in ', b(ctx.teamName(d.team) || 'a team'), d.members ? ` (${plural(d.members.length, 'person', 'people')} now)` : ''],
    // Annual Leave
    'leave.view': (e, d) => ['opened Annual Leave', d.access === 'approver' ? ' as an approver' : ''],
    'leave.face': () => ['updated a staff photo in Annual Leave'],
    'leave.approver': (e, d) => [d.on === false || d.allowed === false ? 'removed ' : 'added ', b(d.email || 'someone'), d.on === false || d.allowed === false ? ' from the leave approvers' : ' as a leave approver'],
    'leave.form': () => ['changed the Annual Leave request form link'],
    'leave.key.rotated': () => ['renewed the Annual Leave sync key'],
    // Fleet
    'speeding.view': () => ['opened Fleet Management'],
    'speeding.preview': (e, d, ctx) => ['previewed Fleet Management as ', b(d.driver || who(d.user, ctx) || 'a driver')],
    'speeding.link': (e, d, ctx) => ['linked driver ', b(d.driver || 'a driver'), ' to ', b(who(d.user, ctx) || d.email || 'an account')],
    'speeding.unlink': (e, d, ctx) => ['unlinked driver ', b(d.driver || 'a driver'), d.user || d.email ? [' from ', b(who(d.user, ctx) || d.email)] : ''],
    'speeding.writer.set': () => ['changed the Fleet Management upload key'],
    'arrivals.radius': (e, d) => ['changed the fitter arrival distance', d.metres || d.radius ? ` to ${num(d.metres || d.radius)} m` : ''],
    // Order Tracker, Warehouse, Nearby
    'orders.receipt': (e, d) => ['recorded a delivery', d.job || d.jobNumber ? [' for ', b(d.job || d.jobNumber)] : ''],
    'orders.receipt_correction': (e, d) => ['corrected a delivery receipt', d.job || d.jobNumber ? [' for ', b(d.job || d.jobNumber)] : ''],
    'orders.problem': (e, d) => ['reported a problem with an order', d.job || d.jobNumber ? [' for ', b(d.job || d.jobNumber)] : ''],
    'orders.untick': () => ['unticked an order item'],
    'warehouse.tick': (e, d) => [d.done === false ? 'unticked ' : 'ticked off ', b(d.task || d.name || 'a warehouse task')],
    'nearby.screen_link': () => ['made a new link for the office TV map'],
    'nearby.screen_off': () => ['switched off the office TV map link'],
  };
  const SKIP = {
    'account.role': ['to', 'from'], 'account.status': ['to'], 'account.app': ['app', 'allowed', 'email'], 'account.approved': ['role', 'checkedHow', 'email', 'roleGiven'],
    'account.refused': ['email'], 'account.preassign': ['email', 'role'], 'account.preassign.remove': ['email'], 'account.name': ['from', 'to'], 'profile.name': ['name'],
    'settings.default_apps': ['apps'], 'settings.registration': ['open'], 'settings.assistant': ['on'], 'project.reassign': ['from', 'to'], 'project.reviewed': ['finalExVat'],
    'project.recovered': ['from'], 'room.save': ['name'], 'room.reprice': ['oldPrice', 'newPrice'], 'room.duplicate': ['count', 'from'], 'override.meta': ['field'], 'override.remove': ['field'],
    'supplyonly.acknowledge': ['confirmed'], 'rules.change': ['reason'], 'defaults.change': ['reason'], 'team.created': ['name', 'team'], 'team.changed': ['name', 'team'],
    'team.deleted': ['name', 'team'], 'team.members': ['team', 'members'], 'leave.view': ['access'], 'project.delete': ['rooms', 'approved'], 'testdata.import': ['rooms'],
    'warehouse.tick': ['task', 'name', 'done'], 'speeding.link': ['driver'], 'speeding.unlink': ['driver'],
  };
  function flat(parts) { const out = []; (function walk(p) { for (const x of p) { if (Array.isArray(x)) walk(x); else if (x !== '' && x != null) out.push(x); } })(parts); return out; }
  function describe(e, ctx) {
    const d = (e.detail && typeof e.detail === 'object' && !Array.isArray(e.detail)) ? e.detail : {};
    const say = SAY[e.kind];
    let parts;
    try { parts = say ? flat(say(e, d, ctx)) : null; } catch (err) { parts = null; }
    if (!parts) {
      const what = String(e.kind || '').split('.').slice(1).join(' ').replace(/_/g, ' ');
      parts = ['did something in ', b(AREA[e.area] || 'the Hub'), what ? `: ${what}` : '', e.quoteId ? [' on ', quote(e)] : ''];
      parts = flat(parts);
    }
    return { parts, details: details(d, ctx, SAY[e.kind] ? (SKIP[e.kind] || []) : []) };
  }
  window.FLRActivity = Object.freeze({ describe, AREA });
})();
