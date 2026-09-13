// Test harness — loads the REAL engine from app/script.js (no copy-paste of
// formulas, so the tests can't drift from the app) under a tiny DOM shim, then
// runs realistic scenarios and checks invariants that must always hold.
//
// Run: node test-engine.js        (exit code 1 on any failure)

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- Minimal DOM shim: enough for script.js to load without a browser ----
function stubEl() {
  const el = {
    value: '', textContent: '', innerHTML: '', style: {}, hidden: false, className: '', options: [], selectedIndex: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, hasAttribute() { return false; }, appendChild() {}, insertBefore() {}, focus() {}, select() {},
    querySelector() { return stubEl(); }, querySelectorAll() { return []; }, closest() { return null; },
    getBoundingClientRect() { return { width: 800, height: 280, left: 0, top: 0 }; },
    getContext() { return new Proxy({}, { get: () => () => {} }); },
    firstChild: null, parentNode: null, parentElement: null,
  };
  el.parentNode = el.parentElement = el;
  return el;
}
const sandbox = {
  console, Math, Number, String, Array, Object, Date, JSON, isFinite, isNaN, parseFloat, parseInt, Infinity, NaN,
  setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  document: { getElementById: () => stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener() {}, createElement: () => stubEl(), body: stubEl(), execCommand() {} },
  window: { location: { hostname: 'localhost', search: '', origin: 'http://localhost', pathname: '/app/' }, innerWidth: 1400, devicePixelRatio: 1 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { clipboard: null }, Node: { TEXT_NODE: 3 }, URLSearchParams,
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app', 'script.js'), 'utf8'), sandbox, { filename: 'app/script.js' });
const E = sandbox; // engine functions live here

// ---- Scenario helper ----
const BASE = {
  homePrice: 350000, downPct: 10, rate: 6.75, term: 30, taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1, hoaMonthly: 0,
  rent: 1800, rentGrowthPct: 3, appreciationPct: 3, rentalIncome: 0, vacancyPct: 5, expenseRatioPct: 25,
  creditProfile: '740-759', loanType: 'Conventional', closingCostsPct: 3, sellingCostsPct: 6, investReturn: 7,
  timeHorizon: 5, moveOutYear: 0, costInflationPct: 3, investTaxPct: 15, rentalUnits: 1, annualIncome: 0, monthlyDebt: 0,
};
function run(name, overrides, expect) {
  const p = Object.assign({}, BASE, overrides);
  const own = E.calcTotalOwnership(p.homePrice, p.downPct, p.rate, p.term, p.taxPct, p.insuranceAnnual, p.maintPct, p.hoaMonthly, p.creditProfile, p.loanType);
  const net = own - E.calcEffectiveRental(p.rentalIncome, p.vacancyPct, p.expenseRatioPct);
  const be = E.findBreakEven(p);
  const w = E.calcBuyVsRentWealth(p, p.timeHorizon);
  const d = E.generateDecision(p, own, net, w.equityGross, be);
  const rt = E.findRateThreshold(p), pt = E.findPriceThreshold(p);
  const conf = E.calcConfidence(d, be, rt, pt, p);
  return { name, p, own, net, be, w, d, rt, pt, conf, expect };
}
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('   ❌ ' + msg); } }

