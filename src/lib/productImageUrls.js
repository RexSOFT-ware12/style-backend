const LEGACY_API_HOST = "stream-sell.de.r.appspot.com";

function normalizeProductImageUrl(value) {
  if (typeof value !== "string") return value;

  let imageUrl;
  try {
    imageUrl = new URL(value);
  } catch {
    return value;
  }

  if (imageUrl.hostname.toLowerCase() !== LEGACY_API_HOST) return value;

  const apiBase = new URL(process.env.PUBLIC_API_URL || "https://backend.fabricnow.pro");
  return `${apiBase.origin}${imageUrl.pathname}${imageUrl.search}${imageUrl.hash}`;
}

module.exports = { LEGACY_API_HOST, normalizeProductImageUrl };
