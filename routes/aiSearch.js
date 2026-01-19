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
//          title: variantEdge.node.title === "Default Title"
//   ? node.title
//   : `${node.title} - ${variantEdge.node.title}`,

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
//    const matched = products.filter(p => result.matches.includes(p.title) && p.imageUrl);


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

// Get credentials from environment variables
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// --- 1. GLOBAL CACHE (The Speed Fix) ---
// We store products in memory so we don't ask Shopify for them on every single search.
let productCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 Hour

// --- Helper Functions ---

async function fetchProductsForCapsules() {
  // Check if we have valid cached data
  const now = Date.now();
  if (productCache && (now - lastCacheTime < CACHE_DURATION)) {
    console.log("⚡ Serving products from memory cache (Fast)...");
    return productCache;
  }

  console.log("🔄 Fetching fresh products from Shopify (This happens once per hour)...");
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              title
              vendor
              tags
              description
              productType
              onlineStoreUrl
              variants(first: 10) {
                edges {
                  node {
                    availableForSale
                    price
                  }
                }
              }
              images(first: 1) { 
                edges { node { url } }
              }
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const response = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
        },
        data: { query, variables: { first: 250, after: cursor } }
      });

      const { data, errors } = response.data;
      if (errors) throw new Error(JSON.stringify(errors));

      // Flatten data for the AI to read easily
      const products = data.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        // We clean the description to save tokens but keep the meaning
        description: node.description ? node.description.replace(/(<([^>]+)>)/gi, "").slice(0, 300) : "",
        tags: node.tags || [],
        productType: node.productType,
        imageUrl: node.images.edges[0]?.node?.url || null,
        price: node.priceRangeV2?.minVariantPrice?.amount,
        currency: node.priceRangeV2?.minVariantPrice?.currencyCode,
        isAvailable: node.variants?.edges?.some(e => e.node.availableForSale)
      }));

      allProducts.push(...products);
      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;

    } catch (error) {
      console.error("❌ Shopify Fetch Error:", error.message);
      break;
    }
  }

  // Update Cache
  productCache = allProducts;
  lastCacheTime = now;
  return allProducts;
}

// --- 2. THE AI BRAIN (The Logic Fix) ---
async function geminiSearch(userQuery, products) {
  // Only search available products that have images
  const searchableProducts = products.filter(p => p.imageUrl && p.isAvailable);

  // We feed the AI a condensed list of products so it can "Understand" them.
  const productContext = searchableProducts.map((p, index) =>
    `ID: ${p.id} | Name: ${p.title} | Type: ${p.productType} | Tags: ${p.tags.join(", ")} | Desc: ${p.description}`
  ).join("\n");

  const prompt = `
    You are an intelligent personal shopping assistant.
    The user is searching for: "${userQuery}"

    YOUR JOB:
    Identify products from the list below that match the user's *intent*, not just their keywords.
    
    RULES:
    1. Understand Synonyms: If user asks for "kicks", find shoes/sneakers.
    2. Understand Vibe: If user asks for "party wear", look for dresses, suits, or stylish items.
    3. Understand Needs: If user asks for "something for cold weather", find jackets, hoodies, or sweaters.
    4. Rank results by relevance.
    5. Return up to 15 matching Product IDs.
    
    PRODUCT LIST:
    ${productContext}

    OUTPUT FORMAT:
    Return strictly JSON: { "matchIds": ["gid://shopify/Product/123", "gid://shopify/Product/456"] }
  `;

  try {
    // We use gemini-1.5-flash because it handles large contexts (lists of products) much better than 2.5-lite
    const resp = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3, // A little creativity allowed for semantic matching
          responseMimeType: "application/json"
        }
      },
      { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
    );

    const rawText = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
    const json = JSON.parse(rawText);
    return json.matchIds || [];

  } catch (e) {
    console.error("❌ Gemini AI Error:", e.response?.data || e.message);
    return [];
  }
}

// --- Rate Limiter ---
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- API Route ---
router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });

    // 1. Get products (Instant from cache)
    const products = await fetchProductsForCapsules();

    // 2. Ask AI which IDs match the user's intent
    const matchIds = await geminiSearch(query, products);

    // 3. Retrieve the full product details for those IDs
    // Note: We are filtering by ID, but the AI selected these IDs based on *meaning*
    const matchedProducts = products.filter(p => matchIds.includes(p.id));

    // Sort them in the order the AI returned them (Relevance)
    const sortedMatches = matchIds
      .map(id => matchedProducts.find(p => p.id === id))
      .filter(p => p); // Remove undefined

    res.json({
      matches: sortedMatches,
      totalProductsSearched: products.length,
      searchQuery: query
    });

  } catch (err) {
    console.error("Search failed:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;