/* ===== HOUSING DECISION ENGINE v2 — DECISION ENGINE LOGIC ===== */

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
// VA: no monthly MI (VA funding fee is an upfront cost, not modeled here — note shown to user).
// Jumbo: monthly MI behavior varies by lender; use Conventional PMI as a reasonable default.
function calcMonthlyMI(homePrice, downPct, profile, loanType) {
  if (loanType === 'FHA') return calcMonthlyFHAMIP(homePrice, downPct);
  if (loanType === 'VA') return 0;
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
  if (loanType === 'VA') {
    benchEl.textContent = 'VA loans carry no monthly mortgage insurance (funding fee applies at closing).';
    return;
  }
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
  // Credit score rate advisory — includes an actionable "Apply" button that
  // bumps the interest rate input to a typical adjusted value for that tier.
  const rateNoteEl = $('creditRateNote');
  if (rateNoteEl) {
    const currentRate = parseFloat($('interestRate').value) || 6.75;
    // Tier bumps, roughly centered on industry LLPA guidance
    const bumps = { 'below660': 1.0, '660-699': 0.5, '700-739': 0.25, '740-759': 0, '760+': 0 };
    const bump = bumps[profile] || 0;
    if (bump > 0) {
      const suggested = Math.round((currentRate + bump) * 1000) / 1000;
      rateNoteEl.innerHTML =
        (profile === 'below660'
          ? '⚠ Credit below 660 may add ~0.5–1.5% to your rate. '
          : (profile === '660-699'
              ? '⚠ Credit in 660–699 range may add ~0.25–0.75% to your rate. '
              : 'Credit in 700–739 range may add ~0.125–0.375% to your rate. ')) +
        `<button type="button" class="btn-apply-suggestion" data-suggested="${suggested}">Apply suggested ${suggested.toFixed(3).replace(/\.?0+$/, '')}%</button>`;
      rateNoteEl.style.display = '';
      const applyBtn = rateNoteEl.querySelector('.btn-apply-suggestion');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          const v = parseFloat(applyBtn.getAttribute('data-suggested'));
          if (!isNaN(v)) {
            $('interestRate').value = v;
            const slider = $('interestRateSlider');
            if (slider && v >= 2 && v <= 12) slider.value = v;
            updateHints();
          }
        });
      }
    } else {
      rateNoteEl.style.display = 'none';
    }
  }
  // Auto-hide the Credit Score Range input when it doesn't influence PMI:
  //   - Conventional + DP >= 20%  → no PMI
  //   - VA                        → no monthly MI at all
  // FHA MIP and <20% Conventional PMI DO use the tier → keep it visible.
  const creditGroup = $('creditProfile') ? $('creditProfile').closest('.input-group') : null;
  if (creditGroup) {
    const pmiMatters = (loanType === 'Conventional' && dpPct < 20) || loanType === 'FHA';
    creditGroup.style.display = pmiMatters ? '' : 'none';
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
  if ($('rentalUnitsGroup')) $('rentalUnitsGroup').style.display = rental > 0 ? '' : 'none';
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
  } else if (t === 'VA') {
    bench.textContent = 'VA loans (for eligible veterans / active service members) require no down payment and no monthly mortgage insurance. Note: a one-time VA funding fee (~1.25–3.3% of the loan) applies at closing and is not modeled here — factor it into your closing cost estimate.';
  } else if (t === 'Jumbo') {
    bench.textContent = 'Jumbo loans exceed the conforming limit (~$766K in most counties). Terms vary widely by lender: expect higher rates, stricter credit/income underwriting, and sometimes larger down-payment requirements. Adjust your interest rate input to reflect typical jumbo pricing in your market.';
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
// CANONICAL COMPARISON — the SINGLE source of truth for the Decision
// Plan, the Net Wealth panel, the chart, break-even and sensitivity.
//
// Month-by-month simulation. Each month:
//   BUY side pays  P&I + mortgage insurance (until it drops off)
//                  + tax/insurance/maintenance/HOA (inflating yearly)
//                  − rental income from other units (grows with rent)
//                  + own rent elsewhere after a house-hack move-out
//   RENT side pays rent (grows yearly)
//   Whoever pays LESS that month invests the difference at the
//   investment return. The renter also invests the cash-to-close on day 0.
//
// Net position (both sides) = assets − all cash out
//   buyNet  = (home value − loan balance − selling costs) − cash to close
//             − cumulative net ownership cost + after-tax investment gains
//   rentNet = after-tax investment gains − cumulative rent
//   wealthImpact = buyNet − rentNet   (positive → buying is ahead)
// ----------------------------------------------------------------
const DEFAULT_COST_INFLATION = 3;   // %/yr on tax, insurance, maintenance, HOA
const DEFAULT_INVEST_TAX = 15;      // % tax on investment gains at exit (LTCG)
const FHA_MIP_MONTHS_10PCT_DOWN = 132; // 11 years when FHA down payment >= 10%

function calcBuyVsRentWealth(params, years) {
  const { homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly,
          rent, rentGrowthPct, appreciationPct, rentalIncome, creditProfile, loanType,
          closingCostsPct, sellingCostsPct, investReturn, moveOutYear,
          vacancyPct, expenseRatioPct, costInflationPct, investTaxPct, rentalUnits } = params;
  const downPayment = homePrice * downPct / 100;
  const closingCosts = homePrice * (closingCostsPct || 0) / 100;
  const cashToClose = downPayment + closingCosts;
  const loanAmount = homePrice - downPayment;
  const months = Math.max(0, Math.round(years * 12));
  const invReturn = (investReturn == null || isNaN(investReturn)) ? DEFAULT_INVEST_RETURN : investReturn;
  const rm = invReturn / 100 / 12;
  const infl = ((costInflationPct == null || isNaN(costInflationPct)) ? DEFAULT_COST_INFLATION : costInflationPct) / 100;
  const taxDrag = Math.max(0, Math.min(100, (investTaxPct == null || isNaN(investTaxPct)) ? DEFAULT_INVEST_TAX : investTaxPct)) / 100;
  const units = Math.max(1, Math.round(rentalUnits || 1));

  const monthlyPayment = calcMonthlyMortgage(loanAmount, rate, term);
  const r = rate / 100 / 12;
  const miMonthly0 = calcMonthlyMI(homePrice, downPct, creditProfile, loanType);
  const fhaLifeOfLoan = loanType === 'FHA' && downPct < 10;
  const carry0 = homePrice * taxPct / 100 / 12 + insuranceAnnual / 12 + homePrice * maintPct / 100 / 12 + hoaMonthly;
  const totalOwnership = monthlyPayment + miMonthly0 + carry0; // month-1 cost (headline figure)

  const effRental0 = calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct);
  const moveOutMonth = (moveOutYear && moveOutYear > 0) ? moveOutYear * 12 : Infinity;
  // After move-out the owner's own unit is rented too. Proxy: it rents like the
  // average of the other units (gross rental income ÷ number of rented units).
  const ownerUnitEff = rentalIncome > 0 ? calcEffectiveRental(rentalIncome / units, vacancyPct, expenseRatioPct) : 0;

  let balance = loanAmount;
  let cumulativeOwn = 0, cumulativeRent = 0, cumulativeRentalIncome = 0, cumulativeOwnerRent = 0;
  let renterPortfolio = cashToClose, renterContrib = cashToClose;
  let buyerPortfolio = 0, buyerContrib = 0;
  let miDropMonth = null, totalMI = 0, totalInterest = 0;

  for (let mo = 0; mo < months; mo++) {
    const yr = Math.floor(mo / 12);
    const inflF = Math.pow(1 + infl, yr);
    const rentF = Math.pow(1 + rentGrowthPct / 100, yr);

    // Portfolios earn a month of return on the opening balance
    renterPortfolio *= (1 + rm);
    buyerPortfolio *= (1 + rm);

    // Mortgage payment (stops once the loan is paid off)
    let pi = 0;
    if (balance > 0.005) {
      const interest = balance * r;
      const principal = Math.min(monthlyPayment - interest, balance);
      balance -= principal;
      pi = interest + principal;
      totalInterest += interest;
    }

    // Mortgage insurance: conventional drops at 80% LTV of purchase price;
    // FHA lasts 11 years (>=10% down) or the life of the loan (<10% down).
    let mi = 0;
    if (miMonthly0 > 0) {
      const dropped = loanType === 'FHA'
        ? (!fhaLifeOfLoan && mo >= FHA_MIP_MONTHS_10PCT_DOWN)
        : (balance / homePrice <= 0.80);
      if (!dropped) { mi = miMonthly0; totalMI += mi; }
      else if (miDropMonth == null) miDropMonth = mo + 1;
    }

    const ownGross = pi + mi + carry0 * inflF;
    const rentNow = rent * rentF;

    // Rental income (other units), plus own unit after move-out — at which point
    // the owner also pays rent somewhere, just like the renter does.
    let rentalNow = effRental0 * rentF;
    let ownerRent = 0;
    if (rentalIncome > 0 && mo >= moveOutMonth) {
      rentalNow += ownerUnitEff * rentF;
      ownerRent = rentNow;
    }
    cumulativeRentalIncome += rentalNow;
    cumulativeOwnerRent += ownerRent;

    const buyCash = ownGross - rentalNow + ownerRent; // may be negative = positive cash flow
    cumulativeOwn += buyCash;
    cumulativeRent += rentNow;

    // Invest the difference — whichever path is cheaper this month
    const diff = buyCash - rentNow;
    if (diff > 0) { renterPortfolio += diff; renterContrib += diff; }
    else if (diff < 0) { buyerPortfolio += -diff; buyerContrib += -diff; }
  }

  // Buy side at exit
  const homeValue = homePrice * Math.pow(1 + appreciationPct / 100, months / 12);
  const appreciation = homeValue - homePrice;
  const principalPaid = loanAmount - balance;
  const sellingCosts = homeValue * (sellingCostsPct || 0) / 100;
  const equityGross = homeValue - balance;          // = downPayment + principalPaid + appreciation
  const equity = equityGross - sellingCosts;
  const buyerGainsPre = buyerPortfolio - buyerContrib;
  const buyerGains = buyerGainsPre * (1 - taxDrag);
  const buyNet = equity - cashToClose - cumulativeOwn + buyerGains;

  // Rent side at exit
  const renterGainsPre = renterPortfolio - renterContrib;
  const investTax = renterGainsPre * taxDrag;
  const investmentGains = renterGainsPre - investTax;
  const dpGainsPre = cashToClose * (Math.pow(1 + rm, months) - 1);
  const savingsGainsPre = Math.max(0, renterGainsPre - dpGainsPre);
  const rentNet = investmentGains - cumulativeRent;

  const wealthImpact = buyNet - rentNet;
  const monthlySavings = Math.max(totalOwnership - effRental0 - rent, 0);

  function safe(v) { return isFinite(v) && !isNaN(v) ? v : 0; }
  return {
    equity: safe(equity), equityGross: safe(equityGross), appreciation: safe(appreciation),
    principalPaid: safe(principalPaid), loanBalance: safe(balance),
    sellingCosts: safe(sellingCosts), homeValue: safe(homeValue),
    downPayment: safe(downPayment), closingCosts: safe(closingCosts),
    cashToClose: safe(cashToClose), cumulativeOwn: safe(cumulativeOwn),
    cumulativeRent: safe(cumulativeRent), cumulativeRentalIncome: safe(cumulativeRentalIncome),
    cumulativeOwnerRent: safe(cumulativeOwnerRent),
    buyNet: safe(buyNet), rentNet: safe(rentNet), wealthImpact: safe(wealthImpact),
    totalOwnership: safe(totalOwnership), effRentalIncome: safe(effRental0),
    investmentGains: safe(investmentGains), investTax: safe(investTax),
    dpGains: safe(dpGainsPre), savingsGains: safe(savingsGainsPre), // pre-tax; investTax is shown as its own line
    buyerGains: safe(buyerGains), buyerContrib: safe(buyerContrib),
    monthlySavings: safe(monthlySavings), totalInvestmentValue: safe(renterPortfolio),
    miDropMonth, totalMI: safe(totalMI), totalInterest: safe(totalInterest),
  };
}

