const { Schema, model } = require('mongoose');
const patternRequestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'Garment pattern request' },
  garment: { type: String, default: 'Not specified' },
  lining: { type: String, default: 'none' },
  notes: { type: String, default: '' },
  formats: { type: Schema.Types.Mixed, default: [] },
  extraCuts: { type: Boolean, default: false },
  sourceImage: { type: String, required: true },
  sourceImageName: String,
  swatchImage: String,
  swatchImageName: String,
  status: { type: String, enum: ['submitted', 'processing', 'completed', 'revision_requested'], default: 'submitted', index: true },
  adminNote: { type: String, default: '' },
  resultZip: String,
  resultZipName: String,
  previewImages: [{ path: String, name: String }],
  completedAt: Date,
}, { timestamps: true });
patternRequestSchema.index({ createdAt: -1 });
module.exports = model('PatternRequest', patternRequestSchema);
