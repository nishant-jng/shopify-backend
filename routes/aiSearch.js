// const express = require("express");
// const axios = require("axios");
// const rateLimit = require("express-rate-limit");
// const router = express.Router();

// // Get credentials from environment variables
// const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// // --- Helper Functions ---

// // Fetches product data from Shopify for the AI prompt
// // Updated function to fetch ALL products with pagination
// async function fetchProductsForCapsules() {
//   let allProducts = [];
//   let hasNextPage = true;
//   let cursor = null;

//   while (hasNextPage) {
//     const query = `
//       query getProducts($first: Int!, $after: String) {
//         products(first: $first, after: $after) {
//           edges {
//             node {
//               id
//               handle
//               title
//               vendor
//               tags
//               description
//               status
//               productType
//               variants(first: 10) {
//                 edges {
//                   node {
//                     id
//                     title
//                     price
//                     sku
//                     inventoryQuantity
//                     availableForSale
//                   }
//                 }
//               }
//               images(first: 1) {
//                 edges {
//                   node {
//                     url
//                   }
//                 }
//               }
//               priceRangeV2 {
//                 minVariantPrice { amount currencyCode }
//               }
//             }
//             cursor
//           }
//           pageInfo {
//             hasNextPage
//             endCursor
//           }
//         }
//       }
//     `;

//     const variables = {
//       first: 250, // Maximum allowed per request
//       after: cursor
//     };

//     const response = await axios({
//       method: "POST",
//       url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
//       headers: {
//         "Content-Type": "application/json",
//         "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
//       },
//       data: { query, variables }
//     });

//     const { data, errors } = response.data;

//     if (errors) {
//       console.error('GraphQL errors:', errors);
//       break;
//     }

//     // Process products and their variants
//     const products = data.products.edges.flatMap(({ node }) => {
//       // If product has variants, create entries for each variant
//       if (node.variants.edges && node.variants.edges.length > 0) {
//         return node.variants.edges.map(variantEdge => ({
//           id: `${node.id}-${variantEdge.node.id}`,
//           handle: node.handle,
//           title: variantEdge.node.title === "Default Title"
//             ? node.title
//             : `${node.title} - ${variantEdge.node.title}`,

//           productTitle: node.title,
//           variantTitle: variantEdge.node.title,
//           vendor: node.vendor,
//           tags: node.tags,
//           productType: node.productType,
//           summary: node.description ? node.description.slice(0, 200) : "",
//           imageUrl: node.images.edges[0]?.node?.url || null,
//           price: variantEdge.node.price || node.priceRangeV2.minVariantPrice.amount,
//           currency: node.priceRangeV2.minVariantPrice.currencyCode,
//           sku: variantEdge.node.sku,
//           inventoryQuantity: variantEdge.node.inventoryQuantity,
//           availableForSale: variantEdge.node.availableForSale,
//           status: node.status
//         }));
//       } else {
//         // Product without variants (fallback to original structure)
//         return [{
//           id: node.id,
//           handle: node.handle,
//           title: node.title,
//           vendor: node.vendor,
//           tags: node.tags,
//           productType: node.productType,
//           summary: node.description ? node.description.slice(0, 200) : "",
//           imageUrl: node.images.edges[0]?.node?.url || null,
//           price: node.priceRangeV2.minVariantPrice.amount,
//           currency: node.priceRangeV2.minVariantPrice.currencyCode,
//           status: node.status
//         }];
//       }
//     });

//     allProducts.push(...products);

//     hasNextPage = data.products.pageInfo.hasNextPage;
//     cursor = data.products.pageInfo.endCursor;
//   }

//   return allProducts;
// }

// // Enhanced Gemini search with better product context
// async function geminiSearch(userQuery, products) {
//   const prompt = `
// You are an intelligent e-commerce search assistant for a Shopify store.
// User query: "${userQuery}"

// Available products (${products.length} items):
// ${products.map(
//   p => `- ${p.title} | Price: ${p.price} ${p.currency} | Type: ${p.productType || 'N/A'} | Vendor: ${p.vendor} | Tags: ${p.tags.join(", ")} | ${p.summary} | Stock: ${p.availableForSale ? 'Available' : 'Unavailable'}`
// ).join("\n")}

// Instructions:
// 1. Analyze user intent and find products that best match their search
// 2. Consider product title, type, vendor, tags, description, and availability
// 3. Look for synonyms and related terms
// 4. Return ONLY titles of products that are strong matches
// 5. Prioritize available products over out-of-stock items
// 6. If nothing matches well, return empty array
// 7. Maximum 5 best matches

// Output must be strictly valid JSON only. No explanations.
// Output JSON format: { "matches": ["Product Title 1","Product Title 2"] }
// `;

//   //changes are made based on model update
//   const resp = await axios.post(
//     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
//     {
//       contents: [{ role: "user", parts: [{ text: prompt }] }]
//     },
//     { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
//   );

//   const raw = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
//   try {
//     return JSON.parse(raw);
//   } catch (e) {
//     const match = raw.match(/\{[\s\S]*\}/);
//     return match ? JSON.parse(match[0]) : { matches: [] };
//   }
// }


// // --- Rate Limiter --- (unchanged)
// const searchLimiter = rateLimit({
//   windowMs: 60 * 1000, // 1 minute
//   max: 5,
//   standardHeaders: true,
//   legacyHeaders: false,
//   handler: (req, res) => {
//     console.warn(`Rate limit exceeded for IP: ${req.ip}`);
//     res.status(429).json({
//       error: "Too many requests",
//       details: "You can only make 5 AI search requests per minute. Please wait and try again."
//     });
//   }
// });

