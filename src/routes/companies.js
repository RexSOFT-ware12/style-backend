const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Company = require('../models/Company');
const CompanyMembership = require('../models/CompanyMembership');
const CompanyInvitation = require('../models/CompanyInvitation');
const CompanyIntegration = require('../models/CompanyIntegration');
const Inspiration = require('../models/Inspiration');
const { requireAuth } = require('../middleware/auth');
const { notifyWorkspaceInvite } = require('../lib/notify');
const { requireCompany, requirePermission, ensureCompanyForUser, ROLE_PERMISSIONS } = require('../middleware/company');

// Base URL used in invitation links/emails. Deliberately NOT WORKSPACE_ORIGIN,
// which can hold a comma-separated allow-list of origins.
const INVITE_BASE_URL = String(process.env.INVITE_BASE_URL || 'https://workspace.fabricnow.pro').split(',')[0].trim().replace(/\/+$/, '');

const router = express.Router();
router.use((req, res, next) => req.path === '/pinterest/oauth/callback' ? next() : requireAuth(req, res, next));

function publicMembership(m) { return { id: m.id, userId: m.userId, companyId: m.companyId, role: m.role, status: m.status, permissions: m.permissions || [], joinedAt: m.joinedAt }; }
function makeSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'company'; }

router.get('/bootstrap', async (req, res, next) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(401).json({ error: 'User account not found.' });
    const first = await ensureCompanyForUser(user);
    const memberships = await CompanyMembership.find({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
    const companyIds = memberships.map(m => m.companyId);
    const companies = await Company.find({ _id: { $in: companyIds } }).sort({ createdAt: 1 });
    const requested = req.headers['x-company-id'];
    const requestedMembership = requested ? memberships.find(m => String(m.companyId) === String(requested)) : null;
    if (requested && !requestedMembership) return res.status(403).json({ error: 'You do not have access to that company.' });
    const currentMembership = requestedMembership || memberships.find(m => String(m.companyId) === String(first.company._id)) || memberships[0];
    const current = companies.find(c => String(c._id) === String(currentMembership.companyId)) || first.company;
    res.json({ currentCompany: current, membership: publicMembership(currentMembership), companies, memberships: memberships.map(publicMembership) });
  } catch (e) { next(e); }
});

router.post('/', requireCompany, requirePermission('company:manage'), async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Company name is required.' });
    let slug = makeSlug(name); const base = slug; let i = 2;
    while (await Company.exists({ slug })) slug = `${base}-${i++}`;
    const company = await Company.create({ name, slug, ownerId: req.user.sub });
    await CompanyMembership.create({ companyId: company._id, userId: req.user.sub, role: 'owner', permissions: ['*'] });
    res.status(201).json({ company });
  } catch (e) { next(e); }
});

router.get('/members', requireCompany, requirePermission('team:read'), async (req, res, next) => {
  try {
    const memberships = await CompanyMembership.find({ companyId: req.company._id }).sort({ role: 1, createdAt: 1 }).lean();
    const ids = memberships.map(m => m.userId);
    const users = await User.find({ _id: { $in: ids } }).select('name email avatarUrl').lean();
    const byId = new Map(users.map(u => [String(u._id), u]));
    res.json({ members: memberships.map(m => ({ ...publicMembership(m), user: byId.get(String(m.userId)) || null })) });
  } catch (e) { next(e); }
});