// ---------- BREAK-EVEN ANALYSIS ----------
// Scans every month out to max(10 years, the user's horizon). Break-even is the
// month AFTER the last month in which renting was ahead, so it is sustained
// through the end of the scan (the curve can be non-monotonic early on).
function breakEvenScanMonths(params) {
  const h = Math.max(1, params.timeHorizon || 5);
  return Math.min(480, Math.max(120, Math.round(h * 12)));
}

function findBreakEven(params) {
  const scanMonths = breakEvenScanMonths(params);
  const scanYears = scanMonths / 12;
  const impacts = [];
  for (let mo = 1; mo <= scanMonths; mo++) {
    impacts.push(calcBuyVsRentWealth(params, mo / 12).wealthImpact);
  }
  if (impacts[impacts.length - 1] < 0) {
    return { month: null, year: null, found: false, scanMonths, scanYears };
  }
  let lastNegative = -1;
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (impacts[i] < 0) { lastNegative = i; break; }
  }
  const mo = lastNegative + 2; // 1-indexed month after the last negative sample
  const years = Math.round((mo / 12) * 10) / 10;
  return { month: mo, year: years, found: true, scanMonths, scanYears };
}

// ---------- LONG-HORIZON REVERSAL ANALYSIS ----------
// In some scenarios (notably house-hack with move-out, long horizons, and
// modest appreciation), the buy advantage CROSSES POSITIVE around the
// break-even point, peaks somewhere mid-horizon, then crosses NEGATIVE again
// before the user's horizon ends — because the renter's investment portfolio
// (compounding at 7%) eventually outpaces home appreciation (typically 3%).
//
// This function detects that "double crossover" and returns the peak-advantage
// month + the month when buy falls back behind rent. The Decision Plan and
// Break-Even panel can use this to surface a "wealth-maximizing sell window"
// callout, so the user understands that buying-then-holding-forever isn't
// always the optimal play.
//
// Returns { hasReversal: false } when buy stays ahead through horizon, or
// when buy never overtakes rent in the first place. Otherwise returns
// detailed reversal info.
function findReversal(params) {
  const horizonYears = Math.max(1, params.timeHorizon || 5);
  // Scan up to the user's horizon, capped at 30 years for compute safety.
  const scanMonths = Math.min(360, Math.round(horizonYears * 12));
  if (scanMonths < 24) return { hasReversal: false }; // too short to be meaningful

  let peakMonth = 0;
  let peakImpact = -Infinity;
  let lastPositiveMonth = 0;
  let firstPositiveMonth = 0;

  for (let mo = 1; mo <= scanMonths; mo++) {
    const w = calcBuyVsRentWealth(params, mo / 12);
    if (w.wealthImpact > peakImpact) {
      peakImpact = w.wealthImpact;
      peakMonth = mo;
    }
    if (w.wealthImpact >= 0) {
      lastPositiveMonth = mo;
      if (firstPositiveMonth === 0) firstPositiveMonth = mo;
    }
  }

  const finalW = calcBuyVsRentWealth(params, scanMonths / 12);

  // Reversal only meaningful if buy actually went ahead AND ended behind.
  const hasReversal =
    peakImpact > 0 &&
    finalW.wealthImpact < 0 &&
    lastPositiveMonth > 0 &&
    lastPositiveMonth < scanMonths;

  if (!hasReversal) return { hasReversal: false };

  return {
    hasReversal: true,
    firstCrossMonth: firstPositiveMonth,
    firstCrossYear: Math.round((firstPositiveMonth / 12) * 10) / 10,
    peakMonth,
    peakYear: Math.round((peakMonth / 12) * 10) / 10,
    peakImpact,
    reversalMonth: lastPositiveMonth + 1,
    reversalYear: Math.round(((lastPositiveMonth + 1) / 12) * 10) / 10,
    finalImpact: finalW.wealthImpact,
    finalYear: scanMonths / 12
  };
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
// Where does the RECOMMENDATION flip? We search for the input value at which
// the wealth impact at the user's horizon crosses zero. (Monthly-cost parity is
// reported separately as context — in expensive markets it often never happens,
// which is not the same thing as "never buy".)
function wealthAt(params, overrides) {
  const p = Object.assign({}, params, overrides);
  return calcBuyVsRentWealth(p, Math.max(1 / 12, p.timeHorizon || 5)).wealthImpact;
}

// Bisection on `key` between lo and hi for wealthImpact = 0. Assumes wealth
// impact is monotonic in the key over the range (true for rate; true for price
// unless appreciation wildly exceeds the cost of capital).
function findWealthThreshold(params, key, lo, hi) {
  const wLo = wealthAt(params, { [key]: lo });
  const wHi = wealthAt(params, { [key]: hi });
  if ((wLo >= 0) === (wHi >= 0)) return null; // no crossing in range
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const w = wealthAt(params, { [key]: mid });
    if ((w >= 0) === (wLo >= 0)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function findRateThreshold(params) {
  const buyWinsNow = wealthAt(params, {}) >= 0;
  const monthlyNow = calcTotalOwnership(params.homePrice, params.downPct, params.rate,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType)
    - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
  const buyingIsCheaper = monthlyNow <= params.rent;
  // Monthly parity rate (context only)
  let parityRate = null;
  const atZero = calcTotalOwnership(params.homePrice, params.downPct, 0,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType)
    - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
  if (atZero <= params.rent) {
    let lo = 0, hi = 20;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const own = calcTotalOwnership(params.homePrice, params.downPct, mid,
        params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly, params.creditProfile, params.loanType)
        - calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
      if (own <= params.rent) lo = mid; else hi = mid;
    }
    parityRate = Math.round((lo + hi) / 2 * 100) / 100;
  }
  const t = findWealthThreshold(params, 'rate', 0, 20);
  if (t == null) {
    return { threshold: null, noThreshold: true, buyWinsNow, buyingIsCheaper, parityRate,
             zeroNetCost: Math.round(atZero), zeroGap: Math.round(atZero - params.rent) };
  }
  return { threshold: Math.round(t * 100) / 100, noThreshold: false, buyWinsNow, buyingIsCheaper, parityRate,
           zeroNetCost: Math.round(atZero), zeroGap: Math.round(atZero - params.rent) };
}

function findPriceThreshold(params) {
  const buyWinsNow = wealthAt(params, {}) >= 0;
  const t = findWealthThreshold(params, 'homePrice', params.homePrice * 0.25, params.homePrice * 3);
  if (t == null) return { threshold: null, noThreshold: true, buyWinsNow };
  return { threshold: Math.round(t / 1000) * 1000, noThreshold: false, buyWinsNow };
}

// ---------- CONFIDENCE SCORING ----------
// How robust is the call to reasonable changes in the inputs? 0–100 → High/Medium/Low.
function calcConfidence(decision, breakEven, rateThreshold, priceThreshold, params) {
  let score = 50;
  const isBuyRec = (decision.type === 'buy' || decision.type === 'hack');
  const wi = decision.wealth5.wealthImpact;
  const h = Math.max(1, params.timeHorizon || 5);

  // 1. Size of the wealth gap relative to the home price
  const rel = Math.abs(wi) / Math.max(1, params.homePrice);
  if (rel > 0.10) score += 18;
  else if (rel > 0.05) score += 10;
  else if (rel > 0.025) score += 3;
  else if (rel > 0.01) score -= 8;
  else score -= 18;

  // 2. Rate cushion — distance from the rate at which the call flips
  if (!rateThreshold.noThreshold && rateThreshold.threshold != null) {
    const dist = Math.abs(params.rate - rateThreshold.threshold);
    if (dist > 1.5) score += 12;
    else if (dist > 0.75) score += 6;
    else if (dist > 0.35) score -= 2;
    else score -= 10;
  } else {
    score += 8; // no rate within 0–20% flips it — very robust to rates
  }

  // 3. Price cushion
  if (!priceThreshold.noThreshold && priceThreshold.threshold != null) {
    const dist = Math.abs(params.homePrice - priceThreshold.threshold) / params.homePrice;
    if (dist > 0.15) score += 8;
    else if (dist > 0.08) score += 4;
    else if (dist > 0.04) score -= 2;
    else score -= 8;
  } else {
    score += 4;
  }

  // 4. Break-even vs horizon
  if (isBuyRec) {
    if (breakEven.found && breakEven.month <= 1) score += 8;
    else if (breakEven.found && (h - breakEven.year) >= 3) score += 8;
    else if (breakEven.found && (h - breakEven.year) >= 1) score += 3;
    else score -= 8;
  } else {
    if (!breakEven.found) score += 10;
    else if ((breakEven.year - h) >= 3) score += 8;
    else if ((breakEven.year - h) >= 1) score += 3;
    else score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  let level, label, explanation;
  if (score >= 62) {
    level = 'high'; label = 'High';
    explanation = 'The numbers clearly favor this path across multiple assumptions.';
  } else if (score >= 42) {
    level = 'medium'; label = 'Medium';
    explanation = 'The recommendation holds, but small changes in rates, prices, or how long you stay could shift the outcome.';
  } else {
    level = 'low'; label = 'Low';
    explanation = 'This is a close call — the two paths are nearly equivalent financially.';
  }
  return { score, level, label, explanation };
}

// ---------- RECOMMENDATION ENGINE ----------
// The wealth impact at the USER'S horizon is the primary driver. Monthly cost
// and break-even timing shape the wording and the "your move" line; they never
// override the wealth result.
function generateDecision(params, totalOwnership, netCost, equityHorizon, breakEven) {
  const { rent, rentalIncome, homePrice, rate, investReturn } = params;
  const invReturn = investReturn || DEFAULT_INVEST_RETURN;
  const h = params.timeHorizon || 5;
  const yrs = `${h} year${h === 1 ? '' : 's'}`;
  const downPayment = homePrice * params.downPct / 100;
  const cashToClose = downPayment + homePrice * (params.closingCostsPct || 0) / 100;
  const hasHouseHack = rentalIncome > 0;
  const effectiveCost = hasHouseHack ? netCost : totalOwnership;
  const monthlyDiff = effectiveCost - rent; // Positive = buying costs more per month
  const annualDiff = monthlyDiff * 12;
  const wealth5 = calcBuyVsRentWealth(params, h); // snapshot at the user's horizon
  const wi = wealth5.wealthImpact;
  const wiAbs = Math.abs(wi);
  const equityNet = wealth5.equity;
  const costLabel = hasHouseHack ? `${fmt(effectiveCost)}/mo after rental income` : `${fmt(effectiveCost)}/mo`;
  const beLabel = breakEven.found ? fmtBreakEven(breakEven) : null;
  const minStay = breakEven.found ? Math.max(1, Math.ceil(breakEven.year)) : null;
  const closeCall = wiAbs < Math.max(5000, 0.015 * homePrice);
  const scanYrs = Math.round(breakEven.scanYears || 10);

  let verdict, reason, action, type, horizon;

  if (wi >= 0) {
    // ---- BUYING IS AHEAD AT THE HORIZON ----
    type = hasHouseHack ? 'hack' : 'buy';
    const dayOne = breakEven.found && breakEven.month <= 1;

    if (monthlyDiff <= 0) {
      horizon = dayOne ? 'Buy now — ahead from day one' : `Buy — the math works if you stay ${minStay}+ years`;
      verdict = hasHouseHack
        ? 'House hacking makes this a strong buy — cheaper than renting and ahead on wealth.'
        : 'Buying is financially favorable under your current assumptions.';
      reason = `${hasHouseHack ? 'After rental income, owning' : 'Owning'} costs ${costLabel} — ${fmt(-monthlyDiff)} less than renting at ${fmt(rent)}/mo. ` +
        `On top of that, you'd build ~${fmt(equityNet)} in equity (net of selling costs) over ${yrs}. ` +
        `Even after a renter invests the ${fmt(cashToClose)} cash-to-close at ${invReturn}%, buying finishes ~${fmt(wiAbs)} ahead.`;
    } else if (closeCall) {
      horizon = `Lean buy — only if you'll stay ${minStay}+ years`;
      verdict = 'Buying edges out renting on total wealth, but it\'s close.';
      reason = `You'd pay ${fmt(monthlyDiff)}/mo more to own (${costLabel} vs ${fmt(rent)} rent). ` +
        `Equity and appreciation claw that back by ${beLabel}, leaving buying only ~${fmt(wiAbs)} ahead after ${yrs}. ` +
        `A small change in rate, price, or how long you stay could flip this.`;
    } else {
      horizon = dayOne ? 'Buy — ahead from day one' : `Buy if you'll stay ${minStay}+ years`;
      verdict = 'Buying costs more monthly, but the wealth-building makes up for it.';
      reason = `You'd pay ${fmt(monthlyDiff)}/mo more than renting (${costLabel} vs ${fmt(rent)}). ` +
        `By ${beLabel}, buying overtakes renting in total wealth — even with the renter investing the difference at ${invReturn}%. ` +
        `After ${yrs}, buying puts you ~${fmt(wiAbs)} ahead. The monthly premium is forced savings into an appreciating asset.`;
    }

    if (hasHouseHack) {
      action = `Next steps: (1) Verify the rental income with local comps and a property manager — be conservative by 10–15%. ` +
        `(2) Set aside 2–3 months of gross rent as a vacancy and repair reserve. ` +
        `(3) Get pre-approved at or below ${rate}%; ask the lender how much rental income they'll count toward qualifying (typically 75%). ` +
        (breakEven.found && breakEven.month > 1 ? `(4) Plan to hold at least ${minStay} years — selling before ${beLabel} hands the lead back to renting.` : `(4) This is one of the strongest wealth-building positions in real estate — the numbers hold from day one.`);
    } else if (monthlyDiff <= 0) {
      action = `Next steps: (1) Get pre-approved at or below ${rate}%. (2) Target properties at or below ${fmt(homePrice)}. ` +
        `(3) Keep ${fmt(Math.round(totalOwnership * 4))} in reserves (3–6 months of housing costs) after closing. ` +
        (breakEven.found && breakEven.month > 1 ? `(4) Selling costs mean you still need to stay past ${beLabel} for buying to win.` : `(4) The numbers support buying at these terms.`);
    } else {
      action = `Next steps: (1) Be honest about how long you'll stay — buying only wins if you hold past ${beLabel}. ` +
        `(2) Budget for the extra ${fmt(monthlyDiff)}/mo versus renting. ` +
        `(3) Get pre-approved soon — each 0.25% of rate moves the break-even. ` +
        `(4) If there's a real chance you'd move within ${minStay} years, renting preserves flexibility and avoids closing and selling costs.`;
    }
  } else if (monthlyDiff <= 0) {
    // ---- CHEAPER MONTHLY, BUT BEHIND ON WEALTH (large down payment / weak appreciation) ----
    const decisive = wiAbs >= 0.05 * homePrice;
    type = decisive ? 'rent' : 'lean-rent';
    horizon = breakEven.found ? `${decisive ? 'Rent' : 'Lean rent'} — buy only if you'll stay ${minStay}+ years` : `${decisive ? 'Rent' : 'Lean rent'} — your cash earns more invested`;
    verdict = decisive
      ? 'Buying is cheaper monthly, but renting + investing wins clearly on total wealth.'
      : 'Buying is cheaper monthly, but renting + investing wins on total wealth.';
    reason = `${hasHouseHack ? 'After rental income, owning' : 'Owning'} costs ${costLabel} — less than ${fmt(rent)} rent. ` +
      `But the ${fmt(cashToClose)} you'd tie up at closing earns more invested at ${invReturn}% than the home returns after selling costs, ` +
      `so after ${yrs} you'd be ~${fmt(wiAbs)} behind by buying` +
      (breakEven.found ? `. Buying only pulls ahead if you stay past ${beLabel}.` : `, and it doesn't catch up within ${scanYrs} years.`);
    action = `Next steps: (1) If you value a lower monthly payment and stability over total wealth, buying still works — just know the trade. ` +
      `(2) To maximize wealth, invest the ${fmt(cashToClose)} and keep renting. ` +
      `(3) Re-run with a smaller down payment (keeps more cash invested) or a longer horizon to see what tips it back to buying.`;
  } else if (closeCall || (breakEven.found && breakEven.year <= h + 2)) {
    // ---- CLOSE CALL: renting is ahead at the horizon, but not by much / break-even is near ----
    type = 'lean-rent';
    horizon = breakEven.found ? `Rent unless you'll stay ${minStay}+ years` : 'Lean rent — reassess in 12 months';
    verdict = breakEven.found
      ? `It's a close call — buying wins only if you stay past ${beLabel}.`
      : 'It\'s a close call — lean toward renting and investing.';
    reason = `Buying costs ${fmt(monthlyDiff)}/mo more (${costLabel} vs ${fmt(rent)} rent). ` +
      (breakEven.found
        ? `Buying overtakes renting at ${beLabel} — ${(breakEven.year - h).toFixed(1)} year${breakEven.year - h === 1 ? '' : 's'} past your ${yrs} plan. `
        : `Buying doesn't catch up within ${scanYrs} years under these inputs. `) +
      `If you sell on schedule, renting and investing leaves you ~${fmt(wiAbs)} ahead. If you're confident you'll stay longer, buying builds wealth.`;
    action = `Next steps: (1) Decide how long you'll really stay — that's the whole decision here. ` +
      `(2) If renting, auto-invest the ${fmt(monthlyDiff)}/mo difference and the ${fmt(cashToClose)} you'd have spent at closing. ` +
      `(3) A lower price, a rate drop of ~0.5%, or a longer stay would tip this toward buying — re-run before you sign either way.`;
  } else if (breakEven.found) {
    // ---- RENT: buying eventually wins, but far beyond the user's plan ----
    type = 'rent';
    horizon = 'Rent for now — reassess in 12–18 months';
    const investValue = calcInvestmentFV(monthlyDiff, invReturn, h);
    verdict = 'Renting and investing the difference is the stronger financial move for now.';
    reason = `Buying would cost ${fmt(monthlyDiff)}/mo more — ${fmt(annualDiff)} per year. ` +
      `It doesn't overtake renting until ${beLabel}, well past your ${yrs} plan, so you'd finish ~${fmt(wiAbs)} behind. ` +
      `Investing the ${fmt(monthlyDiff)}/mo difference at ${invReturn}% would grow to ~${fmt(investValue)} over ${yrs} — a concrete alternative to home equity.`;
    action = `Next steps: (1) Invest your ${fmt(cashToClose)} in a diversified index fund. ` +
      `(2) Set up automatic monthly investments of ${fmt(monthlyDiff)}. ` +
      `(3) Re-run this in 12 months — rates, prices, and your horizon can all shift. ` +
      `(4) If your plans firm up to ${minStay}+ years, buying starts to make sense.`;
  } else {
    // ---- RENT: buying never catches up in the scan window ----
    type = 'rent';
    horizon = 'Rent for now — reassess in 12–18 months';
    const investValue = calcInvestmentFV(monthlyDiff, invReturn, h);
    verdict = 'Renting and investing is clearly the stronger financial path right now.';
    reason = `At ${costLabel} vs ${fmt(rent)}/mo rent, buying would cost you ${fmt(annualDiff)} more per year, ` +
      `and it never overtakes renting-and-investing within ${scanYrs} years under these inputs — after ${yrs} you'd be ~${fmt(wiAbs)} behind. ` +
      `Investing ${fmt(monthlyDiff)}/mo at ${invReturn}% would grow to ~${fmt(investValue)} over ${yrs}.`;
    const rt = findRateThreshold(params);
    const pt = findPriceThreshold(params);
    const levers = [];
    if (!rt.noThreshold && rt.threshold != null && rt.threshold < rate) levers.push(`rates near ${rt.threshold}%`);
    if (!pt.noThreshold && pt.threshold != null && pt.threshold < homePrice) levers.push(`a price around ${fmt(pt.threshold)}`);
    action = `Next steps: (1) Invest the ${fmt(cashToClose)} you'd spend at closing in a diversified index fund today. ` +
      `(2) Auto-invest the ${fmt(monthlyDiff)}/mo premium you're avoiding. ` +
      (levers.length
        ? `(3) The call flips at ${levers.join(' or ')} — watch for those, or look at ${hasHouseHack ? 'higher rental income' : 'multi-family properties with rental income'}. `
        : `(3) At this price-to-rent ratio, even large rate drops don't fix it — look at lower-priced homes or ${hasHouseHack ? 'higher rental income' : 'multi-family properties with rental income'}. `) +
      `(4) Reassess in 12–18 months.`;
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

  // Generate year-by-year data (Year 0 → max(10, horizon)) using the canonical formula
  const maxYr = Math.max(10, Math.ceil(params.timeHorizon || 5));
  const years = [];
  for (let yr = 0; yr <= maxYr; yr++) {
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

  function xPos(yr) { return pad.left + (yr / maxYr) * chartW; }
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
  const labelEvery = maxYr > 20 ? 5 : (maxYr > 12 ? 2 : 1);
  for (let yr = 0; yr <= maxYr; yr++) {
    const x = xPos(yr);
    if (yr % labelEvery === 0 || yr === maxYr) ctx.fillText('Yr ' + yr, x, H - pad.bottom + 20);
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
  ctx.lineTo(xPos(maxYr), yPos(years[maxYr].rentNet));
  for (let i = maxYr; i >= 0; i--) {
    ctx.lineTo(xPos(years[i].yr), yPos(years[i].rentNet));
  }
  ctx.closePath();
  // Fill green where buy > rent, red where rent > buy (simplified: single fill based on endpoint)
  const endDiff = years[maxYr].diff;
  ctx.fillStyle = endDiff >= 0 ? 'rgba(22,128,61,0.06)' : 'rgba(59,130,246,0.06)';
  ctx.fill();

  drawLine(years, 'rentNet', '#3b82f6');
  drawLine(years, 'buyNet', '#16803d');

  // Dots at Year 5 and the last year
  [5, maxYr].forEach(yr => {
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
  if (breakEven.found && breakEven.year <= maxYr) {
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
  if (moveOutYr > 0 && moveOutYr <= maxYr && params.rentalIncome > 0) {
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
  const y10 = years[maxYr];
  const diffClass5 = y5.diff >= 0 ? 'pos' : 'neg';
  const diffClass10 = y10.diff >= 0 ? 'pos' : 'neg';
  callouts.innerHTML =
    `<span class="chart-callout"><span class="cc-label">Year 5:</span> <span class="cc-value ${diffClass5}">${fmtSigned(y5.diff)}</span></span>` +
    `<span class="chart-callout"><span class="cc-label">Year ${maxYr}:</span> <span class="cc-value ${diffClass10}">${fmtSigned(y10.diff)}</span></span>`;

  // Insight text
  const insight = $('chartInsight');
  const parts = [];
  if (breakEven.found && breakEven.year <= maxYr) {
    if (breakEven.month <= 6) {
      parts.push('Buying pulls ahead almost immediately and the gap widens every year.');
    } else if (breakEven.month <= 12) {
      parts.push(`Buying overtakes renting at month ${breakEven.month}. If you sell before then, renting would have been the better financial outcome.`);
    } else {
      parts.push(`Buying overtakes renting at year ${breakEven.year}. If you sell before then, renting would have been the better financial outcome.`);
    }
  } else {
    parts.push(`Renting and investing the difference stays ahead for the full ${maxYr}-year window under these assumptions.`);
  }
  if (y10.diff >= 0) {
    parts.push(`By year ${maxYr}, buying puts you ~${fmt(y10.diff)} ahead of renting.`);
  } else {
    parts.push(`By year ${maxYr}, renting still keeps you ~${fmt(Math.abs(y10.diff))} ahead.`);
  }
  insight.textContent = parts.join(' ');

  // Store chart state for tooltip access
  chartState = { years, xPos, yPos, pad, W, H, maxYr };
}

// ---------- CHART TOOLTIP ----------

(function initChartTooltip() {
  const canvas = $('wealthChart');
  const tooltip = $('chartTooltip');
  const crosshair = $('chartCrosshair');

  canvas.addEventListener('mousemove', function(e) {
    if (!chartState) return;
    const { years, xPos, pad, W, maxYr } = chartState;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Find nearest year
    let nearest = 0;
    let minDist = Infinity;
    for (let yr = 0; yr <= maxYr; yr++) {
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
    timeHorizon: Math.max(1, Math.round(num('timeHorizon')) || 5),
    moveOutYear: Math.min(parseInt($('moveOutYear').value) || 0, num('timeHorizon') || 5),
    annualIncome: num('annualIncome'),
    monthlyDebt: num('monthlyDebt'),
    costInflationPct: $('costInflationPct') ? num('costInflationPct') : DEFAULT_COST_INFLATION,
    investTaxPct: $('investTaxPct') ? num('investTaxPct') : DEFAULT_INVEST_TAX,
    rentalUnits: $('rentalUnits') ? Math.max(1, num('rentalUnits') || 1) : 1,
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
  const horizonSim = calcBuyVsRentWealth(params, timeHorizon);
  const totalOwnHorizon = horizonSim.cumulativeOwn;   // net of rental income, incl. inflation + MI drop-off
  const homeValueHorizon = horizonSim.homeValue;
  const equityHorizon = horizonSim.equityGross;

  // Advanced analyses
  const breakEven = findBreakEven(params);
  const reversal = findReversal(params);
  const rateThreshold = findRateThreshold(params);
  const priceThreshold = findPriceThreshold(params);
  const decision = generateDecision(params, totalOwnership, netCost, equityHorizon, breakEven);

  // ---------- UPDATE UI ----------

  $('resultsPlaceholder').style.display = 'none';
  $('resultsContent').style.display = 'block';


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
  dp.className = 'decision-plan';
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
  if ($('dpReason')) $('dpReason').textContent = decision.reason;
  $('dpAction').textContent = decision.action;

  // Time horizon — prefix with "Your move:" so the actionable recommendation reads clearly
  $('dpHorizon').innerHTML = `<span class="dp-horizon-prefix">Your move:</span> <span class="dp-horizon-text">${decision.horizon}</span>`;

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
  // === TIPPING-POINT DIAL ===
  // Needle angle ranges from -90° (full left = Rent strongly) to +90° (full right = Buy strongly).
  // Linear scale: $50K delta = full deflection. Small deltas visibly lean; genuine ties stay center.
  (function renderTippingDial() {
    const needle = $('tippingDialNeedle');
    const cap = $('tippingDialCaption');
    if (!needle || !cap) return;
    const wi = decision.wealth5.wealthImpact;
    const sign = wi >= 0 ? 1 : -1;
    const absWi = Math.abs(wi);
    const SCALE_MAX = 50000; // $50K wealth delta = full 90° deflection
    const norm = Math.min(1, absWi / SCALE_MAX);
    const angle = sign * norm * 90;
    // Use CSS custom property so the transition interpolates reliably across browsers.
    needle.style.setProperty('--needle-angle', angle.toFixed(2) + 'deg');
    needle.setAttribute('transform', `rotate(${angle.toFixed(2)} 100 100)`);
    // Caption
    const absFmt = fmt(absWi);
    let verdict, strength;
    if (absWi < 3000) { strength = 'Dead-even tipping point'; }
    else if (absWi < 15000) { strength = wi >= 0 ? 'Leans buy' : 'Leans rent'; }
    else if (absWi < 60000) { strength = wi >= 0 ? 'Buy is favored' : 'Rent is favored'; }
    else { strength = wi >= 0 ? 'Buy strongly wins' : 'Rent strongly wins'; }
    verdict = `${strength} — ${wi >= 0 ? 'buy' : 'rent'} is ahead by ${absFmt} over ${timeHorizon} year${timeHorizon === 1 ? '' : 's'}`;
    if (absWi < 3000) verdict = `Dead-even tipping point — the two paths are within ${absFmt} of each other over ${timeHorizon} year${timeHorizon === 1 ? '' : 's'}. Small input changes could flip the call.`;
    cap.textContent = verdict;
  })();

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
  if ($('dpAssumption')) $('dpAssumption').textContent = `Analysis assumes renters invest savings at ${investReturn}% annual return`;

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
    if ($('bdPMILabel')) {
      $('bdPMILabel').textContent = (loanType === 'FHA') ? 'FHA MIP'
        : (loanType === 'VA') ? 'VA MI'
        : 'PMI';
    }
  } else {
    $('bdPMIRow').style.display = 'none';
  }
  $('bdTotal').textContent = fmt(totalOwnership);

  if (rentalIncome > 0) {
    $('bdRentalRow').style.display = '';
    $('bdNetRow').style.display = '';
    $('bdRental').textContent = '-' + fmt(effRentalIncome);
    if ($('bdRentalLabel')) $('bdRentalLabel').textContent = `Rental income (after ${vacancyPct}% vacancy, ${expenseRatioPct}% costs)`;
    $('bdNet').textContent = fmt(netCost);
  } else {
    $('bdRentalRow').style.display = 'none';
    $('bdNetRow').style.display = 'none';
  }

  // Out-of-pocket card only earns its place when rental income changes the number
  if ($('kpiNetCard')) $('kpiNetCard').style.display = rentalIncome > 0 ? '' : 'none';

  // Plain-English headline: the delta between the two bars, stated once.
  // Prefer the house-hack figure when rental income offsets ownership cost.
  const headline = $('monthlyDeltaHeadline');
  if (headline) {
    const effectiveBuy = rentalIncome > 0 ? netCost : totalOwnership;
    const delta = effectiveBuy - rent;
    const absDelta = Math.abs(delta);
    const noun = rentalIncome > 0 ? 'Owning (after rental income)' : 'Owning';
    if (absDelta < 25) {
      headline.textContent = `${noun} and renting cost about the same each month (within ${fmt(absDelta)}).`;
      headline.className = 'monthly-delta-headline even';
    } else if (delta > 0) {
      headline.textContent = `${noun} costs ${fmt(absDelta)}/mo more than renting.`;
      headline.className = 'monthly-delta-headline neg';
    } else {
      headline.textContent = `${noun} costs ${fmt(absDelta)}/mo less than renting.`;
      headline.className = 'monthly-delta-headline pos';
    }
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
  $('wBuyCost').textContent = (w5.cumulativeOwn >= 0 ? '-' : '+') + fmt(Math.abs(w5.cumulativeOwn));
  if ($('wBuySavingsRow')) {
    if (w5.buyerGains > 0.5) {
      $('wBuySavingsRow').style.display = '';
      $('wBuySavingsGains').textContent = '+' + fmt(w5.buyerGains);
    } else {
      $('wBuySavingsRow').style.display = 'none';
    }
  }
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
  if ($('wRentTaxRow')) {
    if (w5.investTax > 0.5) {
      $('wRentTaxRow').style.display = '';
      $('wRentTax').textContent = '-' + fmt(w5.investTax);
      if ($('wRentTaxLabel')) $('wRentTaxLabel').textContent = `Tax on investment gains (${params.investTaxPct}%)`;
    } else {
      $('wRentTaxRow').style.display = 'none';
    }
  }
  $('wRentCost').textContent = '-' + fmt(w5.cumulativeRent);
  $('wRentNet').textContent = fmtSigned(w5.rentNet);
  $('wRentNet').className = w5.rentNet >= 0 ? 'wealth-pos' : 'wealth-neg';
  $('wRentReturnNote').textContent = `Assumes ${investReturn}% annual return; gains taxed at ${params.investTaxPct}% at exit. Both sides invest whatever they save each month.`;

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

  const beBarMax = Math.max(10, Math.ceil(breakEven.scanYears || 10));
  if ($('beBarMid')) $('beBarMid').textContent = `Year ${Math.round(beBarMax / 2)}`;
  if ($('beBarEnd')) $('beBarEnd').textContent = `Year ${beBarMax}`;
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
      const pct = Math.min(breakEven.year / beBarMax * 100, 100);
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
    $('beTimeline').innerHTML = `<span class="be-never">Buying does not break even within ${beBarMax} years.</span>`;
    $('beBarFill').style.width = '100%';
    $('beBarFill').classList.add('be-bar-never');
    $('beBarMarker').style.display = 'none';
    $('beDetail').textContent = `Under these assumptions, renting and investing stays ahead for the full ${beBarMax}-year window.`;
  }

  // Time horizon vs break-even warning
  const horizonWarn = $('beHorizonWarn');
  if (breakEven.found && breakEven.year > timeHorizon) {
    horizonWarn.style.display = '';
    horizonWarn.textContent = `⚠ You may not reach break-even within your expected ${timeHorizon}-year timeframe. Break-even is at year ${breakEven.year}, which is ${(breakEven.year - timeHorizon).toFixed(1)} years beyond your plan.`;
  } else if (!breakEven.found) {
    horizonWarn.style.display = '';
    horizonWarn.textContent = `⚠ Break-even is not reached within ${beBarMax} years — beyond your ${timeHorizon}-year plan.`;
  } else {
    horizonWarn.style.display = 'none';
  }

  // House hack transition insight
  const transInsight = $('transitionInsight');
  if (moveOutYear > 0 && rentalIncome > 0) {
    transInsight.style.display = '';
    const postRental = rentalIncome + rentalIncome / params.rentalUnits;
    transInsight.textContent = `After year ${moveOutYear}, your unit is rented too (~${fmt(postRental)}/mo gross across ${params.rentalUnits + 1} units, before vacancy and costs) — and you pay ${fmt(rent)}/mo rent elsewhere, growing with rent growth. Both effects are in the wealth math.`;
  } else {
    transInsight.style.display = 'none';
  }

  // Long-horizon REVERSAL callout — buying overtakes rent, peaks, then falls
  // back behind because the renter's investment portfolio compounds faster
  // than home appreciation. Only shown when this actually happens within the
  // user's horizon — otherwise hidden.
  const reversalEl = $('beReversal');
  if (reversalEl) {
    if (reversal.hasReversal) {
      reversalEl.style.display = '';
      const sellWindowStart = Math.max(1, Math.floor(reversal.peakYear));
      const sellWindowEnd = Math.max(sellWindowStart, Math.ceil(reversal.reversalYear) - 1);
      const finalDirection = reversal.finalImpact < 0
        ? `rent is ahead by ~${fmt(-reversal.finalImpact)}`
        : `buy is ahead by ~${fmt(reversal.finalImpact)}`;
      $('beReversalHeadline').textContent =
        `Buying's lead peaks around year ${reversal.peakYear} at ~${fmt(reversal.peakImpact)}, then reverses.`;
      $('beReversalBody').textContent =
        `After year ${reversal.reversalYear}, the renter's compounding investment portfolio (at ${investReturn}%/yr) overtakes home appreciation (at ${appreciationPct}%/yr). ` +
        `By year ${Math.round(reversal.finalYear)}, ${finalDirection}.`;
      $('beReversalAction').textContent =
        sellWindowEnd > sellWindowStart
          ? `If you have flexibility on when to sell, your wealth-maximizing window is roughly years ${sellWindowStart}–${sellWindowEnd}. After that, the renter-and-invest path catches back up.`
          : `Your wealth-maximizing point is around year ${sellWindowStart}. Holding longer than that hands the lead back to renting and investing.`;
    } else {
      reversalEl.style.display = 'none';
    }
  }

  // === SENSITIVITY ANALYSIS === (where the recommendation itself flips)
  const buyWins = decision.wealth5.wealthImpact >= 0;
  const rateCard = $('sensRateCard');
  rateCard.classList.remove('sens-structural');
  $('sensRateIcon').textContent = '📉';
  $('sensRateTitle').textContent = 'Interest Rate Tipping Point';
  const parityNote = rateThreshold.parityRate == null
    ? ` Monthly cost never matches rent at any rate — at 0% you'd still pay ${fmt(rateThreshold.zeroNetCost != null ? rateThreshold.zeroNetCost : totalOwnership)}/mo.`
    : ` (Monthly cost alone matches rent at ${rateThreshold.parityRate}%.)`;
  if (rateThreshold.noThreshold) {
    $('sensRate').textContent = buyWins ? 'Any rate' : 'No rate helps';
    $('sensRateDetail').textContent = buyWins
      ? `Buying stays ahead over ${timeHorizon} years at any rate from 0–20%. The equity and appreciation math dominates the interest cost.` + parityNote
      : `No rate between 0% and 20% makes buying win over ${timeHorizon} years. The price-to-rent ratio, closing and selling costs are the problem — not the rate.` + parityNote;
    if (!buyWins) { rateCard.classList.add('sens-structural'); $('sensRateIcon').textContent = '🚫'; }
  } else if (buyWins) {
    $('sensRate').textContent = rateThreshold.threshold + '%';
    $('sensRateDetail').textContent = `Buying stays ahead over ${timeHorizon} years at rates up to ${rateThreshold.threshold}%. You have ${(rateThreshold.threshold - rate).toFixed(2)}% of cushion above today's ${rate}%.` + parityNote;
  } else {
    $('sensRate').textContent = rateThreshold.threshold + '%';
    $('sensRateDetail').textContent = `At ${rateThreshold.threshold}% or below, buying would come out ahead over ${timeHorizon} years — a ${(rate - rateThreshold.threshold).toFixed(2)}% drop from today's ${rate}%.` + parityNote;
  }

  const priceCard = $('sensPriceCard');
  priceCard.classList.remove('sens-structural');
  $('sensPriceIcon').textContent = '🏷️';
  $('sensPriceTitle').textContent = 'Home Price Tipping Point';
  if (priceThreshold.noThreshold) {
    $('sensPrice').textContent = buyWins ? 'Any price' : 'No price helps';
    $('sensPriceDetail').textContent = buyWins
      ? `Buying stays ahead across the whole price range tested (25%–300% of your price).`
      : `Even at a quarter of the price, buying doesn't win over ${timeHorizon} years — the horizon is too short for appreciation to cover closing and selling costs.`;
  } else if (buyWins) {
    $('sensPrice').textContent = fmt(priceThreshold.threshold);
    $('sensPriceDetail').textContent = `Buying works at prices up to ~${fmt(priceThreshold.threshold)} — ${fmt(priceThreshold.threshold - homePrice)} (${Math.round((priceThreshold.threshold / homePrice - 1) * 100)}%) above your target.`;
  } else {
    $('sensPrice').textContent = fmt(priceThreshold.threshold);
    $('sensPriceDetail').textContent = `The price would need to be ~${fmt(priceThreshold.threshold)} for buying to win over ${timeHorizon} years — a ${Math.round((1 - priceThreshold.threshold / homePrice) * 100)}% drop from ${fmt(homePrice)}.`;
  }

  const sensParts = [];
  if (!rateThreshold.noThreshold) {
    const d = Math.abs(rate - rateThreshold.threshold).toFixed(1);
    if (buyWins) {
      if (d > 1.5) sensParts.push(`You have a comfortable ${d}% rate cushion — even a sizable rate rise won't flip the call.`);
      else if (d > 0.75) sensParts.push(`You have ${d}% of rate cushion — a moderate rate rise still keeps buying ahead.`);
      else sensParts.push(`Your rate cushion is thin at ${d}% — a small rate rise could flip this to renting.`);
    } else {
      if (d > 2) sensParts.push(`Rates would need to fall ${d}% — a large move that's unlikely in the near term.`);
      else if (d > 0.75) sensParts.push(`A ${d}% rate drop would flip this to buying — plausible over 12–24 months.`);
      else sensParts.push(`You're only ${d}% from the rate tipping point — a modest rate drop changes the recommendation.`);
    }
  } else {
    sensParts.push(buyWins ? 'The recommendation is not sensitive to the interest rate.' : 'No realistic rate fixes this — the price-to-rent ratio is the issue.');
  }
  if (!priceThreshold.noThreshold) {
    const pd = Math.round(Math.abs(1 - priceThreshold.threshold / homePrice) * 100);
    if (buyWins) {
      if (pd > 15) sensParts.push(`You have ${pd}% of price headroom — buying works even at meaningfully higher prices.`);
      else if (pd > 5) sensParts.push(`You have ${pd}% of price headroom — don't overbid past ~${fmt(priceThreshold.threshold)}.`);
      else sensParts.push(`You're within ${pd}% of the price tipping point — overpaying even slightly flips this.`);
    } else {
      if (pd > 20) sensParts.push(`A ${pd}% price correction is needed — that's a major market shift.`);
      else if (pd > 8) sensParts.push(`A ${pd}% lower price would tip the balance — worth negotiating hard or waiting for softening.`);
      else sensParts.push(`You're within ${pd}% of the price tipping point — negotiating the price down could change the outcome.`);
    }
  }
  $('sensSummary').textContent = sensParts.join(' ');

  // === HORIZON OUTLOOK ===
  // === AFFORDABILITY / DTI ===
  renderAffordability(params, totalOwnership - monthlyMaint);

  // === WEALTH DATA TABLE ===
  renderChartDataTable(params);

  // === METHODOLOGY PANEL ("How This Decision Is Calculated") ===
  renderMethodology(params, totalOwnership, decision.wealth5);

  if ($('ol5Rent')) { $('ol5Rent').textContent = fmt(totalRentHorizon); $('ol5Own').textContent = fmt(totalOwnHorizon); $('ol5Equity').textContent = fmt(equityHorizon); $('ol5Value').textContent = fmt(homeValueHorizon); }

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
    ['sellingCostsPct', 'Exit Costs at Sale cannot be negative.'],
    ['vacancyPct', 'Vacancy Rate cannot be negative.'],
    ['expenseRatioPct', 'Operating Costs cannot be negative.'],
    ['costInflationPct', 'Cost inflation cannot be negative.'],
    ['investTaxPct', 'Tax on investment gains cannot be negative.'],
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
  if (th < 1) {
    markInvalid(thEl, 'Time horizon must be at least 1 year — a buy-vs-rent comparison needs time for equity and appreciation to matter.');
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

  // Interest rate upper bound (hard sanity cap)
  const irEl = $('interestRate');
  if (irEl) {
    const irV = parseFloat(irEl.value);
    if (!isNaN(irV) && irV > 20) markInvalid(irEl, 'Interest Rate above 20% is unrealistic — please double-check.');
  }

  // Loan term upper bound
  const ltEl = $('loanTerm');
  if (ltEl) {
    const ltV = parseFloat(ltEl.value);
    if (!isNaN(ltV) && ltV > 50) markInvalid(ltEl, 'Loan term above 50 years is not supported.');
  }

  // Affordability inputs: if entered (non-empty), must be positive
  const aiEl = $('annualIncome');
  if (aiEl && aiEl.value !== '' && aiEl.value != null) {
    const aiV = parseFloat(aiEl.value);
    if (isNaN(aiV) || aiV <= 0) markInvalid(aiEl, 'Annual Income must be greater than 0 (or leave blank).');
    else clearInvalid(aiEl);
  }
  const mdEl = $('monthlyDebt');
  if (mdEl && mdEl.value !== '' && mdEl.value != null) {
    const mdV = parseFloat(mdEl.value);
    if (isNaN(mdV) || mdV < 0) markInvalid(mdEl, 'Monthly Debt cannot be negative (or leave blank).');
    else clearInvalid(mdEl);
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
  const rentalCredit = (params.rentalIncome || 0) * 0.75; // lenders typically count 75% of gross rent
  const monthlyIncome = income / 12 + rentalCredit;
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
    `(${fmt(totalOwnership)} PITI + HOA + MI, excluding maintenance` + ` + ${fmt(debt)} existing debts) ÷ ${fmt(monthlyIncome)}/mo gross income` +
    (rentalCredit > 0 ? ` (includes 75% of rental income, ${fmt(rentalCredit)})` : '');
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
  const snapshots = [];
  for (let yr = 0; yr <= maxYr; yr++) {
    const w = calcBuyVsRentWealth(params, yr);
    const diffClass = w.wealthImpact >= 0 ? 'pos' : 'neg';
    html += `<tr><td>${yr}</td><td>${fmt(w.buyNet)}</td><td>${fmt(w.rentNet)}</td><td class="${diffClass}">${fmtSigned(w.wealthImpact)}</td></tr>`;
    snapshots.push(w);
  }
  body.innerHTML = html;
  // Screen-reader summary of the chart (non-visual users can't see the canvas)
  const sr = $('chartSrSummary');
  if (sr) {
    const y0 = snapshots[0], y5 = snapshots[5] || snapshots[snapshots.length-1], yEnd = snapshots[snapshots.length-1];
    sr.textContent = `Wealth-over-time chart summary. ` +
      `Buy net position starts at ${fmt(y0.buyNet)} in year 0, reaches ${fmt(y5.buyNet)} at year 5, and ${fmt(yEnd.buyNet)} at year ${maxYr}. ` +
      `Rent net position starts at ${fmt(y0.rentNet)}, reaches ${fmt(y5.rentNet)} at year 5, and ${fmt(yEnd.rentNet)} at year ${maxYr}. ` +
      `Wealth impact at year ${maxYr}: ${fmtSigned(yEnd.wealthImpact)}.`;
  }
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
  $('methInvest').textContent = `+${fmt(w5.investmentGains)} renter investment gains over ${yrLabel} at ${invR}% (after ${params.investTaxPct}% tax)` + (w5.buyerGains > 0.5 ? `; buyer invests too: +${fmt(w5.buyerGains)}` : '');
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
  btn.setAttribute('aria-expanded', hidden ? 'true' : 'false');
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
    timeInsight = `Buying never overtakes renting within ${Math.round(breakEven.scanYears || 10)} years under these inputs, so ${[8,11,18].includes(horizon)?'an':'a'} ${horizon}-year commitment can't recover the upfront and selling costs.`;
  }

  // 3. RISK & SENSITIVITY — what would have to move to flip the call.
  let riskNote;
  if (confidence.level === 'high') {
    riskNote = `High confidence: the answer holds under meaningful rate and price moves — see the tipping points below for the exact cushion.`;
  } else if (confidence.level === 'medium') {
    riskNote = `Moderate confidence: a realistic rate or price move — or staying a year or two longer or shorter — could flip this. Check the tipping points below before you commit.`;
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
  ['costInflationPct', 'costInflationPct'],
  ['investTaxPct', 'investTaxPct'],
  ['rentalUnits', 'rentalUnits'],
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

// ── Shareable-link encoding ─────────────────────────────────────────────────
// Build a URL that captures the current form state in query params, so a
// recipient opening the link sees the same analysis. No auth, no backend —
// all inputs round-trip through the URL.
function buildShareLink() {
  const params = new URLSearchParams();
  params.set('share', '1');
  SCENARIO_INPUT_MAP.forEach(([inputId, paramKey]) => {
    const el = $(inputId);
    if (!el) return;
    const v = (el.value || '').toString().trim();
    if (v === '') return;
    params.set(paramKey, v);
  });
  const mo = $('moveOutYear');
  if (mo && mo.value !== '' && mo.value != null) params.set('moveOutYear', mo.value);
  const base = window.location.origin + window.location.pathname;
  return base + '?' + params.toString();
}

function copyShareLink() {
  const url = buildShareLink();
  const toast = $('shareAnalysisToast');
  const done = function () {
    if (!toast) return;
    toast.hidden = false;
    setTimeout(function () { toast.hidden = true; }, 2200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(function () {
      // Fallback: create a temporary textarea
      copyViaTextarea(url); done();
    });
  } else {
    copyViaTextarea(url); done();
  }
}

function copyViaTextarea(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (_) { /* ignore */ }
}

// Read query params (?share=1&homePrice=...) on page load and prefill inputs
// if present. Returns true if any share param was applied (caller may choose
// to auto-run the analysis).
function applyShareLinkParamsFromUrl() {
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('share') !== '1') return false;
    let applied = false;
    SCENARIO_INPUT_MAP.forEach(([inputId, paramKey]) => {
      const raw = qs.get(paramKey);
      if (raw === null || raw === '') return;
      const el = $(inputId);
      if (!el) return;
      el.value = raw;
      applied = true;
    });
    const mo = qs.get('moveOutYear');
    if (mo !== null && mo !== '' && $('moveOutYear')) {
      $('moveOutYear').value = mo;
      applied = true;
    }
    if (applied) {
      // Sync interest rate slider + skip state-based tax prefill
      const rate = qs.get('rate');
      const rateSlider = $('interestRateSlider');
      if (rateSlider && rate !== null) {
        const v = parseFloat(rate);
        if (!isNaN(v) && v >= 2 && v <= 12) rateSlider.value = v;
      }
      if (qs.get('taxPct') !== null) userEditedPropertyTax = true;
    }
    return applied;
  } catch (_) { return false; }
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
  // Confirm before wiping user inputs — prevents accidental destruction of a
  // mid-analysis scenario. Native confirm() is adequate; skipped if nothing
  // has been meaningfully changed from defaults (no results computed yet).
  const resultsVisible = $('resultsContent') && $('resultsContent').style.display !== 'none';
  if (resultsVisible) {
    const ok = window.confirm(
      'Reset all inputs to defaults?\n\nYour current analysis, saved scenarios, and any changes you\u2019ve made will be cleared. This cannot be undone.'
    );
    if (!ok) return;
  }
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

// ---------- FAQ HELP DRAWER ----------
// Accessible side-panel with plain-English explainers. Trap Escape key for dismiss.
function toggleFaqDrawer(force) {
  const drawer = $('faqDrawer');
  const backdrop = $('faqBackdrop');
  const fab = $('faqFab');
  if (!drawer || !backdrop || !fab) return;
  const willOpen = (typeof force === 'boolean') ? force : drawer.hasAttribute('hidden');
  if (willOpen) {
    drawer.hidden = false;
    backdrop.hidden = false;
    // Next frame so the transition fires
    requestAnimationFrame(() => {
      drawer.classList.add('faq-open');
      backdrop.classList.add('faq-open');
    });
    drawer.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');
    const closeBtn = drawer.querySelector('.faq-drawer-close');
    if (closeBtn) closeBtn.focus();
  } else {
    drawer.classList.remove('faq-open');
    backdrop.classList.remove('faq-open');
    drawer.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-expanded', 'false');
    // Hide after the CSS transition completes (~220ms)
    setTimeout(() => {
      if (!drawer.classList.contains('faq-open')) {
        drawer.hidden = true;
        backdrop.hidden = true;
      }
    }, 240);
    fab.focus();
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const d = $('faqDrawer');
    if (d && d.classList.contains('faq-open')) toggleFaqDrawer(false);
  }
});

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

// Apply shareable-link params if present (?share=1&homePrice=...). If any
// share params were set, auto-run the analysis so the recipient lands on
// results immediately. Share links ignore any stale state and re-populate
// inputs from the URL.
if (applyShareLinkParamsFromUrl()) {
  updateHints();
  // Defer calculate() so all initialization settles first
  setTimeout(function () {
    try { calculate(); } catch (err) { console.warn('[HDE] auto-calculate from share link failed:', err); }
  }, 50);
}
