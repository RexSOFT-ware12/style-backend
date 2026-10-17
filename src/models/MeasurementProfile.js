const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true }, category: String, unit: { type: String, enum: ['cm','in'], default: 'cm' },
  sizes: { type: [String], default: [] }, measurements: { type: Schema.Types.Mixed, default: {} }, notes: String,
  status: { type: String, enum: ['draft','active','archived'], default: 'draft' }
}, { timestamps: true });
schema.set('toJSON', { virtuals:true, transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;} });
module.exports=model('MeasurementProfile',schema);
