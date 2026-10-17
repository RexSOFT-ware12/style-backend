// Works out WHO/WHERE a request came from: IP, approximate location and
// device. Used for sign-in alerts.
//
// Location sources, in order:
//   1. Google App Engine headers (X-Appengine-Country / Region / City) —
//      free and accurate when deployed on App Engine (this app's host).
//   2. geoip-lite — offline MaxMind-derived database, no external calls.
// Nothing is sent to third-party lookup services.

const UAParser = require("ua-parser-js");
const geoip = require("geoip-lite");

let regionNames;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

function countryName(code) {
  if (!code) return "";
  try {
    return (regionNames && regionNames.of(code.toUpperCase())) || code;
  } catch {
    return code;
  }
}

function cleanIp(ip) {
  return String(ip || "").replace(/^::ffff:/, "").trim();
}

function isPrivateIp(ip) {
  return (
    !ip ||
    ip === "::1" ||
    /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip)
  );
}

function titleCase(s) {
  return String(s || "")
    .split(/[\s-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function describeRequest(req) {
  // trust proxy is on in server.js, so req.ip is the real client IP.
  const ip = cleanIp(req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress);

  let city = "";
  let region = "";
  let countryCode = "";

  const h = req.headers;
  if (h["x-appengine-country"] && h["x-appengine-country"] !== "ZZ") {
    countryCode = h["x-appengine-country"];
    city = h["x-appengine-city"] ? titleCase(h["x-appengine-city"]) : "";
    // App Engine's region is a cryptic ISO code (e.g. "gh-aa"); city + country reads better.
  }
  if (!countryCode && !isPrivateIp(ip)) {
    const g = geoip.lookup(ip);
    if (g) {
      countryCode = g.country || "";
      city = g.city || "";
      region = g.region || "";
    }
  }

  const ua = new UAParser(h["user-agent"] || "").getResult();
  const browser = ua.browser.name ? `${ua.browser.name}${ua.browser.major ? " " + ua.browser.major : ""}` : "Unknown browser";
  const os = ua.os.name ? `${ua.os.name}${ua.os.version ? " " + ua.os.version : ""}` : "Unknown OS";
  const deviceType = ua.device.type || "desktop";

  const country = countryName(countryCode);
  const place = [city, region && region !== city ? region : "", country].filter(Boolean);

  return {
    ip: ip || "Unknown",
    city,
    region,
    countryCode: (countryCode || "").toUpperCase(),
    country,
    location: place.length ? place.join(", ") : "Unknown location",
    browser,
    os,
    deviceType,
    device: `${browser} on ${os}`,
    // Coarse identity used to decide "is this a new device/place?".
    // Major browser + OS family + country: stable across minor updates and IP changes.
    fingerprint: [ua.browser.name || "?", (ua.os.name || "?"), deviceType, countryCode || "?"].join("|").toLowerCase(),
  };
}

module.exports = { describeRequest };
