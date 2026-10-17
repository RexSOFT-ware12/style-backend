const Company = require('../models/Company');
const CompanyMembership = require('../models/CompanyMembership');

const ROLE_PERMISSIONS = {
  owner: ['*'],
  admin: ['*'],
  designer: ['products:read','products:write','fabrics:read','fabrics:write','measurements:read','measurements:write','techpacks:read','techpacks:write','assets:read','assets:write','collections:read','collections:write','integrations:read'],
  merchandiser: ['products:read','products:write','fabrics:read','fabrics:write','measurements:read','techpacks:read','techpacks:write','collections:read','collections:write','marketing:read','marketing:write'],
  reviewer: ['products:read','fabrics:read','measurements:read','techpacks:read','quality:read','quality:write','assets:read'],
  production: ['products:read','fabrics:read','measurements:read','techpacks:read','production:read','production:write','quality:read','quality:write','assets:read','assets:write'],
  marketing: ['products:read','collections:read','collections:write','marketing:read','marketing:write','assets:read','assets:write','integrations:read']
};

function permissionsFor(membership) {
  const role = membership?.role || 'designer';
  return new Set([...(ROLE_PERMISSIONS[role] || []), ...(membership?.permissions || [])]);
}

async function backfillLegacyWorkspace(userId, companyId) {
  const WorkspaceProject = require('../models/WorkspaceProject');
  const WorkspaceCollection = require('../models/WorkspaceCollection');
  const WorkspaceAsset = require('../models/WorkspaceAsset');
  const WorkspaceTeam = require('../models/WorkspaceTeam');
  await Promise.all([
    WorkspaceProject.updateMany({ userId, companyId: { $exists: false } }, { $set: { companyId } }),
    WorkspaceCollection.updateMany({ userId, companyId: { $exists: false } }, { $set: { companyId } }),
    WorkspaceAsset.updateMany({ userId, companyId: { $exists: false } }, { $set: { companyId } }),
    WorkspaceTeam.updateMany({ userId, companyId: { $exists: false } }, { $set: { companyId } })
  ]);
}

async function ensureCompanyForUser(user) {
  let membership = await CompanyMembership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
  if (membership) {
    const company = await Company.findById(membership.companyId);
    if (company) {
      await backfillLegacyWorkspace(user._id, company._id);
      return { company, membership };
    }
  }

  const name = String(user.companyName || `${user.name || 'My'} Company`).trim() || 'My Company';
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `company-${String(user._id).slice(-8)}`;
  let slug = base;
  let i = 2;
  while (await Company.exists({ slug })) slug = `${base}-${i++}`;
  const company = await Company.create({ name, slug, ownerId: user._id });
  membership = await CompanyMembership.create({ companyId: company._id, userId: user._id, role: 'owner', status: 'active', permissions: ['*'] });
  await backfillLegacyWorkspace(user._id, company._id);
  return { company, membership };
}

async function requireCompany(req, res, next) {
  try {
    const requestedId = req.headers['x-company-id'] || req.query.companyId || req.body?.companyId;
    let membership;
    if (requestedId) {
      membership = await CompanyMembership.findOne({ companyId: requestedId, userId: req.user.sub, status: 'active' });
      if (!membership) return res.status(403).json({ error: 'You do not have access to this company.' });
    } else {
      membership = await CompanyMembership.findOne({ userId: req.user.sub, status: 'active' }).sort({ createdAt: 1 });
      if (!membership) {
        const User = require('../models/User');
        const user = await User.findById(req.user.sub);
        if (!user) return res.status(401).json({ error: 'User account not found.' });
        const ensured = await ensureCompanyForUser(user);
        membership = ensured.membership;
      }
    }
    const company = await Company.findById(membership.companyId);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    req.company = company;
    req.membership = membership;
    req.companyPermissions = permissionsFor(membership);
    next();
  } catch (err) { next(err); }
}

function requirePermission(permission) {
  return (req, res, next) => {
    const p = req.companyPermissions || new Set();
    if (p.has('*') || p.has(permission)) return next();
    return res.status(403).json({ error: `Your company role does not allow ${permission}.` });
  };
}

module.exports = { ROLE_PERMISSIONS, permissionsFor, ensureCompanyForUser, requireCompany, requirePermission };
