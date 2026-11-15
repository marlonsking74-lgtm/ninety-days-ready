/*
 * POST /.netlify/functions/send-plan
 * Body: JSON answers from the questionnaire.
 * Rebuilds the plan on the server from the answers (never accepts HTML from the
 * browser, so this endpoint cannot be used to send arbitrary email content),
 * then sends it through Resend. Nothing is stored or logged.
 *
 * Required environment variables (Netlify > Site configuration > Environment variables):
 *   RESEND_API_KEY  - API key from resend.com
 *   FROM_EMAIL      - a sender on a domain verified in Resend, e.g. "90 Days Ready <plan@yourdomain.com>"
 */
const PlanBuilder = require('../../public/plan.js');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!event.body || event.body.length > 10000) return json(400, { error: 'bad_request' });

  let raw;
  try { raw = JSON.parse(event.body); } catch (e) { return json(400, { error: 'bad_json' }); }
  if (!raw || typeof raw !== 'object') return json(400, { error: 'bad_request' });

  // Honeypot: real people never fill the hidden "website" field. Pretend success to bots.
  if (raw.website) return json(200, { ok: true });

  const result = PlanBuilder.validate(raw);
  if (!result.ok) return json(400, { error: 'invalid', messages: result.errors });
  if (!result.answers.email) return json(400, { error: 'invalid', messages: ['An email address is required to send the plan.'] });

  const key = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;
  if (!key || !from) return json(503, { error: 'email_not_configured' });

  const plan = PlanBuilder.buildPlan(result.answers);
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: from,
        to: [result.answers.email],
        subject: plan.title,
        html: PlanBuilder.renderEmail(plan),
        text: PlanBuilder.renderText(plan)
      })
    });
  } catch (e) {
    return json(502, { error: 'send_failed' });
  }
  if (!res.ok) return json(502, { error: 'send_failed' });
  return json(200, { ok: true });
};
