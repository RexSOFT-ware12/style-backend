// Outbound transactional email via Resend's HTTPS API.
//
// Configure RESEND_API_KEY and RESEND_FROM_EMAIL in the backend environment.
// The sender address must belong to a domain verified in Resend.

const RESEND_API_URL = "https://api.resend.com/emails";

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Send an email. Resolves to true/false and NEVER throws — email problems
 * must not break sign-in or billing flows.
 */
async function sendMail({ to, cc, replyTo, from, subject, html, text, idempotencyKey }) {
  if (!to) return false;
  if (!isConfigured()) {
    console.warn(`[mail] RESEND_API_KEY not configured — skipped "${subject}" to ${to}`);
    return false;
  }

  const supportEmail =
    process.env.SUPPORT_EMAIL || process.env.CONTACT_EMAIL || "support@fabricnow.pro";
  const payload = {
    from: from || process.env.RESEND_FROM_EMAIL || "FabricNow <reply@support.fabricnow.pro>",
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    reply_to: replyTo || supportEmail,
  };

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const result = await response.json();
        if (result?.message) detail = result.message;
      } catch {
        // Keep the HTTP status when the provider response isn't JSON.
      }
      console.error(`[mail] Resend failed "${subject}" to ${to}: ${detail}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[mail] Resend request failed "${subject}" to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendMail, isConfigured };
