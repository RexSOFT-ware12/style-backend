const { Schema, model } = require('mongoose');

const invitationSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  role: { type: String, default: 'designer' },
  permissions: { type: [String], default: [] },
  tokenHash: { type: String, required: true, unique: true, index: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });
module.exports = model('CompanyInvitation', invitationSchema);
