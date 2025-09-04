const express = require('express');
const axios = require('axios');
const router = express.Router();
const { shopify } = require('../shopify');

const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } = process.env;

// Helper for Shopify REST API requests
const shopifyApi = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2025-07`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
  }
});

// Fetch all customer lists
router.get('/get', async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) return res.status(400).json({ success: false, error: 'Missing customerId' });

  try {
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    const metafield = (response.data.metafields || [])[0];
    let listNames = [];
    if (metafield && metafield.value) {
      try {
        listNames = JSON.parse(metafield.value);
      } catch (parseError) {
        console.error('Error parsing list names:', parseError);
        listNames = [];
      }
    }
    res.json({ success: true, lists: listNames });
  } catch (error) {
    console.error('Error fetching customer lists:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new list name to the metafield
router.post('/add', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) {
    return res.status(400).json({ success: false, error: 'Missing customerId or listName' });
  }

  try {
    // Fetch existing lists
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    let listNames = [];
    let metafieldId = null;
    
    if (response.data.metafields && response.data.metafields[0]) {
      metafieldId = response.data.metafields[0].id;
      try {
        listNames = JSON.parse(response.data.metafields[0].value);
      } catch (parseError) {
        console.error('Error parsing existing list names:', parseError);
        listNames = [];
      }
    }

    // Check if list already exists (case-insensitive)
    const existingList = listNames.find(name => 
      name.toLowerCase() === listName.toLowerCase()
    );
    
    if (existingList) {
      return res.json({ 
        success: true, 
        message: 'List already exists', 
        lists: listNames 
      });
    }

    // Add new list name
    listNames.push(listName);

    const payload = {
      metafield: {
        namespace: 'custom',
        key: 'favList',
        value: JSON.stringify(listNames),
        type: 'list.single_line_text_field'
      }
    };

    let saveResp;
    if (metafieldId) {
      saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);
    } else {
      saveResp = await shopifyApi.post(`/customers/${customerId}/metafields.json`, payload);
    }

    res.json({ 
      success: true, 
      lists: listNames, 
      metafield: saveResp.data.metafield,
      message: 'List created successfully'
    });
  } catch (error) {
    console.error('Error adding list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/create', async (req, res) => {
  const { customerId, listName, shop, accessToken } = req.body;

  // 1. Enhanced input validation
  if (!customerId || !listName) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: customerId and listName are required'
    });
  }

  try {
    // 2. Handle session - multiple approaches for different setups
    let session;
    
    // Approach 1: Try to get session from middleware (if properly set up)
    if (res.locals?.shopify?.session) {
      session = res.locals.shopify.session;
    }
    // Approach 2: Try to get session from request headers (common in API calls)
    else if (req.headers['x-shopify-shop-domain'] && req.headers['x-shopify-access-token']) {
      session = {
        shop: req.headers['x-shopify-shop-domain'],
        accessToken: req.headers['x-shopify-access-token']
      };
    }
    // Approach 3: Get session data from request body (if passed directly)
    else if (shop && accessToken) {
      session = { shop, accessToken };
    }
    // Approach 4: Try to find session in session storage
    else if (req.query.shop) {
      const sessionId = shopify.session.getOfflineId(req.query.shop);
      session = await shopify.config.sessionStorage.loadSession(sessionId);
    }
    
    // If no session found, return error
    if (!session || !session.accessToken) {
      return res.status(401).json({ 
        success: false, 
        error: "Unauthorized: No valid session found. Please ensure you're authenticated with Shopify.",
        debug: {
          hasLocalsShopify: !!res.locals?.shopify,
          hasHeaders: !!(req.headers['x-shopify-shop-domain'] && req.headers['x-shopify-access-token']),
          hasBodyData: !!(shop && accessToken),
          hasShopQuery: !!req.query.shop
        }
      });
    }

    // 3. Create REST and GraphQL clients using the session
    const restClient = new shopify.clients.Rest({ session });
    const graphqlClient = new shopify.clients.Graphql({ session });

    // 4. Fetch existing metafield that stores the list of names using REST client
    const metafieldsResponse = await restClient.get({
      path: `/customers/${customerId}/metafields.json`,
      query: { namespace: 'custom', key: 'favList' }
    });

    let listNames = [];
    let metafieldId = null;
    const existingMetafield = metafieldsResponse.body.metafields?.[0];

    if (existingMetafield) {
      metafieldId = existingMetafield.id;
      try {
        listNames = existingMetafield.value ? JSON.parse(existingMetafield.value) : [];
        // Ensure listNames is an array
        if (!Array.isArray(listNames)) {
          console.warn('Existing list names is not an array, resetting to empty array');
          listNames = [];
        }
      } catch (parseError) {
        console.error('Error parsing existing list names, resetting to empty array:', parseError);
        listNames = [];
      }
    }

    // 5. Check for duplicates (case-insensitive)
    const listExists = listNames.some(name => 
      typeof name === 'string' && name.toLowerCase() === listName.toLowerCase()
    );
    
    if (listExists) {
      return res.json({
        success: true,
        message: 'List already exists',
        lists: listNames
      });
    }

    // 6. Add the new list name and save the updated array to the customer's metafield
    listNames.push(listName);
    const listNamesPayload = {
      metafield: {
        namespace: 'custom',
        key: 'favList',
        value: JSON.stringify(listNames),
        type: 'json' // Updated to use 'json' type instead of 'list.single_line_text_field'
      }
    };

    if (metafieldId) {
      // Update existing metafield
      await restClient.put({
        path: `/metafields/${metafieldId}.json`,
        data: listNamesPayload
      });
    } else {
      // Create new metafield for the customer
      await restClient.post({
        path: `/customers/${customerId}/metafields.json`,
        data: listNamesPayload
      });
    }

    // 7. Sanitize listName to create a valid key for the metafield definition
    const safeListKey = listName.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 30); // Limit key length

    // 8. Create metafield definition using GraphQL client
    const createMutation = `
      mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            name
            key
            namespace
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const definitionInput = {
      name: listName,
      namespace: "custom",
      key: safeListKey,
      type: "list.product_reference",
      ownerType: "CUSTOMER",
      visibleToStorefrontApi: true,
      description: `Favorite products list: ${listName}`
    };

    const createResponse = await graphqlClient.query({
      data: {
        query: createMutation,
        variables: { definition: definitionInput }
      }
    });

    // 9. Handle GraphQL response
    const userErrors = createResponse.body?.data?.metafieldDefinitionCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      const code = userErrors[0].code;
      // Handle the "already exists" error gracefully
      if (code === "DUPLICATE_KEY_NAMESPACE" || code === "TAKEN") {
        console.log(`Metafield definition already exists for key: ${safeListKey}. Skipping creation.`);
      } else {
        console.error("Failed to create metafield definition:", userErrors);
        // Don't throw error, just log it as the main functionality (list creation) succeeded
      }
    } else {
      const createdDefinition = createResponse.body?.data?.metafieldDefinitionCreate?.createdDefinition;
      if (createdDefinition) {
        console.log("✅ Created new metafield definition:", createdDefinition);
      }
    }

    // 10. Send success response
    res.status(201).json({
      success: true,
      message: 'List created successfully',
      lists: listNames,
      data: {
        customerId,
        listName,
        metafieldKey: safeListKey,
        totalLists: listNames.length
      }
    });

  } catch (error) {
    console.error('Error creating customer list:', {
      message: error.message,
      stack: error.stack,
      customerId,
      listName,
      shopifyError: error.response?.body || error.response?.data
    });

    // Determine appropriate error status
    let statusCode = 500;
    if (error.message?.includes('Unauthorized') || error.response?.status === 401) {
      statusCode = 401;
    } else if (error.message?.includes('Not Found') || error.response?.status === 404) {
      statusCode = 404;
    } else if (error.response?.status === 429) {
      statusCode = 429; // Rate limit
    }

    res.status(statusCode).json({
      success: false,
      error: 'Failed to create customer list',
      message: error.message,
      ...(process.env.NODE_ENV === 'development' && { 
        debug: {
          stack: error.stack,
          shopifyError: error.response?.body
        }
      })
    });
  }
});

