// Outbound email via Hostinger SMTP (support@fabricnow.pro).
//
// Configure with env vars (never commit the password):
//   SMTP_HOST   default smtp.hostinger.com
//   SMTP_PORT   default 465  (465 = SSL, 587 = STARTTLS)
//   SMTP_USER   support@fabricnow.pro
//   SMTP_PASS   the mailbox password
//   MAIL_FROM   optional, default `FabricNow <SMTP_USER>`
//
// If SMTP_USER/SMTP_PASS are missing, sending is skipped with a log line —
// the app keeps working, it just doesn't email.

const nodemailer = require("nodemailer");

let transporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.hostinger.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/**
 * Send an email. Resolves to true/false and NEVER throws — email problems
 * must not break sign-in or billing flows.
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) return false;
  if (!isConfigured()) {
    console.warn(`[mail] SMTP not configured — skipped "${subject}" to ${to}`);
    return false;
  }
  try {
    const from = process.env.MAIL_FROM || `FabricNow <${process.env.SMTP_USER}>`;
    await getTransporter().sendMail({
      from,
      to,
      subject,
      html,
      text,
      replyTo: process.env.SMTP_USER,
    });
    return true;
  } catch (err) {
    console.error(`[mail] failed "${subject}" to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendMail, isConfigured };
