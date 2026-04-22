/* ===== HOUSING DECISION ENGINE v2 — DECISION ENGINE LOGIC ===== */

// ── ACCESS GATING ─────────────────────────────────────────────────────────
// paidAccessVerified is set to true by the inline gating script (bottom of
// index.html) after successful Stripe session verification. Without it, the
// app computes everything but only displays the free-tier sections.
// Set ?dev=true in the URL to unlock locally during development.
window.paidAccessVerified = (function() {
  const p = new URLSearchParams(window.location.search);
  return p.get('dev') === 'true';
})();

function unlockPaidAccess() {
  window.paidAccessVerified = true;
  // Banner sync — whatever path unlocks the content, the "You're viewing the
  // preview" banner must go away. This is the single source of truth so we
  // never end up with unlocked content + preview banner visible.
  const _pv = document.getElementById('previewBanner');
  if (_pv) _pv.hidden = true;
  // If results are already showing, re-run to reveal paid sections
  if (document.getElementById('resultsContent').style.display !== 'none') {
    calculate();
  }
}

function injectUnlockButtons() {
  const rc = document.getElementById('resultsContent');
  if (!rc) return;
  rc.querySelectorAll('.paid-only').forEach(el => {
    if (!el.querySelector('.paid-unlock-cta')) {
      const a = document.createElement('a');
      a.href = 'https://buy.stripe.com/4gMcMYeZr3ZKeNReaafIs00';
      a.className = 'paid-unlock-cta';
      a.textContent = '\uD83D\uDD12 Unlock the full analysis \u2014 $19';
      el.appendChild(a);
    }
  });
}

// ---------- CHART STATE (shared between render and tooltip) ----------
let chartState = null;

// ============================================================
// BENCHMARKS — STATE AVERAGE EFFECTIVE PROPERTY TAX RATES
// ------------------------------------------------------------
// Values are average effective property tax rate (% of home
// value per year), used purely as a directional planning
// benchmark. These are NOT lender quotes or live tax data.
// Adjust the numbers here as your data sources improve.
// ============================================================
const STATE_TAX_RATES = {
  AL: 0.40, AK: 1.22, AZ: 0.62, AR: 0.62, CA: 0.75,
  CO: 0.51, CT: 2.14, DE: 0.57, DC: 0.56, FL: 0.89,
  GA: 0.92, HI: 0.28, ID: 0.69, IL: 2.27, IN: 0.85,
  IA: 1.57, KS: 1.41, KY: 0.86, LA: 0.55, ME: 1.36,
  MD: 1.09, MA: 1.23, MI: 1.54, MN: 1.12, MS: 0.81,
  MO: 0.97, MT: 0.84, NE: 1.73, NV: 0.60, NH: 2.18,
  NJ: 2.49, NM: 0.80, NY: 1.72, NC: 0.84, ND: 0.98,
  OH: 1.56, OK: 0.90, OR: 0.97, PA: 1.58, RI: 1.63,
  SC: 0.57, SD: 1.31, TN: 0.71, TX: 1.80, UT: 0.63,
  VT: 1.90, VA: 0.82, WA: 0.98, WV: 0.58, WI: 1.85,
  WY: 0.61
};

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming'
};

// Default state on first load (used by the dropdown + initial benchmark)
const DEFAULT_STATE = 'MA';

// ============================================================
// BENCHMARKS — PMI RATES BY BORROWER PROFILE
// ------------------------------------------------------------
// Annual PMI rate as a percent of the original loan amount.
// Applied ONLY when the down payment is below 20%.
// These are simple directional planning estimates, not lender
// quotes. Adjust freely as data improves.
//
// The "profile" labels are intentionally generic so the input
// stays educational and avoids implying a hard credit gate.
// ============================================================
// Credit-score-range → annual PMI rate (% of original loan).
// Mapping is the single source of truth for PMI tiers — change
// values here and every consumer (monthly cost, breakdown, 5-year
// outlook, wealth calc, sensitivity sweeps) picks them up.
const PMI_RATES_BY_PROFILE = {
  '760+':     0.30,
  '740-759':  0.40,
  '700-739':  0.55,
  '660-699':  0.75,
  'below660': 1.00
};

const DEFAULT_PROFILE = '740-759';

// Returns the monthly PMI dollar amount (Conventional).
// Returns 0 when the down payment is 20%+ (PMI not required)
// or when the loan amount is non-positive.
function calcMonthlyPMI(homePrice, downPct, profile) {
  if (downPct >= 20) return 0;
  const loan = homePrice * (1 - downPct / 100);
  if (loan <= 0) return 0;
  const annualPct = PMI_RATES_BY_PROFILE[profile] ?? PMI_RATES_BY_PROFILE[DEFAULT_PROFILE];
  return (loan * annualPct / 100) / 12;
}

// FHA Mortgage Insurance Premium (MIP) — applies for the life of the loan
// (simplified: 0.55% annual of the original loan balance, regardless of down payment).
const FHA_MIP_ANNUAL_PCT = 0.55;
function calcMonthlyFHAMIP(homePrice, downPct) {
  const loan = homePrice * (1 - downPct / 100);
  if (loan <= 0) return 0;
  return (loan * FHA_MIP_ANNUAL_PCT / 100) / 12;
}

// Dispatcher: returns the appropriate monthly mortgage insurance for the loan type.
function calcMonthlyMI(homePrice, downPct, profile, loanType) {
  if (loanType === 'FHA') return calcMonthlyFHAMIP(homePrice, downPct);
  return calcMonthlyPMI(homePrice, downPct, profile);
}

// ---------- HELPERS ----------

function $(id) { return document.getElementById(id); }

function num(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return (isNaN(v) || !isFinite(v)) ? 0 : v;
}

function fmt(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtSigned(n) {
  // Show +$X or -$X with sign
  const prefix = n >= 0 ? '+' : '-';
  return prefix + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
}

// ---------- LIVE HINTS ----------

function updateHints() {
  const price = num('homePrice');
  const dpPct = num('downPaymentPct');
  const taxPct = num('propertyTax');
  const maintPct = num('maintenance');
  const ccPct = num('closingCostsPct');

  $('downPaymentAmt').textContent = fmt(price * dpPct / 100);
  $('closingCostsAmt').textContent = fmt(price * ccPct / 100);
  $('propertyTaxAmt').textContent = fmt(price * taxPct / 100 / 12) + '/mo';
  $('maintenanceAmt').textContent = fmt(price * maintPct / 100 / 12) + '/mo';

  updatePMIHint();
  updateRentalIncomeHelper();
}

// Live update of the PMI helper line beneath the Credit Score Range dropdown.
// Shows "Not applicable" when DP >= 20%, otherwise "Est. PMI: $X/mo".
function updatePMIHint() {
  const benchEl = $('pmiBench');
  if (!benchEl) return;
  const price = num('homePrice');
  const dpPct = num('downPaymentPct');
  const profile = $('creditProfile') ? $('creditProfile').value : DEFAULT_PROFILE;
  const loanType = $('loanType') ? $('loanType').value : 'Conventional';
  if (loanType === 'FHA') {
    const mip = calcMonthlyFHAMIP(price, dpPct);
    benchEl.textContent = `Est. FHA MIP: ${fmt(mip)}/mo (life of loan)`;
    return;
  }
  if (dpPct >= 20) {
    benchEl.textContent = 'Not applicable — down payment is 20% or more';
    return;
  }
  const pmi = calcMonthlyPMI(price, dpPct, profile);
  benchEl.textContent = `Est. PMI: ${fmt(pmi)}/mo`;
  // Credit score rate advisory
  const rateNoteEl = $('creditRateNote');
  if (rateNoteEl) {
    if (profile === 'below660') {
      rateNoteEl.textContent = '⚠ Credit below 660 may increase your interest rate by 0.5–1.5% above advertised rates. Consider using a higher rate in your analysis.';
      rateNoteEl.style.display = '';
    } else if (profile === '660-699') {
      rateNoteEl.textContent = 'Credit in 660–699 range may increase your rate by ~0.25–0.75%. Consider adjusting your interest rate input slightly upward.';
      rateNoteEl.style.display = '';
    } else {
      rateNoteEl.style.display = 'none';
    }
  }
  if (document.body.classList.contains('basic-mode') && dpPct < 20 && loanType === 'Conventional') {
    const noteEl = document.getElementById('loanTypeNote');
    if (noteEl) noteEl.style.display = '';
  } else {
    const noteEl = document.getElementById('loanTypeNote');
    if (noteEl) noteEl.style.display = 'none';
  }
}

// Show/hide rental income helper text and move-out dropdown
function updateRentalIncomeHelper() {
  const rental = num('rentalIncome');
  const helper = $('rentalIncomeHelper');
  const moveOutGroup = $('moveOutGroup');
  const hackRealism = $('hackRealismRow');
  if (helper) helper.style.display = rental > 0 ? '' : 'none';
  if (moveOutGroup) moveOutGroup.style.display = rental > 0 ? '' : 'none';
  if (hackRealism) hackRealism.style.display = rental > 0 ? '' : 'none';
  if (rental <= 0 && $('moveOutWarn')) $('moveOutWarn').style.display = 'none';
  const hackSub = $('hackSubtitle');
  if (hackSub) hackSub.style.display = rental > 0 ? 'none' : '';
  validateMoveOut();
}

// Loan type → update hint text
function updateLoanTypeHint() {
  const bench = $('loanTypeBench');
  if (!bench || !$('loanType')) return;
  const t = $('loanType').value;
  const dpPct2 = num('downPaymentPct');
  if (dpPct2 >= 20) {
    if (bench) bench.textContent = 'With 20%+ down, no mortgage insurance is required. Conventional loans are typically the best choice at this down payment level.';
    updatePMIHint();
    return;
  }
  if (t === 'FHA') {
    bench.textContent = 'FHA mortgage insurance (MIP) works differently from conventional PMI — it often lasts 11 years or the life of the loan depending on your original down payment. For down payments below 10%, MIP lasts the full loan term.';
  } else {
    bench.textContent = 'Conventional: PMI may be removable once sufficient equity is reached.';
  }
  updatePMIHint();
}

// Warn if move-out year exceeds ownership horizon; clamp to horizon
function validateMoveOut() {
  const warn = $('moveOutWarn');
  if (!warn) return;
  const moveOut = parseInt($('moveOutYear').value) || 0;
  const horizon = num('timeHorizon') || 5;
  if (moveOut > 0 && moveOut > horizon) {
    warn.style.display = '';
    warn.textContent = `⚠ Move-out year (${moveOut}) exceeds your ${horizon}-year ownership plan. Move-out will be clamped to year ${horizon} in calculations.`;
  } else {
    warn.style.display = 'none';
  }
}

['homePrice', 'downPaymentPct', 'propertyTax', 'maintenance', 'closingCostsPct'].forEach(id => {
  $(id).addEventListener('input', updateHints);
});
$('rentalIncome').addEventListener('input', updateRentalIncomeHelper);
$('moveOutYear').addEventListener('change', validateMoveOut);
$('timeHorizon').addEventListener('input', validateMoveOut);

// ---------- CORE FINANCIAL FUNCTIONS ----------

// Standard amortization: M = P * [r(1+r)^n] / [(1+r)^n - 1]
function calcMonthlyMortgage(principal, annualRate, years) {
  if (principal <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// How much principal has been paid down after N months
function calcPrincipalPaid(principal, annualRate, years, months) {
  if (principal <= 0) return 0;
  const monthlyPayment = calcMonthlyMortgage(principal, annualRate, years);
  let balance = principal;
  const r = annualRate / 100 / 12;
  for (let i = 0; i < months; i++) {
    if (r > 0) {
      balance -= (monthlyPayment - balance * r);
    } else {
      balance -= monthlyPayment;
    }
  }
  return principal - Math.max(balance, 0);
}

// Total monthly ownership cost given a home price and rate (used by sensitivity analysis)
// PMI is computed inside via calcMonthlyPMI so it stays consistent everywhere this is called.
// PMI does NOT depend on the mortgage interest rate — only on price, down payment, and profile.
function calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly, profile, loanType) {
  const loan = homePrice * (1 - downPct / 100);
  const mortgage = calcMonthlyMortgage(loan, rate, term);
  const mi = calcMonthlyMI(homePrice, downPct, profile, loanType);
  return mortgage + (homePrice * taxPct / 100 / 12) + (insuranceAnnual / 12) + (homePrice * maintPct / 100 / 12) + hoaMonthly + mi;
}

// Effective rental income after vacancy + operating expenses (for house-hack realism).
function calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct) {
  const v = Math.max(0, Math.min(100, vacancyPct || 0)) / 100;
  const e = Math.max(0, Math.min(100, expenseRatioPct || 0)) / 100;
  return Math.max(0, (rentalIncome || 0) * (1 - v) * (1 - e));
}

// Cumulative rent paid over N years with annual growth
function calcCumulativeRent(monthlyRent, growthPct, years) {
  const totalMonths = Math.round(years * 12);
  let total = 0;
  for (let mo = 0; mo < totalMonths; mo++) {
    // Rent grows annually — year 0 = base, year 1 = base*(1+g), etc.
    const yearIndex = Math.floor(mo / 12);
    const rent = monthlyRent * Math.pow(1 + growthPct / 100, yearIndex);
    total += rent;
  }
  return total;
}

// Future value of recurring monthly contributions at a fixed annual return
// FV = PMT * [((1 + r)^n - 1) / r]  where r = monthly rate, n = months
// Default investment return — overridden by user input when available.
const DEFAULT_INVEST_RETURN = 7;

function calcInvestmentFV(monthlyContribution, annualReturn, years) {
  if (monthlyContribution <= 0 || years <= 0) return 0;
  const n = years * 12;
  if (annualReturn <= 0) return monthlyContribution * n; // 0% return = straight sum
  const r = annualReturn / 100 / 12;
  const fv = monthlyContribution * ((Math.pow(1 + r, n) - 1) / r);
  return isFinite(fv) ? fv : monthlyContribution * n;
}

// Future value of a lump sum
function calcLumpSumFV(principal, annualReturn, years) {
  if (principal <= 0) return 0;
  if (years <= 0) return principal;
  return principal * Math.pow(1 + annualReturn / 100, years);
}

// ----------------------------------------------------------------
// CANONICAL COMPARISON — the SINGLE source of truth for
// both the Decision Plan and the Net Wealth panel.
//
// Net Position = Equity/Assets Built - Total Cash Outflow
//
// BUYING:
//   equity      = downPayment + principalPaid + appreciation
//   cash out    = downPayment + (monthlyCost * months)
//   buyNet      = equity - cashOut
//               = principalPaid + appreciation - (monthlyCost * months)
//
// RENTING (and investing the difference):
//   The renter keeps the down payment and invests it (lump sum at 7%)
//   If ownership > rent, the renter invests the monthly savings too
//   cash out    = cumulativeRent
//   assets      = investmentValue (DP growth + monthly savings growth)
//   rentNet     = assets - cumulativeRent
//
// WEALTH IMPACT = buyNet - rentNet
// ----------------------------------------------------------------
function calcBuyVsRentWealth(params, years) {
  const { homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly,
          rent, rentGrowthPct, appreciationPct, rentalIncome, creditProfile, loanType,
          closingCostsPct, sellingCostsPct, investReturn, moveOutYear,
          vacancyPct, expenseRatioPct } = params;
  const downPayment = homePrice * downPct / 100;
  const closingCosts = homePrice * (closingCostsPct || 0) / 100;
  const cashToClose = downPayment + closingCosts;
  const loanAmount = homePrice - downPayment;
  const totalOwnership = calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly, creditProfile, loanType);
  const invReturn = investReturn || DEFAULT_INVEST_RETURN;
  const months = Math.round(years * 12);

  // Effective rental income after vacancy + operating expenses (house-hack realism).
  const effRentalIncome = calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct);

  // House hack transition: after moveOutYear, effective rental income increases by 1.75x
  const TRANSITION_MULT = 1.75;
  const moveOutMonth = (moveOutYear && moveOutYear > 0) ? moveOutYear * 12 : Infinity;

  // === BUYING SIDE ===
  const principalPaid = calcPrincipalPaid(loanAmount, rate, term, months);
  const homeValue = homePrice * Math.pow(1 + appreciationPct / 100, years);
  const appreciation = homeValue - homePrice;
  // Selling costs at exit (agent commissions + transaction fees) — deducted from home value
  const sellingCosts = homeValue * (sellingCostsPct || 0) / 100;
  const equityGross = downPayment + principalPaid + appreciation;
  const equity = equityGross - sellingCosts;

  // Cumulative ownership cost — month-by-month when transition is active
  let cumulativeOwn = 0;
  if (moveOutMonth < Infinity && effRentalIncome > 0) {
    for (let mo = 0; mo < months; mo++) {
      const rentalNow = mo >= moveOutMonth ? effRentalIncome * TRANSITION_MULT : effRentalIncome;
      cumulativeOwn += Math.max(totalOwnership - rentalNow, 0);
    }
  } else {
    const netMonthlyCost = Math.max(totalOwnership - effRentalIncome, 0);
    cumulativeOwn = netMonthlyCost * months;
  }

  // Net Position = Equity Built - Total Cash Outflow (including closing costs)
  const buyNet = equity - cashToClose - cumulativeOwn;

  // === RENTING SIDE (invest the difference) ===
  const cumulativeRent = calcCumulativeRent(rent, rentGrowthPct, years);

  // 1. Renter invests the full cash-to-close (DP + closing costs) as a lump sum
  const dpInvestmentValue = calcLumpSumFV(cashToClose, invReturn, years);

  // 2. Renter invests monthly savings (ownership cost - rent), if positive
  // Use first-year pre-transition values for simplicity
  const netMonthlyCostForSavings = Math.max(totalOwnership - effRentalIncome, 0);
  const monthlySavings = Math.max(netMonthlyCostForSavings - rent, 0);
  const savingsInvestmentValue = calcInvestmentFV(monthlySavings, invReturn, years);

  const totalInvestmentValue = dpInvestmentValue + savingsInvestmentValue;
  // Pure investment gains (subtract the principal contributions to avoid double-counting)
  const dpGains = dpInvestmentValue - cashToClose;
  const savingsGains = savingsInvestmentValue - (monthlySavings * months);
  const investmentGains = dpGains + savingsGains;

  const rentNet = investmentGains - cumulativeRent;

  // Wealth Impact = how much better off buying is vs renting
  const wealthImpact = buyNet - rentNet;

  // Guard against NaN / Infinity that would break rendering (Phase 4)
  function safe(v) { return isFinite(v) && !isNaN(v) ? v : 0; }

  return {
    equity: safe(equity), equityGross: safe(equityGross),
    sellingCosts: safe(sellingCosts), homeValue: safe(homeValue),
    downPayment: safe(downPayment), closingCosts: safe(closingCosts),
    cashToClose: safe(cashToClose), cumulativeOwn: safe(cumulativeOwn),
    cumulativeRent: safe(cumulativeRent),
    buyNet: safe(buyNet), rentNet: safe(rentNet), wealthImpact: safe(wealthImpact),
    totalOwnership: safe(totalOwnership), effRentalIncome: safe(effRentalIncome),
    investmentGains: safe(investmentGains), dpGains: safe(dpGains),
    savingsGains: safe(savingsGains),
    monthlySavings: safe(monthlySavings), totalInvestmentValue: safe(totalInvestmentValue)
  };
}

