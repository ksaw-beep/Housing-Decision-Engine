/* ===== HOUSING DECISION ENGINE — PREVIEW SCRIPT ===== */
/* This is a standalone, simplified calculator for the free preview.   */
/* It does NOT use the full engine from the paid app.                  */
/* Only computes: mortgage P&I, total monthly ownership, cash to close.*/

'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────
function $pv(id) { return document.getElementById(id); }

function pvNum(id) {
  const el = $pv(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return isNaN(v) ? 0 : v;
}

function pvFmt(n) {
  return '$' + Math.round(Math.max(n, 0)).toLocaleString('en-US');
}

// ─── Mortgage formula ─────────────────────────────────────────────────
// Standard amortization: M = P * [r(1+r)^n] / [(1+r)^n - 1]
// Falls back to P/n when rate is 0 to avoid division by zero.
function pvMortgage(principal, annualRatePct, termYears) {
  if (principal <= 0) return 0;
  const n = termYears * 12;
  if (n <= 0) return 0;
  if (annualRatePct <= 0) return principal / n;
  const r = annualRatePct / 100 / 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ─── Live hints ───────────────────────────────────────────────────────
function pvUpdateHints() {
  const price = pvNum('pvHomePrice');
  const dpPct = pvNum('pvDownPct');
  if ($pv('pvDownAmt') && price > 0) {
    $pv('pvDownAmt').textContent = pvFmt(price * dpPct / 100) + ' down';
  }
}

$pv('pvHomePrice').addEventListener('input', pvUpdateHints);
$pv('pvDownPct').addEventListener('input', pvUpdateHints);
pvUpdateHints();

// ─── Advanced accordion ───────────────────────────────────────────────
function toggleAdvanced() {
  const content = $pv('advContent');
  const trigger = $pv('advTrigger');
  const icon    = trigger.querySelector('.adv-trigger-icon');
  const open    = !content.hidden;
  content.hidden = open;
  trigger.setAttribute('aria-expanded', String(!open));
  icon.textContent = open ? '▾' : '▴';
}

// ─── Upgrade details toggle ───────────────────────────────────────────
function toggleUpgradeDetails() {
  const details = $pv('upgradeDetails');
  const btn     = $pv('upgradeWhatBtn');
  const open    = !details.hidden;
  details.hidden = open;
  btn.setAttribute('aria-expanded', String(!open));
  btn.textContent = open ? 'What\'s included? ▾' : 'What\'s included? ▴';
}

// ─── Validation ───────────────────────────────────────────────────────
function pvValidate() {
  const errs = [];
  const errBox = $pv('pvFormErrors');

  const fields = [
    { id: 'pvHomePrice', label: 'Home Price', min: 1 },
    { id: 'pvDownPct',   label: 'Down Payment', min: 0, max: 100 },
    { id: 'pvRate',      label: 'Interest Rate', min: 0, max: 20 },
    { id: 'pvTerm',      label: 'Loan Term', min: 1 },
    { id: 'pvRent',      label: 'Current Monthly Rent', min: 0 },
  ];

  // Clear previous errors
  fields.forEach(f => {
    const el = $pv(f.id);
    if (el) {
      el.classList.remove('input-error');
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
  });

  let firstBad = null;
  fields.forEach(f => {
    const el = $pv(f.id);
    if (!el) return;
    const v = parseFloat(el.value);
    let msg = null;
    if (isNaN(v)) {
      msg = `${f.label} is required.`;
    } else if (f.min !== undefined && v < f.min) {
      msg = `${f.label} must be at least ${f.min}.`;
    } else if (f.max !== undefined && v > f.max) {
      msg = `${f.label} must be at most ${f.max}.`;
    }
    if (msg) {
      errs.push(msg);
      el.classList.add('input-error');
      el.setAttribute('aria-invalid', 'true');
      if (!firstBad) firstBad = el;
    }
  });

  if (errs.length) {
    errBox.style.display = '';
    errBox.innerHTML = '<strong>Please fix the following:</strong><ul>' +
      errs.map(e => `<li>${e}</li>`).join('') + '</ul>';
    if (firstBad) firstBad.focus();
    return false;
  }

  errBox.style.display = 'none';
  errBox.innerHTML = '';
  return true;
}

// ─── Main calculate ───────────────────────────────────────────────────
function pvCalculate() {
  if (!pvValidate()) return;

  const homePrice  = pvNum('pvHomePrice');
  const downPct    = pvNum('pvDownPct');
  const rate       = pvNum('pvRate');
  const term       = pvNum('pvTerm');
  const rent       = pvNum('pvRent');
  const taxPct     = pvNum('pvTax')      || 1.2;
  const insurance  = pvNum('pvInsurance') || 1800;
  const maintPct   = pvNum('pvMaint')    || 1;
  const hoa        = pvNum('pvHOA')      || 0;
  const closingPct = pvNum('pvClosing')  || 3;

  // Core calcs
  const downPayment  = homePrice * downPct / 100;
  const loanAmount   = homePrice - downPayment;
  const mortgage     = pvMortgage(loanAmount, rate, term);
  const monthlyTax   = homePrice * taxPct / 100 / 12;
  const monthlyIns   = insurance / 12;
  const monthlyMaint = homePrice * maintPct / 100 / 12;
  // Conventional PMI (applied when down payment < 20%, using moderate credit assumption)
  // Rate: 0.4% annually of loan amount — matches paid app's 740-759 credit score tier
  const pvPMI = (downPct < 20 && loanAmount > 0) ? (loanAmount * 0.004 / 12) : 0;
  const totalOwn     = mortgage + monthlyTax + monthlyIns + monthlyMaint + hoa + pvPMI;

  const closingCost  = homePrice * closingPct / 100;
  const cashToClose  = downPayment + closingCost;

  const diff = totalOwn - rent; // positive = buying costs more

  // ── Populate KPIs ──
  $pv('pvKpiMortgage').textContent = pvFmt(mortgage) + '/mo';
  $pv('pvKpiTotal').textContent    = pvFmt(totalOwn) + '/mo';
  const pvTotalSublabel = document.querySelector('#pvResults .kpi-card:nth-child(2) .kpi-sublabel');
  if (pvTotalSublabel) {
    pvTotalSublabel.textContent = pvPMI > 0
      ? '(P&I + tax + insurance + maintenance + HOA + PMI)'
      : '(P&I + tax + insurance + maintenance + HOA)';
  }
  $pv('pvKpiRent').textContent     = pvFmt(rent) + '/mo';

  const diffEl = $pv('pvMonthlyDiff');
  if (diff > 0) {
    diffEl.textContent = `$${Math.round(diff).toLocaleString()} more/mo than rent`;
    diffEl.className = 'kpi-diff kpi-diff-neg';
  } else if (diff < 0) {
    diffEl.textContent = `$${Math.round(Math.abs(diff)).toLocaleString()} less/mo than rent`;
    diffEl.className = 'kpi-diff kpi-diff-pos';
  } else {
    diffEl.textContent = 'Same as rent';
    diffEl.className = 'kpi-diff';
  }

  // ── Cash to close ──
  $pv('pvDP').textContent          = pvFmt(downPayment);
  $pv('pvClosingAmt').textContent  = pvFmt(closingCost);
  $pv('pvCashTotal').textContent   = pvFmt(cashToClose);

  // ── Bar chart ──
  const maxVal = Math.max(rent, totalOwn, 1);
  $pv('pvBarRent').style.width = (rent / maxVal * 100).toFixed(1) + '%';
  $pv('pvBarRentAmt').textContent  = pvFmt(rent) + '/mo';
  $pv('pvBarBuy').style.width  = (totalOwn / maxVal * 100).toFixed(1) + '%';
  $pv('pvBarBuyAmt').textContent   = pvFmt(totalOwn) + '/mo';

  // ── Show results ──
  $pv('pvPlaceholder').style.display = 'none';
  $pv('pvResults').style.display = '';

  // Accessible status update
  const status = $pv('pvStatus');
  if (status) {
    status.textContent = '';                    // reset first so re-announce fires
    requestAnimationFrame(() => {
      status.textContent = 'Analysis updated.';
    });
  }

  // Reveal sticky upgrade card
  $pv('upgradeCard').hidden = false;

  // Scroll results into view on mobile
  if (window.innerWidth <= 960) {
    $pv('pvResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
