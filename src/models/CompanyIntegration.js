const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  provider: { type: String, required: true, index: true }, name: { type: String, required: true },
  status: { type: String, enum: ['available','connected','error','disabled'], default: 'available' }, accountName: String,
  scopes: { type: [String], default: [] }, config: { type: Schema.Types.Mixed, default: {} }, connectedAt: Date, connectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  lastSyncAt: Date, error: String
}, { timestamps: true });
schema.index({ companyId: 1, provider: 1 }, { unique: true });
schema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}}); module.exports=model('CompanyIntegration',schema);
