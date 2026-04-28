// Test harness — replicates the engine logic from app/script.js exactly
// and runs scenarios to validate recommendations make sense.
//
// Run: node test-engine.js

'use strict';

// ---- Constants matching app/script.js ----
const PMI_RATES_BY_PROFILE = {
  '760+':     0.30,
  '740-759':  0.40,
  '700-739':  0.55,
  '660-699':  0.75,
  'below660': 1.00
};
const DEFAULT_PROFILE = '740-759';
const FHA_MIP_ANNUAL_PCT = 0.55;
const DEFAULT_INVEST_RETURN = 7;

// ---- Core financial functions ----
function calcMonthlyMortgage(principal, annualRate, years) {
  if (principal <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function calcPrincipalPaid(principal, annualRate, years, months) {
  if (principal <= 0) return 0;
  const monthlyPayment = calcMonthlyMortgage(principal, annualRate, years);
  let balance = principal;
  const r = annualRate / 100 / 12;
  for (let i = 0; i < months; i++) {
    if (r > 0) balance -= (monthlyPayment - balance * r);
    else balance -= monthlyPayment;
  }
  return principal - Math.max(balance, 0);
}

function calcMonthlyPMI(homePrice, downPct, profile) {
  if (downPct >= 20) return 0;
  const loan = homePrice * (1 - downPct / 100);
  if (loan <= 0) return 0;
  const annualPct = PMI_RATES_BY_PROFILE[profile] ?? PMI_RATES_BY_PROFILE[DEFAULT_PROFILE];
  return (loan * annualPct / 100) / 12;
}

function calcMonthlyFHAMIP(homePrice, downPct) {
  const loan = homePrice * (1 - downPct / 100);
  if (loan <= 0) return 0;
  return (loan * FHA_MIP_ANNUAL_PCT / 100) / 12;
}

function calcMonthlyMI(homePrice, downPct, profile, loanType) {
  if (loanType === 'FHA') return calcMonthlyFHAMIP(homePrice, downPct);
  if (loanType === 'VA') return 0;
  return calcMonthlyPMI(homePrice, downPct, profile);
}

function calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insuranceAnnual, maintPct, hoaMonthly, profile, loanType) {
  const loan = homePrice * (1 - downPct / 100);
  const mortgage = calcMonthlyMortgage(loan, rate, term);
  const mi = calcMonthlyMI(homePrice, downPct, profile, loanType);
  return mortgage + (homePrice * taxPct / 100 / 12) + (insuranceAnnual / 12) + (homePrice * maintPct / 100 / 12) + hoaMonthly + mi;
}

function calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct) {
  const v = Math.max(0, Math.min(100, vacancyPct || 0)) / 100;
  const e = Math.max(0, Math.min(100, expenseRatioPct || 0)) / 100;
  return Math.max(0, (rentalIncome || 0) * (1 - v) * (1 - e));
}

function calcCumulativeRent(monthlyRent, growthPct, years) {
  const totalMonths = Math.round(years * 12);
  let total = 0;
  for (let mo = 0; mo < totalMonths; mo++) {
    const yearIndex = Math.floor(mo / 12);
    total += monthlyRent * Math.pow(1 + growthPct / 100, yearIndex);
  }
  return total;
}

function calcInvestmentFV(monthlyContribution, annualReturn, years) {
  if (monthlyContribution <= 0 || years <= 0) return 0;
  const n = years * 12;
  if (annualReturn <= 0) return monthlyContribution * n;
  const r = annualReturn / 100 / 12;
  const fv = monthlyContribution * ((Math.pow(1 + r, n) - 1) / r);
  return isFinite(fv) ? fv : monthlyContribution * n;
}

