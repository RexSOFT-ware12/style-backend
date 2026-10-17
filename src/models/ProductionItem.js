const { Schema, model } = require('mongoose');
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'WorkspaceProject', default: null, index: true },
  title: { type: String, required: true, trim: true }, stage: { type: String, enum: ['queued','sampling','production','quality','ready','shipped'], default: 'queued', index: true },
  assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, priority: { type: String, enum: ['low','normal','high','urgent'], default: 'normal' }, dueDate: Date,
  notes: String, meta: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });
schema.set('toJSON',{virtuals:true,transform:(_d,r)=>{r.id=r._id.toString();delete r._id;delete r.__v;return r;}}); module.exports=model('ProductionItem',schema);
