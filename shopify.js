const { shopifyApi} = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
require('dotenv/config');
// 1. Configure the Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY, 
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_API_SCOPES,
  apiVersion: '2025-07',
  hostName: 'https://shopify-backend-gt39.onrender.com',
  sessionStorage: new shopify.MemorySessionStorage(), 
});
module.exports = { shopify };