// ---- Universal invariants (hold for every scenario) ----
function invariants(r) {
  const { p, w, be, d } = r;
  // Net position identities
  check(Math.abs((w.equity - w.cashToClose - w.cumulativeOwn + w.buyerGains) - w.buyNet) < 1, 'buyNet identity');
  check(Math.abs((w.investmentGains - w.cumulativeRent) - w.rentNet) < 1, 'rentNet identity');
  check(Math.abs((w.buyNet - w.rentNet) - w.wealthImpact) < 1, 'wealthImpact identity');
  check(Math.abs((w.equityGross - w.sellingCosts) - w.equity) < 1, 'equity net of selling costs');
  check(Math.abs((w.dpGains + w.savingsGains) * (1 - p.investTaxPct / 100) - w.investmentGains) < 2, 'investment gains = (dp + savings) after tax');
  // Decision must agree with the wealth result at the horizon
  const buyRec = d.type === 'buy' || d.type === 'hack';
  check(buyRec === (w.wealthImpact >= 0), `decision type "${d.type}" agrees with wealth impact ${fmt(w.wealthImpact)}`);
  // Break-even must be consistent with wealth at the horizon
  if (w.wealthImpact >= 0) check(be.found && be.year <= p.timeHorizon + 0.1, `buy ahead at horizon ⇒ break-even (${be.year}) within horizon (${p.timeHorizon})`);
  if (be.found && be.year <= p.timeHorizon - 0.1) check(w.wealthImpact >= -1, 'break-even inside horizon ⇒ buy ahead at horizon');
  check(be.scanYears >= 10 && be.scanYears >= p.timeHorizon, 'break-even scan covers max(10, horizon)');
  // Text sanity: never print raw fractional years, never reference undefined
  const text = d.verdict + d.reason + d.action + d.horizon;
  check(!/undefined|NaN|0\.0833/.test(text), 'decision text has no undefined/NaN');
  // Year-0 position is just the sunk costs
  const w0 = E.calcBuyVsRentWealth(p, 0);
  check(Math.abs(w0.buyNet + w0.closingCosts + w0.sellingCosts) < 1 && Math.abs(w0.rentNet) < 1, 'year-0 positions = sunk costs only');
}

const SCENARIOS = [
  ['MA South Shore SFH — $650K, 10% down, 7yr', { homePrice: 650000, rate: 6.5, taxPct: 1.1, insuranceAnnual: 2400, rent: 3000, timeHorizon: 7, appreciationPct: 3.5 }, { type: 'rent' }],
  ['Quincy condo — 5% down, HOA $400, 5yr', { homePrice: 525000, downPct: 5, rate: 6.5, taxPct: 1.1, insuranceAnnual: 900, hoaMonthly: 400, rent: 2600, timeHorizon: 5 }, { type: 'rent' }],
  ['Brockton FHA — 3.5% down, 7yr', { homePrice: 500000, downPct: 3.5, loanType: 'FHA', rate: 6.25, insuranceAnnual: 2200, rent: 2400, timeHorizon: 7 }, { type: 'rent', miNeverDrops: true }],
  ['Weymouth 2-family hack — stay 7yr', { homePrice: 850000, downPct: 5, rate: 6.5, taxPct: 1.1, insuranceAnnual: 3200, rent: 2800, rentalIncome: 3400, timeHorizon: 7, appreciationPct: 3.5 }, { type: 'hack' }],
  ['Weymouth 2-family hack — move out yr 3', { homePrice: 850000, downPct: 5, rate: 6.5, taxPct: 1.1, insuranceAnnual: 3200, rent: 2800, rentalIncome: 2800, timeHorizon: 7, moveOutYear: 3, appreciationPct: 3.5 }, { ownerRentCharged: true }],
  ['Big down payment, cheaper monthly, weak appreciation', { homePrice: 400000, downPct: 50, rate: 6.5, taxPct: 1.1, rent: 3200, timeHorizon: 5, appreciationPct: 1 }, { buyerInvests: true }],
  ['Buy-favorable — $450K, 20% down, rent $3,000, 10yr', { homePrice: 450000, downPct: 20, rate: 6.0, taxPct: 1.1, insuranceAnnual: 2000, rent: 3000, timeHorizon: 10, appreciationPct: 4 }, { type: 'buy', conf: 'High' }],
  ['Long horizon — 15yr, 20% down (scan must extend)', { homePrice: 650000, downPct: 20, rate: 6.5, taxPct: 1.1, insuranceAnnual: 2400, rent: 3000, timeHorizon: 15, appreciationPct: 3.5 }, { scanYears: 15 }],
  ['PMI drop-off — 10% down, 10yr', { homePrice: 500000, downPct: 10, rate: 6.0, rent: 2600, timeHorizon: 10 }, { miDrops: true }],
  ['Short loan — 15yr term, 20yr hold', { homePrice: 500000, downPct: 20, rate: 5.75, term: 15, rent: 2800, timeHorizon: 20, appreciationPct: 3.5 }, { type: 'buy' }],
  ['Zero rates / zero returns edge', { rate: 0, investReturn: 0, appreciationPct: 0, rentGrowthPct: 0, costInflationPct: 0, investTaxPct: 0 }, {}],
  ['1-year horizon', { timeHorizon: 1 }, { type: 'rent' }],
];

