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

// --- GLOBAL CACHE VARIABLES ---
// This prevents fetching from Shopify on every single request
let productCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour in milliseconds

// --- Helper Functions ---

async function fetchProductsForCapsules() {
  // 1. Check Cache
  const now = Date.now();
  if (productCache && (now - lastCacheTime < CACHE_DURATION)) {
    console.log("Serving products from cache...");
    return productCache;
  }

  console.log("Fetching fresh products from Shopify...");
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
              status
              productType
              onlineStoreUrl
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
                  node { url } 
                } 
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

    const variables = {
      first: 250,
      after: cursor
    };

    try {
      const response = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`, // Use a stable API version
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
        },
        data: { query, variables }
      });

      const { data, errors } = response.data;
      
      if (errors) {
        console.error('GraphQL errors:', errors);
        break;
      }

      // Process products - Simplified structure for the AI
      // We only need one entry per product unless variants are wildly different
      const products = data.products.edges.map(({ node }) => {
        const price = node.priceRangeV2?.minVariantPrice?.amount || "0";
        const currency = node.priceRangeV2?.minVariantPrice?.currencyCode || "USD";
        
        return {
          id: node.id, // KEEP THE SHOPIFY GID
          title: node.title,
          vendor: node.vendor,
          tags: node.tags || [],
          productType: node.productType,
          summary: node.description ? node.description.slice(0, 150).replace(/\n/g, " ") : "", // Cleanup text
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: price,
          currency: currency,
          available: node.variants?.edges?.some(e => e.node.availableForSale) || false
        };
      });

      allProducts.push(...products);

      hasNextPage = data.products.pageInfo.hasNextPage;
      cursor = data.products.pageInfo.endCursor;
    } catch (error) {
      console.error("Error fetching Shopify products:", error);
      break; 
    }
  }

  // 2. Set Cache
  productCache = allProducts;
  lastCacheTime = now;
  return allProducts;
}

// Enhanced Gemini search
async function geminiSearch(userQuery, products) {
  // Filter products to reduce token count (remove products with no image or unavailable if you prefer)
  const availableProducts = products.filter(p => p.imageUrl); 

  // We construct a lighter map for the AI to read. 
  // IMPORTANT: We ask the AI to return the ID, not the title.
  const productListText = availableProducts.map(
    p => `ID: ${p.id} | Name: ${p.title} | Type: ${p.productType} | Tags: ${p.tags.join(", ")} | Desc: ${p.summary} | Price: ${p.price}`
  ).join("\n");

  const prompt = `
    You are a search engine for an e-commerce store.
    
    User Query: "${userQuery}"
    
    Task: Return a JSON object containing a list of Product IDs that match the user's intent.
    
    Rules:
    1. Analyze the User Query for intent (category, color, price, style, occasion).
    2. Select up to 6 products from the list below that best match.
    3. Sort them by relevance (most relevant first).
    4. Return ONLY valid JSON.
    
    Product List:
    ${productListText}
    
    Output Format:
    { "matchIds": ["gid://shopify/Product/123456789", "gid://shopify/Product/987654321"] }
  `;

  try {
    // UPDATED MODEL: Using gemini-1.5-flash for better stability and context handling than 2.5-lite
    // We also set temperature to 0 for deterministic results
    const resp = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.0,
            responseMimeType: "application/json" // Forces JSON output
        }
      },
      { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
    );

    const rawText = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
    const json = JSON.parse(rawText);
    return json.matchIds || []; // Expecting matchIds array

  } catch (e) {
    console.error("Gemini API Error:", e.response?.data || e.message);
    return [];
  }
}

// --- Rate Limiter ---
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 10, // Increased slightly
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

// --- Main Route ---
router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // 1. Get products (Instant if cached)
    const products = await fetchProductsForCapsules();

    // 2. Get AI matches (IDs)
    const matchIds = await geminiSearch(query, products);

    // 3. Map IDs back to full product objects
    // We map strictly based on the ID returned by AI
    const matchedProducts = products.filter(p => matchIds.includes(p.id));

    // Optional: Sort the results in the order the AI returned them
    const sortedMatches = matchIds
        .map(id => matchedProducts.find(p => p.id === id))
        .filter(p => p !== undefined); // remove any failed lookups

    res.json({ 
      matches: sortedMatches,
      totalProductsSearched: products.length,
      searchQuery: query
    });

  } catch (err) {
    console.error("Search route error:", err.message);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
});

module.exports = router;