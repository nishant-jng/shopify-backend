const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const path = require("path");

dotenv.config();

// --- Import modular routes ---
const updateCustomerRoutes = require('./routes/updateCustomer');
const aiSearchRoutes = require('./routes/aiSearch');
const updateCustomerWishlistRoutes = require('./routes/updateCustomerWishlist');
const getCustomerWishListRoutes = require('./routes/getCustomerWishlist');
const customerListsRoutes = require('./routes/customerLists');
const shareListRoutes = require('./routes/shareList');
const customers = require('./routes/customers');




// --- Environment Variable Validation ---
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY, PORT = 3000 } = process.env;

if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
  console.error('Missing required Shopify environment variables: SHOPIFY_STORE and/or SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY environment variable. AI Search will fail.");
    // We don't exit here, so the customer update endpoint can still run
}

// --- App Initialization & Middleware ---
const app = express();

app.set('trust proxy', 1); // Trust first proxy, adjust if needed
app.use(express.json()); // Middleware to parse JSON bodies
app.use(cors());         // Middleware to enable CORS

// --- Route Mounting ---
// All requests to /update-customer-metafields will be handled by updateCustomerRoutes
app.use("/update-customer-metafields", updateCustomerRoutes);

// All requests to /ai-search will be handled by aiSearchRoutes
app.use("/ai-search", aiSearchRoutes);

app.use("/wishlist",updateCustomerWishlistRoutes);
app.use("/customer-wishlist", getCustomerWishListRoutes);

app.use('/customer-lists', customerListsRoutes); 
app.use("/share-list", shareListRoutes);
app.use("/customers", customers);
// --- Core Routes ---
// Health check endpoint to verify the server is running
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    shopify_store: SHOPIFY_STORE ? "configured" : "not configured"
  });
});

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Shopify Store: ${SHOPIFY_STORE}`);
});