// ---------- BREAK-EVEN ANALYSIS ----------
// Monthly precision: check each month from 1 to 120 (10 years)
// Break-even = the first month where buying's net position exceeds renting's

function findBreakEven(params) {
  // Sample wealthImpact at every month 1-120. Because the curve can be
  // non-monotonic (month-1 appreciation can briefly outpace closing costs
  // before being dragged back under), we can't just return the first
  // month where wealthImpact >= 0 — that could be a transient blip.
  //
  // Instead: find the LAST month where wealthImpact < 0, and return the
  // following month. That guarantees the reported break-even is sustained
  // through the end of the 10-year horizon.
  const impacts = [];
  for (let mo = 1; mo <= 120; mo++) {
    impacts.push(calcBuyVsRentWealth(params, mo / 12).wealthImpact);
  }

  // If buying is still behind at month 120, no sustained break-even exists.
  if (impacts[impacts.length - 1] < 0) {
    return { month: null, year: null, found: false };
  }

  // Walk backwards to find the last negative month.
  let lastNegative = -1;
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (impacts[i] < 0) { lastNegative = i; break; }
  }

  // Sustained crossover is the month right after the last negative sample.
  // (If lastNegative === -1, buying was positive for all 120 months → month 1.)
  const crossoverIdx = lastNegative + 1;
  const mo = crossoverIdx + 1; // 1-indexed month
  const years = Math.round((mo / 12) * 10) / 10;
  return { month: mo, year: years, found: true };
}

// Format break-even for display: "Month 9 (~0.8 years)" or "Month 38 (~3.2 years)"
function fmtBreakEven(be) {
  if (!be.found) return '';
  if (be.month <= 12) {
    return `month ${be.month} (~${be.year} years)`;
  }
  return `year ${be.year} (month ${be.month})`;
}

// ---------- SENSITIVITY ANALYSIS ----------
// Binary search for the threshold where the recommendation flips

function findRateThreshold(params) {
  const currentOwnership = calcTotalOwnership(params.homePrice, params.downPct, params.rate,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType);
  const buyingIsCheaper = (currentOwnership - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct)) <= params.rent;

  // Check if buying is EVER cheaper, even at 0% interest
  const atZero = calcTotalOwnership(params.homePrice, params.downPct, 0,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType);
  const zeroNetCost = atZero - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
  if (zeroNetCost > params.rent) {
    // Even at 0% rates, ownership costs exceed rent — no monthly-cost threshold exists.
    // But check how close it is — if the gap is small, equity building can still win.
    const zeroGap = zeroNetCost - params.rent;
    const zeroGapPct = zeroGap / params.rent;
    // Run a wealth break-even at a few rates to find where buying wins on a wealth basis
    let wealthBreakRate = null;
    for (const testRate of [3, 4, 5]) {
      const testParams = Object.assign({}, params, { rate: testRate });
      const be = findBreakEven(testParams);
      if (be.found && be.month <= 60) {
        wealthBreakRate = testRate;
        break;
      }
    }
    return { threshold: null, buyingIsCheaper, noThreshold: true,
             zeroGap: Math.round(zeroGap), zeroGapPct, zeroCost: Math.round(zeroNetCost),
             wealthBreakRate };
  }

  let lo = 0, hi = 15;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const ownership = calcTotalOwnership(params.homePrice, params.downPct, mid,
      params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType);
    const netCost = ownership - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
    if (netCost <= params.rent) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const threshold = Math.round((lo + hi) / 2 * 100) / 100;
  return { threshold, buyingIsCheaper, noThreshold: false };
}

function findPriceThreshold(params) {
  const currentOwnership = calcTotalOwnership(params.homePrice, params.downPct, params.rate,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType);
  const buyingIsCheaper = (currentOwnership - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct)) <= params.rent;

  let lo = 0, hi = params.homePrice * 3;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const ownership = calcTotalOwnership(mid, params.downPct, params.rate,
      params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType);
    const netCost = ownership - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
    if (netCost <= params.rent) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const threshold = Math.round((lo + hi) / 2 / 1000) * 1000; // Round to nearest $1k
  return { threshold, buyingIsCheaper };
}

// ---------- CONFIDENCE SCORING ----------

function calcConfidence(decision, breakEven, rateThreshold, priceThreshold, params) {
  // Score from 0-100, mapped to High / Medium / Low
  // Based on: break-even clarity, threshold distance (direction-aware), wealth magnitude
  let score = 50; // neutral start
  const type = decision.type;
  const isBuyRec = (type === 'buy' || type === 'hack');
  const wi = Math.abs(decision.wealth5.wealthImpact);

  // Break-even clarity
  if (isBuyRec) {
    if (breakEven.found && breakEven.month <= 12) score += 15;
    else if (breakEven.found && breakEven.month <= 36) score += 8;
    else if (breakEven.found && breakEven.month <= 60) score += 3;
    else score -= 10;
  } else {
    if (!breakEven.found) score += 15;
    else if (breakEven.month > 84) score += 10;
    else if (breakEven.month > 60) score += 5;
    else score -= 8; // close call
  }

  // Rate threshold — direction-aware
  // "buyingIsCheaper" means monthly ownership < rent at current rate
  if (!rateThreshold.noThreshold && rateThreshold.threshold != null) {
    const rateDist = Math.abs(params.rate - rateThreshold.threshold);
    if (isBuyRec && rateThreshold.buyingIsCheaper) {
      // Buy rec + monthly cost supports it → cushion = good
      if (rateDist > 2) score += 12;
      else if (rateDist > 1) score += 6;
      else score -= 5;
    } else if (isBuyRec && !rateThreshold.buyingIsCheaper) {
      // Buy rec but monthly cost is against it → wealth-driven, lower confidence
      if (rateDist > 2) score -= 8;
      else if (rateDist > 1) score -= 4;
      else score -= 2;
    } else if (!isBuyRec && !rateThreshold.buyingIsCheaper) {
      // Rent rec + monthly cost supports it → distance = good
      if (rateDist > 2) score += 12;
      else if (rateDist > 1) score += 6;
      else score -= 5;
    } else {
      // Rent rec but monthly cost favors buying — unusual, penalize
      score -= 5;
    }
  } else if (rateThreshold.noThreshold) {
    if (!isBuyRec) score += 12;
    else score -= 12;
  }

  // Price threshold — direction-aware
  if (priceThreshold.threshold != null) {
    const priceDist = Math.abs(params.homePrice - priceThreshold.threshold) / params.homePrice;
    if (isBuyRec && priceThreshold.buyingIsCheaper) {
      if (priceDist > 0.2) score += 8;
      else if (priceDist > 0.1) score += 4;
    } else if (!isBuyRec && !priceThreshold.buyingIsCheaper) {
      if (priceDist > 0.2) score += 8;
      else if (priceDist > 0.1) score += 4;
      else score -= 3;
    } else {
      // Threshold direction opposes recommendation
      if (priceDist < 0.1) score -= 5;
    }
  }

  // Wealth impact magnitude
  if (wi > 50000) score += 8;
  else if (wi > 20000) score += 4;
  else if (wi > 10000) score += 0;
  else if (wi < 3000) score -= 10;
  else if (wi < 5000) score -= 5;

  score = Math.max(0, Math.min(100, score));

  let level, label, explanation;
  if (score >= 62) {
    level = 'high';
    label = 'High';
    explanation = 'The numbers clearly favor this path across multiple assumptions.';
  } else if (score >= 42) {
    level = 'medium';
    label = 'Medium';
    explanation = 'The recommendation holds, but small changes in rates or prices could shift the outcome.';
  } else {
    level = 'low';
    label = 'Low';
    explanation = 'This is a close call — the scenarios are nearly equivalent financially.';
  }

  return { score, level, label, explanation };
}

