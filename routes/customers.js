const nodemailer = require('nodemailer');
const express = require("express");
const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');
const { admin, db } = require("../firebaseConfig.js");
const router = express.Router();
const axios = require("axios");
const {authenticate,authenticateShopifyProxy} = require("../middleware/authenticate.js");

// Initialize phone number utility
const phoneUtil = PhoneNumberUtil.getInstance();

// Get email credentials from environment variables
const { EMAIL_PASS, EMAIL_USER,SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN} = process.env;


const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});
const shopifyApi = axios.create({
  baseURL: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-07`,
  headers: {
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
    "Content-Type": "application/json",
  },
});


async function sendAdminNotification(customerData) {
  const emailContent = `
    <h2>New Customer Profile Created - Verification Required</h2>
    
    <h3>Customer Details:</h3>
    <ul>
      <li><strong>Name:</strong> ${customerData.customer_name}</li>
      <li><strong>Email:</strong> ${customerData.customer_email || 'Not provided'}</li>
      <li><strong>Phone:</strong> ${customerData.customer_phone || 'Not provided'}</li>
      <li><strong>Country:</strong> ${customerData.country}</li>
      <li><strong>Role:</strong> ${customerData.customer_role}</li>
    </ul>
    
    <h3>Business Information:</h3>
    <ul>
      <li><strong>Company:</strong> ${customerData.business_name}</li>
      <li><strong>Website:</strong> ${customerData.domain_name || 'Not provided'}</li>
      <li><strong>Employees:</strong> ${customerData.number_of_employees}</li>
      ${customerData.customer_role === 'Buyer' ? 
        `<li><strong>Retailer Type:</strong> ${customerData.retailer_type || 'Not specified'}</li>` : 
        `<li><strong>Supplier Type:</strong> ${customerData.supplier_type || 'Not specified'}</li>
         <li><strong>Registration #:</strong> ${customerData.business_registration || 'Not provided'}</li>`
      }
    </ul>
    
    <p><strong>Customer ID:</strong> ${customerData.customerId}</p>
    <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
    
    <p>Please review and verify this customer profile.</p>
  `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: `New ${customerData.customer_role} Profile - ${customerData.business_name}`,
    html: emailContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent successfully');
  } catch (error) {
    console.error('Failed to send admin notification:', error);
    // Don't fail the main request if email fails
  }
}

// Phone validation function
function validatePhoneNumber(phoneNumber, countryCode) {
  if (!phoneNumber || !phoneNumber.trim()) {
    return { isValid: true, formattedNumber: '' }; // Phone is optional
  }

  try {
    const number = phoneUtil.parseAndKeepRawInput(phoneNumber, countryCode);
    const isValid = phoneUtil.isValidNumber(number);
    
    if (!isValid) {
      return { isValid: false, error: 'Invalid phone number format' };
    }

    const formattedNumber = phoneUtil.format(number, PhoneNumberFormat.INTERNATIONAL);
    return { isValid: true, formattedNumber };
  } catch (error) {
    return { isValid: false, error: 'Invalid phone number format' };
  }
}

// Country code mapping for phone validation
const countryToPhoneCode = {
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'GB',
  'Germany': 'DE',
  'France': 'FR',
  'Australia': 'AU',
  'Japan': 'JP',
  'India': 'IN',
  'China': 'CN',
  'Brazil': 'BR',
  'Mexico': 'MX',
  'Other': 'US' // Default to US format for 'Other'
};

router.post("/", authenticate, async (req, res) => {
  const { 
    customerId, 
    customer_name,
    customer_email, 
    business_name, 
    customer_role, 
    customer_phone,
    country,
    domain_name,
    number_of_employees,
    retailer_type,
    supplier_type,
    business_registration
  } = req.body;

  // Input validation
  if (!customerId || !customer_name || !customer_role || !country || !business_name || !number_of_employees) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'customerId, customer_name, customer_role, country, business_name, and number_of_employees are required fields'
    });
  }

  // Validate customerId is numeric
  if (!/^\d+$/.test(customerId.toString())) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId must be a numeric value'
    });
  }

  // Validate role
  if (!['Buyer', 'Supplier/Vendor'].includes(customer_role)) {
    return res.status(400).json({
      error: 'Invalid customer role',
      details: 'customer_role must be either "Buyer" or "Supplier/Vendor"'
    });
  }

  // Validate URL format if domain_name is provided
  if (domain_name && domain_name.trim() && !/^https?:\/\/.+\..+/.test(domain_name.trim())) {
    return res.status(400).json({
      error: 'Invalid website URL',
      details: 'domain_name must be a valid URL starting with http:// or https://'
    });
  }

  // Validate phone number using Google libphonenumber
  const phoneCountryCode = countryToPhoneCode[country] || 'US';
  const phoneValidation = validatePhoneNumber(customer_phone, phoneCountryCode);
  
  if (!phoneValidation.isValid) {
    return res.status(400).json({
      error: 'Invalid phone number',
      details: phoneValidation.error + ` for ${country}`
    });
  }

  // Use formatted phone number if validation passed
  const formattedPhone = phoneValidation.formattedNumber;

  // Validate employee count
  const validEmployeeCounts = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
  if (!validEmployeeCounts.includes(number_of_employees)) {
    return res.status(400).json({
      error: 'Invalid employee count',
      details: 'number_of_employees must be one of: ' + validEmployeeCounts.join(', ')
    });
  }

  // Prepare customer data for Firestore
  const customerData = {
    customerId: customerId.toString(),
    customerName: customer_name,
    businessName: business_name,
    role: customer_role,
    contact: formattedPhone || "",
    email: customer_email || "",
    country: country,
    domain: domain_name || "",
    numberOfEmployees: number_of_employees,
    isVerified: false, // Default to false for new customers
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Add role-specific fields
  if (customer_role === 'Buyer' && retailer_type) {
    customerData.retailerType = retailer_type;
  }

  if (customer_role === 'Supplier/Vendor') {
    if (supplier_type) {
      customerData.supplierType = supplier_type;
    }
    if (business_registration) {
      customerData.businessRegistration = business_registration;
    }
  }

  try {
    // Check if customer exists in Firebase
    const customerRef = db.collection('customers').doc(customerId.toString());
    const doc = await customerRef.get();
    
    if (doc.exists) {
      // Update existing customer
      delete customerData.createdAt; // Don't update creation date
      await customerRef.update(customerData);
      console.log(`Successfully updated customer ${customerId} in Firebase:`, customerData);
    } else {
      // Create new customer
      await customerRef.set(customerData);
      console.log(`Successfully created customer ${customerId} in Firebase:`, customerData);
    }

    // Update all Shopify metafields
    const query = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value namespace type }
          userErrors { field message code }
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
        value: business_name
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "role",
        type: "single_line_text_field",
        value: customer_role
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "contact",
        type: "single_line_text_field",
        value: formattedPhone || ""
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "country",
        type: "single_line_text_field",
        value: country
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "domain",
        type: "single_line_text_field",
        value: domain_name || ""
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "number_of_employees",
        type: "single_line_text_field",
        value: number_of_employees
      }
    ];

    // Add role-specific fields
    if (customer_role === 'Buyer' && retailer_type) {
      metafieldsPayload.push({
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "retailer_type",
        type: "single_line_text_field",
        value: retailer_type
      });
    }

    if (customer_role === 'Supplier/Vendor') {
      if (supplier_type) {
        metafieldsPayload.push({
          ownerId: `gid://shopify/Customer/${customerId}`,
          namespace: "custom",
          key: "supplier_type",
          type: "single_line_text_field",
          value: supplier_type
        });
      }
      
      if (business_registration) {
        metafieldsPayload.push({
          ownerId: `gid://shopify/Customer/${customerId}`,
          namespace: "custom",
          key: "business_registration",
          type: "single_line_text_field",
          value: business_registration
        });
      }
    }

    const variables = {
      metafields: metafieldsPayload
    };

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      data: { query, variables }
    });

    const shopifyResult = shopifyResponse.data;

    if (shopifyResult.errors) {
      console.error('Shopify GraphQL errors:', shopifyResult.errors);
      console.warn('Firebase updated successfully but Shopify metafields update failed');
    }

    if (shopifyResult.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('Shopify user errors:', shopifyResult.data.metafieldsSet.userErrors);
      console.warn('Firebase updated successfully but Shopify metafields update had validation errors');
    } else {
      console.log(`Successfully updated all Shopify metafields for customer ${customerId}:`, {
        name: customer_name,
        role: customer_role,
        business: business_name,
        country: country,
        phone: formattedPhone || 'not provided',
        employees: number_of_employees,
        domain: domain_name || 'not provided',
        retailer_type: retailer_type || 'not applicable',
        supplier_type: supplier_type || 'not applicable',
        registration: business_registration || 'not provided'
      });
    }

    // Send admin notification
    await sendAdminNotification({ ...req.body, customer_email });

    res.json({
      success: true,
      data: customerData,
      message: doc.exists ? 'Customer profile updated successfully' : 'Customer profile created successfully',
      shopifyMetafieldsUpdated: !shopifyResult.errors && !shopifyResult.data?.metafieldsSet?.userErrors?.length
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    
    // If it's a Shopify-specific error but Firebase succeeded, still return success
    if (err.response && err.config?.url?.includes('shopify')) {
      console.error('Shopify API error:', err.response.data);
      console.warn('Firebase updated successfully but Shopify API call failed');
      
      return res.json({
        success: true,
        data: customerData,
        message: 'Customer profile updated in Firebase, but Shopify metafields update failed',
        shopifyMetafieldsUpdated: false,
        shopifyError: err.response.data || err.message
      });
    }

    // Firebase or other critical error
    return res.status(500).json({
      error: "Failed to update customer data",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// GET /customer/:customerId - Retrieve specific customer data
router.get("/customer/:customerId",authenticate, async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId is required'
    });
  }

  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    const doc = await customerRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    const customerData = doc.data();
    
    res.json({
      success: true,
      data: {
        id: doc.id,
        ...customerData
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({
      error: "Failed to retrieve customer data",
      details: err.message || 'An unexpected error occurred'
    });
  }
});


/**
 * This endpoint is the first step for a new user.
 * It takes a Firebase Auth UID and user details, then:
 * 1. Creates a new customer in Shopify or finds them if they already exist by email.
 * 2. Creates a corresponding user profile in Firestore, using the Shopify Customer ID as the document ID.
 */


// The new, all-in-one endpoint
router.post('/create-and-sync-user',authenticate, async (req, res) => {
  const { uid, email, name } = req.body;

  // Enhanced validation
  if (!uid || !email || !name) {
    return res.status(400).json({ 
      success: false, 
      error: 'Firebase UID, email, and name are required' 
    });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid email format' 
    });
  }

  try {
    let shopifyCustomerId;

    // Split name into first and last
    const nameParts = name.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || firstName;

    // STEP 1: Create or find the customer in Shopify
    try {
      const shopifyPayload = { 
        customer: { 
          first_name: firstName,
          last_name: lastName,
          email: email,
          email_marketing_consent: {
            state: 'not_subscribed',
            opt_in_level: 'single_opt_in'
          },
          tags: 'firebase-synced',
          note: `Synced from Firebase UID: ${uid}`
        } 
      };
      
      // Use versioned endpoint
      const shopifyResponse = await shopifyApi.post('/customers.json', shopifyPayload);
      shopifyCustomerId = shopifyResponse.data.customer.id;
      console.log(`Created new Shopify customer with ID: ${shopifyCustomerId}`);
      
    } catch (error) {
      if (error.response && error.response.status === 422) {
        // Customer already exists, search for them
        console.log('Customer exists in Shopify. Searching...');
        
        // URL-encode the email for safe query
        const encodedEmail = encodeURIComponent(email);
        const searchUrl = `/customers/search.json?query=email:${encodedEmail}`;
        const existingCust = await shopifyApi.get(searchUrl);
        
        if (!existingCust.data.customers || existingCust.data.customers.length === 0) {
          throw new Error('Customer exists but could not be found by email search.');
        }
        
        shopifyCustomerId = existingCust.data.customers[0].id;
        console.log(`Found existing Shopify customer with ID: ${shopifyCustomerId}`);
        
      } else {
        // Log detailed error info for debugging
        console.error('Shopify API Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        throw error;
      }
    }

    // STEP 2: Store the link and user data in Firestore
    const userDocRef = db.collection('users').doc(uid);
    await userDocRef.set({
      name: name,
      email: email,
      shopifyCustomerId: String(shopifyCustomerId), // Ensure it's a string
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }); // Use merge to avoid overwriting existing data
    
    console.log(`Stored user data in Firestore for UID: ${uid}`);

    // STEP 3: Return the Shopify ID to the client
    res.json({
      success: true,
      message: 'User synced successfully across Shopify and Firebase.',
      shopifyCustomerId: shopifyCustomerId
    });

  } catch (error) {
    console.error('FATAL SYNC ERROR:', error.message, error.stack);
    
    // Return more specific error messages
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.errors || error.message || 'Failed to sync user';
    
    res.status(statusCode).json({ 
      success: false, 
      error: 'Failed to sync user.',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});
// GET /customers - Retrieve all customers with pagination
router.get("/all", authenticateShopifyProxy, async (req, res) => {
  const { 
    limit = 50,
    startAfter, 
    role, 
    isVerified,
    country,
    sortBy = 'createdAt',
    sortOrder = 'desc' 
  } = req.query;

  try {
    let query = db.collection('customers');

    // Apply filters
    if (role) {
      query = query.where('role', '==', role);
    }
    
    if (isVerified !== undefined) {
      query = query.where('isVerified', '==', isVerified === 'true');
    }
    
    if (country) {
      query = query.where('country', '==', country);
    }

    // Apply sorting
    query = query.orderBy(sortBy, sortOrder);

    // Apply pagination
    const limitNum = Math.min(parseInt(limit), 100);
    query = query.limit(limitNum);

    if (startAfter) {
      const startAfterDoc = await db.collection('customers').doc(startAfter).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    // Execute query
    const snapshot = await query.get();
    
    const customers = [];
    let lastDocId = null;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      customers.push({
        id: doc.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || '',
        phone: data.contact || '',
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
        tags: data.tags || [],
        customerName: data.customerName || '',
        businessName: data.businessName || '',
        role: data.role || '',
        contact: data.contact || '',
        isVerified: data.isVerified || false,
        country: data.country || '',
        domainName: data.domain || '',
        numberOfEmployees: data.numberOfEmployees || '',
        retailerType: data.retailerType || '',
        supplierType: data.supplierType || '',
        businessRegistration: data.businessRegistration || ''
      });
      lastDocId = doc.id;
    });

    const hasNextPage = customers.length === limitNum;

    res.json({
      success: true,
      data: {
        customers: customers,
        pageInfo: {
          hasNextPage: hasNextPage,
          lastDocId: lastDocId,
          totalCount: customers.length
        }
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    return res.status(500).json({
      error: "Failed to retrieve customers",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// POST /verify - Update customer verification status
router.post("/verify",authenticate, async (req, res) => {
  const { customerId, isVerified } = req.body;

  // Input Validation
  if (!customerId) {
    return res.status(400).json({
      error: 'Missing required field',
      details: 'customerId is a required field'
    });
  }

  // Validate customerId is numeric
  if (!/^\d+$/.test(customerId.toString())) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId must be a numeric value'
    });
  }

  if (typeof isVerified !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid isVerified value',
      details: 'isVerified must be a boolean (true or false)'
    });
  }

  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    
    // Check if customer exists
    const doc = await customerRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    // Update verification status in Firebase
    await customerRef.update({
      isVerified: isVerified,
      updatedAt: new Date().toISOString(),
      verifiedAt: isVerified ? new Date().toISOString() : null
    });

    console.log(`Successfully updated isVerified status in Firebase for customer ${customerId} to ${isVerified}`);

    // Update Shopify metafield for isVerified
    const query = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id key value namespace type }
          userErrors { field message code }
        }
      }
    `;

    const metafieldsPayload = [
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "is_verified",
        type: "boolean",
        value: isVerified.toString()
      }
    ];

    const variables = {
      metafields: metafieldsPayload
    };

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      data: { query, variables }
    });

    const shopifyResult = shopifyResponse.data;

    if (shopifyResult.errors) {
      console.error('Shopify GraphQL errors:', shopifyResult.errors);
      console.warn('Firebase updated successfully but Shopify metafield update failed');
    }

    if (shopifyResult.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('Shopify user errors:', shopifyResult.data.metafieldsSet.userErrors);
      console.warn('Firebase updated successfully but Shopify metafield update had validation errors');
    } else {
      console.log(`Successfully updated Shopify is_verified metafield for customer ${customerId}: ${isVerified}`);
    }

    res.json({
      success: true,
      message: `Customer verification status updated to ${isVerified}`,
      data: {
        customerId: customerId,
        isVerified: isVerified,
        updatedAt: new Date().toISOString()
      },
      shopifyMetafieldUpdated: !shopifyResult.errors && !shopifyResult.data?.metafieldsSet?.userErrors?.length
    });

  } catch (err) {
    console.error('Unexpected error during verification update:', err.message);
    
    // If it's a Shopify-specific error but Firebase succeeded, still return success
    if (err.response && err.config?.url?.includes('shopify')) {
      console.error('Shopify API error:', err.response.data);
      console.warn('Firebase updated successfully but Shopify API call failed');
      
      return res.json({
        success: true,
        message: `Customer verification status updated in Firebase to ${isVerified}, but Shopify metafield update failed`,
        data: {
          customerId: customerId,
          isVerified: isVerified,
          updatedAt: new Date().toISOString()
        },
        shopifyMetafieldUpdated: false,
        shopifyError: err.response.data || err.message
      });
    }

    // Firebase or other critical error
    return res.status(500).json({
      error: "Failed to update verification status",
      details: err.message || 'An unexpected error occurred'
    });
  }
});
// DELETE /customer/:customerId - Delete a customer (optional endpoint)
router.delete("/customer/:customerId",authenticate, async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId is required'
    });
  }
 
  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    
    // Check if customer exists
    const doc = await customerRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    // Delete the customer
    await customerRef.delete();
    
    console.log(`Successfully deleted customer ${customerId}`);

    res.json({
      success: true,
      message: `Customer ${customerId} deleted successfully`
    });

  } catch (err) {
    console.error('Unexpected error during deletion:', err.message);
    return res.status(500).json({
      error: "Failed to delete customer",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// Export the router to be used in server.js
module.exports = router;