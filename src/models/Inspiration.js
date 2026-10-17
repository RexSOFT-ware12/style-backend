const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  provider: { type: String, enum: ['pinterest','manual'], default: 'pinterest', index: true },
  externalId: { type: String, default: '' },
  title: String,
  description: String,
  imageUrl: String,
  sourceUrl: String,
  sourceAccount: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
schema.index({ companyId: 1, provider: 1, externalId: 1 }, { unique: true, sparse: true });
schema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });
module.exports = model('Inspiration', schema);
