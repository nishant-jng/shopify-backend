// aiSearchRouter.js
const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// --- Config & env ---
const {
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_TOKEN,
  GEMINI_API_KEY,
  MAX_PRODUCTS,        // optional env override (e.g., 350)
  PRODUCT_CACHE_TTL_MS // optional env override (e.g., 300000 for 5min)
} = process.env;

const SHOPIFY_GQL_ENDPOINT = SHOPIFY_STORE
  ? `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`
  : null;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const AXIOS_TIMEOUT_MS = 15000;
const PRODUCTS_LIMIT = parseInt(MAX_PRODUCTS || "350", 10); // clamp number of products in prompt
const CACHE_TTL = parseInt(PRODUCT_CACHE_TTL_MS || String(5 * 60 * 1000), 10); // default 5 minutes

// Basic env checks (we don't crash module — we return errors when endpoint is called)
if (!GEMINI_API_KEY) {
  console.warn("Warning: GEMINI_API_KEY not set - /ai-search will fail if used.");
}
if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_TOKEN) {
  console.warn("Warning: SHOPIFY_STORE/SHOPIFY_ADMIN_TOKEN not fully configured - server-side Shopify fetches will fail.");
}

// --- In-memory cache for Shopify products ---
let productCache = {
  ts: 0,
  data: []
};

// --- Helper: sanitize text for inclusion in prompt ---
function sanitizeText(str, maxLen = 220) {
  if (!str) return "";
  // collapse whitespace, remove code fences and backticks, trim
  let s = String(str).replace(/[`]/g, "").replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + "…";
  return s;
}

// --- Helper: fetch products from Shopify Admin (with pagination single-shot, limited) ---
async function fetchProductsFromShopify(limit = PRODUCTS_LIMIT) {
  if (!SHOPIFY_GQL_ENDPOINT || !SHOPIFY_ADMIN_TOKEN) {
    throw new Error("Shopify Admin credentials not configured");
  }

  // Return cache if fresh
  const now = Date.now();
  if (productCache.ts && (now - productCache.ts) < CACHE_TTL && productCache.data?.length) {
    return productCache.data.slice(0, limit);
  }

  const query = `
    query ProductsPage($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            handle
            title
            vendor
            tags
            description
            images(first: 1) { edges { node { url } } }
            priceRangeV2 { minVariantPrice { amount currencyCode } }
          }
        }
      }
    }
  `;

  let all = [];
  let cursor = null;
  let pageSize = Math.min(250, limit); // Shopify max is 250
  let keepFetching = true;

  try {
    while (keepFetching && all.length < limit) {
      const variables = { first: pageSize, after: cursor };
      const resp = await axios({
        method: "POST",
        url: SHOPIFY_GQL_ENDPOINT,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
        },
        data: { query, variables },
        timeout: AXIOS_TIMEOUT_MS
      });

      if (!resp.data || resp.data.errors) {
        throw new Error(`Shopify GraphQL error: ${JSON.stringify(resp.data?.errors || resp.data)}`);
      }

      const edges = resp.data.data.products.edges || [];
      for (const e of edges) {
        const n = e.node;
        all.push({
          id: n.id,
          handle: n.handle,
          title: sanitizeText(n.title, 120),
          vendor: sanitizeText(n.vendor || "", 80),
          tags: Array.isArray(n.tags) ? n.tags.map(t => sanitizeText(t, 50)) : [],
          summary: sanitizeText(n.description || "", 200),
          imageUrl: n.images?.edges?.[0]?.node?.url || null,
          price: n.priceRangeV2?.minVariantPrice?.amount || null,
          currency: n.priceRangeV2?.minVariantPrice?.currencyCode || null
        });

        if (all.length >= limit) break;
        cursor = e.cursor;
      }

      keepFetching = resp.data.data.products.pageInfo.hasNextPage && all.length < limit;
      if (!keepFetching) break;
    }

    // update cache
    productCache = { ts: Date.now(), data: all.slice() };
    return all.slice(0, limit);
  } catch (err) {
    // bubble up for route handler to return 502
    throw new Error(`Failed to fetch products from Shopify: ${err.message}`);
  }
}

// --- Helper: build prompt (products should be sanitized objects) ---
function buildPromptForGemini(userQuery, products) {
  // Keep prompt compact — list handles + title + price + summary + tags
  const lines = products.map(p =>
    `- handle: ${p.handle} | title: ${p.title} | price: ${p.price || ""} ${p.currency || ""} | summary: ${p.summary} | tags: ${p.tags?.slice(0,6).join(", ") || ""}`
  ).join("\n");

  return `
