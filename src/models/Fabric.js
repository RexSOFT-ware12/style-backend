const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true }, supplier: String, code: String, composition: String,
  weightGsm: Number, widthCm: Number, color: String, pattern: String, origin: String, notes: String,
  imageUrl: String, status: { type: String, enum: ['active','archived'], default: 'active' }, meta: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });
schema.index({ companyId: 1, updatedAt: -1 });
schema.set('toJSON', { virtuals: true, transform: (_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;} });
module.exports = model('Fabric', schema);
