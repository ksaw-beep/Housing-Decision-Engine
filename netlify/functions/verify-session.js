/**
 * Netlify Function: verify-session
 * ---------------------------------
 * Verifies a Stripe Checkout Session server-side so the paid app cannot
 * be unlocked just by appending ?paid=true to the URL.
 *
 * ENDPOINT: /.netlify/functions/verify-session?session_id=cs_xxx
 *
 * ENVIRONMENT VARIABLES (set in Netlify dashboard → Site settings → Environment):
 *   STRIPE_SECRET_KEY   — your Stripe secret key (sk_live_... or sk_test_...)
 *
 * RETURNS:
 *   { ok: true,  paid: true,  customer: "email@example.com" }  — verified paid
 *   { ok: false, paid: false, error: "reason" }                — not paid / error
 *
 * SECURITY NOTES:
 *   - STRIPE_SECRET_KEY is NEVER exposed to the browser — it only lives here.
 *   - The session must have payment_status === "paid" to be considered valid.
 *   - This endpoint is read-only (GET) — it never charges anyone.
 *   - CORS is locked to the same origin (netlify deploy URL).
 *     Adjust ALLOWED_ORIGIN if you use a custom domain.
 */

const ALLOWED_ORIGIN = process.env.URL || '*'; // Netlify sets URL automatically

exports.handler = async (event) => {
  // ── CORS pre-flight ──────────────────────────────────────────────
  const headers = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, paid: false, error: 'Method not allowed' }),
    };
  }

  // ── Check env var ────────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[verify-session] STRIPE_SECRET_KEY is not set.');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        paid: false,
        error: 'Server configuration error — STRIPE_SECRET_KEY not set.',
      }),
    };
  }

  // ── Read session_id from query string ────────────────────────────
  const sessionId = (event.queryStringParameters || {}).session_id;
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, paid: false, error: 'Missing or invalid session_id.' }),
    };
  }

  // ── Call Stripe API ──────────────────────────────────────────────
  // We use the native https module (no npm install needed for Netlify Functions).
  try {
    const result = await stripeGetSession(stripeKey, sessionId);

    if (result.payment_status === 'paid') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          paid: true,
          customer: result.customer_details?.email || null,
        }),
      };
    } else {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: false,
          paid: false,
          error: `Session payment_status is "${result.payment_status}", not "paid".`,
        }),
      };
    }
  } catch (err) {
    console.error('[verify-session] Stripe API error:', err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ ok: false, paid: false, error: 'Stripe verification failed.' }),
    };
  }
};

// ── Minimal Stripe session fetch using Node's built-in https ─────────────────
function stripeGetSession(secretKey, sessionId) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const options = {
      hostname: 'api.stripe.com',
      path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': '2023-10-16',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Stripe error'));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Invalid JSON from Stripe'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
