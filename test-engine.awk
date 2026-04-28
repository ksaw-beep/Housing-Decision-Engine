# Test harness — replicates app/script.js engine logic in awk
# Run: awk -f test-engine.awk

function pow(base, expt) {
  # Use exp(ln(base) * exp) — works for any real exponent
  if (base <= 0) return 0
  return exp(log(base) * expt)
}

function calcMonthlyMortgage(principal, annualRate, years,    r, n, p) {
  if (principal <= 0) return 0
  if (annualRate <= 0) return principal / (years * 12)
  r = annualRate / 100 / 12
  n = years * 12
  p = pow(1 + r, n)
  return principal * (r * p) / (p - 1)
}

function calcPrincipalPaid(principal, annualRate, years, months,    M, balance, r, i) {
  if (principal <= 0) return 0
  M = calcMonthlyMortgage(principal, annualRate, years)
  balance = principal
  r = annualRate / 100 / 12
  for (i = 0; i < months; i++) {
    if (r > 0) balance -= (M - balance * r)
    else balance -= M
  }
  return principal - (balance > 0 ? balance : 0)
}

function pmiRate(profile) {
  if (profile == "760+")     return 0.30
  if (profile == "740-759")  return 0.40
  if (profile == "700-739")  return 0.55
  if (profile == "660-699")  return 0.75
  if (profile == "below660") return 1.00
  return 0.40
}

function calcMonthlyMI(homePrice, downPct, profile, loanType,    loan) {
  loan = homePrice * (1 - downPct/100)
  if (loan <= 0) return 0
  if (loanType == "FHA") return (loan * 0.55 / 100) / 12
  if (loanType == "VA")  return 0
  if (downPct >= 20) return 0
  return (loan * pmiRate(profile) / 100) / 12
}

function calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa, profile, loanType,    loan, mortgage, mi) {
  loan = homePrice * (1 - downPct/100)
  mortgage = calcMonthlyMortgage(loan, rate, term)
  mi = calcMonthlyMI(homePrice, downPct, profile, loanType)
  return mortgage + (homePrice * taxPct/100/12) + (insAnnual/12) + (homePrice * maintPct/100/12) + hoa + mi
}

function calcEffectiveRental(rentalIncome, vacPct, expPct,    v, e) {
  v = vacPct < 0 ? 0 : (vacPct > 100 ? 100 : vacPct); v = v/100
  e = expPct < 0 ? 0 : (expPct > 100 ? 100 : expPct); e = e/100
  if (rentalIncome < 0) return 0
  return rentalIncome * (1 - v) * (1 - e)
}

function calcCumulativeRent(monthlyRent, growthPct, years,    total, mo, yr, totalMonths) {
  totalMonths = int(years * 12 + 0.5)
  total = 0
  for (mo = 0; mo < totalMonths; mo++) {
    yr = int(mo / 12)
    total += monthlyRent * pow(1 + growthPct/100, yr)
  }
  return total
}

function calcInvestmentFV(monthly, annualReturn, years,    n, r) {
  if (monthly <= 0 || years <= 0) return 0
  n = years * 12
  if (annualReturn <= 0) return monthly * n
  r = annualReturn / 100 / 12
  return monthly * (pow(1 + r, n) - 1) / r
}

function calcLumpSumFV(principal, annualReturn, years) {
  if (principal <= 0) return 0
  if (years <= 0) return principal
  return principal * pow(1 + annualReturn/100, years)
}

