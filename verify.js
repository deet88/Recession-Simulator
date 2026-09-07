#!/usr/bin/env osascript -l JavaScript
//
// Regression harness for index.html — run:  osascript -l JavaScript verify.js
//
// There is no Node on this machine, so this runs on JavaScriptCore via osascript.
// It evaluates the REAL script block out of index.html against stub DOM/Chart
// objects, so the assertions below test the shipped code and cannot drift from it.
//
ObjC.import('Foundation');

const CWD = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath);
const HTML = CWD + '/index.html';
const src = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(
  $(HTML), $.NSUTF8StringEncoding, $()));

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? '  — ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.01 : tol); }

// ── Load the app's own script block under stubs ──────────────────────────────
function stubEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', style: {},
    dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
    offsetWidth: 0, appendChild(){}, setAttribute(){}, removeAttribute(){},
    addEventListener(){}, querySelectorAll(){ return []; }, focus(){},
  };
  return el;
}
const els = {};
const document = {
  documentElement: { dataset: { theme: 'dark' }, style: {} },
  getElementById(id){ return els[id] || (els[id] = stubEl()); },
  querySelectorAll(){ return []; },
  querySelector(){ return stubEl(); },
  createElement(){ return stubEl(); },
  addEventListener(){},
};
const localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } };
function matchMedia(){ return { matches:false, addEventListener(){} }; }
function Chart(){ return { destroy(){}, update(){}, data:{}, options:{} }; }
Chart.defaults = {};
// JXA has no timers or DOM globals; the app only uses them for debounce and history.
function setTimeout(){ return 0; } function clearTimeout(){}
function addEventListener(){}
const location = { hash: '', href: '' };
const history = { replaceState(_a, _b, url){ location.hash = String(url); } };
const navigator = {};
const window = { location, history, addEventListener, setTimeout, clearTimeout };

// Grab the last <script> block (the app logic) and expose its internals.
const blocks = src.split('<script>');
const appSrc = blocks[blocks.length - 1].split('</script>')[0];
const EXPOSE = `;({ simulate, sim, makePath, assetImpact, contribs, extremeIndex, recoveryMonths,
  pathExtreme, tot, pct, existed, deflator, fmtRec, cp,
  ALLOC, BASE, PRESETS, RECESSIONS, LONG_RUN_INFLATION, POST_RECOVERY_GROWTH,
  stateToHash, applyHash, benchPath, benchDrawdown, simulate,
  ASSET_GROUPS, PRESET_META, renderPresetDefs, presetSummary,
  state: () => ({ chartMode, realMode, divMode, logScale, withdrawAmt,
                  withdrawInflate, rebalanceOn, benchOn,
                  selected: Array.from(selected).sort().join(','),
                  alloc: Object.keys(ALLOC).map(k => k+':'+Math.round(ALLOC[k].value)).join(',') }),
  setState: (o) => { if (o.chartMode !== undefined) chartMode = o.chartMode;
                     if (o.realMode !== undefined) realMode = o.realMode;
                     if (o.divMode !== undefined) divMode = o.divMode;
                     if (o.logScale !== undefined) logScale = o.logScale;
                     if (o.withdrawAmt !== undefined) withdrawAmt = o.withdrawAmt;
                     if (o.withdrawInflate !== undefined) withdrawInflate = o.withdrawInflate;
                     if (o.rebalanceOn !== undefined) rebalanceOn = o.rebalanceOn;
                     if (o.benchOn !== undefined) benchOn = o.benchOn;
                     if (o.selected !== undefined) selected = new Set(o.selected);
                     simCacheKey = ''; },
  setModes: (rm, dm) => { realMode = rm; divMode = dm; simCacheKey = ''; },
  setAlloc: (a) => { ALLOC = a; simCacheKey = ''; },
})`;

let A;
try {
  A = eval(appSrc + EXPOSE);
} catch (e) {
  throw new Error('FATAL: index.html script block did not evaluate — ' + e);
}
const KEYS = Object.keys(A.BASE);
const MODES = [[false,false],[true,false],[false,true],[true,true]];
const modeName = (r,d) => (r?'Real':'Nominal') + (d?' +Div':' Price');

