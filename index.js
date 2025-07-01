// ✅ index.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

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

// GET /parcels/:id
app.get("/parcels/:id", async (req, res) => {
  const { id } = req.params;

  // Check if valid MongoDB ObjectId
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid parcel ID" });
  }

  try {
    const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });

    if (!parcel) {
      return res.status(404).json({ error: "Parcel not found" });
    }

    res.json(parcel);
  } catch (error) {
    console.error("Error fetching parcel:", error);
    res.status(500).json({ error: "Internal Server Error" });
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

// DELETE a parcel by ID
app.delete("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid parcel ID." });
    }

    const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Parcel not found." });
    }

    res.status(200).json({
      message: "Parcel deleted successfully.",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Stripe create payment intent api
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
