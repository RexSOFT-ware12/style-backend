const express = require("express");
const { sendMail, isConfigured } = require("../lib/mailer");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const contactRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Too many contact requests. Please wait a minute and try again.",
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

router.post("/", contactRateLimit, async (req, res) => {
  const name = cleanText(req.body?.name);
  const email = cleanText(req.body?.email);
  const subject = cleanText(req.body?.subject);
  const message = cleanText(req.body?.message);
  const topic = cleanText(req.body?.topic);

  if (!name || name.length > 120) {
    return res.status(400).json({ error: "name is required and must be 120 characters or fewer." });
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
    return res.status(400).json({ error: "subject is required and must be 200 characters or fewer." });
  }
  if (!message || message.length > 10_000) {
    return res.status(400).json({ error: "message is required and must be 10,000 characters or fewer." });
  }
  if (topic.length > 100 || /[\r\n]/.test(topic)) {
    return res.status(400).json({ error: "topic must be 100 characters or fewer." });
  }
  if (!isConfigured()) {
    return res.status(503).json({ error: "The contact form is temporarily unavailable. Please try again later." });
  }

  const to =
    process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL || "support@fabricnow.pro";
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Topic: ${topic || "Not specified"}`,
    `Subject: ${subject}`,
    "",
    message,
  ].join("\n");

  const sent = await sendMail({
    to,
    replyTo: email,
    subject: `[FabricNow Contact] ${subject}`,
    text,
  });
  if (!sent) {
    return res.status(503).json({ error: "We couldn't send your message right now. Please try again later." });
  }

  return res.status(200).json({ ok: true, message: "Your message has been sent." });
});

module.exports = router;