// ── 1. Data shape ────────────────────────────────────────────────────────────
for (const r of A.RECESSIONS) {
  const missD  = KEYS.filter(k => !(k in r.d));
  const missDy = KEYS.filter(k => !(k in r.dy));
  ok('data/' + r.id + '/d covers all assets',  missD.length === 0,  'missing ' + missD);
  ok('data/' + r.id + '/dy covers all assets', missDy.length === 0, 'missing ' + missDy);
  ok('data/' + r.id + '/has dur+rec', r.dur >= 0 && r.rec >= 0);
}

// ── 2. Preset fractions sum to 1.0 ───────────────────────────────────────────
for (const [n, m] of Object.entries(A.PRESETS)) {
  const s = Object.values(m).reduce((a,b) => a+b, 0);
  ok('preset/' + n + ' sums to 100%', Math.abs(s - 1) < 1e-9, 'got ' + (s*100).toFixed(2) + '%');
}

// ── 3. The preset documentation panel is generated from PRESETS ──────────────
// It used to repeat 40 percentages by hand. Rendering it removes the drift risk;
// what remains testable is that the grouping covers the asset list.
{
  const grouped = A.ASSET_GROUPS.reduce((acc,g) => acc.concat(g.keys), []);
  const missing = KEYS.filter(k => grouped.indexOf(k) < 0);
  const extra = grouped.filter(k => KEYS.indexOf(k) < 0);
  const dupes = grouped.filter((k,i) => grouped.indexOf(k) !== i);
  ok('presets/every asset appears in a group', missing.length === 0, 'ungrouped: ' + missing);
  ok('presets/no group names an unknown asset', extra.length === 0, 'unknown: ' + extra);
  ok('presets/no asset is grouped twice', dupes.length === 0, 'duplicated: ' + dupes);
  ok('presets/every preset has a description',
     Object.keys(A.PRESETS).every(k => A.PRESET_META[k] && A.PRESET_META[k].tag.length > 20));

  // The rendered panel must report the same weights the buttons apply.
  A.renderPresetDefs();
  const out = els.presetDefs.innerHTML;
  const cards = out.split('<div class="preset-def-card">').slice(1);
  ok('presets/renders one card per preset', cards.length === Object.keys(A.PRESETS).length,
     'rendered ' + cards.length);
  Object.keys(A.PRESETS).forEach((key, i) => {
    const mix = A.PRESETS[key], card = cards[i] || '';
    const shown = {};
    const re = /style="background:[^"]*"><\/span>([^<]+)<\/span>\s*<span class="preset-def-pct">([\d.]+)%/g;
    let m; while ((m = re.exec(card))) {
      const k = KEYS.filter(kk => A.BASE[kk].label === m[1].trim())[0];
      if (k) shown[k] = parseFloat(m[2]) / 100;
    }
    const drift = KEYS.filter(k => Math.abs((shown[k] || 0) - (mix[k] || 0)) > 5e-4)
      .map(k => k + ' shows ' + ((shown[k]||0)*100) + '% but applies ' + ((mix[k]||0)*100) + '%');
    ok('presets/' + key + ' panel matches what it applies', drift.length === 0, drift.join('; '));
    const total = KEYS.reduce((a,k) => a + (shown[k] || 0), 0);
    ok('presets/' + key + ' panel totals 100%', Math.abs(total - 1) < 5e-4,
       'panel totals ' + (total*100).toFixed(1) + '%');
  });
}