# ---- Wealth comparison engine ----
# Sets globals: out_buyNet, out_rentNet, out_wealthImpact, out_totalOwnership, out_netCost, out_cumulativeOwn, out_cumulativeRent
function calcBuyVsRentWealth(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                              rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                              ccPct, scPct, invReturn, moveOut, vacPct, expPct, years,
                              dp, cc, cashClose, loan, totalOwn, eff, months, princPaid, homeVal,
                              appreciation, sellingCosts, equity, cumOwn, mo, rentalNow, netMonthly,
                              buyNet, cumRent, dpFV, savings, savingsFV, dpGains, savGains, gains, rentNet) {
  dp = homePrice * downPct/100
  cc = homePrice * (ccPct ? ccPct : 0) / 100
  cashClose = dp + cc
  loan = homePrice - dp
  totalOwn = calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa, profile, loanType)
  eff = calcEffectiveRental(rentalIncome, vacPct, expPct)
  months = int(years * 12 + 0.5)

  princPaid = calcPrincipalPaid(loan, rate, term, months)
  homeVal = homePrice * pow(1 + apprPct/100, years)
  appreciation = homeVal - homePrice
  sellingCosts = homeVal * (scPct ? scPct : 0) / 100
  equity = dp + princPaid + appreciation - sellingCosts

  cumOwn = 0
  if (moveOut > 0 && eff > 0) {
    for (mo = 0; mo < months; mo++) {
      rentalNow = (mo >= moveOut*12) ? eff * 1.75 : eff
      netMonthly = totalOwn - rentalNow
      if (netMonthly < 0) netMonthly = 0
      cumOwn += netMonthly
    }
  } else {
    netMonthly = totalOwn - eff
    if (netMonthly < 0) netMonthly = 0
    cumOwn = netMonthly * months
  }
  buyNet = equity - cashClose - cumOwn

  cumRent = calcCumulativeRent(rent, rentGrow, years)
  dpFV = calcLumpSumFV(cashClose, invReturn, years)
  savings = totalOwn - eff - rent
  if (savings < 0) savings = 0
  savingsFV = calcInvestmentFV(savings, invReturn, years)
  dpGains = dpFV - cashClose
  savGains = savingsFV - (savings * months)
  gains = dpGains + savGains
  rentNet = gains - cumRent

  out_buyNet = buyNet
  out_rentNet = rentNet
  out_wealthImpact = buyNet - rentNet
  out_totalOwnership = totalOwn
  out_netCost = (totalOwn - eff < 0 ? 0 : totalOwn - eff)
  out_cumulativeOwn = cumOwn
  out_cumulativeRent = cumRent
  out_effRental = eff
  out_equity = equity
  out_homeValue = homeVal
}

# ---- Break-even ----
# Sets out_be_found (0/1), out_be_month, out_be_year
function findBreakEven(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                       rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                       ccPct, scPct, invReturn, moveOut, vacPct, expPct,
                       impacts, mo, lastNeg, i, finalImpact) {
  for (mo = 1; mo <= 120; mo++) {
    calcBuyVsRentWealth(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                        rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                        ccPct, scPct, invReturn, moveOut, vacPct, expPct, mo/12)
    impacts[mo] = out_wealthImpact
  }
  finalImpact = impacts[120]
  if (finalImpact < 0) {
    out_be_found = 0; out_be_month = 0; out_be_year = 0
    return
  }
  lastNeg = 0
  for (i = 120; i >= 1; i--) {
    if (impacts[i] < 0) { lastNeg = i; break }
  }
  out_be_found = 1
  out_be_month = lastNeg + 1
  out_be_year = int((out_be_month / 12) * 10 + 0.5) / 10
}

function fmt(n,    sign, val) {
  sign = n < 0 ? "-" : ""
  val = n < 0 ? -n : n
  val = int(val + 0.5)
  return sign "$" commafy(val)
}
function fmtSigned(n,    sign, val) {
  sign = n >= 0 ? "+" : "-"
  val = n < 0 ? -n : n
  val = int(val + 0.5)
  return sign "$" commafy(val)
}
function commafy(n,    s, out, i, len) {
  s = sprintf("%d", n)
  len = length(s)
  out = ""
  for (i = 1; i <= len; i++) {
    out = out substr(s, i, 1)
    if ((len - i) % 3 == 0 && i < len) out = out ","
  }
  return out
}

