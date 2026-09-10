/**
 * MongoDB connection (Mongoose).
 *
 * Requires MONGODB_URI to be set (e.g. a MongoDB Atlas connection string) in
 * backend/.env:
 *
 *   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/fabricnow
 *
 * connectDB() is called once from server.js before the app starts listening.
 */
const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to backend/.env, e.g.\n" +
        "  MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/fabricnow"
    );
  }

  mongoose.connection.on("connected", () => {
    console.log(`MongoDB connected (${mongoose.connection.name})`);
  });
  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
  });

  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = { connectDB, mongoose };