// ── 4. Documented proxy rules actually hold in the data ──────────────────────
// The methodology panel states pre-1970 Developed & Emerging use US large cap.
for (const r of A.RECESSIONS) {
  const yr = parseInt(r.period.slice(0,4), 10);
  if (yr >= 1970 || r.proxyException) continue;
  ok('proxy/' + r.id + ' pre-1970 DM=LC', r.d.developed === r.d.largeCap,
     'LC=' + r.d.largeCap + ' DM=' + r.d.developed);
  ok('proxy/' + r.id + ' pre-1970 EM=LC', r.d.emerging === r.d.largeCap,
     'LC=' + r.d.largeCap + ' EM=' + r.d.emerging);
}
// Gold was pegged at $35/oz until Aug 1971.
for (const r of A.RECESSIONS) {
  if (parseInt(r.period.slice(0,4), 10) >= 1971 || r.proxyException) continue;
  ok('proxy/' + r.id + ' pre-1971 gold flat', r.d.goldSilver === 0, 'got ' + r.d.goldSilver);
}
// Every departure from a documented rule must carry a written reason.
for (const r of A.RECESSIONS) {
  if (!r.proxyException) continue;
  ok('proxy/' + r.id + ' exception is documented',
     typeof r.proxyException === 'string' && r.proxyException.length > 40);
}
// Bitcoin launched Jan 2009.
for (const r of A.RECESSIONS) {
  if (parseInt(r.period.slice(0,4), 10) >= 2009) continue;
  ok('proxy/' + r.id + ' pre-2009 crypto zero',
     r.d.crypto === 0 && r.dy.crypto === 0, 'd=' + r.d.crypto + ' dy=' + r.dy.crypto);
}
// The large-cap series should carry the same precision as the headline S&P figure.
for (const r of A.RECESSIONS) {
  ok('data/' + r.id + ' largeCap matches spx', r.d.largeCap === r.spx,
     'largeCap=' + r.d.largeCap + ' spx=' + r.spx);
}

// ── 5. Core invariants, across every Real × Dividend combination ─────────────
A.setAlloc(A.cp(A.BASE));
for (const [rm, dm] of MODES) {
  A.setModes(rm, dm);
  const t = A.tot();
  for (const r of A.RECESSIONS) {
    const s = A.sim(r), ex = A.extremeIndex(r), tag = r.id + '/' + modeName(rm, dm);

    // (a) THE invariant: per-asset figures sum to the headline figure.
    //     This is the bug that started the rewrite — it broke in Real mode because
    //     the "crypto didn't exist" carve-out lived in only one of two functions.
    const sum = KEYS.reduce((acc, k) => acc + A.assetImpact(r, k), 0);
    ok('invariant/' + tag + ' assets sum to headline',
       near(sum, A.pathExtreme(r) - t, 0.01),
       'assets $' + sum.toFixed(2) + ' vs headline $' + (A.pathExtreme(r) - t).toFixed(2));

    // (b) per-asset paths sum to the total path at every month
    let worstM = -1, worstD = 0;
    for (let m = 0; m < s.total.length; m++) {
      const d = Math.abs(KEYS.reduce((acc,k) => acc + s.byAsset[k][m], 0) - s.total[m]);
      if (d > worstD) { worstD = d; worstM = m; }
    }
    ok('invariant/' + tag + ' byAsset sums to total', worstD < 1e-6,
       'drift $' + worstD.toFixed(6) + ' at month ' + worstM);

    // (c) the path starts at the portfolio value
    ok('path/' + tag + ' starts at total', near(s.total[0], t, 0.01), 'got ' + s.total[0]);
    ok('path/' + tag + ' indexed starts at 0', near(A.makePath(r,'indexed')[0], 0, 1e-9));

    // (d) a dormant asset must not move at all
    if (!A.existed(r, 'crypto')) {
      const moved = s.byAsset.crypto.some(v => !near(v, A.ALLOC.crypto.value, 0.01));
      ok('dormant/' + tag + ' crypto never moves', !moved,
         'crypto drifted from $' + A.ALLOC.crypto.value);
    }

    // (e) the extreme really is the extreme of the downturn window
    const win = s.total.slice(0, r.dur + 1);
    const isDown = A.pathExtreme(r) < t;
    ok('extreme/' + tag + ' is the window extreme',
       near(win[ex], isDown ? Math.min.apply(null, win) : Math.max.apply(null, win), 0.01));

    // (f) recovery figure agrees with where the line actually crosses baseline.
    //     In nominal price-return mode every recession returns to baseline by
    //     construction, so a null there is a bug, not a modelling outcome.
    const rec = A.recoveryMonths(r);
    if (!rm && !dm) ok('recovery/' + tag + ' is reported at all', rec !== null,
                       'reported "not recovered" for a path that reaches baseline');
    if (rec !== null) {
      ok('recovery/' + tag + ' crosses at reported month', s.total[ex + rec] >= t - 0.01);
      ok('recovery/' + tag + ' not earlier than reported',
         ex + rec === ex || s.total[ex + rec - 1] < t + 0.01);
    }
  }
}