// Middleware to help with session debugging (optional)
router.use((req, res, next) => {
  console.log('Session Debug Info:', {
    hasLocalsShopify: !!res.locals?.shopify,
    hasShopifySession: !!res.locals?.shopify?.session,
    headers: {
      shopDomain: req.headers['x-shopify-shop-domain'],
      hasAccessToken: !!req.headers['x-shopify-access-token']
    },
    query: req.query,
    url: req.url
  });
  next();
});
// Fetch products for a specific list
router.post('/products', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) {
    return res.status(400).json({ success: false, error: 'Missing customerId or listName' });
  }

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch the specific list's products from metafield
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    const metafield = (response.data.metafields || [])[0];
    if (metafield && metafield.value) {
      try {
        productIds = JSON.parse(metafield.value);
      } catch (parseError) {
        console.error('Error parsing product IDs:', parseError);
        return res.json({ success: true, products: [] });
      }
    }

    if (!productIds.length) {
      return res.json({ success: true, products: [] });
    }

    // Fetch product details using GraphQL
    const productsWithDetails = await fetchProductDetailsUsingGraphQL(productIds);

    res.json({ success: true, products: productsWithDetails });
  } catch (error) {
    console.error('Error fetching list products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add product to a specific list
router.post('/add-product', async (req, res) => {
  const { customerId, listName, productId } = req.body;
  if (!customerId || !listName || !productId) {
    return res.status(400).json({ success: false, error: 'Missing customerId, listName, or productId' });
  }

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch existing products for this list
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    let metafieldId = null;
    
    const metafield = (response.data.metafields || [])[0];
    if (metafield) {
      metafieldId = metafield.id;
      try {
        productIds = JSON.parse(metafield.value) || [];
      } catch (parseError) {
        console.error('Error parsing existing product IDs:', parseError);
        productIds = [];
      }
    }

    // Convert to GID format (consistent with wishlist format)
    const productGid = `gid://shopify/Product/${productId}`;

    // Check if product already exists in the list
    const isAlreadyInList = productIds.some(id => {
      const numericId = id.toString().replace('gid://shopify/Product/', '');
      return numericId === productId.toString();
    });

    if (isAlreadyInList) {
      return res.json({ 
        success: true, 
        message: 'Product already in list', 
        products: productIds 
      });
    }

    // Add new product GID
    productIds.push(productGid);

    const payload = {
      metafield: {
        namespace: 'custom',
        key: metafieldKey,
        value: JSON.stringify(productIds),
        type: 'list.product_reference'
      }
    };

    let saveResp;
    if (metafieldId) {
      saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);
    } else {
      saveResp = await shopifyApi.post(`/customers/${customerId}/metafields.json`, payload);
    }

    res.json({ 
      success: true, 
      products: productIds, 
      metafield: saveResp.data.metafield,
      message: 'Product added to list successfully'
    });
  } catch (error) {
    console.error('Error adding product to list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove product from a specific list
router.post('/remove-product', async (req, res) => {
  const { customerId, listName, productId } = req.body;
  if (!customerId || !listName || !productId) {
    return res.status(400).json({ success: false, error: 'Missing customerId, listName, or productId' });
  }

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch existing products for this list
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    let metafieldId = null;
    
    const metafield = (response.data.metafields || [])[0];
    if (metafield) {
      metafieldId = metafield.id;
      try {
        productIds = JSON.parse(metafield.value) || [];
      } catch (parseError) {
        return res.status(404).json({ success: false, error: 'List not found or invalid' });
      }
    } else {
      return res.status(404).json({ success: false, error: 'List not found' });
    }

    // Remove product using the same logic as wishlist removal
    const productGid = `gid://shopify/Product/${productId}`;
    const numericId = productId.toString();
    
    const initialCount = productIds.length;
    
    // Filter out the product in all possible formats
    productIds = productIds.filter((item) => {
      const itemStr = item.toString();
      return itemStr !== productGid &&           
             itemStr !== numericId &&            
             itemStr !== `gid://shopify/Product/${itemStr}` && 
             itemStr.replace('gid://shopify/Product/', '') !== numericId;
    });

    // Check if anything was actually removed
    if (productIds.length === initialCount) {
      return res.json({ 
        success: true, 
        message: "Product not found in list.",
        productId: productId
      });
    }

    const payload = {
      metafield: {
        id: metafieldId,
        value: JSON.stringify(productIds),
      }
    };

    const saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);

    res.json({ 
      success: true, 
      products: productIds, 
      message: 'Product removed from list successfully',
      metafield: saveResp.data.metafield 
    });
  } catch (error) {
    console.error('Error removing product from list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a list entirely
router.post('/delete', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) {
    return res.status(400).json({ success: false, error: 'Missing customerId or listName' });
  }

  try {
    // First remove the list name from the main favList metafield
    const listResponse = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    
    let listNames = [];
    let listMetafieldId = null;
    
    if (listResponse.data.metafields && listResponse.data.metafields[0]) {
      listMetafieldId = listResponse.data.metafields[0].id;
      try {
        listNames = JSON.parse(listResponse.data.metafields[0].value);
      } catch (parseError) {
        console.error('Error parsing list names for deletion:', parseError);
        listNames = [];
      }
    }

    // Remove the list name (case-insensitive)
    const updatedListNames = listNames.filter(name => 
      name.toLowerCase() !== listName.toLowerCase()
    );

    // Update the main list metafield
    if (listMetafieldId) {
      const listPayload = {
        metafield: {
          namespace: 'custom',
          key: 'favList',
          value: JSON.stringify(updatedListNames),
          type: 'list.single_line_text_field'
        }
      };
      await shopifyApi.put(`/metafields/${listMetafieldId}.json`, listPayload);
    }

    // Delete the products metafield for this list
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const productResponse = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    if (productResponse.data.metafields && productResponse.data.metafields[0]) {
      const productMetafieldId = productResponse.data.metafields[0].id;
      await shopifyApi.delete(`/metafields/${productMetafieldId}.json`);
    }

    res.json({ 
      success: true, 
      message: 'List deleted successfully', 
      lists: updatedListNames 
    });
  } catch (error) {
    console.error('Error deleting list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GraphQL product fetching function (reused from wishlist code)
async function fetchProductDetailsUsingGraphQL(productIds) {
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

  // Helper function to normalize product IDs
  function normalizeProductId(id) {
    if (typeof id === 'string') {
      if (id.includes('gid://shopify/Product/')) {
        return id.split('/').pop();
      }
      return id;
    }
    return id.toString();
  }

  // Normalize all product IDs and create GraphQL IDs
  const productGIDs = productIds.map(id => {
    const numericId = normalizeProductId(id);
    return `gid://shopify/Product/${numericId}`;
  });

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
                reference {
                  ... on GenericFile{
                    url
                  }
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
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
      product_code: metafields.find((m) => m.key === "product_code")?.value || "",
      catalogue_pdf: metafields.find((m) => m.key === "catalogue_pdf")?.reference?.url || null,
      group_catalogue: metafields.find((m) => m.key === "group_catalogue")?.reference?.image?.url || null,
    };
  }).filter(Boolean);

  // Keep order as per the original list
  const orderedProducts = productIds
    .map((id) => {
      const numericId = normalizeProductId(id);
      return products.find((p) => p.id === numericId);
    })
    .filter(Boolean);

  return orderedProducts;
}

module.exports = router;