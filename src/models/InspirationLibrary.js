const { Schema, model } = require('mongoose');
// Platform-wide Pinterest inspiration library. Deliberately has NO companyId:
// every company sees the same documents. Company-private saves still live in
// the existing Inspiration model.
const schema = new Schema({
  seedId: { type: Number, required: true, unique: true },
  type: { type: String, enum: ['board', 'pin', 'search'], required: true, index: true },
  gender: { type: String, enum: ['female', 'male', 'unisex'], index: true },
  category: { type: String, index: true },
  style: String,
  region: { type: String, index: true },
  title: String,
  sourceAccount: { type: String, default: '' },
  url: { type: String, required: true },
  searchQuery: { type: String, default: '' },
  tags: { type: [String], index: true },
  origin: { type: String, default: 'original' },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });
schema.index({ title: 'text', style: 'text', tags: 'text' });
schema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });
module.exports = model('InspirationLibrary', schema);