function decision(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                  rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                  ccPct, scPct, invReturn, moveOut, vacPct, expPct, horizon,
                  totalOwn, eff, netCost, hasHack, type, hor, monDiff) {
  totalOwn = calcTotalOwnership(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa, profile, loanType)
  eff = calcEffectiveRental(rentalIncome, vacPct, expPct)
  netCost = totalOwn - eff
  if (netCost < 0) netCost = 0
  hasHack = rentalIncome > 0

  findBreakEven(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                ccPct, scPct, invReturn, moveOut, vacPct, expPct)

  calcBuyVsRentWealth(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                      rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                      ccPct, scPct, invReturn, moveOut, vacPct, expPct, horizon)
  d_buyNet = out_buyNet
  d_rentNet = out_rentNet
  d_wealthImpact = out_wealthImpact
  d_totalOwn = totalOwn
  d_netCost = netCost
  d_hasHack = hasHack
  d_be_found = out_be_found
  d_be_month = out_be_month
  d_be_year = out_be_year

  if (hasHack && netCost < rent && netCost < totalOwn) {
    type = "HACK"
    hor = "Buy now — hold at least 3 years"
  } else if (totalOwn < rent * 0.9) {
    type = "BUY-CLEAR"
    hor = "Buy now — math works from day one"
  } else if (totalOwn < rent && d_wealthImpact < -10000) {
    type = "LEAN-RENT-WEALTH"
    hor = "Lean rent — money does more invested than tied up in equity"
  } else if (totalOwn < rent) {
    type = "BUY-SLIGHT"
    hor = "Buy within next 12 months"
  } else if (totalOwn <= rent * 1.15 && d_be_found && d_be_year <= 5) {
    type = "BUY-MARGIN"
    hor = sprintf("Buy if you'll stay %d+ years", int(d_be_year + 0.999))
  } else if (d_be_found && d_be_year <= 3 && d_wealthImpact > 0) {
    type = "BUY-FAST-BE"
    hor = "Buy if you'll stay 3+ years"
  } else if (d_be_found && d_wealthImpact > 0 && (d_be_year <= 5 || (d_be_year <= 7 && d_be_year <= horizon - 1))) {
    type = "BUY-MEDIUM"
    hor = sprintf("Buy if you'll stay %d+ years", int(d_be_year + 0.999))
  } else if (d_be_found && d_be_year <= 7) {
    type = "LEAN-RENT"
    hor = "Rent for the next 1-2 years, then reassess"
  } else if (d_be_found && d_be_year <= 10) {
    type = "RENT-SOFT"
    hor = "Rent for next 2-3 years, then reassess"
  } else {
    type = "RENT-FIRM"
    hor = sprintf("Rent for next %d years, then reassess", horizon)
  }

  monDiff = (hasHack ? netCost : totalOwn) - rent
  d_type = type
  d_horizon = hor
  d_monDiff = monDiff
}

# ---- REVERSAL DETECTION (mirrors findReversal in app/script.js) ----
function checkReversal(label, homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                       rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                       ccPct, scPct, invReturn, moveOut, vacPct, expPct, horizon,
                       scanMonths, mo, peakMo, peakImp, lastPos, firstPos, finalImp, hasRev) {
  scanMonths = horizon * 12
  if (scanMonths > 360) scanMonths = 360
  if (scanMonths < 24) {
    printf "%-50s %-10s %-10s %-12s\n", label, "n/a", "n/a", "(short hzn)"
    return
  }
  peakMo = 0; peakImp = -1e15; lastPos = 0; firstPos = 0
  for (mo = 1; mo <= scanMonths; mo++) {
    calcBuyVsRentWealth(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                        rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                        ccPct, scPct, invReturn, moveOut, vacPct, expPct, mo/12)
    if (out_wealthImpact > peakImp) { peakImp = out_wealthImpact; peakMo = mo }
    if (out_wealthImpact >= 0) {
      lastPos = mo
      if (firstPos == 0) firstPos = mo
    }
  }
  finalImp = out_wealthImpact
  hasRev = (peakImp > 0 && finalImp < 0 && lastPos > 0 && lastPos < scanMonths)
  if (hasRev) {
    printf "%-50s yr %-7.1f yr %-7.1f reversal yr %.1f (peak %s, final %s)\n",
      label, firstPos/12, peakMo/12, (lastPos+1)/12, fmtSigned(peakImp), fmtSigned(finalImp)
  } else {
    printf "%-50s %-10s %-10s %-12s\n", label,
      (firstPos > 0 ? sprintf("yr %.1f", firstPos/12) : "—"),
      (peakImp > 0 ? sprintf("yr %.1f", peakMo/12) : "—"),
      "no reversal"
  }
}

