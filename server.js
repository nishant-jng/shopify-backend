const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

// Validate environment variables on startup
if (!SHOPIFY_STORE || !ADMIN_API_TOKEN) {
  console.error('Missing required environment variables: SHOPIFY_STORE and/or SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

app.post("/update-customer-metafields", async (req, res) => {
  const { customerId, customer_name, business_name, customer_role, customer_phone } = req.body;

  // Input validation
  if (!customerId || !customer_name || !customer_role) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      details: 'customerId, customer_name, and customer_role are required fields'
    });
  }

  // Validate customerId is numeric
  if (!/^\d+$/.test(customerId.toString())) {
    return res.status(400).json({ 
      error: 'Invalid customerId',
      details: 'customerId must be a numeric value'
    });
  }

  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { 
          id 
          key 
          value 
          namespace
          type
        }
        userErrors { 
          field 
          message 
          code
        }
      }
    }
  `;

  // Construct the metafields array based on the expected types
  const metafieldsPayload = [
    {
      ownerId: `gid://shopify/Customer/${customerId}`,
      namespace: "custom",
      key: "name",
      type: "single_line_text_field",
      value: customer_name
    },
    {
      ownerId: `gid://shopify/Customer/${customerId}`,
      namespace: "custom",
      key: "business_name",
      type: "single_line_text_field",
      value: business_name || ""
    },
    {
      ownerId: `gid://shopify/Customer/${customerId}`,
      namespace: "custom",
      key: "role",
      // FIX: Changed type back to a single value field
      type: "single_line_text_field",
      // FIX: Value is now a simple string, not a stringified array
      value: customer_role
    },
    {
      ownerId: `gid://shopify/Customer/${customerId}`,
      namespace: "custom",
      key: "phone",
      // FIX: Changed type to match Shopify definition 'number_integer'
      type: "number_integer",
      // For number types, the value must be a string representation of the number.
      value: customer_phone ? customer_phone.toString() : ""
    }
  ];

  const variables = {
    metafields: metafieldsPayload
  };

  try {
    const response = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_API_TOKEN
      },
      data: { query, variables }
    });

    const result = response.data;

    // Check for GraphQL errors
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return res.status(400).json({ 
        error: 'GraphQL errors occurred',
        details: result.errors
      });
    }

    // Check for user errors in the mutation response
    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('User errors:', result.data.metafieldsSet.userErrors);
      return res.status(400).json({ 
        error: 'Metafield validation errors',
        details: result.data.metafieldsSet.userErrors
      });
    }

    // Success response
    res.json({
      success: true,
      data: result.data.metafieldsSet.metafields,
      message: 'Customer metafields updated successfully'
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ 
      error: "Failed to update metafields",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    timestamp: new Date().toISOString(),
    shopify_store: SHOPIFY_STORE ? "configured" : "not configured"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Shopify Store: ${SHOPIFY_STORE}`);
  console.log(`Admin API Token: ${ADMIN_API_TOKEN ? 'configured' : 'not configured'}`);
});



// server.js - Shopify Admin API integration with Gemini AI Search
// This file provides an API to update customer metafields and integrates with Gemini AI for product search
// ---------------- Gemini AI Search Integration ---------------- //

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Validate
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY env variable");
}

// Simple helper to fetch products (title, description, tags, images)
async function fetchProductsForCapsules() {
  const query = `
    {
      products(first: 50) {
        edges {
          node {
            id
            handle
            title
            vendor
            tags
            description
            images(first: 1) { edges { node { url } } }
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
          }
        }
      }
    }
  `;

  const response = await axios({
    method: "POST",
    url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_API_TOKEN
    },
    data: { query }
  });

  const products = response.data.data.products.edges.map(({ node }) => ({
    id: node.id,
    handle: node.handle,
    title: node.title,
    vendor: node.vendor,
    tags: node.tags,
    summary: node.description ? node.description.slice(0, 200) : "",
    imageUrl: node.images.edges[0]?.node?.url || null,
    price: node.priceRangeV2.minVariantPrice.amount,
    currency: node.priceRangeV2.minVariantPrice.currencyCode,
  }));

  return products;
}

// Gemini call
async function geminiSearch(userQuery, products) {
  const prompt = `
You are an e-commerce search assistant for a Shopify store.
User query: "${userQuery}"

Available products (capsules):
${products.map(
  p => `- ${p.title} (${p.price} ${p.currency}) | ${p.summary} | Tags: ${p.tags.join(", ")}`
).join("\n")}

Rules:
- Return ONLY titles of products that are strong matches.
- No guessing. If nothing matches, return [].
- Max 3 items.
Output JSON: { "matches": ["Product A","Product B"] }
`;

  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    },
    { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
  );

  const text = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}

// 👇 Add limiter here
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    console.warn(
      `Rate limit exceeded for IP: ${req.ip} at ${new Date().toISOString()}`
    );
    res.status(options.statusCode).json({
      error: "Too many requests",
      details: "You can only make 5 AI search requests per minute. Please wait and try again."
    });
  }
});

// New API route
app.post("/ai-search", searchLimiter , async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const products = await fetchProductsForCapsules();
    const result = await geminiSearch(query, products);

    // Map product titles back to full objects
    const matched = products.filter(p => result.matches.includes(p.title));

    res.json({ matches: matched });
  } catch (err) {
    console.error("Gemini search failed:", err.message);
    res.status(500).json({ error: "Something went wrong!", details: err.message });
  }
});

