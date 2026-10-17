const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'WorkspaceProject', default: null, index: true },
  name: { type: String, required: true, trim: true }, version: { type: Number, default: 1 },
  status: { type: String, enum: ['draft','review','approved','archived'], default: 'draft' },
  sections: { type: Schema.Types.Mixed, default: {} }, notes: String, approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, approvedAt: Date
}, { timestamps: true });
schema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}}); module.exports=model('TechPack',schema);
