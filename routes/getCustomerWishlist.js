const express = require("express");
const axios = require("axios");
const router = express.Router();

// Shopify GraphQL Fetcher
async function shopifyGraphQL(query, variables = {}) {
  const url = `https://${process.env.SHOPIFY_STORE}/admin/api/2025-07/graphql.json`;

  try {
    const response = await axios({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
      data: JSON.stringify({ query, variables }),
    });

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors));
    }

    return response.data.data;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Shopify GraphQL error: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`
      );
    } else {
      throw new Error(`Shopify GraphQL request failed: ${error.message}`);
    }
  }
}

router.post("/get", async (req, res) => {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      return res.json({ success: false, error: "Customer ID is required" });
    }

    // Step 1: Fetch customer metafields (REST is fine here)
    const customerMetafields = await shopifyGraphQL(
      `
      query getCustomerMetafields($id: ID!) {
        customer(id: $id) {
          id
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }
    `,
      { id: `gid://shopify/Customer/${customerId}` }
    );

    const wishlistField = customerMetafields.customer?.metafields.edges.find(
      (edge) => edge.node.key === "wishlist"
    );

    if (!wishlistField) {
      return res.json({ success: true, products: [] });
    }

    let productIds;
    try {
      productIds = JSON.parse(wishlistField.node.value);
      if (!Array.isArray(productIds)) productIds = [];
    } catch (e) {
      productIds = [];
    }

    if (productIds.length === 0) {
      return res.json({ success: true, products: [] });
    }

    // Step 2: Fetch products + metafields in one GraphQL query
    const productGIDs = productIds.map(
      (id) => `gid://shopify/Product/${id}`
    );

    const productQuery = `
      query getProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            vendor
            featuredImage { url }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    `;

    const productsResp = await shopifyGraphQL(productQuery, { ids: productGIDs });

    // Format products
    const products = (productsResp.nodes || []).map((product) => {
      if (!product) return null;

      const metafields = product.metafields.edges.map((edge) => edge.node);

      return {
        id: product.id.replace("gid://shopify/Product/", ""),
        title: product.title,
        handle: product.handle,
        vendor: product.vendor || "",
        featured_image: product.featuredImage?.url || "/assets/no-image.png",
        product_code:
          metafields.find((m) => m.key === "product_code")?.value || "",
        catalogue_pdf:
          metafields.find((m) => m.key === "catalogue_pdf")?.value || null,
        group_catalogue:
          metafields.find((m) => m.key === "group_catalogue")?.value || null,
      };
    }).filter(Boolean);

    // Keep order as per wishlist
    const orderedProducts = productIds
      .map((id) => products.find((p) => p.id === id.toString()))
      .filter(Boolean);

    res.json({ success: true, products: orderedProducts });
  } catch (error) {
    console.error("Error getting wishlist:", error);
    res.json({ success: false, error: "Internal server error" });
  }
});

module.exports = router;