// ── 6. Price-return shape is monotonic (no dividend/deflation confound) ──────
A.setModes(false, false);
for (const r of A.RECESSIONS) {
  const s = A.sim(r), t = A.tot(), down = A.pathExtreme(r) < t;
  let mono = true;
  for (let m = 1; m <= r.dur; m++) {
    if (down ? s.total[m] > s.total[m-1] + 1e-6 : s.total[m] < s.total[m-1] - 1e-6) mono = false;
  }
  ok('shape/' + r.id + ' moves monotonically to the extreme', mono);
  // 1945 rose +38% then normalised back DOWN, so "recovery" is a move toward
  // baseline, not necessarily upward.
  let toward = true;
  for (let m = r.dur + 1; m <= r.dur + r.rec; m++) {
    if (down ? s.total[m] < s.total[m-1] - 1e-6 : s.total[m] > s.total[m-1] + 1e-6) toward = false;
  }
  ok('shape/' + r.id + ' returns monotonically to baseline', toward);
  ok('shape/' + r.id + ' regains baseline at nomEnd', near(s.total[r.dur + r.rec], t, 0.01));
}

// ── 7. The refactor must not have changed nominal price-return values ────────
// Reproduces the original portfolio-level formula and compares point by point.
A.setModes(false, false);
for (const r of A.RECESSIONS) {
  const t = A.tot();
  // Independent reference: the original portfolio-level allocation-weighted blend.
  const d = KEYS.reduce((acc,k) => acc + (A.ALLOC[k].value/t) * (r.d[k] ?? 0), 0);
  const trough = t * (1 + d/100), nomEnd = r.dur + r.rec;
  const s = A.sim(r);
  let worst = 0;
  for (let m = 0; m <= nomEnd; m++) {
    let expect;
    if (m <= r.dur) { const e = r.dur === 0 ? 1 : m/r.dur; expect = t + (trough - t)*(e*e*(3-2*e)); }
    else expect = trough + (t - trough)*Math.sqrt((m - r.dur)/r.rec);
    worst = Math.max(worst, Math.abs(s.total[m] - expect));
  }
  ok('regression/' + r.id + ' nominal path unchanged', worst < 1e-6, 'max drift $' + worst.toFixed(8));
}

// ── 8. Allocation edge cases ────────────────────────────────────────────────
{
  const zero = A.cp(A.BASE);
  Object.keys(zero).forEach(k => zero[k].value = 0);
  A.setAlloc(zero); A.setModes(false, false);
  let threw = false;
  try { A.RECESSIONS.forEach(r => { A.sim(r); A.extremeIndex(r); A.makePath(r,'indexed'); }); }
  catch (e) { threw = true; }
  ok('edge/empty portfolio does not throw', !threw);

  const solo = A.cp(A.BASE);
  Object.keys(solo).forEach(k => solo[k].value = k === 'largeCap' ? 1000000 : 0);
  A.setAlloc(solo);
  const r08 = A.RECESSIONS.find(x => x.id === 'r2008');
  const dd08 = (A.pathExtreme(r08) / 1000000 - 1) * 100;
  ok('edge/100% large cap tracks the S&P figure', near(dd08, r08.spx, 0.05),
     'portfolio ' + dd08.toFixed(2) + '% vs spx ' + r08.spx + '%');
  A.setAlloc(A.cp(A.BASE));
}

