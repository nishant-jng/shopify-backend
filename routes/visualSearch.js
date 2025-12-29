const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const router = express.Router();

// Get credentials from environment variables
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// Configure multer for image upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// --- Helper Functions ---

// Fetches product data from Shopify (same as text search)
async function fetchProductsForVisualSearch() {
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

    const response = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
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

    const products = data.products.edges.flatMap(({ node }) => {
      if (node.variants.edges && node.variants.edges.length > 0) {
        return node.variants.edges.map(variantEdge => ({
          id: `${node.id}-${variantEdge.node.id}`,
          handle: node.handle,
          title: variantEdge.node.title === "Default Title"
            ? node.title
            : `${node.title} - ${variantEdge.node.title}`,
          productTitle: node.title,
          variantTitle: variantEdge.node.title,
          vendor: node.vendor,
          tags: node.tags,
          productType: node.productType,
          summary: node.description ? node.description.slice(0, 200) : "",
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: variantEdge.node.price || node.priceRangeV2.minVariantPrice.amount,
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
          sku: variantEdge.node.sku,
          inventoryQuantity: variantEdge.node.inventoryQuantity,
          availableForSale: variantEdge.node.availableForSale,
          status: node.status
        }));
      } else {
        return [{
          id: node.id,
          handle: node.handle,
          title: node.title,
          vendor: node.vendor,
          tags: node.tags,
          productType: node.productType,
          summary: node.description ? node.description.slice(0, 200) : "",
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: node.priceRangeV2.minVariantPrice.amount,
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
          status: node.status
        }];
      }
    });

    allProducts.push(...products);

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  return allProducts;
}

// Enhanced Gemini visual search with image understanding
async function geminiVisualSearch(imageBase64, mimeType, products) {
  const prompt = `
You are an intelligent visual search assistant for an e-commerce store.
Analyze the uploaded image and find similar or matching products from the catalog.

Available products (${products.length} items):
${products.map(
  p => `- ${p.title} | Type: ${p.productType || 'N/A'} | Vendor: ${p.vendor} | Tags: ${p.tags.join(", ")} | ${p.summary} | Stock: ${p.availableForSale ? 'Available' : 'Unavailable'}`
).join("\n")}

Instructions:
1. Analyze the visual content of the uploaded image
2. Identify: colors, style, category, pattern, material, aesthetic
3. Match these visual attributes to products in the catalog
4. Consider product type, tags, and descriptions
5. Prioritize visually similar items
6. Return ONLY titles of best matching products
7. Prioritize available products
8. Maximum 8 best matches

Output must be strictly valid JSON only. No explanations.
Output JSON format: { "matches": ["Product Title 1","Product Title 2"], "detected": "brief description of what you see in the image" }
`;

  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
    {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          }
        ]
      }]
    },
    { 
      headers: { 
        "Content-Type": "application/json", 
        "x-goog-api-key": GEMINI_API_KEY 
      } 
    }
  );

  const raw = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { matches: [], detected: "Unable to analyze image" };
  }
}

// --- Rate Limiter ---
const visualSearchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // Lower limit for visual search (more resource intensive)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Visual search rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests",
      details: "You can only make 3 visual search requests per minute. Please wait and try again."
    });
  }
});

// --- Visual Search API Route ---
router.post("/", visualSearchLimiter, upload.single('image'), async (req, res) => {
  try {
    // Check if image was uploaded
    if (!req.file) {
      return res.status(400).json({ 
        error: "Missing image",
        details: "Please upload an image file"
      });
    }

    // Convert image buffer to base64
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log(`Visual search initiated - Image size: ${req.file.size} bytes, Type: ${mimeType}`);

    // Fetch products and perform visual search
    const products = await fetchProductsForVisualSearch();
    const result = await geminiVisualSearch(imageBase64, mimeType, products);

    // Map the titles from the AI response back to the full product objects
    const matched = products.filter(p => result.matches.includes(p.title) && p.imageUrl);

    res.json({ 
      matches: matched,
      detected: result.detected || "Image analyzed",
      totalProductsSearched: products.length,
      imageSize: req.file.size,
      imageType: mimeType
    });

  } catch (err) {
    console.error("Visual search failed:", err.message);
    
    // Handle specific errors
    if (err.message.includes('File too large')) {
      return res.status(413).json({ 
        error: "Image too large",
        details: "Please upload an image smaller than 5MB"
      });
    }
    
    if (err.message.includes('Only image files')) {
      return res.status(400).json({ 
        error: "Invalid file type",
        details: "Please upload a valid image file (JPG, PNG, etc.)"
      });
    }

    res.status(500).json({ 
      error: "Visual search failed", 
      details: err.message 
    });
  }
});

module.exports = router;