// Usage: node src/scripts/make-admin.js you@example.com [--remove]
// Marks an existing user as an admin (or removes the role with --remove).
require("dotenv").config();
const { connectDB, mongoose } = require("../db");
const User = require("../models/User");

(async () => {
  const email = (process.argv[2] || "").toLowerCase();
  const remove = process.argv.includes("--remove");
  if (!email) {
    console.error("Usage: node src/scripts/make-admin.js you@example.com [--remove]");
    process.exit(1);
  }
  await connectDB();
  const r = await User.updateOne({ email }, { $set: { role: remove ? "user" : "admin" } });
  console.log(r.matchedCount ? `${email} is now ${remove ? "a normal user" : "an admin"}.` : `No user found with email ${email}.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
