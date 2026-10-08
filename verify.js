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
  stateToHash, applyHash, benchPath, benchDrawdown, benchSim, simulate,
  endOfPath, extremeOf, syncBenchAvailability, renderEditor, efDollars,
  onEmergencyMonths, onWithdraw, renderEmergencyNote, recoveryLabel, neverFell, efExplain, shapeAt, fmtEdge,
  ASSET_GROUPS, PRESET_META, renderPresetDefs, presetSummary,
  state: () => ({ chartMode, realMode, divMode, logScale, withdrawAmt,
                  withdrawInflate, rebalanceOn, benchOn, efMonths,
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
                     if (o.efMonths !== undefined) efMonths = o.efMonths;
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
  // Cash & Savings is a HYSA, so its yield is a real rate. It was 0 on all 15 rows,
  // which made the +Dividends toggle a no-op for anyone holding cash.
  ok('data/' + r.id + '/cash carries a savings rate',
     typeof r.dy.cash === 'number' && isFinite(r.dy.cash) && r.dy.cash >= 0,
     'got ' + r.dy.cash);
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
// Regulation Q capped what banks could pay on retail savings deposits until
// deregulation completed in 1986, so a savings account could not track the T-bill
// rate before then however high T-bills went (12.5% in 1981-82).
const REG_Q_CEILING = 5.25;
for (const r of A.RECESSIONS) {
  if (parseInt(r.period.slice(0,4), 10) >= 1986) continue;
  ok('proxy/' + r.id + ' pre-1986 cash respects Reg Q', r.dy.cash <= REG_Q_CEILING,
     'dy.cash=' + r.dy.cash + ' exceeds the ' + REG_Q_CEILING + '% ceiling');
}
// A savings account should not out-yield a CD of the same era.
for (const r of A.RECESSIONS) {
  ok('data/' + r.id + ' cash does not out-yield CDs', r.dy.cash <= r.dy.cds,
     'cash=' + r.dy.cash + ' cds=' + r.dy.cds);
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

    // (e) a low is the lowest point through the recession AND the S&P's recovery
    //     window; a high is the highest point of the downturn. Past those, the path runs
    //     on assumed growth, which must not be reported as the recession's result.
    const win = s.total.slice(0, r.dur + 1), lowWin = s.total.slice(0, r.dur + r.rec + 1);
    const isDown = A.pathExtreme(r) < t;
    ok('extreme/' + tag + ' is the true extreme',
       near(s.total[ex], isDown ? Math.min.apply(null, lowWin) : Math.max.apply(null, win), 0.01));

    // (f) recovery figure agrees with where the line actually crosses baseline.
    //     In nominal price-return mode every losing asset gets back to its start (on
    //     the S&P's pace, then POST_RECOVERY_GROWTH), so a null there is a bug — except
    //     for a path that never fell, which has nothing to recover from.
    const rec = A.recoveryMonths(r);
    if (!rm && !dm && !A.neverFell(r))
      ok('recovery/' + tag + ' is reported at all', rec !== null,
         'reported "not recovered" for a path that reaches baseline');
    if (A.neverFell(r))
      ok('recovery/' + tag + ' never-fell path reports no recovery figure', rec === null &&
         A.recoveryLabel(r) === 'never fell below start', 'label: ' + A.recoveryLabel(r));
    if (rec !== null) {
      ok('recovery/' + tag + ' crosses at reported month', s.total[ex + rec] >= t - 0.01);
      ok('recovery/' + tag + ' not earlier than reported',
         ex + rec === ex || s.total[ex + rec - 1] < t + 0.01);
    }

    // (g) the DRAWN line stops where the recovery figure says it does. It used to run
    //     to the end of the modelled window regardless, so any path that regained its
    //     baseline early carried on climbing: the Great Depression in Real +Dividends
    //     drew 224 months past recovery and ended at 2.32x its start while the panel
    //     beside it reported recovery in 43 months.
    const p = A.makePath(r, 'absolute');
    const dipped = s.total[ex] < t;
    if (dipped && rec !== null) {
      ok('chart/' + tag + ' stops where recovery says', p.length - 1 === ex + rec,
         'drawn to m' + (p.length - 1) + ' but recovery is m' + (ex + rec));
      ok('chart/' + tag + ' ends on baseline', near(p[p.length - 1], t, t * 0.03),
         'ends at $' + Math.round(p[p.length - 1]) + ' against a $' + t + ' start');
      // The symptom itself: no drawn point after the trough may run away from baseline.
      const peak = Math.max.apply(null, p.slice(ex));
      ok('chart/' + tag + ' never climbs past baseline', peak <= t * 1.03,
         'peaked at ' + (peak / t).toFixed(3) + 'x start');
    } else {
      // Nothing to cut back to: 1945 never dipped, and a path that never recovers has
      // no crossing. Both must draw in full rather than collapse.
      ok('chart/' + tag + ' draws in full when there is nothing to cut',
         p.length === s.total.length, 'drew ' + p.length + ' of ' + s.total.length);
    }
    // % Change mode is the same slice, so the two views cannot disagree on length.
    ok('chart/' + tag + ' indexed matches absolute length',
       A.makePath(r, 'indexed').length === p.length);
    // The S&P overlay stops on the same rule, against its own simulation.
    const bs = A.benchSim(r), bp = A.benchPath(r, 'absolute');
    ok('chart/' + tag + ' benchmark stops on the same rule',
       bp.length - 1 === A.endOfPath(bs, r.dur),
       'drew ' + (bp.length - 1) + ' of ' + A.endOfPath(bs, r.dur));
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
  // In the recovery window gainers hold and losers climb back, so in price-return mode
  // with no costs the portfolio never falls after the downturn — 1945 included, which
  // used to be dragged back DOWN to its start.
  let rising = true;
  for (let m = r.dur + 1; m < s.total.length; m++) {
    if (s.total[m] < s.total[m-1] - 1e-6) rising = false;
  }
  ok('shape/' + r.id + ' never falls during the recovery', rising);
  if (down) ok('shape/' + r.id + ' ends back at its start', s.total[s.total.length - 1] >= t - 0.01,
               'ended at $' + Math.round(s.total[s.total.length - 1]));
}

// ── 7. The recovery model ───────────────────────────────────────────────────
// Recovery used to pull every asset back to exactly its start at nomEnd, so every mix
// recovered on the S&P's clock whatever it held, and gains were handed back.
function only(k, v) { const a = A.cp(A.BASE); KEYS.forEach(x => a[x].value = x === k ? v : 0); return a; }
function mix(o) { const a = A.cp(A.BASE); KEYS.forEach(x => a[x].value = o[x] || 0); return a; }
A.setModes(false, false);
// (a) A 100% S&P book must reproduce the original S&P curve exactly — the headline
//     figures the tool is built on must not move.
for (const r of A.RECESSIONS) {
  if (r.spx >= 0) continue;
  A.setAlloc(only('largeCap', 1000000));
  const t = 1000000, trough = t * (1 + r.spx/100), nomEnd = r.dur + r.rec, s = A.sim(r);
  let worst = 0;
  for (let m = 0; m <= nomEnd; m++) {
    let expect;
    if (m <= r.dur) { const e = r.dur === 0 ? 1 : m/r.dur; expect = t + (trough - t)*(e*e*(3-2*e)); }
    else expect = trough + (t - trough)*Math.sqrt((m - r.dur)/r.rec);
    worst = Math.max(worst, Math.abs(s.total[m] - expect));
  }
  ok('regression/' + r.id + ' S&P-only path unchanged', worst < 1e-6, 'max drift $' + worst.toFixed(8));
  ok('regression/' + r.id + ' S&P-only recovers in r.rec', A.recoveryMonths(r) === r.rec,
     'got ' + A.recoveryMonths(r) + ' vs ' + r.rec);
}
// (b) No asset rises above its own start during the recovery unless it was a gainer.
for (const r of A.RECESSIONS) {
  const nomEnd = r.dur + r.rec;
  for (const k of KEYS) {
    const cap = Math.max(1, 1 + (r.d[k] ?? 0)/100);
    let over = 0, fell = false, prev = A.shapeAt(r, k, r.dur, nomEnd);
    for (let m = r.dur + 1; m <= nomEnd; m++) {
      const v = A.shapeAt(r, k, m, nomEnd);
      over = Math.max(over, v - cap);
      if (v < prev - 1e-12) fell = true;
      prev = v;
    }
    ok('recovery-model/' + r.id + '/' + k + ' never overshoots in the window', over <= 1e-12,
       'exceeded its cap by ' + over);
    ok('recovery-model/' + r.id + '/' + k + ' never falls in the window', !fell);
  }
}
// (c) Gainers keep their gain: gold +70% in 1973–75 is still +70% when the S&P is back.
{
  const r73 = A.RECESSIONS.find(r => r.id === 'r1973');
  A.setAlloc(only('goldSilver', 1000000));
  const s = A.sim(r73);
  ok('recovery-model/1973 gold keeps its gain', near(s.total[r73.dur + r73.rec], 1700000, 0.01),
     'at nomEnd $' + Math.round(s.total[r73.dur + r73.rec]));
  ok('recovery-model/1973 gold never fell', A.recoveryLabel(r73) === 'never fell below start');
}
// (d) Depth now drives recovery time: shallower mixes recover sooner, deeper later.
{
  const r73 = A.RECESSIONS.find(r => r.id === 'r1973'), r08 = A.RECESSIONS.find(r => r.id === 'r2008');
  A.setAlloc(only('bonds', 1000000));
  const bonds73 = A.recoveryMonths(r73);
  ok('recovery-model/1973 bonds (-5%) recover well before the S&P (21 mo)',
     bonds73 !== null && bonds73 < r73.rec / 2, 'got ' + bonds73);
  A.setAlloc(mix({ largeCap: 600000, bonds: 400000 }));
  const sixty40 = A.recoveryMonths(r08);
  ok('recovery-model/2008 60/40 recovers sooner than the S&P (48 mo)',
     sixty40 !== null && sixty40 < r08.rec, 'got ' + sixty40);
  A.setAlloc(only('reit', 1000000));
  const reit08 = A.recoveryMonths(r08);
  ok('recovery-model/2008 REIT (-68%) takes longer than the S&P (-56.8%)',
     reit08 !== null && reit08 > r08.rec, 'got ' + reit08);
  // and the default book, whose equities fell further than the S&P, still recovers
  A.setAlloc(A.cp(A.BASE));
  ok('recovery-model/default book still recovers in 2008', A.recoveryMonths(r08) !== null);
}
A.setAlloc(A.cp(A.BASE));

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

// ── 11. The three reported bugs, pinned by name ─────────────────────────────
// (a) The Great Depression line climbing to $2.32M against a $1M start.
{
  A.setAlloc(A.cp(A.BASE));
  A.setState({ withdrawAmt:0, rebalanceOn:false, realMode:true, divMode:true });
  const gd = A.RECESSIONS.find(r => r.id === 'depression'), t = A.tot();
  const p = A.makePath(gd, 'absolute');
  ok('regression/depression Real+Div stops at recovery', p.length - 1 < 120,
     'drew ' + (p.length - 1) + ' months; it used to draw 308');
  ok('regression/depression Real+Div ends at its start value',
     near(p[p.length - 1], t, t * 0.01),
     'ended at $' + Math.round(p[p.length - 1]) + '; it used to end at $2,323,000');
  // The chart and the figure printed beside it must tell the same story.
  ok('regression/depression drawn length matches the reported recovery',
     p.length - 1 === A.extremeIndex(gd) + A.recoveryMonths(gd));

  // 1945 rose +38% throughout and never dipped, so it reports "0 months to normalise".
  // Cutting on that figure would leave a single point.
  A.setState({ realMode:false, divMode:false });
  const r45 = A.RECESSIONS.find(r => r.id === 'r1945');
  ok('regression/1945 is not collapsed to a point',
     A.makePath(r45,'absolute').length === A.sim(r45).total.length,
     'drew ' + A.makePath(r45,'absolute').length + ' points');
}

// (b) Cash & Savings earned nothing: dy.cash was 0 on all 15 rows, so a 100% cash
//     book ended at exactly its starting value whether or not +Dividends was on.
{
  const cashOnly = A.cp(A.BASE);
  Object.keys(cashOnly).forEach(k => cashOnly[k].value = (k === 'cash' ? 100000 : 0));
  A.setAlloc(cashOnly);
  for (const id of ['r1990', 'r2008', 'depression']) {
    const r = A.RECESSIONS.find(x => x.id === id);
    A.setState({ realMode:false, divMode:false });
    const price = A.sim(r).total[A.sim(r).total.length - 1];
    A.setState({ realMode:false, divMode:true });
    const total = A.sim(r).total[A.sim(r).total.length - 1];
    ok('regression/' + id + ' HYSA pays interest', total > price + 1,
       'price-return $' + Math.round(price) + ' vs +Dividends $' + Math.round(total));
  }
  // Principal is flat in price-return mode — the yield is income, not a return. This
  // used to check only the END of 1990's path, which is back at baseline by
  // construction, so it passed while d.cash quietly lifted cash +8% through 1929–33
  // on top of the interest: a double count. Every month, every recession, both buckets.
  A.setState({ realMode:false, divMode:false });
  for (const k of ['cash', 'cds']) {
    A.setAlloc(only(k, 100000));
    for (const r of A.RECESSIONS) {
      const off = A.sim(r).total.filter(v => !near(v, 100000, 0.01));
      ok('regression/' + r.id + ' ' + k + ' principal flat every month in Price Ret.',
         off.length === 0, off.length + ' months off, e.g. $' + Math.round(off[0]));
    }
  }
  A.setAlloc(A.cp(A.BASE));
  A.setState({ realMode:false, divMode:false });
}

// (c) The vs S&P button stayed lit while doing nothing whenever more than one
//     recession was selected.
{
  const btn = els['btn-bench-on'];
  A.setState({ selected:['r2008'] });   A.syncBenchAvailability();
  ok('ui/benchmark enabled for a single recession', btn.disabled === false);
  A.setState({ selected:['r2008','r2001'] }); A.syncBenchAvailability();
  ok('ui/benchmark disabled for several recessions', btn.disabled === true);
  ok('ui/benchmark says why it is unavailable',
     /one recession at a time/.test(btn.title), 'title: ' + btn.title);
  A.setState({ selected:[] }); A.syncBenchAvailability();
  ok('ui/benchmark disabled with nothing selected', btn.disabled === true);
  // Unlike the log axis, the setting is inapplicable rather than invalid, so the
  // user's choice must survive widening and re-narrowing the selection.
  A.setState({ selected:['r2008'], benchOn:true }); A.syncBenchAvailability();
  A.setState({ selected:['r2008','r2001'] });       A.syncBenchAvailability();
  ok('ui/benchmark setting survives a wider selection', A.state().benchOn === true);
  A.setState({ selected:['r2008'] }); A.syncBenchAvailability();
  ok('ui/benchmark comes back when narrowed again',
     btn.disabled === false && A.state().benchOn === true);
  A.setState({ benchOn:false });
}

// (d) The two interest-bearing buckets pay income only in +Dividends mode, which is
//     not guessable from the name — and cash silently changed from a mattress to a
//     HYSA. That has to be legible in the allocation editor itself, not only in a
//     title= tooltip, which touch devices never show.
{
  for (const k of ['cash', 'cds']) {
    ok('ui/' + k + ' states its yield assumption on screen',
       typeof A.BASE[k].note === 'string' && /\+Dividends/.test(A.BASE[k].note),
       'note: ' + A.BASE[k].note);
    ok('ui/' + k + ' carries a fuller explanation on hover',
       typeof A.BASE[k].about === 'string' && A.BASE[k].about.length > 80);
  }
  ok('ui/cash names the HYSA assumption', /high-yield savings/i.test(A.BASE.cash.about));
  ok('ui/cash names the Reg Q cap', /regulation q/i.test(A.BASE.cash.about));

  // The note has to survive rendering, not just sit in the data.
  A.setAlloc(A.cp(A.BASE));
  A.renderEditor();
  const html = els['allocGrid'].innerHTML;
  ok('ui/editor renders the cash note', html.includes(A.BASE.cash.note),
     'note missing from the rendered allocation editor');
  ok('ui/editor renders the cash tooltip', html.includes('high-yield savings account'));
  // Assets with nothing surprising to say must not grow an empty note element.
  const noteCount = (html.match(/class="alloc-note"/g) || []).length;
  ok('ui/only the interest-bearing rows carry a note', noteCount === 2,
     'found ' + noteCount + ' notes, expected 2');
}

// ── 12. Monthly costs and the emergency fund ───────────────────────────────
// The fund is held outside the portfolio, entered in MONTHS of costs, and spent before
// anything is sold — the standard defence against selling into a drawdown.
{
  A.setAlloc(A.cp(A.BASE));
  A.setState({ realMode:false, divMode:false, rebalanceOn:false, withdrawInflate:false,
               withdrawAmt:0, efMonths:0, selected:['r2008'] });
  const r08 = A.RECESSIONS.find(x => x.id === 'r2008'), t = A.tot();

  // Months × costs is the fund; with no costs it is worth nothing.
  A.setState({ withdrawAmt:5000, efMonths:6 });
  ok('ef/dollars are months times costs', A.efDollars() === 30000, 'got ' + A.efDollars());
  A.setState({ withdrawAmt:0 });
  ok('ef/no costs means no fund', A.efDollars() === 0);

  // It is money outside the portfolio: it must not touch the total or the weights.
  A.setState({ withdrawAmt:5000, efMonths:50 });
  ok('ef/does not change the portfolio total', near(A.tot(), t, 0.01), 'total moved to $' + A.tot());
  ok('ef/does not change the starting path value', near(A.sim(r08).total[0], t, 0.01));
  ok('ef/is reported on the simulation', A.sim(r08).efStart === 250000, 'got ' + A.sim(r08).efStart);

  // At the engine level, a fund with nothing to spend it on changes nothing.
  A.setState({ withdrawAmt:0, efMonths:0 });
  const noDraw = A.sim(r08).total.slice();
  const inert = A.simulate(r08, { emergencyFund:250000, withdraw:0 }).total;
  ok('ef/is inert with no costs', inert.length === noDraw.length &&
     inert.every((v,i) => near(v, noDraw[i], 1e-9)));

  // A fund that covers every month must leave the portfolio identical to paying nothing.
  A.setState({ withdrawAmt:5000, efMonths:400 });
  const shielded = A.sim(r08).total;
  ok('ef/a fund that outlasts the window shields the portfolio entirely',
     shielded.length === noDraw.length && shielded.every((v,i) => near(v, noDraw[i], 1e-6)),
     'portfolio moved despite a fund that covers every month');
  ok('ef/never-exhausted fund reports no run-out month', A.sim(r08).efDepletedAt === null);

  // A fund that runs out hands over in the right month and then behaves as before.
  A.setState({ withdrawAmt:5000, efMonths:10 });
  const s = A.sim(r08);
  ok('ef/runs out when the arithmetic says', s.efDepletedAt === 10,
     '10 months of $5,000 should run out in month 10, got ' + s.efDepletedAt);
  ok('ef/portfolio is untouched until the fund is gone',
     s.total.slice(0, s.efDepletedAt + 1).every((v,i) => near(v, noDraw[i], 1e-6)));
  ok('ef/portfolio is drawn down once the fund is gone', s.total[30] < noDraw[30] - 1);
  // A fractional fund covers the whole months and part of the next.
  A.setState({ efMonths:6.5 });
  ok('ef/6.5 months runs out in month 7', A.sim(r08).efDepletedAt === 7, 'got ' + A.sim(r08).efDepletedAt);

  // More buffer is always weakly better, never worse.
  A.setState({ efMonths:0 });  const none = A.pathExtreme(r08);
  A.setState({ efMonths:10 }); const some = A.pathExtreme(r08);
  A.setState({ efMonths:40 }); const lots = A.pathExtreme(r08);
  ok('ef/a bigger fund never deepens the drawdown', some >= none - 0.01 && lots >= some - 0.01,
     'none $' + Math.round(none) + ' → 10mo $' + Math.round(some) + ' → 40mo $' + Math.round(lots));
  ok('ef/a fund measurably softens the drawdown', lots > none + 1000);

  // It must also delay outright depletion rather than merely deepening it later.
  A.setState({ withdrawAmt:60000, efMonths:0 });  const depNoEF = A.sim(r08).depletedAt;
  A.setState({ efMonths:10 });                    const depEF = A.sim(r08).depletedAt;
  ok('ef/delays portfolio exhaustion', depNoEF !== null && depEF !== null && depEF > depNoEF,
     'without ' + depNoEF + ' vs with ' + depEF);

  // Tier 2: the Cash & Savings bucket absorbs the draw before anything is sold. Cash
  // principal is flat now (d.cash = 0), so it gives up exactly what was spent.
  const withCash = A.cp(A.BASE);
  KEYS.forEach(k => withCash[k].value = k === 'cash' ? 100000 : (k === 'largeCap' ? 900000 : 0));
  A.setAlloc(withCash);
  A.setState({ withdrawAmt:5000, efMonths:0 });
  const c = A.sim(r08), cNo = A.simulate(r08, {alloc:withCash, withdraw:0});
  ok('ef/cash absorbs the whole cost before anything is sold',
     near(cNo.byAsset.cash[10] - c.byAsset.cash[10], 50000, 0.01),
     'cash gave up $' + Math.round(cNo.byAsset.cash[10] - c.byAsset.cash[10]) + ' against $50,000 spent');
  ok('ef/equities are untouched while cash lasts',
     c.byAsset.largeCap[10] > 0 && near(c.byAsset.largeCap[10], cNo.byAsset.largeCap[10], 1.0));
  ok('ef/equities are sold once the cash bucket is empty',
     c.byAsset.cash[30] < 1 && c.byAsset.largeCap[30] < cNo.byAsset.largeCap[30] - 1,
     'cash $' + Math.round(c.byAsset.cash[30]) + ' largeCap $' + Math.round(c.byAsset.largeCap[30]));
  A.setAlloc(A.cp(A.BASE));

  // The cache is keyed on the inputs. setState() flushes it, which would hide a missing
  // key — so drive the real input handlers, as typing would.
  A.setState({ withdrawAmt:5000, efMonths:0, selected:['r2008'] });
  const stale = A.pathExtreme(r08);
  A.onEmergencyMonths(80);
  ok('ef/changing the months invalidates the simulation cache', A.pathExtreme(r08) > stale + 1,
     'the chart would have kept showing the simulation from before the change');
  A.onEmergencyMonths(0);
  ok('ef/clearing the months invalidates it again', near(A.pathExtreme(r08), stale, 0.01));
  // Changing costs alone changes the fund's dollars, so it must invalidate too.
  A.onEmergencyMonths(12);
  const at5k = A.sim(r08).efStart;
  A.onWithdraw(6000);
  ok('ef/changing costs rescales the fund', A.sim(r08).efStart === 72000 && at5k === 60000,
     'fund was $' + at5k + ' then $' + A.sim(r08).efStart);

  // The input is measured against costs, so it is disabled until costs exist — and the
  // months are kept, not cleared, so they come back when costs are entered.
  A.onWithdraw(0);
  ok('ui/fund input disabled with no costs', els['emergencyInput'].disabled === true);
  ok('ui/disabled fund says why', /monthly costs first/.test(els['emergencyNote'].innerHTML),
     'caption: ' + els['emergencyNote'].innerHTML);
  ok('ui/disabling keeps the months', A.state().efMonths === 12);
  A.onWithdraw(5000);
  ok('ui/fund input enabled once costs are set', els['emergencyInput'].disabled === false);
  ok('ui/caption states the fund in dollars', /\$60,000/.test(els['emergencyNote'].innerHTML),
     'caption: ' + els['emergencyNote'].innerHTML);
  A.onEmergencyMonths(0);
  ok('ui/caption says costs hit the portfolio with no fund', /from month 1/.test(els['emergencyNote'].innerHTML));

  // The card's run-out month must reconcile with the caption's months. Without
  // inflation-linked costs an N-month fund runs out in month ceil(N) and needs no note;
  // when prices move it out of that month, the note has to say which way and why.
  const gd = A.RECESSIONS.find(x => x.id === 'depression'), r80 = A.RECESSIONS.find(x => x.id === 'r1980');
  A.setState({ withdrawAmt:5000, efMonths:6, withdrawInflate:false });
  ok('ef/no note when the fund runs out on schedule', A.efExplain(A.sim(gd).efDepletedAt) === '');
  A.setState({ withdrawInflate:true });
  const gdGone = A.sim(gd).efDepletedAt;
  ok('ef/deflation stretches the fund', gdGone === 7, 'got ' + gdGone);
  ok('ef/note explains a fund stretched by deflation',
     /fell with deflation.*month 7 rather than month 6/.test(A.efExplain(gdGone)), A.efExplain(gdGone));
  A.setState({ efMonths:12 });
  const r80Gone = A.sim(r80).efDepletedAt;
  ok('ef/inflation shortens the fund', r80Gone === 12 || r80Gone === 11, 'got ' + r80Gone);
  if (r80Gone !== 12) ok('ef/note explains a fund shortened by inflation',
     /rose with inflation/.test(A.efExplain(r80Gone)), A.efExplain(r80Gone));
  A.setState({ withdrawAmt:0, efMonths:0, withdrawInflate:false });
}

// ── 13. The emergency fund survives a round trip through the URL ────────────
{
  A.setAlloc(A.cp(A.BASE));
  A.setState({ withdrawAmt:4000, efMonths:7.5, selected:['r2008'] });
  const before = A.state();
  location.hash = '#' + A.stateToHash();
  ok('url/writes months as em=', /&em=7\.5(&|$)/.test(location.hash), location.hash);
  A.setState({ withdrawAmt:0, efMonths:0 });
  ok('url/hash applies with an emergency fund', A.applyHash() === true);
  ok('url/round-trips efMonths', A.state().efMonths === before.efMonths,
     'before ' + before.efMonths + ' after ' + A.state().efMonths);

  // Links written while the fund was entered in dollars carry e=; the same fund in
  // months is e= divided by that link's own costs.
  location.hash = '#a=400000.50000.30000.100000.150000.200000.5000.40000.10000.15000.0'
                + '&s=r2008&m=a&f=000100&w=5000&e=75000';
  A.applyHash();
  ok('url/a legacy e= link converts to months', A.state().efMonths === 15, 'got ' + A.state().efMonths);
  ok('url/and keeps its dollar value', A.efDollars() === 75000);

  // Links written before the fund existed carry neither and must mean "no fund".
  A.setState({ efMonths:9 });
  location.hash = '#a=400000.50000.30000.100000.150000.200000.5000.40000.10000.15000.0'
                + '&s=r2008&m=a&f=000100&w=3000';
  A.applyHash();
  ok('url/a link without e= or em= means no emergency fund', A.state().efMonths === 0,
     'got ' + A.state().efMonths);
  ok('url/such a link still restores its costs', A.state().withdrawAmt === 3000);
  A.setState({ withdrawAmt:0, efMonths:0 });
}

// ── 14. Inflation-linked costs and the true low ─────────────────────────────
{
  // Costs that "grow with inflation" must follow the SAME price level Real mode
  // deflates by. They used to compound r.inf forever: 1930s deflation ran for 25 years
  // (a $5,000 bill shrank to ~$1,000) and 1980's 13.5% never normalised.
  // A 100% cash book in Price Ret. has flat principal, so each month's fall in its
  // balance is exactly that month's cost.
  for (const [id, real] of [['depression', false], ['r1980', true], ['r1973', true]]) {
    const r = A.RECESSIONS.find(x => x.id === id), nomEnd = r.dur + r.rec;
    const s = A.simulate(r, { alloc: only('cash', 1e9), withdraw: 1000, drawInflate: true, real: false });
    let worst = 0;
    for (let m = 1; m < s.total.length; m++) {
      const paid = s.total[m-1] - s.total[m];
      worst = Math.max(worst, Math.abs(paid - 1000 * A.deflator(r, m, nomEnd)));
    }
    ok('costs/' + id + ' follow the deflator every month', worst < 1e-6, 'max gap $' + worst.toFixed(6));
  }
  // Depression costs must fall only through the deflationary downturn, then hold.
  {
    const gd = A.RECESSIONS.find(x => x.id === 'depression');
    const s = A.simulate(gd, { alloc: only('cash', 1e9), withdraw: 1000, drawInflate: true });
    const last = s.total.length - 1, paidLast = s.total[last-1] - s.total[last];
    ok('costs/depression bill stops falling after the trough', near(paidLast, 1000 * Math.pow(0.94, gd.dur/12), 1e-6),
       'last month paid $' + paidLast.toFixed(2));
  }

  // The reported low is the lowest point on the path, wherever it falls. Costs paid
  // through the recovery pushed Dot-com's true low to month 87 while the card
  // reported month 31's.
  A.setAlloc(A.cp(A.BASE));
  A.setState({ realMode:false, divMode:false, withdrawAmt:4000, withdrawInflate:true, efMonths:0 });
  const r01 = A.RECESSIONS.find(x => x.id === 'r2001');
  const lo = Math.min.apply(null, A.sim(r01).total.slice(0, r01.dur + r01.rec + 1));
  ok('low/Dot-com with costs reports the true low', near(A.pathExtreme(r01), lo, 0.01),
     'reported $' + Math.round(A.pathExtreme(r01)) + ' vs true low $' + Math.round(lo));
  ok('low/Dot-com low is after the downturn', A.extremeIndex(r01) > r01.dur,
     'at month ' + A.extremeIndex(r01));
  // These costs outrun the assumed 7% growth and empty the book years later. That is
  // reported as its own warning, not folded into the recession's drawdown.
  ok('low/later depletion is still reported', A.sim(r01).depletedAt !== null &&
     A.sim(r01).depletedAt > r01.dur + r01.rec, 'depletedAt ' + A.sim(r01).depletedAt);
  ok('low/later depletion does not become the drawdown', A.pathExtreme(r01) > 0.4 * A.tot(),
     'reported $' + Math.round(A.pathExtreme(r01)));
  // The per-asset bars still reconcile at that later month.
  ok('low/assets still sum to the headline at a late low',
     near(KEYS.reduce((a,k) => a + A.assetImpact(r01, k), 0), A.pathExtreme(r01) - A.tot(), 0.01));
  // Real mode: inflation keeps eroding a CD book after prices stop falling.
  A.setAlloc(only('cds', 1000000));
  A.setState({ realMode:true, withdrawAmt:0 });
  const r80 = A.RECESSIONS.find(x => x.id === 'r1980');
  const lo80 = Math.min.apply(null, A.sim(r80).total.slice(0, r80.dur + r80.rec + 1));
  ok('low/1980 Real CD low is after the downturn', A.extremeIndex(r80) > r80.dur);
  ok('low/1980 Real CDs report the true low', near(A.pathExtreme(r80), lo80, 0.01),
     'reported $' + Math.round(A.pathExtreme(r80)) + ' vs true low $' + Math.round(lo80));
  // A book emptied by costs must report its low in the month it ran out — selling
  // pro rata used to leave float dust, putting the low one month after the warning.
  A.setAlloc(A.cp(A.BASE));
  A.setState({ realMode:false, withdrawAmt:5000, withdrawInflate:true, efMonths:6 });
  const gdx = A.RECESSIONS.find(x => x.id === 'depression'), sx = A.sim(gdx);
  ok('low/run-out month is the low month', sx.depletedAt !== null && A.extremeIndex(gdx) === sx.depletedAt,
     'ran out ' + sx.depletedAt + ', low at ' + A.extremeIndex(gdx));
  ok('low/an emptied book is exactly zero', sx.total.slice(sx.depletedAt).every(v => v === 0));
  // Two lines that bottomed at the same place are level, not "+0.0 pts better".
  ok('ui/a zero gap reads as level', A.fmtEdge(0, true) === 'level with it' && A.fmtEdge(-0.01, false) === '0.0 pts');
  ok('ui/a real gap keeps its sign', A.fmtEdge(19.7, true) === '+19.7 pts better' && A.fmtEdge(-3.2, true) === '-3.2 pts worse');
  A.setAlloc(A.cp(A.BASE));
  A.setState({ realMode:false, withdrawAmt:0 });
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
