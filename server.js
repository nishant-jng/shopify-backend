const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");

// --- Import modular routes ---
const updateCustomerRoutes = require('./routes/updateCustomer');
const aiSearchRoutes = require('./routes/aiSearch');
const updateCustomerWishlistRoutes = require('./routes/updateCustomerWishlist');
const getCustomerWishListRoutes = require('./routes/getCustomerWishlist');
const customerListsRoutes = require('./routes/customerLists');
const shareListRoutes = require('./routes/shareList'); 
const customers = require('./routes/customers');
const visualSearchRoutes = require('./routes/visualSearch');
const merchantsRoutes = require('./routes/merchants');
const proxyRoutes = require('./routes/proxy');
const tradeRoutes = require('./routes/trades');
const travelRoutes = require('./routes/travelBill');
const testRoutes = require('./routes/test');
const buyersRoutes = require('./routes/buyers');
const consultancyInvoicesRoutes = require('./routes/consultancyInvoices');

 
// --- Environment Variable Validation ---
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY} = process.env;
const PORT = process.env.PORT || 8080;


if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
  console.error('Missing required Shopify environment variables: SHOPIFY_STORE and/or SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY environment variable. AI Search will fail.");
}

// --- App Initialization & Middleware ---
const app = express();
app.set('trust proxy', 1);
app.use(express.json());

const allowedOrigins = [
  "https://jn-global.myshopify.com",
  "https://jnitin.com",
  "https://www.jnitin.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser tools (e.g. Postman)
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`🚫 CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


// --- App Proxy Routes (must be mounted at /apps/proxy) ---
// These routes are accessed via: yourstore.myshopify.com/apps/proxy/...
// app.use("/proxy/customers", customers);
app.use("/customers", customers);
// --- Regular API Routes (non-proxy) ---
app.use("/update-customer-metafields", updateCustomerRoutes);
app.use("/ai-search", aiSearchRoutes);
app.use("/wishlist", updateCustomerWishlistRoutes);
app.use("/customer-wishlist", getCustomerWishListRoutes);
app.use('/customer-lists', customerListsRoutes); 
app.use("/share-list", shareListRoutes);
app.use("/visual-search", visualSearchRoutes);
app.use("/proxy/merchants",merchantsRoutes)
app.use('/proxy', proxyRoutes);
app.use('/trades', tradeRoutes);
app.use('/travel-bill', travelRoutes);
app.use('/test', testRoutes);
app.use('/volume', buyersRoutes);
app.use('/proxy/consultancy', consultancyInvoicesRoutes);


// --- Core Routes ---
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    shopify_store: SHOPIFY_STORE ? "configured" : "not configured"
  }); 
});

// // --- 404 Handler for debugging ---
// app.use((req, res) => {
//   console.log('❌ 404 - Route not found:', req.method, req.originalUrl);
//   console.log('Headers:', JSON.stringify(req.headers, null, 2));
//   res.status(404).json({ 
//     success: false, 
//     error: 'Route not found',
//     path: req.originalUrl,
//     method: req.method
//   });
// });

// --- Server Startup ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Shopify Store: ${SHOPIFY_STORE}`);
  console.log('App Proxy routes mounted at: /apps/proxy/customers');
});

module.exports = app;