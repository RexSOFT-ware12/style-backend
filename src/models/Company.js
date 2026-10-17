const { Schema, model } = require('mongoose');

const companySchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  brandKit: {
    logo: String,
    primaryColor: String,
    secondaryColor: String,
    font: String,
    voice: String,
    currency: { type: String, default: 'USD' }
  },
  settings: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

companySchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });
module.exports = model('Company', companySchema);