function calcLumpSumFV(principal, annualReturn, years) {
  if (principal <= 0) return 0;
  if (years <= 0) return principal;
  return principal * Math.pow(1 + annualReturn / 100, years);
}

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

  const effRentalIncome = calcEffectiveRental(rentalIncome, vacancyPct, expenseRatioPct);
  const TRANSITION_MULT = 1.75;
  const moveOutMonth = (moveOutYear && moveOutYear > 0) ? moveOutYear * 12 : Infinity;

  const principalPaid = calcPrincipalPaid(loanAmount, rate, term, months);
  const homeValue = homePrice * Math.pow(1 + appreciationPct / 100, years);
  const appreciation = homeValue - homePrice;
  const sellingCosts = homeValue * (sellingCostsPct || 0) / 100;
  const equityGross = downPayment + principalPaid + appreciation;
  const equity = equityGross - sellingCosts;

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

  const buyNet = equity - cashToClose - cumulativeOwn;

  const cumulativeRent = calcCumulativeRent(rent, rentGrowthPct, years);
  const dpInvestmentValue = calcLumpSumFV(cashToClose, invReturn, years);
  const netMonthlyCostForSavings = Math.max(totalOwnership - effRentalIncome, 0);
  const monthlySavings = Math.max(netMonthlyCostForSavings - rent, 0);
  const savingsInvestmentValue = calcInvestmentFV(monthlySavings, invReturn, years);

  const dpGains = dpInvestmentValue - cashToClose;
  const savingsGains = savingsInvestmentValue - (monthlySavings * months);
  const investmentGains = dpGains + savingsGains;
  const rentNet = investmentGains - cumulativeRent;
  const wealthImpact = buyNet - rentNet;

  const safe = v => isFinite(v) && !isNaN(v) ? v : 0;
  return {
    equity: safe(equity), homeValue: safe(homeValue),
    downPayment: safe(downPayment), closingCosts: safe(closingCosts),
    cashToClose: safe(cashToClose),
    cumulativeOwn: safe(cumulativeOwn), cumulativeRent: safe(cumulativeRent),
    buyNet: safe(buyNet), rentNet: safe(rentNet), wealthImpact: safe(wealthImpact),
    totalOwnership: safe(totalOwnership), effRentalIncome: safe(effRentalIncome),
    investmentGains: safe(investmentGains),
    monthlySavings: safe(monthlySavings)
  };
}

function findBreakEven(params) {
  const impacts = [];
  for (let mo = 1; mo <= 120; mo++) impacts.push(calcBuyVsRentWealth(params, mo / 12).wealthImpact);
  if (impacts[impacts.length - 1] < 0) return { month: null, year: null, found: false };
  let lastNegative = -1;
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (impacts[i] < 0) { lastNegative = i; break; }
  }
  const mo = lastNegative + 2;
  const years = Math.round((mo / 12) * 10) / 10;
  return { month: mo, year: years, found: true };
}

// ---- Recommendation logic (mirrors makeDecision in script.js, simplified) ----
function makeDecision(params) {
  const h = params.timeHorizon || 5;
  const totalOwnership = calcTotalOwnership(params.homePrice, params.downPct, params.rate,
    params.term, params.taxPct, params.insuranceAnnual, params.maintPct, params.hoaMonthly,
    params.creditProfile, params.loanType);
  const effRentalIncome = calcEffectiveRental(params.rentalIncome, params.vacancyPct, params.expenseRatioPct);
  const netCost = Math.max(totalOwnership - effRentalIncome, 0);
  const rent = params.rent;
  const hasHouseHack = params.rentalIncome > 0;
  const breakEven = findBreakEven(params);
  const wealthH = calcBuyVsRentWealth(params, h);

  let type, horizon;
  if (hasHouseHack && netCost < rent && netCost < totalOwnership) {
    type = 'hack';
    horizon = 'Buy now — hold at least 3 years';
  } else if (totalOwnership < rent * 0.9) {
    type = 'buy-clear';
    horizon = 'Buy now — the math works from day one';
  } else if (totalOwnership < rent) {
    type = 'buy-slight';
    horizon = 'Buy within the next 12 months';
  } else if (totalOwnership <= rent * 1.15 && breakEven.found && breakEven.year <= 5) {
    type = 'buy-margin';
    horizon = `Buy if you'll stay ${Math.ceil(breakEven.year)}+ years`;
  } else if (breakEven.found && breakEven.year <= 3 && wealthH.wealthImpact > 0) {
    type = 'buy-fast-be';
    horizon = "Buy if you'll stay 3+ years";
  } else if (breakEven.found && breakEven.year <= 5 && wealthH.wealthImpact > 0) {
    type = 'buy-medium';
    horizon = `Buy if you'll stay ${Math.ceil(breakEven.year)}+ years`;
  } else if (breakEven.found && breakEven.year <= 7) {
    type = 'lean-rent';
    horizon = 'Rent for the next 1-2 years, then reassess';
  } else if (breakEven.found && breakEven.year <= 10) {
    type = 'rent-soft';
    horizon = 'Rent for the next 2-3 years, then reassess';
  } else {
    type = 'rent-firm';
    horizon = `Rent for the next ${h} years, then reassess`;
  }

  return {
    type, horizon,
    monthlyDiff: (hasHouseHack ? netCost : totalOwnership) - rent,
    totalOwnership, netCost, breakEven,
    wealthH
  };
}