// ---------- RECOMMENDATION ENGINE ----------

function generateDecision(params, totalOwnership, netCost, equityHorizon, breakEven) {
  const { rent, rentalIncome, homePrice, rate, investReturn } = params;
  const invReturn = investReturn || DEFAULT_INVEST_RETURN;
  const h = params.timeHorizon || 5;            // P1: dynamic horizon
  const downPayment = homePrice * params.downPct / 100;
  const cashToClose = downPayment + homePrice * (params.closingCostsPct || 0) / 100;
  const hasHouseHack = rentalIncome > 0;
  const effectiveCost = hasHouseHack ? netCost : totalOwnership;
  const monthlyDiff = effectiveCost - rent; // Positive = buying costs more
  const annualDiff = monthlyDiff * 12;
  // wealth5 name preserved for back-compat with consumer code (dp metric, scenario compare),
  // but it is now the wealth snapshot at the USER'S HORIZON.
  const wealth5 = calcBuyVsRentWealth(params, h);
  const wealth10 = calcBuyVsRentWealth(params, 10);
  // equity5yr alias for template strings below (same value as equityHorizon passed in)
  const equity5yr = equityHorizon;

  let verdict, reason, action, type, horizon;

  if (hasHouseHack && netCost < rent && netCost < totalOwnership) {
    type = 'hack';
    horizon = 'Buy now — hold at least 3 years';
    verdict = 'House hacking significantly improves your financial position.';
    reason = `With rental income offsetting your costs, your effective monthly payment drops to ${fmt(netCost)} — ` +
      `that's ${fmt(rent - netCost)} less than you'd pay in rent each month. ` +
      `You're essentially getting paid to build equity. ` +
      `Over ${h} years, you'd accumulate ~${fmt(equity5yr)} in equity while spending less than a renter.`;
    if (netCost <= 0) {
      action = `Next steps: (1) Verify the rental income is realistic for the area — talk to a property manager or check comps. ` +
        `(2) Set aside 3 months of gross rent as a vacancy reserve. ` +
        `(3) Budget ${fmt(homePrice * params.maintPct / 100 / 12)}/mo for maintenance. ` +
        `Your rental income fully covers your cost — this is a powerful wealth-building position.`;
    } else {
      action = `Next steps: (1) Verify rental income with local comps — be conservative by 10-15%. ` +
        `(2) Budget a vacancy reserve of 1-2 months gross rent. ` +
        `(3) Get pre-approved at or below ${rate}% to lock in this math. ` +
        `This is one of the strongest paths to building wealth through real estate.`;
    }
  } else if (totalOwnership < rent * 0.9) {
    // Buying is clearly cheaper (10%+ less than rent)
    type = 'buy';
    const saving = rent - totalOwnership;
    horizon = 'Buy now — the math works from day one';
    verdict = 'Buying is financially favorable under your current assumptions.';
    reason = `Your total ownership cost of ${fmt(totalOwnership)}/mo is ${fmt(saving)} less than renting at ${fmt(rent)}/mo. ` +
      `That's ${fmt(saving * 12)} in annual savings, plus you'd build ~${fmt(equity5yr)} in equity over ${h} years. ` +
      `Even accounting for a renter investing the ${fmt(cashToClose)} cash-to-close at ${invReturn}%, buying comes out ahead.`;
    action = `Next steps: (1) Get pre-approved for a mortgage at or below ${rate}%. ` +
      `(2) Target properties at or below ${fmt(homePrice)}. ` +
      `(3) Build up ${fmt(Math.round(totalOwnership * 4))} in emergency reserves (3-6 months of housing expenses) before closing. ` +
      `The numbers clearly support buying at these terms.`;
  } else if (totalOwnership < rent) {
    // Buying is slightly cheaper
    type = 'buy';
    horizon = 'Buy within the next 12 months';
    verdict = 'Buying is financially favorable under your current assumptions.';
    reason = `Ownership at ${fmt(totalOwnership)}/mo is slightly less than renting at ${fmt(rent)}/mo, ` +
      `saving you ${fmt((rent - totalOwnership) * 12)} per year. The real advantage is equity — ` +
      `you'd build ~${fmt(equity5yr)} over ${h} years. Even after accounting for renter investment returns at ${invReturn}%, buying pulls ahead.`;
    action = `Next steps: (1) Get pre-approved — even a 0.25% rate increase could erode this advantage. ` +
      `(2) Ensure you have ${fmt(cashToClose)} for cash-to-close (down payment + closing costs). ` +
      `(3) Build 3-6 months of housing expenses as emergency reserves. ` +
      `The margin is modest, so locking in soon is important.`;
  } else if (totalOwnership <= rent * 1.15 && breakEven.found && breakEven.year <= 5) {
    // Buying costs more monthly but breaks even within 5 years
    type = 'buy';
    const minStay = Math.ceil(breakEven.year);
    horizon = `Buy if you'll stay ${minStay}+ years`;
    verdict = 'Buying costs more monthly, but the wealth-building makes up for it.';
    reason = `You'd pay ${fmt(monthlyDiff)} more per month than renting. ` +
      `However, by ${fmtBreakEven(breakEven)}, buying overtakes renting in total financial value — even accounting for ${invReturn}% investment returns. ` +
      `After ${h} year${h === 1 ? '' : 's'}, your net wealth advantage from buying is ~${fmt(wealth5.wealthImpact)}. ` +
      `The short-term premium funds long-term wealth.`;
    action = `Next steps: (1) Honestly assess how long you'll stay — buying only wins if you hold past the ${fmtBreakEven(breakEven)} break-even. ` +
      `(2) Budget for the extra ${fmt(monthlyDiff)}/mo compared to renting. ` +
      `(3) If there's a realistic chance you'd move within ${minStay} years, renting preserves flexibility and avoids closing costs.`;
  } else if (breakEven.found && breakEven.year <= 3 && wealth5.wealthImpact > 0) {
    // Buying costs more monthly but wealth effect kicks in fast
    type = 'buy';
    horizon = 'Buy if you\'ll stay 3+ years';
    verdict = 'Buying costs more monthly, but the wealth-building makes it worthwhile.';
    reason = `You'd pay ${fmt(monthlyDiff)} more per month than renting. ` +
      `However, the equity and appreciation gains are strong — by ${fmtBreakEven(breakEven)}, buying already overtakes renting even after ${invReturn}% investment returns. ` +
      `After ${h} years, your net wealth advantage from buying is ~${fmt(wealth5.wealthImpact)}. ` +
      `The higher monthly cost is effectively forced savings into an appreciating asset.`;
    action = `Next steps: (1) Confirm you plan to stay at least 3 years. ` +
      `(2) The monthly premium of ${fmt(monthlyDiff)} is the cost of building ${fmt(equity5yr)} in equity over ${h} years. ` +
      `(3) Get pre-approved and move quickly — rate increases could push the break-even out further.`;
  } else if (breakEven.found && breakEven.year <= 5 && wealth5.wealthImpact > 0) {
    // Moderate break-even, still net positive
    type = 'buy';
    const minStay = Math.ceil(breakEven.year);
    horizon = `Buy if you'll stay ${minStay}+ years`;
    verdict = 'Buying costs more monthly, but the long-term wealth effect favors ownership.';
    reason = `You'd pay ${fmt(monthlyDiff)} more per month (${fmt(totalOwnership)} vs ${fmt(rent)} rent). ` +
      `By ${fmtBreakEven(breakEven)}, buying overtakes renting in total financial value, including ${invReturn}% renter investment returns. ` +
      `After ${h} years, your net wealth advantage from buying is ~${fmt(wealth5.wealthImpact)}.`;
    action = `Next steps: (1) This is a medium-confidence buy — it works if you stay ${minStay}+ years. ` +
      `(2) If there's any chance you'd relocate sooner, renting preserves flexibility and avoids the monthly premium. ` +
      `(3) Consider increasing your down payment to reduce the monthly gap.`;
  } else if (breakEven.found && breakEven.year <= 7) {
    // Longer break-even — close call
    type = 'lean-rent';
    horizon = 'Rent for the next 1-2 years, then reassess';
    verdict = 'It\'s a close call — lean toward renting and investing unless you plan to stay 5+ years.';
    reason = `Buying would cost ${fmt(monthlyDiff)} more per month (${fmt(totalOwnership)} vs ${fmt(rent)} rent). ` +
      `You'd break even around ${fmtBreakEven(breakEven)}, even after accounting for ${invReturn}% investment returns a renter could earn. ` +
      `If you're confident you'll stay long-term, buying builds wealth. ` +
      `If there's uncertainty, renting and investing the ${fmt(monthlyDiff)}/mo difference is the smarter play.`;
    action = `Next steps: (1) Rent for now and auto-invest ${fmt(monthlyDiff)}/mo into a broad market index fund. ` +
      `(2) Also invest your ${fmt(cashToClose)} cash-to-close savings at ${invReturn}%. ` +
      `(3) Revisit this analysis in 12-18 months — if rates drop 0.5-1% or you find a lower-priced property, the math can shift significantly. ` +
      `(4) Consider saving toward a 20%+ down payment to reduce monthly costs.`;
  } else if (breakEven.found && breakEven.year <= 10) {
    // Long break-even
    type = 'rent';
    horizon = 'Rent for the next 2-3 years, then reassess';
    const investValue5 = calcInvestmentFV(monthlyDiff, invReturn, h);
    verdict = 'Renting and investing the difference is the stronger financial move for now.';
    reason = `Buying would cost ${fmt(monthlyDiff)} more per month — that's ${fmt(annualDiff)} extra per year. ` +
      `Buying doesn't overtake renting until around ${fmtBreakEven(breakEven)}, which is a long commitment. ` +
      `Investing the ${fmt(monthlyDiff)}/mo difference at ${invReturn}% would grow to ~${fmt(investValue5)} over ${h} years — ` +
      `a concrete alternative to home equity.`;
    action = `Next steps: (1) Invest your ${fmt(downPayment)} in a diversified index fund (e.g., total market or S&P 500). ` +
      `(2) Set up automatic monthly investments of ${fmt(monthlyDiff)} (the cost difference). ` +
      `(3) Set a calendar reminder to re-run this analysis in 12 months when rates and prices may have shifted. ` +
      `(4) Watch for rate drops below ${rate - 1}% as a signal to reassess.`;
  } else {
    // Buying never breaks even within 10 years
    type = 'rent';
    horizon = `Rent for the next ${h} year${h===1?'':'s'}, then reassess`;
    const investValue5 = calcInvestmentFV(monthlyDiff, invReturn, h);
    verdict = 'Renting and investing is clearly the stronger financial path right now.';
    reason = `At ${fmt(totalOwnership)}/mo vs ${fmt(rent)}/mo rent, buying would cost you ${fmt(annualDiff)} more per year. ` +
      `Even after ${wealth10.wealthImpact >= 0 ? '10 years' : 'a full decade'}, buying does not overtake renting and investing at ${invReturn}%. ` +
      `Investing ${fmt(monthlyDiff)}/mo at ${invReturn}% would grow to ~${fmt(investValue5)} over ${h} years alone.`;
    const rt = findRateThreshold(params);
    if (rt.noThreshold && rt.wealthBreakRate != null) {
      action = `Next steps: (1) Invest aggressively — put your ${fmt(cashToClose)} (what you'd spend on cash-to-close) into a diversified index fund today. ` +
        `(2) Auto-invest ${fmt(monthlyDiff)}/mo (the ownership premium you're avoiding). ` +
        `(3) At lower rates (~${rt.wealthBreakRate}%), buying would win on a total-wealth basis despite costing slightly more monthly. Watch for rate drops. ` +
        `(4) Alternatively, a larger down payment or lower-priced property changes the math. Reassess in 12-18 months.`;
    } else if (rt.noThreshold) {
      action = `Next steps: (1) Invest aggressively — put your ${fmt(cashToClose)} (what you'd spend on cash-to-close) into a diversified index fund today. ` +
        `(2) Auto-invest ${fmt(monthlyDiff)}/mo (the ownership premium you're avoiding). ` +
        `(3) At this price point, even 0% rates won't make buying cheaper. Focus on lower-priced properties or house hacking to change the equation. ` +
        `(4) Reassess in 12-18 months if the market corrects.`;
    } else {
      action = `Next steps: (1) Invest aggressively — put your ${fmt(cashToClose)} (what you'd spend on cash-to-close) into a diversified index fund today. ` +
        `(2) Auto-invest ${fmt(monthlyDiff)}/mo (the ownership premium you're avoiding). ` +
        `(3) Watch for rates below ${rt.threshold}% or a meaningful price correction — that's when this equation changes. ` +
        `(4) Reassess in 12-18 months or when market conditions shift.`;
    }
  }

  return { verdict, reason, action, type, horizon, monthlyDiff, annualDiff, wealth5 };
}

// ---------- WEALTH OVER TIME CHART ----------
// Pure Canvas line chart — no dependencies

