const { Schema, model } = require('mongoose');

const workspaceAssetSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: Schema.Types.ObjectId, ref: 'WorkspaceProject', default: null, index: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['image', 'video', 'document', 'pattern', 'tech-pack', 'other'], default: 'image' },
  url: { type: String, required: true, trim: true },
  mime: String,
  size: Number,
  status: { type: String, enum: ['draft', 'processing', 'ready', 'archived'], default: 'ready' },
  tags: { type: [String], default: [] },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

workspaceAssetSchema.index({ userId: 1, updatedAt: -1 });

workspaceAssetSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = model('WorkspaceAsset', workspaceAssetSchema);
