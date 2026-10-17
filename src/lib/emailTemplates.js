// Professional, email-client-safe HTML templates (table layout + inline CSS,
// works in Gmail / Outlook / Apple Mail, light and dark). Every template
// returns { subject, html, text }.
//
// Optional env:
//   MAIL_LOGO_URL  public https PNG of the logo (email clients can't load
//                  local/SVG files). Falls back to a styled wordmark.
//   FRONTEND_URL / WORKSPACE_URL  used for buttons.

const BRAND = {
  navy: "#302C4D",
  navyDeep: "#24213B",
  orange: "#E66239",
  orangeWash: "#FDEEE8",
  text: "#1D1A33",
  muted: "#5B6676",
  line: "#E1E5EB",
  bg: "#F3F5F8",
  ok: "#17794A",
  okBg: "#E4F5EC",
  bad: "#B42318",
  badBg: "#FDEAE8",
};

const FRONTEND_URL = () => (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const WORKSPACE_URL = () => (process.env.WORKSPACE_URL || `${FRONTEND_URL()}/workspace`).replace(/\/$/, "");
const SUPPORT = () => process.env.SMTP_USER || "support@fabricnow.pro";

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function fmtMoney(cents, currency = "usd") {
  if (typeof cents !== "number") return null;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function logo() {
  const url = process.env.MAIL_LOGO_URL;
  if (url) {
    return `<img src="${esc(url)}" alt="FabricNow" height="34" style="display:block;border:0;height:34px;width:auto;" />`;
  }
  return `<span style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:3px;color:#ffffff;">FABRIC<span style="color:${BRAND.orange};">NOW</span></span>`;
}

function button(label, href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 20px;"><tr>
    <td style="border-radius:8px;background:${BRAND.orange};">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
    </td></tr></table>`;
}

// rows: [[label, value], ...]
function detailsTable(rows) {
  const body = rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([k, v], i, arr) => `<tr>
        <td style="padding:11px 16px;font-family:${FONT};font-size:13px;color:${BRAND.muted};width:38%;${i < arr.length - 1 ? `border-bottom:1px solid ${BRAND.line};` : ""}">${esc(k)}</td>
        <td style="padding:11px 16px;font-family:${FONT};font-size:14px;font-weight:600;color:${BRAND.text};${i < arr.length - 1 ? `border-bottom:1px solid ${BRAND.line};` : ""}">${esc(v)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;background:#F8F9FB;border:1px solid ${BRAND.line};border-radius:10px;border-collapse:separate;">${body}</table>`;
}

function badge(label, color, bg) {
  return `<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${bg};color:${color};font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;">${esc(label)}</span>`;
}

function layout({ preheader, badgeHtml = "", title, bodyHtml }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.bg};"><tr><td align="center" style="padding:32px 14px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="background:${BRAND.navy};border-radius:14px 14px 0 0;padding:26px 32px;border-bottom:4px solid ${BRAND.orange};">${logo()}</td></tr>
    <tr><td style="background:#ffffff;padding:36px 32px 30px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};">
      ${badgeHtml ? `<div style="margin-bottom:16px;">${badgeHtml}</div>` : ""}
      <h1 style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.3;color:${BRAND.text};font-weight:700;">${esc(title)}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="background:#ffffff;padding:0 32px 30px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};">
      <div style="border-top:1px solid ${BRAND.line};padding-top:18px;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.muted};">
        Need help? Reply to this email or write to <a href="mailto:${esc(SUPPORT())}" style="color:${BRAND.orange};text-decoration:none;font-weight:600;">${esc(SUPPORT())}</a>.
      </div>
    </td></tr>
    <tr><td style="background:${BRAND.navyDeep};border-radius:0 0 14px 14px;padding:22px 32px;">
      <p style="margin:0 0 4px;font-family:${FONT};font-size:12px;color:#A3B2BE;">&copy; ${new Date().getUTCFullYear()} FabricNow. All rights reserved.</p>
      <p style="margin:0;font-family:${FONT};font-size:12px;color:#657E92;">You're receiving this because of activity on your FabricNow account. This is a transactional message.</p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (html) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.text};">${html}</p>`;
const small = (html) => `<p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.muted};">${html}</p>`;

// ---------------------------------------------------------------------------

function welcome({ name }) {
  const first = esc(String(name || "there").split(" ")[0]);
  const html = layout({
    preheader: "Your FabricNow workspace is ready.",
    badgeHtml: badge("Welcome", BRAND.ok, BRAND.okBg),
    title: `Welcome to FabricNow, ${String(name || "there").split(" ")[0]}`,
    bodyHtml:
      p(`Hi ${first},`) +
      p("Your account is ready. FabricNow gives you AI-powered tools for garment design, pattern work, tech packs and lookbooks — all in one workspace.") +
      p("You have a <strong>3-day free trial</strong> of the premium tools (Garment Tool, Pose Tool and SVG customization) starting now.") +
      button("Open your workspace", WORKSPACE_URL()) +
      small("If you didn't create this account, please contact us right away."),
  });
  return {
    subject: "Welcome to FabricNow",
    html,
    text: `Hi ${name || "there"},\n\nYour FabricNow account is ready, with a 3-day free trial of the premium tools.\nOpen your workspace: ${WORKSPACE_URL()}\n\nIf you didn't create this account, contact ${SUPPORT()}.\n\n— FabricNow`,
  };
}

function signinAlert({ name, info, when = new Date(), method = "Email & password", firstOfKind = "device" }) {
  const first = esc(String(name || "there").split(" ")[0]);
  const reason = firstOfKind === "location" ? "from a new location" : "on a new device";
  const html = layout({
    preheader: `New sign-in ${reason}: ${info.device} · ${info.location}`,
    badgeHtml: badge("Security alert", BRAND.bad, BRAND.badBg),
    title: "New sign-in to your account",
    bodyHtml:
      p(`Hi ${first},`) +
      p(`We noticed a sign-in to your FabricNow account ${esc(reason)}. If this was you, no action is needed.`) +
      detailsTable([
        ["When", fmtDateTime(when)],
        ["Location", info.location],
        ["IP address", info.ip],
        ["Device", info.device],
        ["Sign-in method", method],
      ]) +
      `<div style="background:${BRAND.orangeWash};border-left:4px solid ${BRAND.orange};border-radius:6px;padding:14px 16px;margin:0 0 6px;">
        <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.text};"><strong>Wasn't you?</strong> Change your password immediately and review your account. If you signed in with Google, secure your Google account too.</p>
      </div>` +
      button("Secure my account", `${FRONTEND_URL()}/account`) +
      small("Location is approximate and based on the IP address, so it may be the location of your internet provider rather than your exact position."),
  });
  return {
    subject: "New sign-in to your FabricNow account",
    html,
    text: `Hi ${name || "there"},\n\nNew sign-in ${reason}.\n\nWhen: ${fmtDateTime(when)}\nLocation: ${info.location}\nIP: ${info.ip}\nDevice: ${info.device}\nMethod: ${method}\n\nIf this wasn't you, change your password now: ${FRONTEND_URL()}/account\n\n— FabricNow`,
  };
}

function subscriptionConfirmed({ name, planName, amountCents, currency, interval = "month", renewsOn, trialing = false }) {
  const first = esc(String(name || "there").split(" ")[0]);
  const price = fmtMoney(amountCents, currency);
  const html = layout({
    preheader: `Your ${planName} subscription is active.`,
    badgeHtml: badge("Subscription active", BRAND.ok, BRAND.okBg),
    title: "Thank you for subscribing",
    bodyHtml:
      p(`Hi ${first},`) +
      p(`Your <strong>${esc(planName)}</strong> subscription is now active. You have full access to everything included in your plan.`) +
      detailsTable([
        ["Plan", planName],
        ["Price", price ? `${price} / ${interval}` : null],
        ["Status", trialing ? "Trial" : "Active"],
        [trialing ? "First charge" : "Next renewal", renewsOn ? fmtDate(renewsOn) : null],
      ]) +
      button("Go to your workspace", WORKSPACE_URL()) +
      small("You can update your payment method, view invoices or cancel any time from the billing portal in your account."),
  });
  return {
    subject: `Your ${planName} subscription is active`,
    html,
    text: `Hi ${name || "there"},\n\nYour ${planName} subscription is active.\n${price ? `Price: ${price} / ${interval}\n` : ""}${renewsOn ? `${trialing ? "First charge" : "Next renewal"}: ${fmtDate(renewsOn)}\n` : ""}\nWorkspace: ${WORKSPACE_URL()}\n\n— FabricNow`,
  };
}

function subscriptionCanceled({ name, planName, endsOn }) {
  const first = esc(String(name || "there").split(" ")[0]);
  const html = layout({
    preheader: `Your ${planName} subscription has ended.`,
    badgeHtml: badge("Subscription ended", BRAND.muted, "#EDF0F4"),
    title: "Your subscription has ended",
    bodyHtml:
      p(`Hi ${first},`) +
      p(`Your <strong>${esc(planName)}</strong> subscription has been cancelled${endsOn ? ` and ended on <strong>${esc(fmtDate(endsOn))}</strong>` : ""}. Your account and saved work are safe, and you can keep using the free features.`) +
      p("Changed your mind? You can resubscribe at any time and pick up right where you left off.") +
      button("Resubscribe", `${FRONTEND_URL()}/account`) +
      small("We'd love to know how we could do better — just reply to this email."),
  });
  return {
    subject: `Your ${planName} subscription has ended`,
    html,
    text: `Hi ${name || "there"},\n\nYour ${planName} subscription has ended${endsOn ? ` (${fmtDate(endsOn)})` : ""}. Resubscribe any time: ${FRONTEND_URL()}/account\n\n— FabricNow`,
  };
}

function paymentFailed({ name, planName }) {
  const first = esc(String(name || "there").split(" ")[0]);
  const html = layout({
    preheader: "We couldn't process your latest payment.",
    badgeHtml: badge("Action needed", BRAND.bad, BRAND.badBg),
    title: "We couldn't process your payment",
    bodyHtml:
      p(`Hi ${first},`) +
      p(`The latest payment for your <strong>${esc(planName)}</strong> subscription didn't go through. Please update your payment method to keep your access without interruption.`) +
      button("Update payment method", `${FRONTEND_URL()}/account`) +
      small("We'll retry the payment automatically. If it keeps failing, your subscription may be cancelled."),
  });
  return {
    subject: "Action needed: payment failed for your FabricNow subscription",
    html,
    text: `Hi ${name || "there"},\n\nWe couldn't process the latest payment for ${planName}. Update your payment method: ${FRONTEND_URL()}/account\n\n— FabricNow`,
  };
}

function workspaceInvitation({ inviterName, companyName, role, acceptUrl, expiresAt, hasAccount }) {
  const roleLabel = String(role || "member").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
  const who = inviterName || "A teammate";
  const html = layout({
    preheader: `${who} invited you to join ${companyName} on FabricNow.`,
    badgeHtml: badge("Workspace invitation", BRAND.navy, "#E9E8F2"),
    title: `Join ${companyName} on FabricNow`,
    bodyHtml:
      p("Hello,") +
      p(`<strong>${esc(who)}</strong> has invited you to collaborate in the <strong>${esc(companyName)}</strong> workspace on FabricNow — design, patterns, tech packs and lookbooks with your team in one place.`) +
      detailsTable([
        ["Workspace", companyName],
        ["Invited by", inviterName],
        ["Your role", roleLabel],
        ["Invitation expires", expiresAt ? fmtDate(expiresAt) : null],
      ]) +
      button("Accept invitation", acceptUrl) +
      p(hasAccount
        ? "Sign in with <strong>this email address</strong> to accept — the invitation only works for the address it was sent to."
        : "New to FabricNow? Create a free account using <strong>this email address</strong>, then accept the invitation.") +
      small(`Button not working? Copy this link into your browser:<br><a href="${esc(acceptUrl)}" style="color:${BRAND.orange};word-break:break-all;">${esc(acceptUrl)}</a>`) +
      small("Didn't expect this invitation? You can safely ignore this email — nothing happens unless you accept."),
  });
  return {
    subject: `${who} invited you to join ${companyName} on FabricNow`,
    html,
    text: `${who} invited you to join the ${companyName} workspace on FabricNow as ${roleLabel}.\n\nAccept (sign in with this email address): ${acceptUrl}\n${expiresAt ? `Expires: ${fmtDate(expiresAt)}\n` : ""}\nIf you didn't expect this, ignore this email.\n\n— FabricNow`,
  };
}

module.exports = { workspaceInvitation, welcome, signinAlert, subscriptionConfirmed, subscriptionCanceled, paymentFailed };
