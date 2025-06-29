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

// Parcels API
// ✅ Get All Parcels and Parcels by User Email
app.get("/parcels", async (req, res) => {
  try {
    const { email } = req.query;
    const query = email ? { created_by: email } : {};
    const options = {
      sort: { creation_date: -1 }, // 🔽 Latest first
    };
    const result = await parcelsCollection.find(query, options).toArray();
    res.send(result);
  } catch (err) {
    console.error("❌ Error fetching parcels:", err);
    res.status(500).send({ error: "Failed to fetch parcels" });
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