function renderWealthChart(params, breakEven) {
  const canvas = $('wealthChart');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  // Generate year-by-year data (Year 0–10) using the canonical formula
  const years = [];
  for (let yr = 0; yr <= 10; yr++) {
    const w = calcBuyVsRentWealth(params, yr);
    years.push({ yr, buyNet: w.buyNet, rentNet: w.rentNet, diff: w.wealthImpact });
  }

  // Chart layout
  const pad = { top: 30, right: 20, bottom: 36, left: 65 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  // Value range
  const allVals = years.flatMap(d => [d.buyNet, d.rentNet]);
  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 1;
  minVal -= range * 0.08;
  maxVal += range * 0.08;

  function xPos(yr) { return pad.left + (yr / 10) * chartW; }
  function yPos(val) { return pad.top + (1 - (val - minVal) / (maxVal - minVal)) * chartH; }

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Grid lines and Y labels
  const gridLines = 5;
  ctx.strokeStyle = '#e8e2db';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#7a6e65';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= gridLines; i++) {
    const val = minVal + (maxVal - minVal) * (i / gridLines);
    const y = yPos(val);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    // Format label as $-XXk or $XXk
    const label = (val >= 0 ? '' : '-') + '$' + Math.abs(Math.round(val / 1000)) + 'k';
    ctx.fillText(label, pad.left - 8, y + 4);
  }

  // X-axis labels
  ctx.textAlign = 'center';
  for (let yr = 0; yr <= 10; yr++) {
    const x = xPos(yr);
    ctx.fillText('Yr ' + yr, x, H - pad.bottom + 20);
    // Tick
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.strokeStyle = yr % 5 === 0 ? '#ddd6cc' : '#eee8e2';
    ctx.stroke();
  }

  // Zero line
  if (minVal < 0 && maxVal > 0) {
    const zeroY = yPos(0);
    ctx.strokeStyle = '#c8bfb4';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(W - pad.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw lines
  function drawLine(data, key, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xPos(d.yr);
      const y = yPos(d[key]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Area fill under buy line (subtle)
  ctx.beginPath();
  years.forEach((d, i) => {
    const x = xPos(d.yr);
    const y = yPos(d.buyNet);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(xPos(10), yPos(years[10].rentNet));
  for (let i = 10; i >= 0; i--) {
    ctx.lineTo(xPos(years[i].yr), yPos(years[i].rentNet));
  }
  ctx.closePath();
  // Fill green where buy > rent, red where rent > buy (simplified: single fill based on endpoint)
  const endDiff = years[10].diff;
  ctx.fillStyle = endDiff >= 0 ? 'rgba(22,128,61,0.06)' : 'rgba(59,130,246,0.06)';
  ctx.fill();

  drawLine(years, 'rentNet', '#3b82f6');
  drawLine(years, 'buyNet', '#16803d');

  // Dots at Year 5 and Year 10
  [5, 10].forEach(yr => {
    const d = years[yr];
    // Buy dot
    ctx.beginPath();
    ctx.arc(xPos(yr), yPos(d.buyNet), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#16803d';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Rent dot
    ctx.beginPath();
    ctx.arc(xPos(yr), yPos(d.rentNet), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // Break-even marker
  if (breakEven.found && breakEven.year <= 10) {
    const beX = xPos(breakEven.year);
    ctx.strokeStyle = '#8b1c2e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(beX, pad.top);
    ctx.lineTo(beX, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = '#8b1c2e';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Break-even', beX, pad.top - 6);
    ctx.fillText(breakEven.month <= 12 ? 'Mo ' + breakEven.month : 'Yr ' + breakEven.year, beX, pad.top + 6);
  }

  // House hack transition marker
  const moveOutYr = params.moveOutYear || 0;
  if (moveOutYr > 0 && moveOutYr <= 10 && params.rentalIncome > 0) {
    const txX = xPos(moveOutYr);
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(txX, pad.top);
    ctx.lineTo(txX, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Move-out', txX, pad.top + chartH + 12);
  }

  // Callout pills
  const callouts = $('chartCallouts');
  const y5 = years[5];
  const y10 = years[10];
  const diffClass5 = y5.diff >= 0 ? 'pos' : 'neg';
  const diffClass10 = y10.diff >= 0 ? 'pos' : 'neg';
  callouts.innerHTML =
    `<span class="chart-callout"><span class="cc-label">Year 5:</span> <span class="cc-value ${diffClass5}">${fmtSigned(y5.diff)}</span></span>` +
    `<span class="chart-callout"><span class="cc-label">Year 10:</span> <span class="cc-value ${diffClass10}">${fmtSigned(y10.diff)}</span></span>`;

  // Insight text
  const insight = $('chartInsight');
  const parts = [];
  if (breakEven.found && breakEven.year <= 10) {
    if (breakEven.month <= 6) {
      parts.push('Buying pulls ahead almost immediately and the gap widens every year.');
    } else if (breakEven.month <= 12) {
      parts.push(`Buying overtakes renting at month ${breakEven.month}. If you sell before then, renting would have been the better financial outcome.`);
    } else {
      parts.push(`Buying overtakes renting at year ${breakEven.year}. If you sell before then, renting would have been the better financial outcome.`);
    }
  } else {
    parts.push('Renting and investing the difference stays ahead for the full 10-year window under these assumptions.');
  }
  if (y10.diff >= 0) {
    parts.push(`By year 10, buying puts you ~${fmt(y10.diff)} ahead of renting.`);
  } else {
    parts.push(`By year 10, renting still keeps you ~${fmt(Math.abs(y10.diff))} ahead.`);
  }
  insight.textContent = parts.join(' ');

  // Store chart state for tooltip access
  chartState = { years, xPos, yPos, pad, W, H };
}

// ---------- CHART TOOLTIP ----------

(function initChartTooltip() {
  const canvas = $('wealthChart');
  const tooltip = $('chartTooltip');
  const crosshair = $('chartCrosshair');

  canvas.addEventListener('mousemove', function(e) {
    if (!chartState) return;
    const { years, xPos, pad, W } = chartState;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Find nearest year
    let nearest = 0;
    let minDist = Infinity;
    for (let yr = 0; yr <= 10; yr++) {
      const dist = Math.abs(mouseX - xPos(yr));
      if (dist < minDist) { minDist = dist; nearest = yr; }
    }

    // Only show if mouse is within chart area
    if (mouseX < pad.left - 10 || mouseX > W - pad.right + 10) {
      tooltip.style.display = 'none';
      crosshair.style.display = 'none';
      return;
    }

    const d = years[nearest];
    const diffAbs = Math.abs(Math.round(d.diff));
    const diffLabel = d.diff >= 0
      ? 'Buying ahead by ' + fmt(diffAbs)
      : 'Renting ahead by ' + fmt(diffAbs);
    const diffClass = d.diff >= 0 ? 'tt-pos' : 'tt-neg';

    tooltip.innerHTML =
      `<div class="tt-year">Year ${d.yr}</div>` +
      `<div class="tt-row"><span class="tt-label">Buy net</span> <span class="tt-buy">${fmt(d.buyNet)}</span></div>` +
      `<div class="tt-row"><span class="tt-label">Rent net</span> <span class="tt-rent">${fmt(d.rentNet)}</span></div>` +
      `<div class="tt-diff ${diffClass}">${diffLabel}</div>`;
    tooltip.style.display = 'block';

    // Position tooltip
    const ttW = tooltip.offsetWidth;
    const snapX = xPos(nearest);
    let left = snapX + 12;
    if (left + ttW > W - 10) left = snapX - ttW - 12;
    tooltip.style.left = left + 'px';
    tooltip.style.top = pad.top + 'px';

    // Crosshair
    crosshair.style.display = 'block';
    crosshair.style.left = snapX + 'px';
  });

  canvas.addEventListener('mouseleave', function() {
    tooltip.style.display = 'none';
    crosshair.style.display = 'none';
  });
})();

// ---------- MAIN CALCULATION ----------

function calculate() {
  // ---------- INPUT VALIDATION (P6) ----------
  if (!validateInputs()) {
    return false;
  }

  // Gather all inputs into a params object
  const params = {
    homePrice: num('homePrice'),
    downPct: num('downPaymentPct'),
    rate: num('interestRate'),
    term: num('loanTerm'),
    taxPct: num('propertyTax'),
    insuranceAnnual: num('insurance'),
    maintPct: num('maintenance'),
    hoaMonthly: num('hoa'),
    rent: num('currentRent'),
    rentGrowthPct: num('rentGrowth'),
    appreciationPct: num('homeAppreciation'),
    rentalIncome: num('rentalIncome'),
    vacancyPct: num('vacancyPct'),
    expenseRatioPct: num('expenseRatioPct'),
    propertyState: $('propertyState') ? $('propertyState').value : '',
    creditProfile: $('creditProfile').value,
    loanType: $('loanType') ? $('loanType').value : 'Conventional',
    closingCostsPct: num('closingCostsPct'),
    sellingCostsPct: num('sellingCostsPct'),
    investReturn: num('investReturn') || DEFAULT_INVEST_RETURN,
    timeHorizon: Math.max(num('timeHorizon') >= 0 ? num('timeHorizon') : 5, 1/12),
    moveOutYear: Math.min(parseInt($('moveOutYear').value) || 0, num('timeHorizon') || 5),
    annualIncome: num('annualIncome'),
    monthlyDebt: num('monthlyDebt'),
  };

  const { homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly,
          rent, rentGrowthPct, appreciationPct, rentalIncome, creditProfile, loanType,
          closingCostsPct, investReturn, timeHorizon, moveOutYear,
          vacancyPct, expenseRatioPct, annualIncome, monthlyDebt } = params;

  // Core calculations
  const downPayment = homePrice * downPct / 100;
  const closingCosts = homePrice * closingCostsPct / 100;
  const cashToClose = downPayment + closingCosts;
  const loanAmount = homePrice - downPayment;
  const monthlyMortgage = calcMonthlyMortgage(loanAmount, rate, term);
  const monthlyTax = homePrice * taxPct / 100 / 12;
  const monthlyInsurance = insuranceAnnual / 12;
  const monthlyMaint = homePrice * maintPct / 100 / 12;
  const monthlyPMI = calcMonthlyMI(homePrice, downPct, creditProfile, loanType);
  const totalOwnership = monthlyMortgage + monthlyTax + monthlyInsurance + monthlyMaint + hoaMonthly + monthlyPMI;
  const effRentalIncome = calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct);
  const netCost = totalOwnership - effRentalIncome;

  // Horizon-based projections (P1 — dynamic time horizon)
  const horizonMonths = timeHorizon * 12;
  const totalRentHorizon = calcCumulativeRent(rent, rentGrowthPct, timeHorizon);
  const totalOwnHorizon = netCost * horizonMonths;
  const principalPaid = calcPrincipalPaid(loanAmount, rate, term, horizonMonths);
  const homeValueHorizon = homePrice * Math.pow(1 + appreciationPct / 100, timeHorizon);
  const equityHorizon = downPayment + principalPaid + (homeValueHorizon - homePrice);

  // Advanced analyses
  const breakEven = findBreakEven(params);
  const rateThreshold = findRateThreshold(params);
  const priceThreshold = findPriceThreshold(params);
  const decision = generateDecision(params, totalOwnership, netCost, equityHorizon, breakEven);

  // ---------- UPDATE UI ----------

  $('resultsPlaceholder').style.display = 'none';
  $('resultsContent').style.display = 'block';

  // Apply or remove paid-content lock based on access verification
  const rc = $('resultsContent');
  if (window.paidAccessVerified) {
    rc.classList.remove('access-locked');
  } else {
    rc.classList.add('access-locked');
  }

  // === ANALYSIS STATUS BANNER (Phase 2) ===
  // Double-RAF ensures the browser has painted display:block before starting
  // the CSS opacity/transform transition (single RAF can fire before layout).
  const statusEl = $('analysisStatus');
  if (statusEl) {
    statusEl.classList.remove('visible');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      statusEl.classList.add('visible');
    }));
  }

  // === FOCUS MANAGEMENT — move focus to results heading (Phase 2) ===
  const dpVerdict = $('dpVerdict');
  if (dpVerdict) {
    dpVerdict.setAttribute('tabindex', '-1');
    dpVerdict.focus({ preventScroll: true });
  }

  // === DECISION PLAN ===
  const dp = $('decisionPlan');
  dp.className = 'decision-plan paid-only';
  if (decision.type === 'hack') {
    dp.classList.add('dp-hack');
    $('dpIcon').textContent = '🏘️';
  } else if (decision.type === 'buy') {
    dp.classList.add('dp-buy');
    $('dpIcon').textContent = '🏠';
  } else if (decision.type === 'lean-rent') {
    dp.classList.add('dp-rent');
    $('dpIcon').textContent = '⚖️';
  } else {
    dp.classList.add('dp-rent');
    $('dpIcon').textContent = '🔑';
  }
  $('dpVerdict').textContent = decision.verdict;
  $('dpReason').textContent = decision.reason;
  $('dpAction').textContent = decision.action;

  // Time horizon
  $('dpHorizon').textContent = decision.horizon;

  // Confidence badge + explanation (F4)
  const confidence = calcConfidence(decision, breakEven, rateThreshold, priceThreshold, params);
  const confBadge = $('dpConfBadge');
  confBadge.textContent = confidence.label;
  confBadge.className = 'dp-conf-badge conf-' + confidence.level;
  confBadge.title = confidence.explanation;
  if ($('dpConfExplanation')) $('dpConfExplanation').textContent = confidence.explanation;

  // Narrative sections (F3)
  const narrative = buildNarrative(decision, params, breakEven, decision.wealth5, confidence);
  if ($('dpTradeoff')) $('dpTradeoff').textContent = narrative.tradeoff;
  if ($('dpTimeInsight')) $('dpTimeInsight').textContent = narrative.timeInsight;
  if ($('dpRiskNote')) $('dpRiskNote').textContent = narrative.riskNote;

  // Decision plan metrics — wealthImpact comes from the SAME calcBuyVsRentWealth used by the panel
  const wi = decision.wealth5.wealthImpact;
  $('dpMonthlyDiff').textContent = fmt(Math.abs(decision.monthlyDiff)) + '/mo';
  $('dpMonthlyDiff').className = 'dp-metric-value ' + (decision.monthlyDiff > 0 ? 'neg' : 'pos');
  $('dpAnnualDiff').textContent = fmt(Math.abs(decision.annualDiff)) + '/yr';
  $('dpAnnualDiff').className = 'dp-metric-value ' + (decision.annualDiff > 0 ? 'neg' : 'pos');
  $('dpWealthImpact').textContent = fmtSigned(wi);
  $('dpWealthImpact').className = 'dp-metric-value ' + (wi >= 0 ? 'pos' : 'neg');

  // === SCENARIO SUMMARY (header) ===
  $('sumHomePrice').textContent = fmt(params.homePrice);
  $('sumDownPct').textContent = params.downPct + '%';
  $('sumRate').textContent = params.rate + '%';

  // === DYNAMIC ASSUMPTION LINE ===
  $('dpAssumption').textContent = `Analysis assumes renters invest savings at ${investReturn}% annual return`;

  // === KPI CARDS ===
  $('kpiMortgage').textContent = fmt(monthlyMortgage);
  $('kpiOwnership').textContent = fmt(totalOwnership);
  $('kpiNet').textContent = fmt(netCost);
  $('kpiRent').textContent = fmt(rent);
  // Dynamic sublabel — clarify whether rental income offset is active
  if ($('kpiNetSublabel')) {
    $('kpiNetSublabel').textContent = rentalIncome > 0
      ? `Total ownership (${fmt(totalOwnership)}) minus rental income offset (${fmt(effRentalIncome)})`
      : 'Same as Total Monthly Cost of Owning when no rental income';
  }

  // === CASH TO CLOSE ===
  $('ctcDP').textContent = fmt(downPayment);
  $('ctcClosing').textContent = fmt(closingCosts);
  $('ctcTotal').textContent = fmt(cashToClose);

  // === COST BREAKDOWN ===
  $('bdMortgage').textContent = fmt(monthlyMortgage);
  $('bdTax').textContent = fmt(monthlyTax);
  $('bdInsurance').textContent = fmt(monthlyInsurance);
  $('bdMaintenance').textContent = fmt(monthlyMaint);
  $('bdHOA').textContent = fmt(hoaMonthly);
  // PMI / FHA MIP row: hidden when mortgage insurance is $0 (Conventional + DP >= 20%)
  if (monthlyPMI > 0) {
    $('bdPMIRow').style.display = '';
    $('bdPMI').textContent = fmt(monthlyPMI);
    if ($('bdPMILabel')) $('bdPMILabel').textContent = (loanType === 'FHA') ? 'FHA MIP' : 'PMI';
  } else {
    $('bdPMIRow').style.display = 'none';
  }
  $('bdTotal').textContent = fmt(totalOwnership);

  if (rentalIncome > 0) {
    $('bdRentalRow').style.display = '';
    $('bdNetRow').style.display = '';
    $('bdRental').textContent = '-' + fmt(rentalIncome);
    $('bdNet').textContent = fmt(netCost);
  } else {
    $('bdRentalRow').style.display = 'none';
    $('bdNetRow').style.display = 'none';
  }

  // === BAR CHART ===
  const maxCost = Math.max(rent, totalOwnership, netCost > 0 ? netCost : 0);
  $('barRent').style.width = (rent / maxCost * 100) + '%';
  $('barRentAmt').textContent = fmt(rent);
  $('barBuy').style.width = (totalOwnership / maxCost * 100) + '%';
  $('barBuyAmt').textContent = fmt(totalOwnership);

  if (rentalIncome > 0) {
    $('hackRow').style.display = '';
    $('barHack').style.width = Math.max(netCost / maxCost * 100, 2) + '%';
    $('barHackAmt').textContent = fmt(netCost);
  } else {
    $('hackRow').style.display = 'none';
  }

  // === NET WEALTH COMPARISON ===
  // Uses the SAME wealth5 object from the decision engine — single source of truth
  const w5 = decision.wealth5;

  // Buy side
  $('wBuyEquity').textContent = '+' + fmt(w5.equityGross);
  $('wBuyDP').textContent = '-' + fmt(w5.downPayment);
  $('wBuyClosing').textContent = '-' + fmt(w5.closingCosts);
  if ($('wBuySelling')) {
    if (w5.sellingCosts > 0) {
      $('wBuySellingRow').style.display = '';
      $('wBuySelling').textContent = '-' + fmt(w5.sellingCosts);
    } else {
      $('wBuySellingRow').style.display = 'none';
    }
  }
  $('wBuyCost').textContent = '-' + fmt(w5.cumulativeOwn);
  $('wBuyNet').textContent = fmtSigned(w5.buyNet);
  $('wBuyNet').className = w5.buyNet >= 0 ? 'wealth-pos' : 'wealth-neg';

  // Rent side — includes investment gains
  $('wRentDPGains').textContent = w5.dpGains > 0 ? '+' + fmt(w5.dpGains) : fmt(0);
  $('wRentDPGains').className = w5.dpGains > 0 ? 'wealth-pos' : 'wealth-zero';
  if (w5.savingsGains > 0) {
    $('wRentSavingsRow').style.display = '';
    $('wRentSavingsGains').textContent = '+' + fmt(w5.savingsGains);
    $('wRentSavingsGains').className = 'wealth-pos';
  } else {
    $('wRentSavingsRow').style.display = 'none';
  }
  $('wRentCost').textContent = '-' + fmt(w5.cumulativeRent);
  $('wRentNet').textContent = fmtSigned(w5.rentNet);
  $('wRentNet').className = w5.rentNet >= 0 ? 'wealth-pos' : 'wealth-neg';
  $('wRentReturnNote').textContent = `Assumes ${investReturn}% annual return on investments`;

  // Wealth verdict — MUST match dpWealthImpact since both use w5.wealthImpact
  const wCard = $('wealthBuyCard');
  const rCard = $('wealthRentCard');
  wCard.classList.remove('winner');
  rCard.classList.remove('winner');
  const horizonLabel = `${timeHorizon} year${timeHorizon === 1 ? '' : 's'}`;
  if (w5.wealthImpact >= 0) {
    $('wVerdict').innerHTML = `<span class="wv-pos">Even after accounting for investment returns, buying puts you <strong>${fmt(w5.wealthImpact)}</strong> ahead after ${horizonLabel}</span>`;
    wCard.classList.add('winner');
  } else {
    $('wVerdict').innerHTML = `<span class="wv-neg">Renting and investing the difference keeps you <strong>${fmt(Math.abs(w5.wealthImpact))}</strong> ahead after ${horizonLabel}</span>`;
    rCard.classList.add('winner');
  }

  // Dynamic panel titles / labels (P1)
  if ($('wealthPanelTitle')) $('wealthPanelTitle').textContent = `Net Financial Position — ${horizonLabel}`;
  if ($('wealthPanelSubtitle')) $('wealthPanelSubtitle').textContent = `What's your total financial outcome after ${horizonLabel} in each scenario?`;
  if ($('outlookPanelTitle')) $('outlookPanelTitle').textContent = `${timeHorizon}-Year Outlook`;
  if ($('olRentLabel')) $('olRentLabel').textContent = `Total Rent Paid (${timeHorizon}yr)`;
  if ($('olOwnLabel')) $('olOwnLabel').textContent = `Total Ownership Cost (${timeHorizon}yr)`;
  if ($('olValueLabel')) $('olValueLabel').textContent = `Est. Home Value (${timeHorizon}yr)`;
  if ($('wBuyCostLabel')) $('wBuyCostLabel').textContent = `Monthly costs paid (${timeHorizon}yr)`;
  if ($('wRentCostLabel')) $('wRentCostLabel').textContent = `Total rent paid (${timeHorizon}yr)`;
  if ($('dpWealthImpactLabel')) {
    // Update only the leading text node — preserve the accessible tip-wrap markup intact
    const _lbl = $('dpWealthImpactLabel');
    if (_lbl.firstChild && _lbl.firstChild.nodeType === Node.TEXT_NODE) {
      _lbl.firstChild.textContent = `${timeHorizon}-Year Wealth Impact `;
    }
    // Also make the tooltip copy time-horizon specific
    const _tipEl = document.getElementById('tip-wealthimpact');
    if (_tipEl) _tipEl.textContent = `The total dollar difference in your net worth after ${timeHorizon} year${timeHorizon === 1 ? '' : 's'} between buying and renting + investing the difference.`;
  }
  if ($('beSnapHdrHorizon')) $('beSnapHdrHorizon').textContent = `Year ${timeHorizon}`;

  // === WEALTH OVER TIME CHART ===
  renderWealthChart(params, breakEven);

  // === BREAK-EVEN ===
  // Reset state from previous runs
  $('beBarFill').classList.remove('be-bar-never');
  $('beBarMarker').style.display = '';

  // Snapshot data for transparency table (uses user's time horizon, not hardcoded 5yr)
  const beY0 = calcBuyVsRentWealth(params, 0);
  const beY1 = calcBuyVsRentWealth(params, 1);
  const beY5 = calcBuyVsRentWealth(params, timeHorizon);
  $('beSnapBuy0').textContent = fmt(beY0.buyNet);
  $('beSnapRent0').textContent = fmt(beY0.rentNet);
  $('beSnapDiff0').textContent = fmtSigned(beY0.wealthImpact);
  $('beSnapDiff0').className = 'be-snap-val ' + (beY0.wealthImpact >= 0 ? 'pos' : 'neg');
  $('beSnapBuy1').textContent = fmt(beY1.buyNet);
  $('beSnapRent1').textContent = fmt(beY1.rentNet);
  $('beSnapDiff1').textContent = fmtSigned(beY1.wealthImpact);
  $('beSnapDiff1').className = 'be-snap-val ' + (beY1.wealthImpact >= 0 ? 'pos' : 'neg');
  $('beSnapBuy5').textContent = fmt(beY5.buyNet);
  $('beSnapRent5').textContent = fmt(beY5.rentNet);
  $('beSnapDiff5').textContent = fmtSigned(beY5.wealthImpact);
  $('beSnapDiff5').className = 'be-snap-val ' + (beY5.wealthImpact >= 0 ? 'pos' : 'neg');

  if (breakEven.found) {
    if (breakEven.month <= 1) {
      // Buying is ahead from the very first sample — no catch-up period.
      // Check whether the margin is razor-thin (tipping point) vs decisive.
      const m1 = calcBuyVsRentWealth(params, 1 / 12);
      const razorThin = Math.abs(m1.wealthImpact) < 500;

      $('beBarWrap').style.display = 'none';
      $('beTimeline').innerHTML = '<span class="be-highlight">Buying is ahead from day one under these assumptions.</span>';

      if (razorThin) {
        $('beDetail').innerHTML =
          `<strong>⚠ Razor-thin margin:</strong> buying is only about ${fmt(Math.abs(m1.wealthImpact))} ahead in month 1. ` +
          `A small change in rent, rate, or price could flip this either way — review the sensitivity analysis below before committing.`;
      } else if (totalOwnership <= rent) {
        $('beDetail').textContent = `You save ${fmt(rent - totalOwnership)} per month immediately, plus you start building equity right away. There's no "catch-up" period — buying wins immediately.`;
      } else {
        $('beDetail').textContent = `Even though monthly ownership costs ${fmt(totalOwnership - rent)} more than rent, the combination of equity building and home appreciation puts buying ahead from month 1 on a total-wealth basis.`;
      }
    } else {
      $('beBarWrap').style.display = '';
      const beLabel = fmtBreakEven(breakEven);
      $('beTimeline').innerHTML = `Buying breaks even at <span class="be-highlight">${beLabel}</span>`;
      const pct = Math.min(breakEven.year / 10 * 100, 100);
      $('beBarFill').style.width = pct + '%';
      $('beBarMarker').style.left = pct + '%';
      $('beBarMarker').setAttribute('data-year', breakEven.year);

      if (breakEven.month <= 24) {
        $('beDetail').textContent = `The equity and appreciation gains overtake the extra monthly cost quickly. If you plan to stay at least ${Math.ceil(breakEven.month / 12)} years, buying is strongly favored.`;
      } else if (breakEven.month <= 60) {
        $('beDetail').textContent = `You'll need to stay about ${Math.ceil(breakEven.year)} years before buying's wealth effect surpasses renting and investing. Reasonable if this is a medium-term home.`;
      } else {
        $('beDetail').textContent = `It takes ${breakEven.year} years for buying to pull ahead. That's a long commitment — make sure you're confident about staying put that long.`;
      }
    }
  } else {
    $('beBarWrap').style.display = '';
    $('beTimeline').innerHTML = '<span class="be-never">Buying does not break even within 10 years.</span>';
    $('beBarFill').style.width = '100%';
    $('beBarFill').classList.add('be-bar-never');
    $('beBarMarker').style.display = 'none';
    $('beDetail').textContent = `Under these assumptions, renting and investing remains the financially stronger option for at least a decade.`;
  }

  // Time horizon vs break-even warning
  const horizonWarn = $('beHorizonWarn');
  if (breakEven.found && breakEven.year > timeHorizon) {
    horizonWarn.style.display = '';
    horizonWarn.textContent = `⚠ You may not reach break-even within your expected ${timeHorizon}-year timeframe. Break-even is at year ${breakEven.year}, which is ${(breakEven.year - timeHorizon).toFixed(1)} years beyond your plan.`;
  } else if (!breakEven.found) {
    horizonWarn.style.display = '';
    horizonWarn.textContent = `⚠ Break-even is not reached within 10 years — well beyond your ${timeHorizon}-year plan.`;
  } else {
    horizonWarn.style.display = 'none';
  }

  // House hack transition insight
  const transInsight = $('transitionInsight');
  if (moveOutYear > 0 && rentalIncome > 0) {
    transInsight.style.display = '';
    const postRental = rentalIncome * 1.75;
    transInsight.textContent = `After year ${moveOutYear}, this property transitions to a full rental (~${fmt(postRental)}/mo income), improving cash flow and long-term returns.`;
  } else {
    transInsight.style.display = 'none';
  }

  // === SENSITIVITY ANALYSIS ===
  const rateCard = $('sensRateCard');

  if (rateThreshold.noThreshold && rateThreshold.wealthBreakRate != null) {
    // Monthly cost never dips below rent, but the gap is close enough that
    // equity building makes buying win on a wealth basis at lower rates.
    rateCard.classList.remove('sens-structural');
    $('sensRateIcon').textContent = '⚖️';
    $('sensRateTitle').textContent = 'Rate Threshold (Wealth-Based)';
    $('sensRate').textContent = '~' + rateThreshold.wealthBreakRate + '%';
    $('sensRateDetail').textContent =
      `No rate makes monthly ownership cheaper than ${fmt(rent)} rent — at 0%, ownership is still ${fmt(rateThreshold.zeroCost)}/mo ` +
      `(${fmt(rateThreshold.zeroGap)} more). However, at ~${rateThreshold.wealthBreakRate}% or below, strong equity building means ` +
      `buying breaks even quickly on a total-wealth basis. At today's ${rate}%, the equity gains can't overcome the monthly premium.`;
  } else if (rateThreshold.noThreshold) {
    // Truly structural — even equity building can't save it at reasonable rates
    rateCard.classList.add('sens-structural');
    $('sensRateIcon').textContent = '🚫';
    $('sensRateTitle').textContent = 'Buying Is Structurally More Expensive';
    $('sensRate').textContent = 'No rate helps';
    $('sensRateDetail').textContent =
      `Even at 0% interest, ownership costs ${fmt(rateThreshold.zeroCost)}/mo — ` +
      `${fmt(rateThreshold.zeroGap)} more than your ${fmt(rent)} rent. ` +
      `The non-mortgage costs alone are too high relative to rent. ` +
      `To change this equation: look at lower-priced homes, explore multi-family properties for rental income, or wait for the market to correct.`;
  } else if (rateThreshold.buyingIsCheaper) {
    rateCard.classList.remove('sens-structural');
    $('sensRateIcon').textContent = '📉';
    $('sensRateTitle').textContent = 'Interest Rate Threshold';
    $('sensRate').textContent = rateThreshold.threshold + '%';
    $('sensRateDetail').textContent = `Buying stays favorable up to ${rateThreshold.threshold}% interest. You currently have ${(rateThreshold.threshold - rate).toFixed(2)}% of cushion before renting becomes cheaper.`;
  } else {
    rateCard.classList.remove('sens-structural');
    $('sensRateIcon').textContent = '📉';
    $('sensRateTitle').textContent = 'Interest Rate Threshold';
    $('sensRate').textContent = rateThreshold.threshold + '%';
    $('sensRateDetail').textContent = `If rates dropped to ${rateThreshold.threshold}%, buying would become cheaper than renting. That's a ${(rate - rateThreshold.threshold).toFixed(2)}% decrease from today's ${rate}%.`;
  }

  // Home price
  const priceCard = $('sensPriceCard');
  priceCard.classList.remove('sens-structural');
  $('sensPriceIcon').textContent = '🏷️';
  $('sensPriceTitle').textContent = 'Home Price Threshold';
  if (priceThreshold.buyingIsCheaper) {
    $('sensPrice').textContent = fmt(priceThreshold.threshold);
    $('sensPriceDetail').textContent = `Buying works at prices up to ~${fmt(priceThreshold.threshold)}. You have ${fmt(priceThreshold.threshold - homePrice)} of room above your target price.`;
  } else {
    $('sensPrice').textContent = fmt(priceThreshold.threshold);
    $('sensPriceDetail').textContent = `The home price would need to drop to ~${fmt(priceThreshold.threshold)} for buying to match your rent cost. That's a ${Math.round((1 - priceThreshold.threshold / homePrice) * 100)}% decrease.`;
  }

  // Sensitivity summary — contextualizes how far you are from the tipping points
  const sensParts = [];
  if (rateThreshold.noThreshold && rateThreshold.wealthBreakRate != null) {
    const rateDropNeeded = (rate - rateThreshold.wealthBreakRate).toFixed(1);
    sensParts.push(`Monthly costs never quite dip below rent, but at ~${rateThreshold.wealthBreakRate}% (a ${rateDropNeeded}% drop), equity building makes buying win on total wealth.`);
  } else if (rateThreshold.noThreshold) {
    sensParts.push('No interest rate can make this home cheaper than renting — the non-mortgage costs alone exceed your rent.');
  } else if (rateThreshold.buyingIsCheaper) {
    const rateCushion = (rateThreshold.threshold - rate).toFixed(1);
    if (rateCushion > 2) sensParts.push(`You have a comfortable ${rateCushion}% rate cushion — even significant rate hikes won't flip the recommendation.`);
    else if (rateCushion > 0.75) sensParts.push(`You have ${rateCushion}% of rate cushion. A moderate rate increase would still keep buying favorable.`);
    else sensParts.push(`Your rate cushion is thin at ${rateCushion}%. A small rate increase could shift the math toward renting.`);
  } else {
    const rateGap = (rate - rateThreshold.threshold).toFixed(1);
    if (rateGap > 2) sensParts.push(`Rates would need to drop ${rateGap}% — a large move that's unlikely in the near term.`);
    else if (rateGap > 1) sensParts.push(`A ${rateGap}% rate drop would shift this to buying — meaningful but plausible over 12-24 months.`);
    else sensParts.push(`You're only ${rateGap}% away from the rate tipping point — a modest rate drop could change the recommendation.`);
  }

  if (priceThreshold.buyingIsCheaper) {
    const priceRoom = Math.round((priceThreshold.threshold - homePrice) / homePrice * 100);
    if (priceRoom > 20) sensParts.push(`You have ${priceRoom}% price headroom — buying works even at significantly higher prices.`);
  } else {
    const priceDrop = Math.round((1 - priceThreshold.threshold / homePrice) * 100);
    if (priceDrop > 20) sensParts.push(`A ${priceDrop}% price correction is needed — that's a major market shift.`);
    else if (priceDrop > 10) sensParts.push(`A ${priceDrop}% price drop would tip the balance — watch for market softening in your area.`);
    else sensParts.push(`You're within ${priceDrop}% of the price tipping point — negotiating the price down could change the outcome.`);
  }
  $('sensSummary').textContent = sensParts.join(' ');

  // === HORIZON OUTLOOK ===
  // === AFFORDABILITY / DTI ===
  renderAffordability(params, totalOwnership);

  // === WEALTH DATA TABLE ===
  renderChartDataTable(params);

  // === METHODOLOGY PANEL ("How This Decision Is Calculated") ===
  renderMethodology(params, totalOwnership, decision.wealth5);

  $('ol5Rent').textContent = fmt(totalRentHorizon);
  $('ol5Own').textContent = fmt(totalOwnHorizon);
  $('ol5Equity').textContent = fmt(equityHorizon);
  $('ol5Value').textContent = fmt(homeValueHorizon);

  // Store last result for scenario comparison (F1)
  lastResult = {
    params: Object.assign({}, params),
    totalOwnership,
    netCost,
    monthlyDiff: decision.monthlyDiff,
    wealth5: decision.wealth5,
    breakEven,
    decision,
    confidence,
  };
  if (typeof updateScenarioUI === 'function') updateScenarioUI();

  // Scroll to top of results panel on mobile (Phase 2)
  if (window.innerWidth <= 960) {
    const resultsPanel = $('resultsPanel') || $('resultsContent');
    if (resultsPanel) resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!window.paidAccessVerified) injectUnlockButtons();
  return true;
}

// ---------- RESET ----------

// ---------- INPUT VALIDATION (Phase 3/4) ----------
// Returns true if all inputs are valid, false otherwise.
// Sets aria-invalid on invalid inputs, links errors via aria-describedby,
// shows inline error text and a summary, and focuses the first bad field.
function validateInputs() {
  const errs = [];
  let firstBadEl = null;

  // Helper: mark field invalid with aria attrs + inline message
  function markInvalid(el, msg) {
    if (!el) return;
    el.classList.add('input-error');
    el.setAttribute('aria-invalid', 'true');
    const errId = el.id + '-err';
    el.setAttribute('aria-describedby', errId);
    // Insert inline error span if not already present
    let span = document.getElementById(errId);
    if (!span) {
      span = document.createElement('span');
      span.id = errId;
      span.className = 'field-error-msg';
      span.setAttribute('role', 'alert');
      el.parentNode.insertBefore(span, el.nextSibling);
    }
    span.textContent = msg;
    if (!firstBadEl) firstBadEl = el;
    errs.push(msg);
  }

  function clearInvalid(el) {
    if (!el) return;
    el.classList.remove('input-error');
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    const span = document.getElementById(el.id + '-err');
    if (span) span.textContent = '';
  }

  // Home Price must be > 0
  const hp = $('homePrice');
  const hpV = parseFloat(hp ? hp.value : '');
  if (!hp || isNaN(hpV) || hpV <= 0) markInvalid(hp, 'Home Price must be greater than 0.');
  else clearInvalid(hp);
  // Current Rent: 0 is valid, only NaN or negative is invalid
  const cr = $('currentRent');
  const crV = parseFloat(cr ? cr.value : '');
  if (!cr || isNaN(crV) || crV < 0) markInvalid(cr, 'Current Rent cannot be negative.');
  else clearInvalid(cr);

  // Must be >= 0 fields
  const nonNegFields = [
    ['downPaymentPct', 'Down Payment (%) cannot be negative.'],
    ['interestRate', 'Interest Rate cannot be negative.'],
    ['propertyTax', 'Property Tax Rate cannot be negative.'],
    ['insurance', 'Insurance cannot be negative.'],
    ['maintenance', 'Maintenance cannot be negative.'],
    ['hoa', 'HOA cannot be negative.'],
    ['rentGrowth', 'Rent Growth cannot be negative.'],
    ['rentalIncome', 'Rental Income cannot be negative.'],
    ['investReturn', 'Investment Return cannot be negative.'],
    ['closingCostsPct', 'Closing Costs cannot be negative.'],
    ['sellingCostsPct', 'Selling Costs cannot be negative.'],
    ['vacancyPct', 'Vacancy Rate cannot be negative.'],
    ['expenseRatioPct', 'Operating Costs cannot be negative.'],
  ];
  for (const [id, msg] of nonNegFields) {
    const el = $(id);
    if (!el) continue;
    const v = parseFloat(el.value);
    if (!isNaN(v) && v < 0) markInvalid(el, msg);
    else clearInvalid(el);
  }

  // Loan term must be valid
  const termEl = $('loanTerm');
  if (termEl) {
    const termV = parseFloat(termEl.value);
    if (isNaN(termV) || termV < 1) markInvalid(termEl, 'Loan term must be at least 1 year.');
    else clearInvalid(termEl);
  }

  // Time horizon must be non-negative
  const thEl = $('timeHorizon');
  const th = thEl ? (parseFloat(thEl.value) || 0) : 0;
  if (th < 0) {
    markInvalid(thEl, 'Time horizon cannot be negative.');
  } else {
    clearInvalid(thEl);
  }

  // Move-out year vs time horizon
  const moEl = $('moveOutYear');
  const mo = moEl ? (parseInt(moEl.value) || 0) : 0;
  if (mo > 0 && th > 0 && mo > th) {
    errs.push(`Move-out year (${mo}) exceeds your ${th}-year time horizon — it will be clamped.`);
  }

  // Down payment range
  const dpEl = $('downPaymentPct');
  if (dpEl) {
    const dpV = parseFloat(dpEl.value);
    if (!isNaN(dpV) && dpV < 0) markInvalid(dpEl, 'Down Payment cannot be negative.');
    else if (!isNaN(dpV) && dpV > 100) markInvalid(dpEl, 'Down Payment cannot exceed 100%.');
  }

  // Vacancy + expense ratio range
  const vacEl = $('vacancyPct');
  if (vacEl) {
    const vacV = parseFloat(vacEl.value);
    if (!isNaN(vacV) && vacV > 100) markInvalid(vacEl, 'Vacancy Rate cannot exceed 100%.');
  }
  const expEl = $('expenseRatioPct');
  if (expEl) {
    const expV = parseFloat(expEl.value);
    if (!isNaN(expV) && expV > 100) markInvalid(expEl, 'Operating Costs cannot exceed 100%.');
  }

  // Show error summary
  const box = $('formErrors');
  if (box) {
    if (errs.length) {
      box.style.display = '';
      box.className = 'form-errors';
      box.innerHTML = '<strong>Please fix the following before analyzing:</strong><ul>' +
        errs.map(e => `<li>${e}</li>`).join('') + '</ul>';
      // Focus first bad input for accessibility
      if (firstBadEl) firstBadEl.focus();
    } else {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  }

  // Advisory warning for negative appreciation (non-blocking)
  const appEl2 = $('homeAppreciation');
  if (appEl2) {
    const appV2 = parseFloat(appEl2.value);
    const warnBox = $('formErrors');
    if (!isNaN(appV2) && appV2 < 0 && warnBox && errs.length === 0) {
      warnBox.style.display = '';
      warnBox.innerHTML = `<strong>⚠ Note:</strong> You've entered negative appreciation (${appV2}%). This means the home loses value over time — a valid scenario, but double-check your input.`;
      warnBox.className = 'form-errors form-warn';
    }
  }

  return errs.length === 0;
}

// ---------- AFFORDABILITY / DTI (Phase 4/7) ----------
function renderAffordability(params, totalOwnership) {
  const panel = $('affordabilityPanel');
  if (!panel) return;
  const income = params.annualIncome || 0;
  const debt = params.monthlyDebt || 0;
  if (income <= 0) {
    // Show panel with "add income to estimate DTI" hint
    panel.style.display = '';
    if ($('dtiValue')) $('dtiValue').textContent = '—';
    if ($('dtiBadge')) { $('dtiBadge').textContent = 'N/A'; $('dtiBadge').className = 'dti-badge'; }
    if ($('dtiBreakdown')) $('dtiBreakdown').textContent = 'Enter your Annual Household Income and Monthly Debt above to see your estimated debt-to-income (DTI) ratio. Missing income data prevents affordability analysis.';
    if ($('dtiWarn')) $('dtiWarn').style.display = 'none';
    return;
  }
  panel.style.display = '';
  const monthlyIncome = income / 12;
  const rawDti = (totalOwnership + debt) / monthlyIncome * 100;
  // Guard against nonsensical values
  if (!isFinite(rawDti) || isNaN(rawDti)) {
    if ($('dtiBreakdown')) $('dtiBreakdown').textContent = 'Unable to compute DTI — check your income input.';
    return;
  }
  const dti = rawDti;
  let level, label;
  if (dti <= 36) { level = 'strong'; label = 'Generally stronger (≤ 36%)'; }
  else if (dti <= 45) { level = 'caution'; label = 'May still qualify (36–45%)'; }
  else { level = 'high'; label = 'Stretch territory (> 45%)'; }
  $('dtiValue').textContent = dti.toFixed(1) + '%';
  const badge = $('dtiBadge');
  badge.textContent = label;
  badge.className = 'dti-badge dti-' + level;
  $('dtiBreakdown').textContent =
    `(${fmt(totalOwnership)} housing + ${fmt(debt)} existing debts) ÷ ${fmt(monthlyIncome)}/mo gross income`;
  const warn = $('dtiWarn');
  if (dti > 50) {
    warn.style.display = '';
    warn.textContent = '⚠ DTI above 50% is stretch territory — very difficult to qualify under most programs. Consult a lender before proceeding.';
  } else if (dti > 45) {
    warn.style.display = '';
    warn.textContent = '⚠ DTI above 45% may be challenging to qualify for. Some programs allow up to 50% with strong credit and reserves. This is informational only.';
  } else {
    warn.style.display = 'none';
  }
}

// ---------- ACCESSIBLE TOOLTIP SYSTEM (Phase 3) ----------
// Each tooltip trigger has class="tip-btn" with aria-describedby pointing to a
// sibling .tip-content[role="tooltip"]. The parent .tip-wrap gets .tip-open to
// show/hide via CSS. Dismisses on Escape or blur.
function tipToggle(btn) {
  const wrap = btn.closest('.tip-wrap');
  if (!wrap) return;
  const isOpen = wrap.classList.contains('tip-open');

  // Close all open tooltips and clear any inline positioning
  document.querySelectorAll('.tip-wrap.tip-open').forEach(w => {
    w.classList.remove('tip-open');
    const b = w.querySelector('.tip-btn');
    if (b) b.setAttribute('aria-expanded', 'false');
    const t = w.querySelector('.tip-content');
    if (t) t.removeAttribute('style');
  });

  if (!isOpen) {
    wrap.classList.add('tip-open');
    btn.setAttribute('aria-expanded', 'true');

    // After the browser renders display:block, calculate fixed position so the
    // tooltip escapes any overflow:hidden ancestor (e.g. the results panel).
    requestAnimationFrame(() => {
      const tip = wrap.querySelector('.tip-content');
      if (!tip) return;

      const btnRect = btn.getBoundingClientRect();
      const tipW = tip.offsetWidth || 250;
      const tipH = tip.offsetHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const margin = 8;
      const gap = 8;

      // Horizontally center on the button, then clamp so the bubble stays on-screen
      let left = btnRect.left + btnRect.width / 2 - tipW / 2;
      left = Math.max(margin, Math.min(left, vw - tipW - margin));

      // Place directly above the button
      const top = btnRect.top - tipH - gap;

      tip.style.top  = top  + 'px';
      tip.style.left = left + 'px';

      // Move the caret arrow to point at the button's horizontal centre,
      // regardless of how much the bubble was shifted by clamping.
      const btnCenterX  = btnRect.left + btnRect.width / 2;
      const caretOffset = Math.max(8, Math.min(btnCenterX - left - 6, tipW - 20));
      tip.style.setProperty('--tip-caret-left', caretOffset + 'px');
    });
  }
}

// Close tooltip on Escape or blur outside the wrap
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.tip-wrap.tip-open').forEach(w => {
      w.classList.remove('tip-open');
      const b = w.querySelector('.tip-btn');
      if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
      const t = w.querySelector('.tip-content');
      if (t) t.removeAttribute('style');
    });
  }
});
document.addEventListener('focusin', e => {
  document.querySelectorAll('.tip-wrap.tip-open').forEach(w => {
    if (!w.contains(e.target)) {
      w.classList.remove('tip-open');
      const b = w.querySelector('.tip-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
      const t = w.querySelector('.tip-content');
      if (t) t.removeAttribute('style');
    }
  });
});

// ---------- WEALTH DATA TABLE (P5) ----------
function renderChartDataTable(params) {
  const body = $('chartDataTableBody');
  if (!body) return;
  const maxYr = Math.max(10, params.timeHorizon || 5);
  let html = '';
  for (let yr = 0; yr <= maxYr; yr++) {
    const w = calcBuyVsRentWealth(params, yr);
    const diffClass = w.wealthImpact >= 0 ? 'pos' : 'neg';
    html += `<tr><td>${yr}</td><td>${fmt(w.buyNet)}</td><td>${fmt(w.rentNet)}</td><td class="${diffClass}">${fmtSigned(w.wealthImpact)}</td></tr>`;
  }
  body.innerHTML = html;
}

// ---------- METHODOLOGY PANEL ("How This Decision Is Calculated") ----------
// Plain-English breakdown of every line item that feeds the recommendation.
// All numbers come from the SAME canonical wealth5 object the rest of the UI uses,
// so users see the exact figures that drove the decision.
function renderMethodology(params, totalOwnership, w5) {
  if (!$('methUpfront')) return;
  const horizon = params.timeHorizon || 5;
  const invR = params.investReturn || DEFAULT_INVEST_RETURN;
  const yrLabel = `${horizon} year${horizon === 1 ? '' : 's'}`;
  $('methUpfront').textContent = `${fmt(w5.cashToClose)}  (${fmt(w5.downPayment)} down + ${fmt(w5.closingCosts)} closing)`;
  $('methMonthly').textContent = `${fmt(totalOwnership)}/mo total cost of owning`;
  $('methInvest').textContent = `+${fmt(w5.investmentGains)} in projected investment gains over ${yrLabel} at ${invR}%`;
  $('methExit').textContent = w5.sellingCosts > 0
    ? `−${fmt(w5.sellingCosts)} in selling costs at exit`
    : 'No exit costs modeled';
  const buyNet = w5.buyNet;
  const rentNet = w5.rentNet;
  const winner = buyNet >= rentNet ? 'Buying' : 'Renting';
  $('methNet').textContent =
    `Buy net: ${fmtSigned(buyNet)}   |   Rent net: ${fmtSigned(rentNet)}   →   ${winner} wins by ${fmt(Math.abs(buyNet - rentNet))} over ${yrLabel}`;
}

// ---------- INPUT MODE TOGGLE (Basic / Advanced) ----------
// Basic shows only the headline inputs (price, down, rate, horizon, rent).
// Advanced reveals the full set. Choice persists in localStorage so users
// don't have to re-toggle every visit.
function setInputMode(mode) {
  const isAdvanced = mode === 'advanced';
  document.body.classList.toggle('basic-mode', !isAdvanced);
  document.body.classList.toggle('advanced-mode', isAdvanced);
  const bBtn = $('modeBasicBtn');
  const aBtn = $('modeAdvBtn');
  if (bBtn && aBtn) {
    bBtn.classList.toggle('mode-btn-active', !isAdvanced);
    aBtn.classList.toggle('mode-btn-active', isAdvanced);
    bBtn.setAttribute('aria-selected', String(!isAdvanced));
    aBtn.setAttribute('aria-selected', String(isAdvanced));
  }
  try { localStorage.setItem('hde-input-mode', mode); } catch (e) {}
}

function toggleChartDataTable() {
  const wrap = $('chartDataTableWrap');
  const btn = $('btnChartDataTable');
  if (!wrap || !btn) return;
  const hidden = wrap.style.display === 'none' || wrap.style.display === '';
  wrap.style.display = hidden ? 'block' : 'none';
  btn.textContent = hidden ? 'Hide data table' : 'Show data table';
}

// ---------- NARRATIVE BUILDER (F3) ----------
// Three plain-English sections that read like an advisor's note: the core tradeoff,
// whether the math reaches break-even within the user's horizon, and what would
// have to change to flip the recommendation.
function buildNarrative(decision, params, breakEven, wealth5, confidence) {
  const { rate, rentalIncome, investReturn } = params;
  const horizon = params.timeHorizon || 5;
  const invR = investReturn || DEFAULT_INVEST_RETURN;
  const isBuyRec = (decision.type === 'buy' || decision.type === 'hack');
  const monthlyDiff = decision.monthlyDiff;
  const wi = wealth5.wealthImpact;
  const yrLabel = `${horizon} year${horizon === 1 ? '' : 's'}`;
  const wiAbs = fmt(Math.abs(wi));

  // 1. KEY TRADEOFF — punchy and decisive, anchored on a real dollar amount.
  let tradeoff;
  if (decision.type === 'hack') {
    tradeoff = `House hacking is the strongest play here: rental income drops your effective cost to ${fmt(decision.monthlyDiff + params.rent)}/mo while you still capture ~${fmt(wealth5.equity)} in equity over ${yrLabel}.`;
  } else if (isBuyRec && monthlyDiff <= 0) {
    tradeoff = `Buying wins on both fronts. You pay ${fmt(Math.abs(monthlyDiff))} less per month than rent AND you build equity — projected ${wiAbs} ahead of renting after ${yrLabel}.`;
  } else if (isBuyRec && monthlyDiff > 0) {
    tradeoff = `You'd pay ${fmt(monthlyDiff)}/mo more to own than to rent — but that premium funds ${wiAbs} of additional net wealth over ${yrLabel}. Treat the extra cash flow as forced savings into an appreciating asset.`;
  } else if (monthlyDiff > 0) {
    tradeoff = `Renting is the smarter cash-flow move here. You save ${fmt(monthlyDiff)}/mo, and investing that difference at ${invR}% keeps you ${wiAbs} ahead of buying after ${yrLabel}.`;
  } else {
    tradeoff = `The math doesn't yet favor ownership at today's rates and prices. Renting preserves flexibility and leaves you ${wiAbs} ahead on net wealth over ${yrLabel}.`;
  }

  // 2. TIME-BASED INSIGHT — grounded in break-even vs user's horizon.
  let timeInsight;
  if (breakEven.found) {
    const beYr = breakEven.year;
    if (breakEven.month <= 1) {
      timeInsight = `Buying is ahead from day one under your inputs — there's no catch-up period to worry about. Your ${yrLabel} horizon comfortably covers it.`;
    } else if (beYr <= horizon) {
      const cushion = (horizon - beYr).toFixed(1);
      timeInsight = `Break-even hits at year ${beYr}, leaving ${cushion} year${cushion === '1.0' ? '' : 's'} of cushion inside your ${yrLabel} plan. The longer you stay past that point, the more buying pulls ahead.`;
    } else {
      timeInsight = `Break-even is at year ${beYr} — that's ${(beYr - horizon).toFixed(1)} years beyond your ${yrLabel} plan. If you sell on schedule, you'd lock in renting's lead instead of capturing the equity payoff.`;
    }
  } else {
    timeInsight = `Buying never overtakes renting within 10 years under these inputs, so ${[8,11,18].includes(horizon)?'an':'a'} ${horizon}-year commitment can't recover the upfront costs. The structural gap is too wide.`;
  }

  // 3. RISK & SENSITIVITY — what would have to move to flip the call.
  let riskNote;
  if (confidence.level === 'high') {
    riskNote = `High confidence: the answer holds even if rates move ±1% or the home price drifts ±10%. You're well clear of the tipping points.`;
  } else if (confidence.level === 'medium') {
    riskNote = `Moderate confidence: a ~1% rate swing or a ~10% price change could flip this. Watch for rate or market shifts before you commit.`;
  } else {
    riskNote = `Low confidence: this is a coin-flip scenario. Even small changes to rate, price, rent, or your time horizon can swap the recommendation. Run a second scenario before you decide.`;
  }

  return { tradeoff, timeInsight, riskNote };
}

// ---------- SCENARIO COMPARISON (F1) ----------
let scenarioA = null;
let scenarioB = null;
let activeSlot = null; // 'A' | 'B' | null — which slot the current inputs correspond to
let scenLabelA = 'Scenario A';
let scenLabelB = 'Scenario B';

function snapshotScenario() {
  // Must be called after calculate() has produced a fresh result
  return lastResult ? Object.assign({}, lastResult) : null;
}

let lastResult = null;

// List of input IDs mirrored to/from params when loading a scenario.
const SCENARIO_INPUT_MAP = [
  ['homePrice', 'homePrice'],
  ['downPaymentPct', 'downPct'],
  ['interestRate', 'rate'],
  ['loanTerm', 'term'],
  ['propertyState', 'propertyState'],
  ['propertyTax', 'taxPct'],
  ['insurance', 'insuranceAnnual'],
  ['maintenance', 'maintPct'],
  ['hoa', 'hoaMonthly'],
  ['currentRent', 'rent'],
  ['rentGrowth', 'rentGrowthPct'],
  ['homeAppreciation', 'appreciationPct'],
  ['rentalIncome', 'rentalIncome'],
  ['vacancyPct', 'vacancyPct'],
  ['expenseRatioPct', 'expenseRatioPct'],
  ['creditProfile', 'creditProfile'],
  ['loanType', 'loanType'],
  ['closingCostsPct', 'closingCostsPct'],
  ['sellingCostsPct', 'sellingCostsPct'],
  ['investReturn', 'investReturn'],
  ['timeHorizon', 'timeHorizon'],
  ['annualIncome', 'annualIncome'],
  ['monthlyDebt', 'monthlyDebt'],
];

// Write a scenario's params back into the form inputs.
function loadScenarioIntoInputs(scen) {
  if (!scen || !scen.params) return;
  const p = scen.params;
  SCENARIO_INPUT_MAP.forEach(([inputId, paramKey]) => {
    const el = $(inputId);
    if (!el || p[paramKey] === undefined || p[paramKey] === null) return;
    el.value = p[paramKey];
  });
  // Move-out year lives under its own key
  const mo = $('moveOutYear');
  if (mo && p.moveOutYear !== undefined) mo.value = p.moveOutYear;
  // Sync the interest rate slider position
  const rateSlider = $('interestRateSlider');
  if (rateSlider && p.rate !== undefined) {
    const v = parseFloat(p.rate);
    if (!isNaN(v) && v >= 2 && v <= 12) rateSlider.value = v;
  }
  // Mark tax as intentionally set so onStateChange won't overwrite it
  userEditedPropertyTax = true;
  // Refresh derived hints / helper text
  updateHints();
  updateLoanTypeHint();
  updateRentalIncomeHelper();
  validateMoveOut();
}

// Click handler on the Save/Scenario buttons. Behaviors:
//   - Slot empty OR active slot: run analysis with current inputs, then save/update.
//   - Saved slot that is NOT active: restore its inputs + re-run its analysis.
function saveScenario(slot) {
  const existing = (slot === 'A') ? scenarioA : scenarioB;
  if (existing && activeSlot !== slot) {
    // VIEW the other saved scenario — restore its inputs and re-run its analysis.
    activeSlot = slot;
    loadScenarioIntoInputs(existing);
    calculate();
    return;
  }
  // SAVE or UPDATE: always run calculate() first so we capture the current
  // inputs, not whatever lastResult happens to be left over from a prior run.
  if (!calculate()) return; // validation failed — errors already shown in form
  if (slot === 'A') scenarioA = structuredClone(lastResult);
  else scenarioB = structuredClone(lastResult);
  activeSlot = slot;
  updateScenarioUI();
}

function clearScenarios() {
  scenarioA = null;
  scenarioB = null;
  activeSlot = null;
  updateScenarioUI();
}

function updateScenarioUI() {
  const btnA = $('btnSaveA');
  const btnB = $('btnSaveB');
  const panel = $('comparePanel');
  const statusA = $('scenAStatus');
  const statusB = $('scenBStatus');
  if (!btnA) return;
  // Status: saved / active marker
  statusA.textContent = scenarioA ? (activeSlot === 'A' ? '● Viewing' : '✓ Saved') : '';
  statusB.textContent = scenarioB ? (activeSlot === 'B' ? '● Viewing' : '✓ Saved') : '';
  // Button labels reflect intent.
  btnA.firstChild.nodeValue = !scenarioA
    ? `Save as ${scenLabelA} `
    : (activeSlot === 'A' ? `Update ${scenLabelA} ` : `View ${scenLabelA} `);
  btnB.firstChild.nodeValue = !scenarioB
    ? `Save as ${scenLabelB} `
    : (activeSlot === 'B' ? `Update ${scenLabelB} ` : `View ${scenLabelB} `);
  // Active-scenario badge in the results panel
  const badge = $('scenarioActiveBadge');
  if (badge) {
    if (activeSlot) {
      const lbl = activeSlot === 'A' ? scenLabelA : scenLabelB;
      badge.textContent = `Viewing: ${lbl}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
  // Active highlight
  btnA.classList.toggle('btn-scenario-active', activeSlot === 'A');
  btnB.classList.toggle('btn-scenario-active', activeSlot === 'B');
  // Scenario B button stays hidden until A is saved.
  btnB.style.display = scenarioA ? '' : 'none';
  if (scenarioA && scenarioB) {
    panel.style.display = '';
    renderComparison();
  } else {
    panel.style.display = 'none';
  }
}

function renderComparison() {
  // Update column headers with custom names
  const thA = document.querySelector('#comparePanel thead th:nth-child(2)');
  const thB = document.querySelector('#comparePanel thead th:nth-child(3)');
  if (thA) thA.textContent = scenLabelA;
  if (thB) thB.textContent = scenLabelB;
  const rows = [
    { label: 'Monthly Cost (Buy)', get: r => fmt(r.totalOwnership) },
    { label: 'Net Monthly vs Rent', get: r => fmtSigned(r.monthlyDiff) + '/mo' },
    { label: `${scenarioA.params.timeHorizon}-Year Wealth Impact (A) / ${scenarioB.params.timeHorizon}-Year (B)`, get: r => fmtSigned(r.wealth5.wealthImpact) },
    { label: 'Break-even Time', get: r => r.breakEven.found ? fmtBreakEven(r.breakEven) : 'Not within 10 years' },
    { label: 'Confidence', get: r => r.confidence.label },
    { label: 'Verdict', get: r => r.decision.verdict },
  ];
  const tbody = $('compareBody');
  tbody.innerHTML = rows.map(r =>
    `<tr><td class="cmp-label" scope="row">${r.label}</td><td>${r.get(scenarioA)}</td><td>${r.get(scenarioB)}</td></tr>`
  ).join('');
  // Summary line
  const wiA = scenarioA.wealth5.wealthImpact;
  const wiB = scenarioB.wealth5.wealthImpact;
  const delta = wiB - wiA;
  const hA = scenarioA.params.timeHorizon || 5;
  const hB = scenarioB.params.timeHorizon || 5;
  const horizonLabel = (hA === hB) ? `${hA}-year wealth` : `net wealth at each scenario's horizon`;
  const deltaLabel = delta >= 0
    ? `Scenario B is ${fmt(Math.abs(delta))} better on ${horizonLabel}.`
    : `Scenario A is ${fmt(Math.abs(delta))} better on ${horizonLabel}.`;
  $('compareSummary').textContent = deltaLabel;
}

function resetForm() {
  $('homePrice').value = 350000;
  $('downPaymentPct').value = 10;
  $('closingCostsPct').value = 3;
  if ($('sellingCostsPct')) $('sellingCostsPct').value = 6;
  if ($('loanType')) $('loanType').value = 'Conventional';
  if ($('vacancyPct')) $('vacancyPct').value = 5;
  if ($('expenseRatioPct')) $('expenseRatioPct').value = 25;
  if ($('annualIncome')) $('annualIncome').value = '';
  if ($('monthlyDebt')) $('monthlyDebt').value = '';
  if ($('formErrors')) { $('formErrors').style.display = 'none'; $('formErrors').innerHTML = ''; }
  clearScenarios();
  $('timeHorizon').value = 5;
  $('interestRate').value = 6.75;
  $('loanTerm').value = 30;
  $('homeAppreciation').value = 3;
  $('propertyTax').value = 1.2;
  $('insurance').value = 1800;
  $('maintenance').value = 1;
  $('hoa').value = 0;
  $('currentRent').value = 1800;
  $('rentGrowth').value = 3;
  $('investReturn').value = 7;
  $('rentalIncome').value = 0;
  $('moveOutYear').value = 0;

  // Reset state dropdown + tax-edit flag so the benchmark prefill works again
  $('propertyState').value = DEFAULT_STATE;
  userEditedPropertyTax = false;
  onStateChange();

  // Reset borrower profile to its default
  $('creditProfile').value = DEFAULT_PROFILE;

  updateHints();

  $('resultsContent').style.display = 'none';
  $('resultsPlaceholder').style.display = '';
}

// ============================================================
// PROPERTY STATE — DROPDOWN + BENCHMARK WIRING
// ------------------------------------------------------------
// - Populates the Property State <select> with all 50 states + DC
// - Updates the "State average: X.XX%" helper line
// - Prefills the Property Tax field with the state benchmark,
//   but only if the user has not manually edited the field yet.
// ============================================================

// Tracks whether the user has manually changed the property tax input.
// Once true, state changes will NOT overwrite the user's value.
let userEditedPropertyTax = false;

// Populate the Property State dropdown
function populateStateDropdown() {
  const sel = $('propertyState');
  if (!sel) return;
  // Sorted alphabetically by full state name for usability
  const codes = Object.keys(STATE_NAMES).sort((a, b) =>
    STATE_NAMES[a].localeCompare(STATE_NAMES[b])
  );
  sel.innerHTML = codes
    .map(c => `<option value="${c}">${STATE_NAMES[c]}</option>`)
    .join('');
  sel.value = DEFAULT_STATE;
}

// Update the "State average: X.XX%" benchmark helper line
function updateStateTaxBenchmark() {
  const code = $('propertyState').value;
  const rate = STATE_TAX_RATES[code];
  const name = STATE_NAMES[code];
  const benchEl = $('propertyTaxBench');
  if (!benchEl) return;
  if (rate != null) {
    benchEl.textContent = `${name} average: ${rate.toFixed(2)}%`;
  } else {
    benchEl.textContent = 'State average: —';
  }
}

// When the state changes: update the benchmark, and prefill the
// property tax field IF the user has not edited it manually.
function onStateChange() {
  updateStateTaxBenchmark();
  const code = $('propertyState').value;
  const rate = STATE_TAX_RATES[code];
  if (rate != null && !userEditedPropertyTax) {
    $('propertyTax').value = rate;
    updateHints();
  }
}

// Mark the property tax field as user-edited the first time the
// user types into it. After that, state changes will not overwrite.
$('propertyTax').addEventListener('input', () => {
  userEditedPropertyTax = true;
});

$('propertyState').addEventListener('change', onStateChange);

// Borrower Profile dropdown — refresh the PMI helper line live.
$('creditProfile').addEventListener('change', updatePMIHint);
if ($('loanType')) $('loanType').addEventListener('change', updateLoanTypeHint);
if ($('downPaymentPct')) $('downPaymentPct').addEventListener('input', updateLoanTypeHint);

// Scenario button: single-click saves/switches; double-click renames
function makeScenLabelEditable(slot) {
  const btn = $(`btnSave${slot}`);
  if (!btn) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = slot === 'A' ? scenLabelA : scenLabelB;
  inp.maxLength = 30;
  inp.className = 'scen-label-edit';
  inp.setAttribute('aria-label', `Rename Scenario ${slot}`);
  btn.parentNode.insertBefore(inp, btn);
  btn.style.display = 'none';
  inp.focus();
  inp.select();
  function commit() {
    const val = inp.value.trim();
    if (slot === 'A') scenLabelA = val || 'Scenario A';
    else scenLabelB = val || 'Scenario B';
    inp.remove();
    btn.style.display = '';
    updateScenarioUI();
    if (scenarioA && scenarioB) renderComparison();
  }
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') inp.blur();
    if (e.key === 'Escape') { inp.remove(); btn.style.display = ''; }
  });
}

['A', 'B'].forEach(slot => {
  const btn = $(`btnSave${slot}`);
  if (!btn) return;
  let clickTimer = null;
  btn.addEventListener('click', () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      makeScenLabelEditable(slot);
    } else {
      clickTimer = setTimeout(() => { clickTimer = null; saveScenario(slot); }, 260);
    }
  });
});

// Interest rate slider ↔ number input sync (NTH 6)
const rateInput = $('interestRate');
const rateSlider = $('interestRateSlider');
if (rateInput && rateSlider) {
  rateInput.addEventListener('input', () => {
    const v = parseFloat(rateInput.value);
    if (!isNaN(v) && v >= 2 && v <= 12) rateSlider.value = v;
  });
  rateSlider.addEventListener('input', () => {
    rateInput.value = parseFloat(rateSlider.value).toFixed(3).replace(/\.?0+$/, '');
    const rc = document.getElementById('resultsContent');
    if (rc && rc.style.display !== 'none') calculate();
    else updateHints();
  });
}

// ---------- INIT ----------
populateStateDropdown();
// Apply the default state's benchmark on first load (prefills tax field
// since the user has not yet edited it).
onStateChange();
updateHints();
// Restore Basic/Advanced mode preference (defaults to Basic).
try {
  const savedMode = localStorage.getItem('hde-input-mode');
  setInputMode(savedMode === 'advanced' ? 'advanced' : 'basic');
} catch (e) {
  setInputMode('basic');
}
