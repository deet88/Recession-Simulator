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
const document = {
  documentElement: { dataset: { theme: 'dark' }, style: {} },
  getElementById(){ return stubEl(); },
  querySelectorAll(){ return []; },
  querySelector(){ return stubEl(); },
  createElement(){ return stubEl(); },
  addEventListener(){},
};
const localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } };
function matchMedia(){ return { matches:false, addEventListener(){} }; }
function Chart(){ return { destroy(){}, update(){}, data:{}, options:{} }; }
Chart.defaults = {};
const window = { location: { hash: '' }, addEventListener(){}, history: { replaceState(){} } };
const location = window.location;
const history = window.history;
const navigator = { clipboard: { writeText(){} } };

// Grab the last <script> block (the app logic) and expose its internals.
const blocks = src.split('<script>');
const appSrc = blocks[blocks.length - 1].split('</script>')[0];
const EXPOSE = `;({ simulate, sim, makePath, assetImpact, contribs, extremeIndex, recoveryMonths,
  pathExtreme, tot, pct, existed, deflator, fmtRec, cp,
  ALLOC, BASE, PRESETS, RECESSIONS, LONG_RUN_INFLATION, POST_RECOVERY_GROWTH,
  setModes: (rm, dm) => { realMode = rm; divMode = dm; simCacheKey = ''; },
  setAlloc: (a) => { ALLOC = a; simCacheKey = ''; },
})`;

let A;
try {
  A = eval(appSrc + EXPOSE);
} catch (e) {
  console.log('FATAL: index.html script block did not evaluate — ' + e);
  $.exit(1);
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

// ── 3. Preset cards in the HTML match the PRESETS object ─────────────────────
// 40 percentages used to be hand-copied; this is what stops them silently drifting.
{
  const NAME2KEY = { Conservative:'conservative', Balanced:'balanced',
                     Aggressive:'aggressive', 'All Equity':'allEquity' };
  const LBL2KEY = { 'Large Cap (US)':'largeCap','Mid Cap':'midCap','Small Cap':'smallCap',
    'Emerging Markets':'emerging','Developed Markets':'developed','Bonds':'bonds','CDs':'cds',
    'REIT':'reit','Gold &amp; Silver':'goldSilver','Crypto':'crypto','Cash &amp; Savings':'cash' };
  const cards = src.split('<div class="preset-def-card">').slice(1);
  ok('preset cards present', cards.length === Object.keys(A.PRESETS).length,
     'found ' + cards.length + ' cards for ' + Object.keys(A.PRESETS).length + ' presets');
  for (const card of cards) {
    const nm = (card.match(/class="preset-def-name">([^<]+)</) || [])[1];
    const key = NAME2KEY[nm];
    if (!key) continue;
    const html = {};
    const re = /preset-def-dot"[^>]*><\/span>([^<]+)<\/span><span class="preset-def-pct[^"]*">([\d.]+)%/g;
    let m; while ((m = re.exec(card))) html[LBL2KEY[m[1].trim()]] = parseFloat(m[2]) / 100;
    const drift = Object.keys(A.PRESETS[key])
      .filter(k => Math.abs((html[k] ?? 0) - A.PRESETS[key][k]) > 1e-9)
      .map(k => k + ' card ' + ((html[k] ?? 0)*100) + '% vs code ' + (A.PRESETS[key][k]*100) + '%');
    ok('preset card/' + nm + ' matches code', drift.length === 0, drift.join('; '));
  }
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

    // (f) recovery figure agrees with where the line actually crosses baseline
    const rec = A.recoveryMonths(r);
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

// ── Report ──────────────────────────────────────────────────────────────────
console.log('');
if (fail) {
  console.log('FAILURES (' + fail + '):');
  failures.forEach(f => console.log('  ✗ ' + f));
  console.log('');
}
if (fail) throw new Error('FAIL — ' + pass + ' passed, ' + fail + ' failed');
console.log('PASS — all ' + pass + ' assertions passed');
