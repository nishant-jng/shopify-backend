// middleware/authenticate.js

const admin = require('firebase-admin');
const crypto = require('crypto');

/**
 * Authentication Middleware for Shared Backend
 * Supports both Shopify App and Flutter Mobile App
 */

// Configuration
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET; // Store in .env
const API_KEY = process.env.SHOPIFY_API_KEY; 

const authenticate = async (req, res, next) => {
  try {
    const clientType = req.headers['x-client-type']; // 'shopify' or 'flutter'
    
    if (!clientType) {
      return res.status(401).json({
        success: false,
        error: 'Missing x-client-type header'
      });
    }

    // Route to appropriate authentication method
    switch (clientType.toLowerCase()) {
      case 'shopify':
        return await authenticateShopify(req, res, next);
      
      case 'flutter':
        return await authenticateFlutter(req, res, next);
      
      default:
        return res.status(401).json({
          success: false,
          error: 'Invalid client type'
        });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

/**
 * Shopify App Authentication
 * Uses session token or API key
 */
const authenticateShopify = async (req, res, next) => {
  const sessionToken = req.headers['authorization']?.replace('Bearer ', '');
  const apiKey = req.headers['x-api-key'];
  const shopDomain = req.headers['x-shop-domain'];

  // Method 1: Shopify Session Token (Recommended for embedded apps)
  if (sessionToken) {
    try {
      // Verify Shopify session token
      const payload = await verifyShopifySessionToken(sessionToken, shopDomain);
      
      req.shopify = {
        shop: payload.dest.replace('https://', ''),
        isOnline: payload.sub ? true : false,
        userId: payload.sub
      };
      
      return next();
    } catch (error) {
      console.error('Shopify session token verification failed:', error);
      return res.status(401).json({
        success: false,
        error: 'Invalid Shopify session token'
      });
    }
  }
  
  // Method 2: API Key (For server-side Shopify apps or webhooks)
  if (apiKey === API_KEY) {
    req.shopify = {
      authenticated: true,
      method: 'api-key'
    };
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Missing or invalid Shopify authentication'
  });
};

/**
 * Flutter App Authentication
 * Uses Firebase ID Token + API Key
 */
const authenticateFlutter = async (req, res, next) => {
  const firebaseToken = req.headers['authorization']?.replace('Bearer ', '');
  const apiKey = req.headers['x-api-key'];

  // Verify API key
  if (apiKey !== API_KEYS.flutter) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key'
    });
  }

  // Verify Firebase ID token
  if (!firebaseToken) {
    return res.status(401).json({
      success: false,
      error: 'Missing Firebase ID token'
    });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
    
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified
    };
    
    return next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid Firebase token'
    });
  }
};

/**
 * Verify Shopify Session Token (JWT)
 * For embedded Shopify apps using App Bridge
 */
const verifyShopifySessionToken = async (token, shopDomain) => {
  const jwt = require('jsonwebtoken');
  
  if (!shopDomain) {
    throw new Error('Shop domain is required');
  }

  // Shopify session tokens are signed with your app's secret
  const payload = jwt.verify(token, SHOPIFY_APP_SECRET, {
    algorithms: ['HS256']
  });

  // Verify the token is for the correct shop
  const tokenShop = payload.dest.replace('https://', '');
  if (tokenShop !== shopDomain) {
    throw new Error('Token shop domain mismatch');
  }

  // Verify token is not expired
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }

  return payload;
};

/**
 * Optional: Rate limiting per client type
 */
const rateLimitByClient = (req, res, next) => {
  const clientType = req.headers['x-client-type'];
  
  // Implement different rate limits
  // For example: Shopify = 100 req/min, Flutter = 50 req/min
  
  next();
};

/**
 * Webhook authentication for Shopify webhooks
 */
const authenticateShopifyWebhook = (req, res, next) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'];
  const shop = req.headers['x-shopify-shop-domain'];

  if (!hmac || !topic || !shop) {
    return res.status(401).json({
      success: false,
      error: 'Missing webhook headers'
    });
  }

  
  const hash = crypto
    .createHmac('sha256', SHOPIFY_APP_SECRET)
    .update(req.body, 'utf8')
    .digest('base64');

  if (hash !== hmac) {
    return res.status(401).json({
      success: false,
      error: 'Invalid webhook signature'
    });
  }

  req.webhook = {
    topic,
    shop,
    verified: true
  };

  next();
};

const crypto = require('crypto');

const authenticateShopifyProxy = (req, res, next) => {
  const { 'x-shopify-hmac-sha256': hmacHeader, 'x-shopify-shop-domain': shopDomain } = req.headers;
  
  if (!hmacHeader) {
    console.warn('❌ Missing App Proxy HMAC header');
    return res.status(403).json({ success: false, error: 'Missing proxy signature' });
  }

  if (!shopDomain) {
    console.warn('❌ Missing shop domain header');
    return res.status(403).json({ success: false, error: 'Missing shop domain' });
  }

  // Use URLSearchParams for robust query string handling
  const params = { ...req.query };
  
  // The 'signature' param must be removed from the query object before hashing
  delete params.signature;

  const searchParams = new URLSearchParams(params);
  
  // URLSearchParams automatically sorts the parameters by key, which is required by Shopify
  const queryString = searchParams.toString();
  
  // Generate the expected HMAC
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_APP_SECRET)
    .update(queryString, 'utf8')
    .digest('base64');

  // Compare the generated HMAC with the one from the header
  if (generatedHmac !== hmacHeader) {
    console.warn('❌ Invalid App Proxy HMAC');
    console.log('Expected:', generatedHmac);
    console.log('Received:', hmacHeader);
    console.log('Query String Used:', queryString);
    return res.status(403).json({ success: false, error: 'Invalid proxy signature' });
  }

  console.log('✅ App Proxy authenticated for shop:', shopDomain);

  req.shopify = {
    shop: shopDomain,
    verified: true,
    source: 'app-proxy'
  };

  next();
};


module.exports = {
  authenticate,
  authenticateShopify,
  authenticateFlutter,
  authenticateShopifyProxy,
  authenticateShopifyWebhook,
  rateLimitByClient
}; 