router.post('/members/invite', requireCompany, requirePermission('team:manage'), async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'designer');
    const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
    if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return res.status(400).json({ error: 'Invalid company role.' });
    const invitedUser = await User.findOne({ email }).select('_id').lean();
    const active = invitedUser ? await CompanyMembership.findOne({ companyId: req.company._id, userId: invitedUser._id, status: 'active' }) : null;
    if (active) return res.status(409).json({ error: 'That person already has access to this company.' });
    await CompanyInvitation.updateMany({ companyId: req.company._id, email, acceptedAt: null, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const invitation = await CompanyInvitation.create({ companyId: req.company._id, email, role, permissions, tokenHash, invitedBy: req.user.sub, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    const acceptPath = `/company-invitations/${rawToken}`;
    const workspaceOrigin = INVITE_BASE_URL;
    const inviter = await User.findById(req.user.sub).select('name').lean().catch(() => null);
    const emailSent = await notifyWorkspaceInvite(email, {
      inviterName: inviter?.name || req.user.name,
      companyName: req.company.name,
      role,
      acceptUrl: `${workspaceOrigin}${acceptPath}`,
      expiresAt: invitation.expiresAt,
      hasAccount: Boolean(invitedUser),
    });
    res.status(201).json({ invitation: { id: invitation.id, email, role, expiresAt: invitation.expiresAt, token: rawToken, acceptPath, emailSent } });
  } catch (e) { next(e); }
});

router.post('/invitations/accept', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'Invitation token is required.' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invitation = await CompanyInvitation.findOne({ tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!invitation) return res.status(404).json({ error: 'This invitation is invalid, expired, or revoked.' });
    const user = await User.findById(req.user.sub);
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) return res.status(403).json({ error: 'Sign in with the invited email address to accept this invitation.' });
    const membership = await CompanyMembership.findOneAndUpdate({ companyId: invitation.companyId, userId: user._id }, { $set: { role: invitation.role, status: 'active', permissions: invitation.permissions, joinedAt: new Date() } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    invitation.acceptedAt = new Date(); await invitation.save();
    const company = await Company.findById(invitation.companyId);
    res.json({ company, membership: publicMembership(membership) });
  } catch (e) { next(e); }
});

router.patch('/members/:membershipId', requireCompany, requirePermission('team:manage'), async (req, res, next) => {
  try {
    const membership = await CompanyMembership.findOne({ _id: req.params.membershipId, companyId: req.company._id });
    if (!membership) return res.status(404).json({ error: 'Member not found.' });
    if (String(membership.userId) === String(req.company.ownerId) && req.body.role && req.body.role !== 'owner') return res.status(400).json({ error: 'The company owner cannot be downgraded here.' });
    if (req.body.role && !ROLE_PERMISSIONS[req.body.role]) return res.status(400).json({ error: 'Invalid role.' });
    if (req.body.role) membership.role = req.body.role;
    if (Array.isArray(req.body.permissions)) membership.permissions = req.body.permissions;
    if (req.body.status && ['active','disabled'].includes(req.body.status)) membership.status = req.body.status;
    await membership.save();
    res.json({ membership: publicMembership(membership) });
  } catch (e) { next(e); }
});

router.delete('/members/:membershipId', requireCompany, requirePermission('team:manage'), async (req, res, next) => {
  try {
    const membership = await CompanyMembership.findOne({ _id: req.params.membershipId, companyId: req.company._id });
    if (!membership) return res.status(404).json({ error: 'Member not found.' });
    if (String(membership.userId) === String(req.company.ownerId)) return res.status(400).json({ error: 'The company owner cannot be removed.' });
    membership.status = 'disabled'; await membership.save();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/integrations', requireCompany, async (req, res, next) => {
  try { res.json({ integrations: await CompanyIntegration.find({ companyId: req.company._id }).sort({ name: 1 }) }); } catch (e) { next(e); }
});

const APPS = [
  ['pinterest','Pinterest','Visual discovery, boards and campaign inspiration','marketing'],
  ['instagram','Instagram','Social content and product campaign workflows','marketing'],
  ['tiktok','TikTok','Short-form product and campaign workflows','marketing'],
  ['shopify','Shopify','Product catalog and commerce sync','commerce'],
  ['woocommerce','WooCommerce','Product catalog and store sync','commerce'],
  ['canva','Canva','Design and campaign asset workflows','creative'],
  ['google-drive','Google Drive','Shared company asset storage','storage'],
  ['dropbox','Dropbox','Shared company asset storage','storage'],
  ['custom-api','Custom API','Connect an internal or external system','developer'],
  ['webhooks','Webhooks','Push Fashion OS events to another system','developer']
];
router.get('/apps', requireCompany, async (req, res, next) => {
  try {
    const connected = await CompanyIntegration.find({ companyId: req.company._id }).lean();
    const map = new Map(connected.map(x => [x.provider, x]));
    res.json({ apps: APPS.map(([id,name,description,category]) => ({ id,name,description,category, integration: map.get(id) || null })) });
  } catch (e) { next(e); }
});
router.post('/integrations/:provider/connect', requireCompany, requirePermission('integrations:manage'), async (req, res, next) => {
  try {
    const app = APPS.find(x => x[0] === req.params.provider);
    if (app?.[0] === 'pinterest') {
      const cfg = pinterestConfig();
      if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) return res.status(503).json({ error: 'Pinterest OAuth is not configured. Add PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET and PINTEREST_REDIRECT_URI to the API environment.', code: 'PINTEREST_OAUTH_NOT_CONFIGURED' });
      const state = signPinterestState({ companyId: String(req.company._id), userId: String(req.user.sub), exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomBytes(12).toString('hex') });
      const url = new URL('https://www.pinterest.com/oauth/');
      url.searchParams.set('client_id', cfg.clientId); url.searchParams.set('redirect_uri', cfg.redirectUri); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'boards:read,boards:read_secret,pins:read,pins:read_secret'); url.searchParams.set('state', state);
      return res.json({ oauth: true, authorizeUrl: url.toString() });
    }
    if (!app) return res.status(404).json({ error: 'Unknown integration.' });
    const integration = await CompanyIntegration.findOneAndUpdate({ companyId: req.company._id, provider: app[0] }, { $set: { name: app[1], status: 'connected', accountName: req.body?.accountName || `${app[1]} account`, config: req.body?.config || {}, scopes: req.body?.scopes || [], connectedAt: new Date(), connectedBy: req.user.sub, error: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    res.json({ integration });
  } catch (e) { next(e); }
});


function pinterestEncryptionKey() {
  return crypto.createHash('sha256').update(String(process.env.PINTEREST_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fabricnow-pinterest-token-key')).digest();
}
function encryptSecret(value) {
  const iv = crypto.randomBytes(12); const key = pinterestEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decryptSecret(value) {
  const [ivB64, tagB64, dataB64] = String(value || '').split('.'); if (!ivB64 || !tagB64 || !dataB64) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', pinterestEncryptionKey(), Buffer.from(ivB64, 'base64url')); decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}
function signPinterestState(payload) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', pinterestEncryptionKey()).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}
function verifyPinterestState(state) {
  const [raw, sig] = String(state || '').split('.'); if (!raw || !sig) throw new Error('Invalid Pinterest OAuth state.');
  const expected = crypto.createHmac('sha256', pinterestEncryptionKey()).update(raw).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid Pinterest OAuth state.');
  const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) throw new Error('Pinterest OAuth state expired.');
  return payload;
}
function normalizeHttpUrl(value, originOnly = false) {
  const candidate = String(value || '').trim().replace(/^(https?):?\/\//i, '$1://');
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return originOnly ? url.origin : url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}
function pinterestConfig() {
  const frontendSetting = process.env.PINTEREST_FRONTEND_URL || process.env.FRONTEND_URL || process.env.WORKSPACE_ORIGIN || '';
  const publicApiUrl = normalizeHttpUrl(process.env.PUBLIC_API_URL);
  const redirectSetting = process.env.PINTEREST_REDIRECT_URI || (publicApiUrl ? `${publicApiUrl}/api/companies/pinterest/oauth/callback` : '');
  return {
    clientId: process.env.PINTEREST_CLIENT_ID || '',
    clientSecret: process.env.PINTEREST_CLIENT_SECRET || '',
    redirectUri: normalizeHttpUrl(redirectSetting),
    frontendUrl: normalizeHttpUrl(String(frontendSetting).split(',')[0], true),
  };
}

router.get('/pinterest/oauth/start', requireCompany, requirePermission('integrations:manage'), async (req, res, next) => {
  try {
    const cfg = pinterestConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) return res.status(503).json({ error: 'Pinterest OAuth is not configured. Add PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET and PINTEREST_REDIRECT_URI to the API environment.', code: 'PINTEREST_OAUTH_NOT_CONFIGURED' });
    const state = signPinterestState({ companyId: String(req.company._id), userId: String(req.user.sub), exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomBytes(12).toString('hex') });
    const url = new URL('https://www.pinterest.com/oauth/');
    url.searchParams.set('client_id', cfg.clientId); url.searchParams.set('redirect_uri', cfg.redirectUri); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'boards:read,boards:read_secret,pins:read,pins:read_secret'); url.searchParams.set('state', state);
    res.json({ authorizeUrl: url.toString() });
  } catch (e) { next(e); }
});

router.get('/pinterest/oauth/callback', async (req, res) => {
  const cfg = pinterestConfig();
  try {
    const state = verifyPinterestState(req.query.state);
    if (!req.query.code) throw new Error('Pinterest did not return an authorization code.');
    const tokenResponse = await fetch('https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: cfg.redirectUri, continuous_refresh: 'true' }) });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.message || 'Pinterest authorization failed.');
    await CompanyIntegration.findOneAndUpdate({ companyId: state.companyId, provider: 'pinterest' }, { $set: { name: 'Pinterest', status: 'connected', accountName: 'Pinterest account', scopes: ['boards:read','boards:read_secret','pins:read','pins:read_secret'], config: { accessToken: encryptSecret(tokenData.access_token), refreshToken: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : '', expiresAt: tokenData.expires_in ? Date.now() + Number(tokenData.expires_in) * 1000 : null }, connectedAt: new Date(), connectedBy: state.userId, error: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const destination = cfg.frontendUrl ? new URL('/?pinterest=connected', cfg.frontendUrl).toString() : '/?pinterest=connected';
    res.redirect(destination);
  } catch (e) {
    console.error('Pinterest OAuth callback failed:', e.message);
    const destination = cfg.frontendUrl ? new URL('/?pinterest=error', cfg.frontendUrl).toString() : '/?pinterest=error';
    res.redirect(destination);
  }
});

router.get('/pinterest/search', requireCompany, requirePermission('integrations:read'), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'Search query is required.' });
    const integration = await CompanyIntegration.findOne({ companyId: req.company._id, provider: 'pinterest', status: 'connected' });
    if (!integration?.config?.accessToken) return res.json({ configured: false, items: [], searchUrl: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}` });
    let accessToken = decryptSecret(integration.config.accessToken);
    let response = await fetch(`https://api.pinterest.com/v5/search/pins?query=${encodeURIComponent(query)}&page_size=24`, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    if (response.status === 401 && integration.config.refreshToken) {
      const refreshToken = decryptSecret(integration.config.refreshToken);
      const cfg = pinterestConfig();
      const refresh = await fetch('https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, continuous_refresh: 'true' }) });
      const refreshed = await refresh.json().catch(() => ({}));
      if (refresh.ok && refreshed.access_token) { accessToken = refreshed.access_token; integration.config.accessToken = encryptSecret(accessToken); if (refreshed.refresh_token) integration.config.refreshToken = encryptSecret(refreshed.refresh_token); integration.config.expiresAt = refreshed.expires_in ? Date.now() + Number(refreshed.expires_in) * 1000 : integration.config.expiresAt; await integration.save(); response = await fetch(`https://api.pinterest.com/v5/search/pins?query=${encodeURIComponent(query)}&page_size=24`, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }); }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Pinterest search failed.', code: data.code || 'PINTEREST_SEARCH_FAILED' });
    const items = (data.items || []).map(pin => ({ id: pin.id, title: pin.title || pin.description || pin.alt_text || 'Pinterest inspiration', description: pin.description || '', altText: pin.alt_text || '', link: pin.link || `https://www.pinterest.com/pin/${pin.id}/`, imageUrl: pin.media?.images?.['1200x']?.url || pin.media?.images?.['600x']?.url || pin.media?.images?.['400x300']?.url || '', boardOwner: pin.board_owner || null, source: 'Pinterest' }));
    res.json({ configured: true, items, bookmark: data.bookmark || null });
  } catch (e) { next(e); }
});

router.get('/inspirations', requireCompany, requirePermission('assets:read'), async (req, res, next) => { try { res.json({ inspirations: await Inspiration.find({ companyId: req.company._id }).sort({ createdAt: -1 }).limit(100) }); } catch (e) { next(e); } });
router.post('/inspirations', requireCompany, requirePermission('assets:write'), async (req, res, next) => { try { const body = req.body || {}; if (!body.sourceUrl && !body.imageUrl) return res.status(400).json({ error: 'A source or image URL is required.' }); const inspiration = await Inspiration.findOneAndUpdate({ companyId: req.company._id, provider: body.provider || 'pinterest', externalId: body.externalId || crypto.createHash('sha1').update(String(body.sourceUrl || body.imageUrl)).digest('hex') }, { $set: { title: body.title || 'Inspiration', description: body.description || '', imageUrl: body.imageUrl || '', sourceUrl: body.sourceUrl || '', sourceAccount: body.sourceAccount || '', createdBy: req.user.sub, metadata: body.metadata || {} } }, { upsert: true, new: true, setDefaultsOnInsert: true }); res.status(201).json({ inspiration }); } catch (e) { next(e); } });
router.delete('/integrations/:provider', requireCompany, requirePermission('integrations:manage'), async (req, res, next) => {
  try { await CompanyIntegration.deleteOne({ companyId: req.company._id, provider: req.params.provider }); res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports = router;
