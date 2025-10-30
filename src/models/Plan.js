const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyLogoUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', PlanSchema);

