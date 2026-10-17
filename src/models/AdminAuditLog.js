const { Schema, model } = require("mongoose");

// Every money/access-affecting thing an admin does from the dashboard
// (block a user, mark an API plan paid, grant credits, change a provider
// key...). Never stores secret values — only which key name changed.
const adminAuditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorEmail: { type: String },
    action: { type: String, required: true, index: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", required: false, index: true },
    targetLabel: { type: String },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

adminAuditLogSchema.set("toJSON", {
  transform: (_d, r) => {
    r.id = r._id.toString();
    delete r._id;
    delete r.__v;
    return r;
  },
});

module.exports = model("AdminAuditLog", adminAuditLogSchema);