You are a precise e-commerce search assistant for a Shopify store.
User query: "${sanitizeText(userQuery, 300)}"

Available products (capsules):
${lines}

Rules:
- Return ONLY product handles (not titles) that are a very strong and direct match to the user's query.
- Do not invent handles; use only handles from the provided list.
- If none match, return an empty array.
- Return at most 3 handles.
- Output MUST be strictly valid JSON and nothing else. Do NOT include explanations or analysis.
Output format:
{ "matches": ["handle-one", "handle-two"] }
`;
}

// --- Helper: parse Gemini output robustly ---
function parseGeminiOutput(raw) {
  if (!raw || typeof raw !== "string") return { matches: [] };

  // Remove Markdown code fences/backticks (common cause)
  let cleaned = raw.replace(/```(?:json)?\n?/gi, "").replace(/```/g, "").replace(/`/g, "").trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to extract first JSON object substring
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (err2) {
        // fall through
      }
    }
  }

  // Final fallback
  console.warn("Gemini returned unparseable output:", cleaned.slice(0, 1000));
  return { matches: [] };
}

// --- Gemini call (safe) ---
async function geminiSearch(userQuery, products) {
  if (!GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured on server");
  }

  // Ensure products array length is capped
  const cap = Math.min(products.length, PRODUCTS_LIMIT);
  const limitedProducts = products.slice(0, cap);

  const prompt = buildPromptForGemini(userQuery, limitedProducts);

  try {
    const resp = await axios.post(
      GEMINI_URL,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY }, timeout: AXIOS_TIMEOUT_MS }
    );

    const raw = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return parseGeminiOutput(raw);
  } catch (err) {
    // wrap error for route handler
    throw new Error(`Gemini request failed: ${err.response?.data?.error?.message || err.message}`);
  }
}

// --- Rate limiter (applied to this router) ---
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests",
      details: "You can only make 5 AI search requests per minute. Please wait and try again."
    });
  }
});

// --- Route: POST / (base path mounted by server) ---
router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query, products: clientProducts } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'query' in request body" });
    }

    // If client passed a product list (Liquid dump), prefer it — but validate & sanitize
    let products = [];
    if (Array.isArray(clientProducts) && clientProducts.length > 0) {
      // Basic validation/sanitization and enforce max
      products = clientProducts.slice(0, PRODUCTS_LIMIT).map(p => ({
        id: p.id || null,
        handle: String(p.handle || "").trim(),
        title: sanitizeText(p.title || "", 120),
        vendor: sanitizeText(p.vendor || "", 80),
        tags: Array.isArray(p.tags) ? p.tags.map(t => sanitizeText(t, 50)) : [],
        summary: sanitizeText(p.summary || p.description || "", 200),
        imageUrl: p.imageUrl || null,
        price: p.price || null,
        currency: p.currency || null
      })).filter(p => p.handle); // ensure handle exists
      if (products.length === 0) {
        return res.status(400).json({ error: "client-supplied products were invalid or empty" });
      }
    } else {
      // Otherwise fetch from Shopify admin (cached)
      products = await fetchProductsFromShopify(PRODUCTS_LIMIT);
    }

    // Call Gemini to get handles
    const gmResult = await geminiSearch(query, products);
    const matchesHandles = Array.isArray(gmResult.matches) ? gmResult.matches : [];

    // Map handles back to full product objects (preserve input order of handles)
    const handleToProduct = new Map(products.map(p => [p.handle, p]));
    const matched = matchesHandles.map(h => handleToProduct.get(h)).filter(Boolean);

    res.json({ matches: matched });
  } catch (err) {
    console.error("AI search error:", err.message);
    // Provide helpful status codes
    if (err.message && err.message.includes("Gemini API key")) {
      return res.status(500).json({ error: "Server misconfiguration", details: err.message });
    }
    if (err.message && err.message.includes("Shopify")) {
      return res.status(502).json({ error: "Failed to fetch products", details: err.message });
    }
    res.status(500).json({ error: "Something went wrong!", details: err.message });
  }
});

module.exports = router;