// ---- Pretty printing ----
const fmt = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtSigned = n => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

function defaults() {
  return {
    homePrice: 350000, downPct: 10, rate: 6.75, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1, hoaMonthly: 0,
    rent: 2000, rentGrowthPct: 3, appreciationPct: 3,
    rentalIncome: 0, vacancyPct: 5, expenseRatioPct: 25,
    creditProfile: '740-759', loanType: 'Conventional',
    closingCostsPct: 3, sellingCostsPct: 6,
    investReturn: 7, moveOutYear: 0,
    timeHorizon: 5
  };
}

function runScenario(label, narrative, expected, overrides) {
  const params = Object.assign(defaults(), overrides);
  const d = makeDecision(params);
  const w = d.wealthH;

  console.log('='.repeat(80));
  console.log(`SCENARIO: ${label}`);
  console.log('-'.repeat(80));
  console.log(`Setup:    ${narrative}`);
  console.log(`Expected: ${expected}`);
  console.log();
  console.log(`Inputs:   $${params.homePrice.toLocaleString()} home, ${params.downPct}% down, ${params.rate}% / ${params.term}-yr ${params.loanType}`);
  console.log(`          Rent ${fmt(params.rent)}, horizon ${params.timeHorizon}y, appr ${params.appreciationPct}%, invest ${params.investReturn}%`);
  if (params.rentalIncome > 0) {
    console.log(`          Rental income ${fmt(params.rentalIncome)} (vac ${params.vacancyPct}%, exp ${params.expenseRatioPct}%)`);
  }
  console.log();
  console.log(`Monthly:  Total ownership ${fmt(d.totalOwnership)} | Rent ${fmt(params.rent)} | Diff ${fmtSigned(d.monthlyDiff)}/mo`);
  if (params.rentalIncome > 0) {
    console.log(`          Net (after eff. rental income): ${fmt(d.netCost)}`);
  }
  console.log(`Wealth:   At year ${params.timeHorizon}: Buy net ${fmt(w.buyNet)}, Rent net ${fmt(w.rentNet)}, Δ ${fmtSigned(w.wealthImpact)}`);
  console.log(`Break-even: ${d.breakEven.found ? `month ${d.breakEven.month} (~${d.breakEven.year}y)` : 'NOT within 10 years'}`);
  console.log();
  console.log(`>>> VERDICT TYPE: ${d.type.toUpperCase()}`);
  console.log(`>>> HORIZON CTA:  ${d.horizon}`);
  console.log();
}

// ============================================================
// SCENARIOS
// ============================================================

runScenario(
  '#1 — Cheap home + expensive rent (clear BUY)',
  'Modest home in moderate-cost area, current rent is well above ownership cost.',
  'BUY (clear). Total ownership should be ~30%+ below rent.',
  {
    homePrice: 250000, downPct: 20, rate: 6.5, term: 30,
    taxPct: 1.2, insuranceAnnual: 1500, maintPct: 1,
    rent: 2800, timeHorizon: 7
  }
);

runScenario(
  '#2 — Expensive home + cheap rent (clear RENT)',
  'High-cost area, big house, cheap rent. Classic rent-favored market.',
  'RENT (firm). Buying never overtakes renting+investing within 10 yrs.',
  {
    homePrice: 600000, downPct: 10, rate: 7.0, term: 30,
    taxPct: 1.2, insuranceAnnual: 2000, maintPct: 1, hoaMonthly: 0,
    rent: 2200, timeHorizon: 5
  }
);

runScenario(
  '#3 — The docx example: $400K, 10% down, 6.75%, 7y horizon',
  'The "Same Home, Two Questions" landing example.',
  'BUY — medium confidence. Monthly higher but break-even near year 5-6.',
  {
    homePrice: 400000, downPct: 10, rate: 6.75, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1,
    rent: 2200, timeHorizon: 7
  }
);

