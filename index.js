// ✅ index.js
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import admin from "firebase-admin";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";

dotenv.config();
const stripe = new Stripe(process.env.PAYMENT_GATEWAY_KEY);
const app = express();
const port = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors());
app.use(express.json());

// firebase service account setup
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, "base64").toString(
    "utf8"
  )
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ MongoDB Client Setup
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: "1",
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;
let ridersCollection;
let parcelsCollection;
let paymentsCollection;
let trackingCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("parcelDB");
    usersCollection = db.collection("users");
    ridersCollection = db.collection("riders");
    parcelsCollection = db.collection("parcels");
    paymentsCollection = db.collection("payments");
    trackingCollection = db.collection("tracking");
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error("❌ MongoDB Connection Failed:", err);
  }
}
connectDB();

// Middlewares
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized Access" });
  }

  // verify the token
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(403).json({ message: "Forbidden: Invalid or expired token" });
  }
};

// ✅ Test Route
app.get("/", (req, res) => {
  res.send("📦 Parcel Delivery Server is Running");
});

// Users API

// Get Users by search
app.get("/users/search", async (req, res) => {
  try {
    const emailQuery = req.query.email;
    if (!emailQuery) {
      return res.status(400).json({ message: "Email is required" });
    }

    const users = await usersCollection
      .find({
        email: { $regex: new RegExp(emailQuery, "i") }, // case-insensitive partial match
      })
      .limit(10)
      .toArray();

    // if (users.length === 0) {
    //   return res.status(404).json({ message: "No users found" });
    // }

    res.status(200).json(users);
  } catch (error) {
    console.error("Error searching users:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update user role to make or remove as admin
app.patch("/users/:id/role", async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;

  // ✅ Allow only "admin" or "user"
  if (!["admin", "user"].includes(role)) {
    return res
      .status(400)
      .json({ message: "Invalid role. Only 'admin' or 'user' allowed." });
  }

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );

    if (result.modifiedCount === 0) {
      return res
        .status(404)
        .json({ message: "User not found or role already set" });
    }

    res.status(200).json({
      message: `User role updated to ${role}`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Failed to update user role:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Post users data
app.post("/users", async (req, res) => {
  try {
    const email = req.body.email;
    const userExists = await usersCollection.findOne({ email });
    if (userExists) {
      await usersCollection.updateOne(
        { email },
        { $set: { last_log_in: new Date().toISOString() } }
      );
      return res
        .status(200)
        .json({ message: "User already exists!", inserted: false });
    }

    const user = req.body;
    const result = await usersCollection.insertOne(user);
    res.status(201).json({
      message: "User created",
      inserted: true,
      insertedId: result.insertedId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Riders API

// GET /riders/pending
app.get("/riders/pending", async (req, res) => {
  try {
    const pendingRiders = await ridersCollection
      .find({ status: "pending" })
      .sort({ created_at: -1 }) // sort by latest
      .toArray();

    res.json(pendingRiders);
  } catch (err) {
    console.error("Error fetching pending riders:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /riders/active
app.get("/riders/active", async (req, res) => {
  try {
    const activeRiders = await ridersCollection
      .find({ status: "accepted" })
      .sort({ created_at: -1 }) // newest first
      .toArray();

    res.json(activeRiders);
  } catch (err) {
    console.error("Failed to fetch active riders:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Post riders
app.post("/riders", async (req, res) => {
  try {
    const newRider = req.body;
    const result = await ridersCollection.insertOne(newRider);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Error adding rider:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH /riders/:id update status
app.patch("/riders/:id", async (req, res) => {
  const { id } = req.params;
  const { status, email } = req.body;

  const result = await ridersCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: { status },
    }
  );

  // update user role for accepted riders
  if (status === "accepted") {
    await usersCollection.updateOne({ email }, { $set: { role: "rider" } });
  }

  res.send(result);
});

// Parcels API
// ✅ Get All Parcels and Parcels by User Email
app.get("/parcels", verifyFBToken, async (req, res) => {
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

// POST /tracking - Add a new tracking log
app.post("/tracking", async (req, res) => {
  try {
    const {
      tracking_id,
      parcel_id,
      status,
      message,
      updated_by = "",
    } = req.body;

    // ✅ Basic validation
    if (!tracking_id || !parcel_id || !status || !message) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: tracking_id, parcel_id, status, message",
      });
    }

    // ✅ Create tracking log object
    const log = {
      tracking_id,
      parcel_id: new ObjectId(parcel_id),
      status,
      message,
      time: new Date(),
      updated_by,
    };

    // ✅ Insert into DB
    const result = await trackingCollection.insertOne(log);

    res.status(201).json({
      success: true,
      insertedId: result.insertedId,
      message: "Tracking log added successfully",
    });
  } catch (error) {
    console.error("❌ Error posting tracking log:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Get payments history
app.get("/payments", verifyFBToken, async (req, res) => {
  try {
    const userEmail = req.query.email;

    if (req?.user?.email !== userEmail) {
      res.status(403).json({ message: "Unauthorized access!" });
    }

    const query = userEmail ? { email: userEmail } : {};
    const options = { sort: { paid_at: -1 } }; // Latest First

    const payments = await paymentsCollection.find(query, options).toArray();
    res.json(payments);
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({ message: "Failed to get payments" });
  }
});

// Record Payment and update parcel status
app.post("/payments", async (req, res) => {
  try {
    const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

    if (!parcelId || !email || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Update parcel payment status
    const updateResult = await parcelsCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      { $set: { payment_status: "paid" } }
    );

    if (updateResult.modifiedCount === 0) {
      return res
        .status(404)
        .send({ message: "Parcel not found or already paid!" });
    }

    // Insert payment record
    const paymentDoc = {
      parcelId,
      email,
      amount,
      paymentMethod,
      transactionId,
      paid_at_string: new Date().toISOString(),
      paid_at: new Date(),
    };

    const paymentResult = await paymentsCollection.insertOne(paymentDoc);
    res.status(201).send({
      message: "Payment recorded and parcel marked as recorded!",
      insertedId: paymentResult.insertedId,
    });
  } catch (error) {
    console.error("❌ Payment Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Stripe create payment intent api
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amountInCents } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      payment_method_types: ["card"],
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