function runScenario(label, narrative, expected,
                     homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
                     rent, rentGrow, apprPct, rentalIncome, profile, loanType,
                     ccPct, scPct, invReturn, moveOut, vacPct, expPct, horizon,
                     dashes) {
  dashes = "================================================================================"
  print dashes
  print "SCENARIO: " label
  print "--------------------------------------------------------------------------------"
  print "Setup:    " narrative
  print "Expected: " expected
  print ""
  printf "Inputs:   $%s home, %.1f%% down, %.3f%% / %d-yr %s\n", commafy(homePrice), downPct, rate, term, loanType
  printf "          Rent %s, horizon %dy, appr %.1f%%, invest %.1f%%\n", fmt(rent), horizon, apprPct, invReturn
  if (rentalIncome > 0) printf "          Rental income %s (vac %.0f%%, exp %.0f%%)\n", fmt(rentalIncome), vacPct, expPct
  print ""

  decision(homePrice, downPct, rate, term, taxPct, insAnnual, maintPct, hoa,
           rent, rentGrow, apprPct, rentalIncome, profile, loanType,
           ccPct, scPct, invReturn, moveOut, vacPct, expPct, horizon)

  printf "Monthly:  Total ownership %s | Rent %s | Diff %s/mo\n", fmt(d_totalOwn), fmt(rent), fmtSigned(d_monDiff)
  if (rentalIncome > 0) printf "          Net (after eff. rental income): %s\n", fmt(d_netCost)
  printf "Wealth(@%dy): Buy net %s, Rent net %s, Δ %s\n", horizon, fmt(d_buyNet), fmt(d_rentNet), fmtSigned(d_wealthImpact)
  if (d_be_found) printf "Break-even:   month %d (~%.1f years)\n", d_be_month, d_be_year
  else            print  "Break-even:   NOT within 10 years"
  print ""
  printf ">>> VERDICT TYPE: %s\n", d_type
  printf ">>> HORIZON CTA:  %s\n", d_horizon
  print ""
}

