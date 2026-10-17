// fetch() for user-supplied store URLs. Blocks private / loopback addresses so the server cannot be pointed at internal services.
const dns = require('dns').promises;
const net = require('net');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublicHttps(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('That store address is not a valid URL.'); }
  if (u.protocol !== 'https:') throw new Error('The store address must start with https://');
  if (u.username || u.password) throw new Error('Remove the username or password from the store address.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error('That store address could not be found.'); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That store address is not allowed.');
  return u;
}

async function safeFetch(rawUrl, opts = {}, timeoutMs = 25000) {
  const u = await assertPublicHttps(rawUrl);
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetch(u, { ...opts, redirect: 'error', signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The store took too long to answer.' : `Could not reach the store: ${e.cause?.code || e.message}`); }
  finally { clearTimeout(timer); }
}

module.exports = { safeFetch, assertPublicHttps, isPrivateIp };
