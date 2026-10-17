const { Schema, model } = require('mongoose');

const ROLES = ['owner', 'admin', 'designer', 'merchandiser', 'reviewer', 'production', 'marketing'];
const membershipSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ROLES, default: 'designer' },
  status: { type: String, enum: ['invited', 'active', 'disabled'], default: 'active', index: true },
  permissions: { type: [String], default: [] },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  joinedAt: { type: Date, default: Date.now }
}, { timestamps: true });
membershipSchema.index({ companyId: 1, userId: 1 }, { unique: true });
membershipSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });
module.exports = model('CompanyMembership', membershipSchema);
module.exports.ROLES = ROLES;