BEGIN {
  # Defaults
  rentGrow = 3
  ccPct    = 3
  scPct    = 6
  invReturn= 7
  vacPct   = 5
  expPct   = 25
  profile  = "740-759"
  loanType = "Conventional"
  hoa      = 0
  rentalIncome = 0
  moveOut  = 0

  # ---------- SCENARIO 1: Cheap home + expensive rent ----------
  runScenario("#1 — Cheap home + expensive rent (clear BUY)",
    "Modest home in moderate-cost area; current rent above ownership cost.",
    "BUY-CLEAR. Total ownership ~30%+ below rent.",
    250000, 20, 6.5, 30, 1.2, 1500, 1, 0,
    2800, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 2: Expensive home + cheap rent ----------
  runScenario("#2 — Expensive home + cheap rent (clear RENT)",
    "HCOL area, expensive house, cheap rent.",
    "RENT-FIRM. Buying never overtakes within 10 years.",
    600000, 10, 7.0, 30, 1.2, 2000, 1, 0,
    2200, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 5)

  # ---------- SCENARIO 3: docx example (the landing page worked example) ----------
  runScenario("#3 — docx example: $400K, 10% down, 6.75%, 7y horizon",
    "The 'Same Home, Two Questions' landing example.",
    "BUY-MEDIUM (medium confidence). Break-even mid-range.",
    400000, 10, 6.75, 30, 1.2, 1800, 1, 0,
    2200, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 4: Same as #3 but short horizon ----------
  runScenario("#4 — Same as #3 but SHORT horizon (2 years)",
    "Buyer might relocate in 2 years. Closing + exit costs eat returns.",
    "RENT or LEAN-RENT — break-even won't hit in 2 years.",
    400000, 10, 6.75, 30, 1.2, 1800, 1, 0,
    2200, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 2)

  # ---------- SCENARIO 5: House hack ----------
  runScenario("#5 — House hack duplex (rental income offsets cost)",
    "Owner-occupies one unit, rents other for $2,500/mo gross.",
    "HACK — net cost should drop below comparable rent.",
    500000, 20, 7.0, 30, 1.2, 2400, 1, 0,
    2400, 3, 3, 2500, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 6: VA loan, 0% down ----------
  runScenario("#6 — VA loan, 0% down (military buyer)",
    "No DP, no monthly MI. Mid-cost market.",
    "Likely BUY-MARGIN or LEAN-RENT depending on monthly gap.",
    300000, 0, 6.5, 30, 1.2, 1500, 1, 0,
    2000, 3, 3, 0, "740-759", "VA",
    3, 6, 7, 0, 5, 25, 5)

  # ---------- SCENARIO 7: FHA, low credit ----------
  runScenario("#7 — FHA, 660-699 credit, 3.5% down",
    "First-time buyer with limited cash and 660-699 credit.",
    "Higher MIP may push toward LEAN-RENT or RENT.",
    280000, 3.5, 7.25, 30, 1.3, 1500, 1, 0,
    1800, 3, 3, 0, "660-699", "FHA",
    3, 6, 7, 0, 5, 25, 5)

  # ---------- SCENARIO 8: 20% down, $700K, HCOL ----------
  runScenario("#8 — 20% down conv, $700K HCOL",
    "Strong buyer, big DP, expensive market.",
    "BUY-MARGIN or LEAN-RENT.",
    700000, 20, 6.5, 30, 1.0, 2400, 1, 200,
    3500, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 9: 50% down ----------
  runScenario("#9 — 50% down (rich buyer)",
    "Half cash down. Mortgage tiny but opportunity cost is real.",
    "Should account for forgone investment returns on the $200K.",
    400000, 50, 6.5, 30, 1.2, 1800, 1, 0,
    2200, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 10: High appreciation ----------
  runScenario("#10 — High appreciation (5%/yr)",
    "Hot market — house grows 5%/yr.",
    "Should tip more clearly toward BUY than 3% case (#3).",
    400000, 10, 6.75, 30, 1.2, 1800, 1, 0,
    2200, 3, 5, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 11: Flat market ----------
  runScenario("#11 — Flat market (0% appreciation)",
    "House holds value but doesn't grow. Renter still earns 7%.",
    "Should clearly favor RENT.",
    400000, 10, 6.75, 30, 1.2, 1800, 1, 0,
    2200, 3, 0, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  # ---------- SCENARIO 12: Parity ----------
  runScenario("#12 — Monthly cost parity (ownership ≈ rent)",
    "Tuned scenario where ownership ≈ rent. Equity should tip BUY.",
    "BUY-CLEAR or BUY-SLIGHT once equity factored.",
    300000, 20, 6.0, 30, 1.2, 1500, 1, 0,
    2100, 3, 3, 0, "740-759", "Conventional",
    3, 6, 7, 0, 5, 25, 7)

  print "================================================================================"
  print "Done. 12 scenarios run."
  print "================================================================================"

  # ---- REVERSAL DETECTION SANITY CHECK ----
  # Run findReversal-like logic on all 12 scenarios above + the user scenario.
  # Expect: no reversal triggers in the 12 standard scenarios. User scenario
  # should trigger with peak around year 14, reversal around year 20.
  print ""
  print "Reversal-detection sanity check (no reversal expected in scenarios 1-12):"
  print ""
  printf "%-50s %-10s %-10s %-12s\n", "Scenario", "First+", "Peak", "Reversal"
  print "----------------------------------------------------------------------------------"

  checkReversal("#1 cheap+expensive (BUY-CLEAR)", 250000, 20, 6.5, 30, 1.2, 1500, 1, 0, 2800, 3, 3, 0, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 7)
  checkReversal("#2 expensive+cheap (RENT-FIRM)", 600000, 10, 7.0, 30, 1.2, 2000, 1, 0, 2200, 3, 3, 0, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 5)
  checkReversal("#3 docx (3% appr, 7y) RENT-FIRM", 400000, 10, 6.75, 30, 1.2, 1800, 1, 0, 2200, 3, 3, 0, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 7)
  checkReversal("#10 (5% appr, 7y) BUY-MEDIUM", 400000, 10, 6.75, 30, 1.2, 1800, 1, 0, 2200, 3, 5, 0, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 7)
  checkReversal("#12 parity (BUY-MARGIN)", 300000, 20, 6.0, 30, 1.2, 1500, 1, 0, 2100, 3, 3, 0, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 7)
  checkReversal("#5 hack 7y (HACK)", 500000, 20, 7.0, 30, 1.2, 2400, 1, 0, 2400, 3, 3, 2500, "740-759", "Conventional", 3, 6, 7, 0, 5, 25, 7)

  print ""
  print "User scenario (expect reversal):"
  checkReversal("USER: $710K hack, moveOut yr2, 25y", 710000, 10, 7.0, 30, 1.2, 1800, 1, 0, 2200, 3, 3, 2600, "740-759", "Conventional", 3, 6, 7, 2, 5, 25, 25)

  # ---- USER SCENARIO: $710K house hack, move out year 2, 25y horizon ----
  print ""
  print "================================================================================"
  print "USER SCENARIO: $710K house hack with move-out at year 2, 25y horizon"
  print "================================================================================"
  print ""
  print "Year-by-year wealth trajectory (Buy net vs Rent net):"
  print ""
  printf "%-6s %14s %14s %14s\n", "Year", "Buy Net", "Rent Net", "Δ (Buy-Rent)"
  print "-------------------------------------------------------"
  for (y = 1; y <= 25; y++) {
    calcBuyVsRentWealth(710000, 10, 7, 30, 1.2, 1800, 1, 0,
                        2200, 3, 3, 2600, "740-759", "Conventional",
                        3, 6, 7, 2, 5, 25, y)
    printf "%-6d %14s %14s %14s\n", y, fmt(out_buyNet), fmt(out_rentNet), fmtSigned(out_wealthImpact)
  }
}
