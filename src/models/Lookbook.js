const { Schema, model } = require('mongoose');
const itemSchema = new Schema({
  name: { type: String, default: '' }, price: { type: String, default: '' }, note: { type: String, default: '' },
  mime: { type: String, default: 'image/jpeg' }, data: { type: Buffer, required: true },
}, { _id: false });
const schema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  slug: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: 'Lookbook' }, brand: { type: String, default: '' }, subtitle: { type: String, default: '' },
  currency: { type: String, default: 'USD' }, theme: { type: String, default: 'light' },
  items: [itemSchema],
}, { timestamps: true });
module.exports = model('Lookbook', schema);