runScenario(
  '#4 — Same as #3 but short horizon (2 years)',
  'Buyer might relocate in 2 years. Closing + exit costs eat returns.',
  'RENT or LEAN-RENT — break-even won\'t hit in 2 years.',
  {
    homePrice: 400000, downPct: 10, rate: 6.75, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1,
    rent: 2200, timeHorizon: 2
  }
);

runScenario(
  '#5 — House hack duplex (rental income offsets cost)',
  'Buyer owner-occupies one unit, rents the other for $2,500/mo gross.',
  'HACK — net cost should drop below rent of comparable single-unit.',
  {
    homePrice: 500000, downPct: 20, rate: 7.0, term: 30,
    taxPct: 1.2, insuranceAnnual: 2400, maintPct: 1,
    rent: 2400, rentalIncome: 2500, vacancyPct: 5, expenseRatioPct: 25,
    timeHorizon: 7
  }
);

runScenario(
  '#6 — VA loan, 0% down (military buyer)',
  'No down payment, no monthly MI. Mid-cost market.',
  'Likely BUY-MARGIN or LEAN-RENT depending on monthly gap.',
  {
    homePrice: 300000, downPct: 0, rate: 6.5, term: 30,
    taxPct: 1.2, insuranceAnnual: 1500, maintPct: 1,
    loanType: 'VA',
    rent: 2000, timeHorizon: 5
  }
);

runScenario(
  '#7 — FHA, low credit, 3.5% down',
  'First-time buyer with limited cash and 660-699 credit.',
  'Higher MIP cost may push toward RENT or LEAN-RENT.',
  {
    homePrice: 280000, downPct: 3.5, rate: 7.25, term: 30,
    taxPct: 1.3, insuranceAnnual: 1500, maintPct: 1,
    loanType: 'FHA', creditProfile: '660-699',
    rent: 1800, timeHorizon: 5
  }
);

runScenario(
  '#8 — 20% down conventional, 700K home, HCOL',
  'Strong buyer, big down payment, but expensive market.',
  'Likely BUY-MARGIN or LEAN-RENT depending on rent comparable.',
  {
    homePrice: 700000, downPct: 20, rate: 6.5, term: 30,
    taxPct: 1.0, insuranceAnnual: 2400, maintPct: 1, hoaMonthly: 200,
    rent: 3500, timeHorizon: 7
  }
);

runScenario(
  '#9 — Edge case: 50% down, rich buyer',
  'Half cash down. Mortgage tiny. Equity build still subject to opportunity cost.',
  'Should still account for the lost investment returns on the $200K down.',
  {
    homePrice: 400000, downPct: 50, rate: 6.5, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1,
    rent: 2200, timeHorizon: 7
  }
);

runScenario(
  '#10 — High appreciation market (5%)',
  'Hot market — house grows at 5%/yr while stocks still 7%/yr.',
  'Faster equity build. Should tip more clearly toward BUY than the 3% case.',
  {
    homePrice: 400000, downPct: 10, rate: 6.75, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1,
    rent: 2200, appreciationPct: 5, timeHorizon: 7
  }
);

runScenario(
  '#11 — Falling/flat market (0% appreciation)',
  'House holds value but doesn\'t grow. Renter still earns 7% on investments.',
  'Should clearly favor RENT — the wealth-building engine on the buy side stalls.',
  {
    homePrice: 400000, downPct: 10, rate: 6.75, term: 30,
    taxPct: 1.2, insuranceAnnual: 1800, maintPct: 1,
    rent: 2200, appreciationPct: 0, timeHorizon: 7
  }
);

runScenario(
  '#12 — Rent vs Buy at PARITY (monthly cost matches)',
  'Carefully tuned scenario where ownership ≈ rent. Equity should tip it BUY.',
  'BUY-CLEAR or BUY-SLIGHT once equity factored in.',
  {
    // tuned roughly: $300K, 20% down, 6%, 30y → ~$1,440 P&I + ~$300 tax + $125 ins + $250 maint = ~$2,115
    homePrice: 300000, downPct: 20, rate: 6.0, term: 30,
    taxPct: 1.2, insuranceAnnual: 1500, maintPct: 1,
    rent: 2100, timeHorizon: 7
  }
);

console.log('='.repeat(80));
console.log('Done. 12 scenarios run.');
console.log('='.repeat(80));