// ── 9. Shared-link state survives a round trip ──────────────────────────────
{
  const alloc = A.cp(A.BASE);
  alloc.largeCap.value = 123456; alloc.crypto.value = 7890; alloc.cash.value = 4321;
  A.setAlloc(alloc);
  A.setState({ chartMode:'indexed', realMode:true, divMode:true, logScale:false,
               withdrawAmt:3500, withdrawInflate:false, rebalanceOn:true, benchOn:true,
               selected:['depression','r2020'] });
  const before = A.state(), hash = A.stateToHash();

  // Wipe every field, then restore from the hash alone.
  A.setAlloc(A.cp(A.BASE));
  A.setState({ chartMode:'absolute', realMode:false, divMode:false, logScale:false,
               withdrawAmt:0, withdrawInflate:true, rebalanceOn:false, benchOn:false,
               selected:[] });
  location.hash = '#' + hash;
  ok('url/hash applies', A.applyHash() === true);
  const after = A.state();
  for (const k of Object.keys(before)) {
    ok('url/round-trips ' + k, before[k] === after[k], 'before ' + before[k] + ' after ' + after[k]);
  }
  // A malformed or foreign link must not throw or corrupt state.
  let threw = false;
  for (const bad of ['', '#', '#a=x.y.z&s=nope&m=q&f=zzz&w=abc', '#a=1.2&s=&f=1']) {
    location.hash = bad;
    try { A.applyHash(); A.RECESSIONS.forEach(r => A.sim(r)); } catch (e) { threw = true; }
  }
  ok('url/malformed hash is survivable', !threw);
  A.setAlloc(A.cp(A.BASE));
  A.setState({ chartMode:'absolute', realMode:false, divMode:false, logScale:false,
               withdrawAmt:0, withdrawInflate:true, rebalanceOn:false, benchOn:false,
               selected:['r2008'] });
}

// ── 10. Withdrawals, rebalancing and the benchmark behave ───────────────────
{
  A.setAlloc(A.cp(A.BASE));
  const t = A.tot(), r08 = A.RECESSIONS.find(x => x.id === 'r2008');

  // Zero withdrawal and no rebalancing must leave the original result untouched.
  A.setState({ withdrawAmt:0, rebalanceOn:false, realMode:false, divMode:false });
  const basePE = A.pathExtreme(r08);
  A.setState({ withdrawAmt:0, rebalanceOn:false });
  ok('feature/zero withdrawal is a no-op', near(A.pathExtreme(r08), basePE, 0.01));

  // Drawing money down through a crash must leave you worse off.
  A.setState({ withdrawAmt:5000 });
  ok('feature/withdrawal deepens the drawdown', A.pathExtreme(r08) < basePE - 1000,
     'with draw $' + Math.round(A.pathExtreme(r08)) + ' vs $' + Math.round(basePE));
  ok('feature/withdrawal never goes negative',
     A.sim(r08).total.every(v => v >= -0.01));

  // A withdrawal large enough to outrun the portfolio must report depletion, once.
  A.setState({ withdrawAmt:200000 });
  const dep = A.sim(r08).depletedAt;
  ok('feature/huge withdrawal depletes', dep !== null && dep > 0, 'depletedAt=' + dep);
  ok('feature/depleted portfolio stays at zero',
     A.sim(r08).total.slice(dep).every(v => v < 1));
  A.setState({ withdrawAmt:0 });

  // Rebalancing must move the result without breaking the reconciliation.
  A.setState({ rebalanceOn:true });
  const KEYS2 = Object.keys(A.ALLOC);
  ok('feature/rebalanced result still reconciles',
     near(KEYS2.reduce((s,k) => s + A.assetImpact(r08,k), 0), A.pathExtreme(r08) - t, 0.01));
  ok('feature/rebalancing changes the outcome', !near(A.pathExtreme(r08), basePE, 1));
  A.setState({ rebalanceOn:false });

  // The benchmark is the S&P alone: with an all-large-cap book they must coincide.
  const solo = A.cp(A.BASE);
  Object.keys(solo).forEach(k => solo[k].value = k === 'largeCap' ? t : 0);
  A.setAlloc(solo);
  ok('feature/benchmark matches an all-large-cap book',
     near(A.benchDrawdown(r08), (A.pathExtreme(r08)/t - 1)*100, 0.01));
  A.setAlloc(A.cp(A.BASE));
  ok('feature/benchmark beats a diversified book in 2008',
     A.benchDrawdown(r08) < (A.pathExtreme(r08)/t - 1)*100,
     'bench ' + A.benchDrawdown(r08).toFixed(2) + '% vs mix ' + ((A.pathExtreme(r08)/t-1)*100).toFixed(2) + '%');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('');
if (fail) {
  console.log('FAILURES (' + fail + '):');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('');
}
if (fail) throw new Error('FAIL — ' + pass + ' passed, ' + fail + ' failed');
console.log('PASS — all ' + pass + ' assertions passed');
