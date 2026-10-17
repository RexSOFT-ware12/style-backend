const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true }, projectId: { type: Schema.Types.ObjectId, ref: 'WorkspaceProject', default: null, index: true },
  title: { type: String, required: true }, status: { type: String, enum: ['queued','running','review','approved','rejected'], default: 'queued', index: true },
  score: { type: Number, default: null }, findings: { type: [Schema.Types.Mixed], default: [] }, notes: String,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, reviewedAt: Date
}, { timestamps: true });
schema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}}); module.exports=model('QualityAudit',schema);
