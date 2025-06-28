// ✅ index.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { MongoClient } from "mongodb";

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());

// ✅ MongoDB Client Setup
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: "1",
    strict: true,
    deprecationErrors: true,
  },
});

let parcelsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("parcelDB");
    parcelsCollection = db.collection("parcels");
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err);
  }
}
connectDB();

// ✅ Test Route
app.get("/", (req, res) => {
  res.send("📦 Parcel Delivery Server is Running");
});

// ✅ Get All Parcels
app.get("/parcels", async (req, res) => {
  try {
    const parcels = await parcelsCollection.find().toArray();
    res.send(parcels);
  } catch (err) {
    res.status(500).send({ error: "❌ Failed to fetch parcels" });
  }
});

// ✅ Get Parcels by User Email (optional)
app.get("/parcels/user", async (req, res) => {
  const email = req.query.email;
  try {
    const result = await parcelsCollection
      .find({ created_by: email })
      .toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "❌ Failed to fetch user parcels" });
  }
});

// ✅ Save Parcel to MongoDB
app.post("/parcels", async (req, res) => {
  const parcel = req.body;
  try {
    const result = await parcelsCollection.insertOne(parcel);
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: "❌ Failed to insert parcel" });
  }
});

// ✅ Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