console.log('='.repeat(80));
console.log('HOUSING DECISION ENGINE — engine tests against app/script.js');
console.log('='.repeat(80));
for (const [name, ov, expect] of SCENARIOS) {
  const r = run(name, ov, expect);
  const { p, own, net, be, w, d, conf, rt, pt } = r;
  console.log(`\n▶ ${name}`);
  console.log(`   Monthly: own ${fmt(own)}${p.rentalIncome ? ' → net ' + fmt(net) : ''} vs rent ${fmt(p.rent)} | ${p.timeHorizon}yr wealth Δ ${fmt(w.wealthImpact)} | BE ${be.found ? 'yr ' + be.year : 'none in ' + be.scanYears + 'y'}`);
  console.log(`   → ${d.type.toUpperCase()} (${conf.label} ${conf.score}) — ${d.horizon}`);
  console.log(`   Tipping: rate ${rt.noThreshold ? 'none' : rt.threshold + '%'} | price ${pt.noThreshold ? 'none' : fmt(pt.threshold)}`);
  invariants(r);
  if (expect.type) check(d.type === expect.type, `expected ${expect.type}, got ${d.type}`);
  if (expect.conf) check(conf.label === expect.conf, `expected ${expect.conf} confidence, got ${conf.label}`);
  if (expect.scanYears) check(be.scanYears === expect.scanYears, `expected ${expect.scanYears}-year scan, got ${be.scanYears}`);
  if (expect.miDrops) check(w.miDropMonth != null && w.miDropMonth > 60 && w.miDropMonth < 120, `PMI should drop between yr 5 and 10 (got month ${w.miDropMonth})`);
  if (expect.miNeverDrops) check(w.miDropMonth == null, 'FHA MIP under 10% down never drops');
  if (expect.buyerInvests) check(w.buyerGains > 0, 'buyer invests the monthly difference when owning is cheaper');
  if (expect.ownerRentCharged) check(w.cumulativeOwnerRent > 0, 'owner pays rent after move-out');
}

// ---- Model-behaviour checks ----
console.log('\n▶ Model behaviour');
{
  const p = Object.assign({}, BASE, { homePrice: 650000, rate: 6.5, rent: 3000, timeHorizon: 15 });
  const a = E.calcBuyVsRentWealth(p, 15), b = E.calcBuyVsRentWealth(Object.assign({}, p, { costInflationPct: 0 }), 15);
  check(a.cumulativeOwn > b.cumulativeOwn, 'cost inflation raises cumulative ownership cost');
  const c = E.calcBuyVsRentWealth(Object.assign({}, p, { investTaxPct: 0 }), 15);
  check(c.rentNet > a.rentNet, 'removing investment tax helps the renter');
  const d = E.calcBuyVsRentWealth(Object.assign({}, p, { rentGrowthPct: 0 }), 15);
  check(d.savingsGains > a.savingsGains, 'renter invests more when rent does not grow (savings shrink as rent rises)');
  // Monotonicity used by the tipping-point search
  const w6 = E.wealthAt(p, { rate: 6 }), w8 = E.wealthAt(p, { rate: 8 });
  check(w6 > w8, 'wealth impact falls as rate rises');
  console.log('   inflation/tax/rent-growth/rate effects all point the right way');
}

console.log('\n' + '='.repeat(80));
console.log(failures ? `FAILED — ${failures} check(s) failed` : `PASS — ${SCENARIOS.length} scenarios, all invariants hold`);
console.log('='.repeat(80));
process.exit(failures ? 1 : 0);