// // --- Enhanced API Route ---
// router.post("/", searchLimiter, async (req, res) => {
//   try {
//     const { query } = req.body;
//     if (!query) {
//       return res.status(400).json({ error: "Missing query" });
//     }

//     const products = await fetchProductsForCapsules();
//     const result = await geminiSearch(query, products);

//     // Map the titles from the AI response back to the full product objects
//     const matched = products.filter(p => result.matches.includes(p.title) && p.imageUrl);


//     res.json({
//       matches: matched,
//       totalProductsSearched: products.length,
//       searchQuery: query
//     });
//   } catch (err) {
//     console.error("Gemini search failed:", err.message);
//     res.status(500).json({ error: "Something went wrong!", details: err.message });
//   }
// });

// module.exports = router;

const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// ENV
const {
  SHOPIFY_STORE,
  SHOPIFY_ADMIN_TOKEN,
  GEMINI_API_KEY
} = process.env;

/* ------------------------------------------------------------------ */
/* ---------------------- PRODUCT CACHE ------------------------------ */
/* ------------------------------------------------------------------ */

let PRODUCT_CACHE = {
  data: [],
  lastSync: 0
};

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getCachedProducts() {
  if (
    PRODUCT_CACHE.data.length > 0 &&
    Date.now() - PRODUCT_CACHE.lastSync < CACHE_TTL
  ) {
    return PRODUCT_CACHE.data;
  }

  console.log("🔄 Fetching products from Shopify...");
  const products = await fetchProductsForCapsules();

  PRODUCT_CACHE = {
    data: products,
    lastSync: Date.now()
  };

  console.log(`✅ Cached ${products.length} products`);
  return products;
}

/* ------------------------------------------------------------------ */
/* ------------------ SHOPIFY PRODUCT FETCH -------------------------- */
/* ------------------------------------------------------------------ */

async function fetchProductsForCapsules() {
  let allProducts = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              handle
              title
              vendor
              tags
              description
              status
              productType
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                    inventoryQuantity
                    availableForSale
                  }
                }
              }
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const variables = { first: 250, after: cursor };

    const response = await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      { query, variables },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
        }
      }
    );

    const { data, errors } = response.data;
    if (errors) throw new Error("Shopify GraphQL error");

    const products = data.products.edges.flatMap(({ node }) =>
      node.variants.edges.length
        ? node.variants.edges.map(v => ({
          id: `${node.id}-${v.node.id}`,
          handle: node.handle,
          title:
            v.node.title === "Default Title"
              ? node.title
              : `${node.title} - ${v.node.title}`,
          vendor: node.vendor,
          tags: node.tags || [],
          productType: node.productType,
          summary: node.description?.slice(0, 200) || "",
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: v.node.price || node.priceRangeV2.minVariantPrice.amount,
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
          sku: v.node.sku,
          inventoryQuantity: v.node.inventoryQuantity,
          availableForSale: v.node.availableForSale,
          status: node.status
        }))
        : []
    );

    allProducts.push(...products);
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return allProducts;
}

/* ------------------------------------------------------------------ */
/* ------------------- FAST KEYWORD PREFILTER ------------------------ */
/* ------------------------------------------------------------------ */

function keywordPrefilter(products, query) {
  const q = query.toLowerCase();

  return products.filter(p =>
    p.title.toLowerCase().includes(q) ||
    p.tags.join(" ").toLowerCase().includes(q) ||
    (p.productType || "").toLowerCase().includes(q) ||
    (p.vendor || "").toLowerCase().includes(q)
  );
}

/* ------------------------------------------------------------------ */
/* ------------------- GEMINI RANKING ONLY --------------------------- */
/* ------------------------------------------------------------------ */

async function geminiRank(userQuery, candidates) {
  const prompt = `
You are an AI shopping assistant.

User query:
"${userQuery}"

Candidate products:
${candidates.map(
  (p, i) => `
${i + 1}. ${p.title}
   Type: ${p.productType}
   Vendor: ${p.vendor}
   Tags: ${p.tags.join(", ")}
   Price: ${p.price} ${p.currency}
   Stock: ${p.availableForSale ? "Available" : "Out of stock"}
`
).join("\n")}

Instructions:
- Understand user intent
- Select up to 5 most relevant products
- Prefer in-stock products
- Return ONLY product indexes

Output JSON ONLY:
{ "indexes": [1, 3, 5] }
`;

  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      }
    }
  );

  const raw =
    resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { indexes: [] };
  }
}

/* ------------------------------------------------------------------ */
/* ---------------------- RATE LIMITER ------------------------------- */
/* ------------------------------------------------------------------ */

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false
});

/* ------------------------------------------------------------------ */
/* ------------------------- API ROUTE ------------------------------- */
/* ------------------------------------------------------------------ */

router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // 1️⃣ Cached products
    const allProducts = await getCachedProducts();

    // 2️⃣ Fast keyword prefilter
    let candidates = keywordPrefilter(allProducts, query);

    // fallback if too strict
    if (candidates.length < 5) {
      candidates = allProducts.slice(0, 40);
    } else {
      candidates = candidates.slice(0, 40);
    }

    // 3️⃣ Gemini ranking
    const { indexes } = await geminiRank(query, candidates);

    // 4️⃣ Map indexes back to products
    const matched = indexes
      .map(i => candidates[i - 1])
      .filter(Boolean)
      .filter(p => p.imageUrl);

    res.json({
      matches: matched,
      totalProductsSearched: allProducts.length,
      searchQuery: query
    });
  } catch (err) {
    console.error("AI search failed:", err.message);
    res.status(500).json({
      error: "Something went wrong",
      details: err.message
    });
  }
});

module.exports = router;

