// High-level email notifications: sign-in detection + subscription emails.
// Everything here is fire-and-forget safe — it never throws into callers.

const User = require("../models/User");
const { sendMail } = require("./mailer");
const { describeRequest } = require("./clientInfo");
const tpl = require("./emailTemplates");

// SIGNIN_ALERT_MODE: "new" (default) = email only for an unrecognised
// device/location; "always" = email on every sign-in; "off" = never.
const alertMode = () => (process.env.SIGNIN_ALERT_MODE || "new").toLowerCase();
const MAX_KNOWN = 30;

async function send(to, built) {
  return sendMail({ to, subject: built.subject, html: built.html, text: built.text });
}

/**
 * Record a successful sign-in and email the user if it looks unfamiliar.
 * `user` may be a lean object or a Mongoose doc. Uses the raw driver so
 * legacy users with non-ObjectId _ids work too.
 */
async function handleSignIn(req, user, method = "Email & password") {
  try {
    if (!user?._id || alertMode() === "off") return;
    const info = describeRequest(req);
    const now = new Date();
    const key = `${info.fingerprint}`;
    const deviceKey = key.split("|").slice(0, 3).join("|");

    const doc = await User.collection.findOne({ _id: user._id }, { projection: { signIns: 1 } });
    const known = doc?.signIns || [];

    const entry = {
      key, deviceKey, ip: info.ip, location: info.location, countryCode: info.countryCode,
      device: info.device, firstSeenAt: now, lastSeenAt: now,
    };

    const seen = known.some((k) => k.key === key);
    if (seen) {
      await User.collection.updateOne(
        { _id: user._id, "signIns.key": key },
        { $set: { "signIns.$.lastSeenAt": now, "signIns.$.ip": info.ip, "signIns.$.location": info.location } }
      );
    } else {
      await User.collection.updateOne({ _id: user._id }, { $push: { signIns: { $each: [entry], $slice: -MAX_KNOWN } } });
    }

    // First ever recorded sign-in = baseline (the welcome email covers new
    // accounts; existing users aren't blasted on rollout).
    const isBaseline = known.length === 0;
    const shouldAlert = alertMode() === "always" ? true : !isBaseline && !seen;
    if (!shouldAlert) return;

    const deviceSeen = known.some((k) => k.deviceKey === deviceKey);
    await send(
      user.email,
      tpl.signinAlert({ name: user.name, info, when: now, method, firstOfKind: deviceSeen ? "location" : "device" })
    );
  } catch (err) {
    console.error("[notify] sign-in handling failed:", err.message);
  }
}

/** New account: store the baseline sign-in + send the welcome email. */
async function handleSignUp(req, user, method = "Email & password") {
  try {
    const info = describeRequest(req);
    const now = new Date();
    await User.collection.updateOne(
      { _id: user._id },
      { $push: { signIns: { key: info.fingerprint, deviceKey: info.fingerprint.split("|").slice(0, 3).join("|"), ip: info.ip, location: info.location, countryCode: info.countryCode, device: info.device, firstSeenAt: now, lastSeenAt: now } } }
    );
    await send(user.email, tpl.welcome({ name: user.name }));
  } catch (err) {
    console.error("[notify] sign-up handling failed:", err.message);
  }
}

const fire = (p) => p.catch((e) => console.error("[notify]", e.message));

const notifySubscriptionActive = (user, data) =>
  fire(send(user.email, tpl.subscriptionConfirmed({ name: user.name, ...data })));
const notifySubscriptionCanceled = (user, data) =>
  fire(send(user.email, tpl.subscriptionCanceled({ name: user.name, ...data })));
const notifyPaymentFailed = (user, data) =>
  fire(send(user.email, tpl.paymentFailed({ name: user.name, ...data })));

// Returns true if the email was handed to the SMTP server.
const notifyWorkspaceInvite = (to, data) => send(to, tpl.workspaceInvitation(data)).catch(() => false);

module.exports = { notifyWorkspaceInvite, handleSignIn, handleSignUp, notifySubscriptionActive, notifySubscriptionCanceled, notifyPaymentFailed };
