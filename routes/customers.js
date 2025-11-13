const nodemailer = require('nodemailer');
const express = require("express");
const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');
const { admin, db } = require("../firebaseConfig.js");
const router = express.Router();
const axios = require("axios");
const {authenticate,authenticateShopifyProxy,authenticateManualHmac} = require("../middleware/authenticate.js");

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

router.post("/register-firebase", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // 1. Create Firebase Auth User (ignore if already exists)
    let user;
    try {
      user = await admin.auth().createUser({
        email,
        password,
        displayName: `${firstName} ${lastName}`.trim()
      });
    } catch(e) {
      if (e.errorInfo?.code === "auth/email-already-exists") {
        user = await admin.auth().getUserByEmail(email);
      } else throw e;
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Firebase Sync Error:", err);
    return res.status(200).json({ success: false, note: "Non-blocking sync" });
  }
});


router.post("/", async (req, res) => {
  const { 
    customerId, 
    customer_name,
    business_name, 
    email,
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
  if (!customerId || !customer_name || !customer_role || !country || !business_name || !number_of_employees || !email) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'customerId, customer_name, customer_role, country, business_name, number_of_employees and email are required fields'
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
    email: email || "",
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
    //await sendAdminNotification({ ...req.body, customer_email });

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
router.get("/customer/:customerId",async (req, res) => {
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
router.post('/create-and-sync-user',async (req, res) => {
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
router.get("/all", authenticateManualHmac, async (req, res) => {
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
router.post("/verify",authenticateManualHmac, async (req, res) => {
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


 // GET /customer/:customerId/excel-data - Fetch and parse Excel metafield
// router.get("/customer/:customerId/performance",  async (req, res) => {
//   const { customerId } = req.params;

//   if (!customerId) {
//     return res.status(400).json({
//       error: 'Invalid customerId',
//       details: 'customerId is required'
//     });
//   }

//   try {
//     // Fetch the Excel file metafield from Shopify
//     const query = `
//       query getCustomerMetafield($customerId: ID!) {
//         customer(id: $customerId) {
//           id
//           metafield(namespace: "custom", key: "po_excel") {
//             id
//             value
//             type
//           }
//         }
//       }
//     `;

//     const variables = {
//       customerId: `gid://shopify/Customer/${customerId}`
//     };

//     const shopifyResponse = await axios({
//       method: "POST",
//       url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
//       headers: {
//         "Content-Type": "application/json",
//         "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
//       },
//       data: { query, variables }
//     });

//     const metafieldData = shopifyResponse.data?.data?.customer?.metafield;
    

//     if (!metafieldData) {
//   return res.status(404).json({
//     error: 'Excel file not found',
//     details: `No metafield found for customer ${customerId}`
//   });
// }

// // metafield is likely a file_reference type
// if (metafieldData.type === 'file_reference') {
//   const fileId = metafieldData.value; // this is gid://shopify/GenericFile/...

//   const fileQuery = `
//     query getFileUrl($fileId: ID!) {
//       node(id: $fileId) {
//         ... on GenericFile {
//           url
//         }
//         ... on MediaImage {
//           image {
//             url
//           }
//         }
//       }
//     }
//   `;

//   const fileResponse = await axios({
//     method: 'POST',
//     url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
//     headers: {
//       'Content-Type': 'application/json',
//       'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN
//     },
//     data: { query: fileQuery, variables: { fileId } }
//   });

//   const fileUrl =
//     fileResponse.data?.data?.node?.url ||
//     fileResponse.data?.data?.node?.image?.url;

//   if (!fileUrl) {
//     return res.status(404).json({
//       error: 'File URL not found',
//       details: 'Could not resolve file reference metafield'
//     });
//   }

//   // Continue parsing Excel file
//   const fileBuffer = await axios.get(fileUrl, { responseType: 'arraybuffer' });
//   const workbook = XLSX.read(fileBuffer.data, { type: 'buffer' });
//   ...
// } else {
//   // if it’s already a URL
//   const fileUrl = metafieldData.value;
//   const fileBuffer = await axios.get(fileUrl, { responseType: 'arraybuffer' });
//   const workbook = XLSX.read(fileBuffer.data, { type: 'buffer' });
//   ...
// }

//     // The metafield value should contain the file URL or base64 data
//     const fileUrl = metafieldData.value;

//     // Download the file
//     const fileResponse = await axios({
//       method: 'GET',
//       url: fileUrl,
//       responseType: 'arraybuffer'
//     });

//     // Parse Excel file using SheetJS
//     const XLSX = require('xlsx');
//     const workbook = XLSX.read(fileResponse.data, { type: 'buffer' });
    
//     // Get the first sheet
//     const sheetName = workbook.SheetNames[0];
//     const worksheet = workbook.Sheets[sheetName];
    
//     // Convert to JSON
//     const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
//       header: 1,
//       defval: '',
//       blankrows: false
//     });

//     if (jsonData.length === 0) {
//       return res.status(404).json({
//         error: 'Empty file',
//         details: 'The Excel file contains no data'
//       });
//     }

//     // Extract headers and rows
//     const headers = jsonData[0];
//     const rows = jsonData.slice(1);

//     // Convert to array of objects
//     const parsedData = rows.map(row => {
//       const obj = {};
//       headers.forEach((header, index) => {
//         obj[header] = row[index] !== undefined ? row[index] : '';
//       });
//       return obj;
//     });

//     // Calculate summary statistics
//     const summary = {
//       totalRows: parsedData.length,
//       totalOpenPos: parsedData.reduce((sum, row) => sum + (parseFloat(row['Open Pos']) || 0), 0),
//       totalOrders: parsedData.reduce((sum, row) => sum + (parseFloat(row['Total orders']) || 0), 0),
//       totalOTIF: parsedData.reduce((sum, row) => sum + (parseFloat(row['OTIF']) || 0), 0),
//       totalQualityClaimsLY: parsedData.reduce((sum, row) => sum + (parseFloat(row['Quality Claims LY']) || 0), 0),
//       totalQualityClaims: parsedData.reduce((sum, row) => sum + (parseFloat(row['Quality Claims']) || 0), 0),
//       totalSKUs: parsedData.reduce((sum, row) => sum + (parseFloat(row['Total SKUs']) || 0), 0),
//       totalConvertedSKUs: parsedData.reduce((sum, row) => sum + (parseFloat(row['Converted SKUs']) || 0), 0)
//     };

//     res.json({
//       success: true,
//       data: {
//         headers: headers,
//         rows: parsedData,
//         summary: summary,
//         rowCount: parsedData.length
//       }
//     });

//   } catch (err) {
//     console.error('Error fetching/parsing Excel file:', err.message);
    
//     if (err.response?.status === 404) {
//       return res.status(404).json({
//         error: 'File not found',
//         details: 'The Excel file URL is not accessible'
//       });
//     }

//     return res.status(500).json({
//       error: "Failed to fetch or parse Excel file",
//       details: err.message || 'An unexpected error occurred'
//     });
//   }
// });


router.get("/customer/:customerId/merchants-performance", async (req, res) => {
  const { customerId } = req.params;
  const { buyer } = req.query; // Optional buyer filter

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    // First, get the customer's email and buyers metafield
    const customerQuery = `
      query getCustomer($customerId: ID!) {
        customer(id: $customerId) {
          id
          email
          metafield(namespace: "custom", key: "buyers") {
            value
            type
          }
        }
      }
    `;

    const customerVariables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const customerResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: customerQuery, variables: customerVariables },
    });

    const customerData = customerResponse.data?.data?.customer;
    const customerEmail = customerData?.email;

    if (!customerEmail) {
      return res.status(404).json({
        error: "Customer not found",
        details: `No customer found with ID ${customerId}`,
      });
    }

    // Parse buyers metafield (list.single_line_text_field)
    let availableBuyers = [];
    if (customerData?.metafield?.value) {
      try {
        availableBuyers = JSON.parse(customerData.metafield.value);
      } catch (e) {
        console.warn("Failed to parse buyers metafield:", e);
      }
    }

    // Fetch shop metafield for the performance Excel file
    const shopMetafieldQuery = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "merchantperformance") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: shopMetafieldQuery },
    });

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No shop metafield found for merchant performance",
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean and normalize headers
    const headers = jsonData[0].map(h =>
      h?.toString().trim().replace(/\u00A0/g, " ")
    );

    const rows = jsonData.slice(1);

    // Helper to safely parse numbers
    const cleanNumber = (val) => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    const parsedData = rows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : "";
      });
      return obj;
    });

    // Find all rows matching customer email
    const customerRows = parsedData.filter(
      (row) => row["Email"]?.toString().toLowerCase().trim() === customerEmail.toLowerCase().trim()
    );

    if (customerRows.length === 0) {
      return res.status(404).json({
        error: "Customer data not found",
        details: `No performance data found for customer email: ${customerEmail}`,
      });
    }

    // Check if merchant handles multiple buyers
    const buyerColumn = customerRows.map(row => row["Buyer"]).filter(Boolean);
    const isMultiBuyer = buyerColumn.length > 1;
    const hasCollective = customerRows.some(row => 
      row["Buyer"]?.toString().toLowerCase().includes("collective")
    );

    // Filter by buyer if specified
    let filteredRows = customerRows;
    if (buyer && buyer !== "All") {
      filteredRows = customerRows.filter(row => 
        row["Buyer"]?.toString().trim() === buyer
      );
      
      if (filteredRows.length === 0) {
        return res.status(404).json({
          error: "Buyer data not found",
          details: `No performance data found for buyer: ${buyer}`,
        });
      }
    }

    // Aggregate data for the selected buyer(s)
    const aggregateSummary = (rows) => {
      const totals = {
        volumeLY25: 0,
        targetFY26: 0,
        ytdFY26: 0,
        totalOpenPos: 0,
        totalOrders: 0,
        otifValues: [],
        otifLYValues: [],
        totalQualityClaimsLY: 0,
        totalQualityClaims: 0,
        totalSKUs: 0,
        totalConvertedSKUs: 0,
        numberOfPos: 0,
      };

      rows.forEach(row => {
        totals.volumeLY25 += cleanNumber(row["Volume LY25"]);
        totals.targetFY26 += cleanNumber(row["Target FY26"]);
        totals.ytdFY26 += cleanNumber(row["YTD FY26"]);
        totals.totalOpenPos += cleanNumber(row["Open Pos"]);
        totals.totalOrders += cleanNumber(row["Total orders"]);
        
        const otif = cleanNumber(row["OTIF"]);
        if (otif > 0) totals.otifValues.push(otif);
        
        const otifLY = cleanNumber(row["OTIF LY"]);
        if (otifLY > 0) totals.otifLYValues.push(otifLY);
        
        totals.totalQualityClaimsLY += cleanNumber(row["Quality Claims LY"]);
        totals.totalQualityClaims += cleanNumber(row["Quality Claims"]);
        totals.totalSKUs += cleanNumber(row["Total SKUs"]);
        totals.totalConvertedSKUs += cleanNumber(row["Converted SKUs"]);
        totals.numberOfPos += cleanNumber(row["Number of Pos"]);
      });

      // Calculate average OTIF
      const avgOtif = totals.otifValues.length > 0
        ? totals.otifValues.reduce((a, b) => a + b, 0) / totals.otifValues.length
        : 0;

      const avgOtifLY = totals.otifLYValues.length > 0
        ? totals.otifLYValues.reduce((a, b) => a + b, 0) / totals.otifLYValues.length
        : 0;

      return {
        totalRows: rows.length,
        volumeLY25: totals.volumeLY25,
        targetFY26: totals.targetFY26,
        ytdActual: totals.ytdFY26,
        ytdFY26: totals.ytdFY26,
        totalOpenPos: totals.totalOpenPos,
        totalOrders: totals.totalOrders,
        otifRate: `${avgOtif.toFixed(0)}%`,
        otifRawAverage: avgOtif,
        otifLY: avgOtifLY,
        totalQualityClaimsLY: totals.totalQualityClaimsLY,
        totalQualityClaims: totals.totalQualityClaims,
        totalSKUs: totals.totalSKUs,
        totalConvertedSKUs: totals.totalConvertedSKUs,
        numberOfPos: totals.numberOfPos,
        ytdTarget: totals.targetFY26,
        lytd: totals.volumeLY25,
      };
    };

    const summary = aggregateSummary(filteredRows);

    // Get list of buyers for this merchant
    const buyersList = Array.from(new Set(
      customerRows.map(row => row["Buyer"]).filter(Boolean)
    )).sort();

    let determinedCurrentBuyer;
    if (buyer && buyer !== "All") {
      // User explicitly selected a buyer
      determinedCurrentBuyer = buyer;
    } else {
      // No buyer selected - pick a default
      if (hasCollective) {
        // If collective exists, use it
        determinedCurrentBuyer = buyersList.find(b => b.toLowerCase().includes('collective')) || buyersList[0];
      } else {
        // No collective - just use first buyer
        determinedCurrentBuyer = buyersList[0] || "Unknown";
      }
    }

    res.json({
  success: true,
  data: {
    headers,
    rows: filteredRows,
    summary,
    rowCount: filteredRows.length,
    isMultiBuyer,
    hasCollective,
    availableBuyers: buyersList,
    currentBuyer: determinedCurrentBuyer,  // Use the determined buyer
    metafieldBuyers: availableBuyers,
  },
});
  } catch (err) {
    console.error("Error fetching/parsing Excel file:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});

router.get("/customer/:customerId/merchant-performance", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    // First, get the customer's email
    const customerQuery = `
      query getCustomer($customerId: ID!) {
        customer(id: $customerId) {
          id
          email
        }
      }
    `;

    const customerVariables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const customerResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: customerQuery, variables: customerVariables },
    });

    const customerEmail = customerResponse.data?.data?.customer?.email;

    if (!customerEmail) {
      return res.status(404).json({
        error: "Customer not found",
        details: `No customer found with ID ${customerId}`,
      });
    }

    // Fetch shop metafield for the performance Excel file
    const shopMetafieldQuery = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "merchantperformance") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: shopMetafieldQuery },
    });

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No shop metafield found for merchant performance",
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      // Case 2: direct URL stored as value
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false, // This ensures numbers are read as strings to preserve formatting
    });

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean and normalize headers
    const headers = jsonData[0].map(h =>
      h?.toString().trim().replace(/\u00A0/g, " ")
    );

    console.log("Headers found:", headers); // Debug log

    const rows = jsonData.slice(1);

    // Helper to safely parse numbers
    const cleanNumber = (val) => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    const parsedData = rows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : "";
      });
      return obj;
    });

    // Find customer's data by matching email
    const customerData = parsedData.find(
      (row) => row["Email"]?.toString().toLowerCase().trim() === customerEmail.toLowerCase().trim()
    );

    if (!customerData) {
      return res.status(404).json({
        error: "Customer data not found",
        details: `No performance data found for customer email: ${customerEmail}`,
        availableEmails: parsedData.map(r => r["Email"]).filter(Boolean), // Debug info
      });
    }

    console.log("Customer data found:", customerData); // Debug log

    // Map to your exact Excel column names
    const summary = {
      totalRows: 1,
      
      // Column C: Volume LY25
      volumeLY25: cleanNumber(customerData["Volume LY25"]),
      
      // Column D: Target FY26
      targetFY26: cleanNumber(customerData["Target FY26"]),
      
      // Column E: YTD FY26
      ytdActual: cleanNumber(customerData["YTD FY26"]),
      ytdFY26: cleanNumber(customerData["YTD FY26"]), // Alias for clarity
      
      // Column F: Open Pos
      totalOpenPos: cleanNumber(customerData["Open Pos"]),
      
      // Column G: Total orders
      totalOrders: cleanNumber(customerData["Total orders"]),
      
      // Column H: OTIF
      otifRate: `${cleanNumber(customerData["OTIF"]).toFixed(0)}%`,
      otifRawAverage: cleanNumber(customerData["OTIF"]),

      otifLY: cleanNumber(customerData["OTIF LY"]),
      
      // Column I: Quality Claims LY
      totalQualityClaimsLY: cleanNumber(customerData["Quality Claims LY"]),
      
      // Column J: Quality Claims
      totalQualityClaims: cleanNumber(customerData["Quality Claims"]),
      
      // Column K: Total SKUs
      totalSKUs: cleanNumber(customerData["Total SKUs"]),
      
      // Column L: Converted SKUs
      totalConvertedSKUs: cleanNumber(customerData["Converted SKUs"]),
      
      // Column M: Number of Pos
      numberOfPos: cleanNumber(customerData["Number of Pos"]),
      
      // For backward compatibility with your frontend
      ytdTarget: cleanNumber(customerData["Target FY26"]), // Using Target FY26 as the target
      lytd: cleanNumber(customerData["Volume LY25"]), // Using Volume LY25 as last year data
    };

    res.json({
      success: true,
      data: {
        headers,
        rows: [customerData], // Return only the matched customer's data as an array
        summary,
        rowCount: 1,
      },
    });
  } catch (err) {
    console.error("Error fetching/parsing Excel file:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});

router.get("/customer/:customerId/buyer-performance", async (req, res) => {
 const { customerId } = req.params;

 if (!customerId) {
 return res.status(400).json({
 error: "Invalid customerId",
 details: "customerId is required",
 });
 }

 try {
 // First, get the customer's email
 const customerQuery = `
 query getCustomer($customerId: ID!) {
 customer(id: $customerId) {
 id
 email
 }
 }
 `;

 const customerVariables = {
 customerId: `gid://shopify/Customer/${customerId}`,
 };

 const customerResponse = await axios({
 method: "POST",
 url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
 headers: {
 "Content-Type": "application/json",
 "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
 },
 data: { query: customerQuery, variables: customerVariables },
 });

 const customerEmail = customerResponse.data?.data?.customer?.email;

 if (!customerEmail) {
 return res.status(404).json({
 error: "Customer not found",
 details: `No customer found with ID ${customerId}`,
 });
 }

 // Fetch shop metafield for the buyer's performance Excel file
 const shopMetafieldQuery = `
 query getShopMetafield {
 shop {
 metafield(namespace: "custom", key: "buyers_performance") {
 id
 value
 type
 }
 }
 }
 `;

 const shopifyResponse = await axios({
 method: "POST",
 url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
 headers: {
 "Content-Type": "application/json",
 "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
 },
 data: { query: shopMetafieldQuery },
 });

 const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

 if (!metafieldData) {
 return res.status(404).json({
 error: "Excel file not found",
 details: "No shop metafield found for buyer performance",
 });
 }

 let fileUrl;

 // Case 1: metafield type is file_reference
 if (metafieldData.type === "file_reference") {
 const fileId = metafieldData.value;

 const fileQuery = `
 query getFileUrl($fileId: ID!) {
 node(id: $fileId) {
 ... on GenericFile {
 url
 }
 ... on MediaImage {
 image {
 url
 }
 }
 }
 }
 `;

 const fileApiResponse = await axios({
 method: "POST",
 url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
 headers: {
 "Content-Type": "application/json",
 "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
 },
 data: { query: fileQuery, variables: { fileId } },
 });

 fileUrl =
 fileApiResponse.data?.data?.node?.url ||
 fileApiResponse.data?.data?.node?.image?.url;

 if (!fileUrl) {
 return res.status(404).json({
 error: "File URL not found",
 details: "Could not resolve file reference metafield",
 });
 }
 } else {
 // Case 2: direct URL stored as value
 fileUrl = metafieldData.value;
 }

 // Download the file
 const fileResponse = await axios({
 method: "GET",
 url: fileUrl,
 responseType: "arraybuffer",
 });

 const workbook = XLSX.read(fileResponse.data, { type: "buffer" });
 const sheetName = workbook.SheetNames[0];
 const worksheet = workbook.Sheets[sheetName];
 const jsonData = XLSX.utils.sheet_to_json(worksheet, {
 header: 1,
 defval: "",
 blankrows: false,
 raw: false,
 });

 if (jsonData.length === 0) {
 return res.status(404).json({
 error: "Empty file",
 details: "The Excel file contains no data",
 });
 }

 // Clean and normalize headers
 const headers = jsonData[0].map(h =>
 h?.toString().trim().replace(/\u00A0/g, " ")
 );
 const rows = jsonData.slice(1);

 // Helper to safely parse numbers and currency
 const cleanNumber = (val) => {
 if (val === null || val === undefined || val === "") return 0;
 if (typeof val === "number") return val;
 if (typeof val === "string") {
 const cleaned = val.replace(/[^0-9.\-]/g, "");
 return cleaned ? parseFloat(cleaned) : 0;
 }
 return 0;
 };

 const parsedData = rows.map((row) => {
 const obj = {};
 headers.forEach((header, index) => {
 obj[header] = row[index] !== undefined ? row[index] : "";
 });
 return obj;
 });

 // Find customer's data by matching email
 const customerData = parsedData.find(
 (row) => row["Email"]?.toString().toLowerCase().trim() === customerEmail.toLowerCase().trim()
 );

 if (!customerData) {
 return res.status(404).json({
 error: "Customer data not found",
 details: `No performance data found for customer email: ${customerEmail}`,
 availableEmails: parsedData.map(r => r["Email"]).filter(Boolean),
 });
 }

 // Map data from the new Excel columns
 const summary = {
 totalRows: 1,
 businessName: customerData["Business Name"],
 shippedPosCurrent: cleanNumber(customerData["Shipped Pos current"]),
 shippedPosLast: cleanNumber(customerData["Shipped Pos last"]),
 ytdFY26: cleanNumber(customerData["YTD FY26"]),
 openPosCurrent: cleanNumber(customerData["Open Pos current"]),
 openPosNext: cleanNumber(customerData["Open Pos next"]),
 totalOrders: cleanNumber(customerData["Total orders"]),
 otifRate: `${cleanNumber(customerData["OTIF"]).toFixed(0)}%`,
 otifRaw: cleanNumber(customerData["OTIF"]),
 openPosYTD: cleanNumber(customerData["Open Pos YTD"]),
 shippedPosYTD: cleanNumber(customerData["Shipped Pos YTD"]),
 };

 res.json({
 success: true,
 data: {
 headers,
 rows: [customerData],
 summary,
 rowCount: 1,
 },
 });
 } catch (err) {
 console.error("Error fetching/parsing Excel file:", err.message);
 console.error("Full error:", err);

 if (err.response?.status === 404) {
 return res.status(404).json({
 error: "File not found",
 details: "The Excel file URL is not accessible",
 });
 }

 return res.status(500).json({
 error: "Failed to fetch or parse Excel file",
 details: err.message || "An unexpected error occurred",
 });
 }
});

router.get("/customer/:customerId/performance", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    const query = `
      query getCustomerMetafield($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "po_excel") {
            id
            value
            type
          }
        }
      }
    `;

    const variables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query, variables },
    });

    const metafieldData = shopifyResponse.data?.data?.customer?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: `No metafield found for customer ${customerId}`,
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      // Case 2: direct URL stored as value
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean and normalize headers
    const headers = jsonData[0].map(h =>
      h?.toString().trim().replace(/\u00A0/g, " ")
    );

    const rows = jsonData.slice(1);

    // Helper to safely parse numbers
    const cleanNumber = (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    const parsedData = rows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : "";
      });
      return obj;
    });

    // Calculate totals and averages
    const totalOTIFSum = parsedData.reduce(
      (sum, row) => sum + cleanNumber(row["OTIF"]),
      0
    );
    const rowsWithOTIF = parsedData.filter(row => cleanNumber(row["OTIF"]) > 0).length;
    const avgOTIF = rowsWithOTIF > 0 ? (totalOTIFSum / rowsWithOTIF) : 0;

    const summary = {
      totalRows: parsedData.length,
      
      // Open POs
      totalOpenPos: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Open Pos"]),
        0
      ),
      
      // Total Orders (shipped)
      totalOrders: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Total orders"]),
        0
      ),
      
      // YTD FY26 Target and Actual
      ytdTarget: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["YTD Target FY26"]),
        0
      ),
      ytdActual: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["YTD Actual FY26"]),
        0
      ),
      
      // LYTD (Last Year To Date)
      lytd: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["LYTD"]),
        0
      ),
      
      // OTIF Rate (average percentage)
      otifRate: `${avgOTIF.toFixed(0)}%`,
      otifRawAverage: avgOTIF,
      
      // Quality Claims
      totalQualityClaimsLY: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Quality Claims LY"]),
        0
      ),
      totalQualityClaims: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Quality Claims"]),
        0
      ),
      
      // SKUs
      totalSKUs: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Total SKUs"]),
        0
      ),
      totalConvertedSKUs: parsedData.reduce(
        (sum, row) => sum + cleanNumber(row["Converted SKUs"]),
        0
      ),
    };

    res.json({
      success: true,
      data: {
        headers,
        rows: parsedData,
        summary,
        rowCount: parsedData.length,
      },
    });
  } catch (err) {
    console.error("Error fetching/parsing Excel file:", err.message);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});

const XLSX = require("xlsx");

router.get("/customer/:customerId/volume-shipped-ytd", async (req, res) => {
  try {
    // Get customer ID from request (adjust based on your auth setup)
    const { customerId } = req.params; // or req.query.customerId, req.session.customerId, etc.

   if (!customerId) {
      return res.status(401).json({
        error: "Unauthorized",
        details: "Customer ID is required"
      });
    }

    // Fetch customer's buyers metafield
    const customerQuery = `
      query getCustomerBuyers($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "buyers") {
            value
          }
        }
      }
    `;

    const customerResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { 
        query: customerQuery, 
        variables: { customerId: `gid://shopify/Customer/${customerId}` }
      },
    });

    const customerBuyersValue = customerResponse.data?.data?.customer?.metafield?.value;
    
    // Parse the buyers list
    let allowedBuyers = [];
    if (customerBuyersValue) {
      try {
        // Try parsing as JSON first (for list metafield type)
        const parsed = JSON.parse(customerBuyersValue);
        allowedBuyers = Array.isArray(parsed) 
          ? parsed.map(b => b.trim().toUpperCase()).filter(b => b)
          : [customerBuyersValue.trim().toUpperCase()];
      } catch (e) {
        // If not JSON, treat as comma-separated string
        allowedBuyers = customerBuyersValue
          .split(',')
          .map(b => b.trim().toUpperCase())
          .filter(b => b);
      }
    }

    console.log("Customer ID:", customerId);
    console.log("Raw customer buyers value:", customerBuyersValue);
    console.log("Customer allowed buyers (normalized):", allowedBuyers);

    // Fetch shop metafield for Excel file
    const query = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "volumeshippedytd") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query },
    });

    console.log("Shopify Response:", JSON.stringify(shopifyResponse.data, null, 2));

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No volumeshippedytd metafield found",
        debugInfo: shopifyResponse.data
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      // Case 2: direct URL stored as value
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    // Parse Excel file
    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get the range for debugging
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log("Sheet range:", range);

    // Convert to JSON array format
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    console.log("=== DEBUG INFO ===");
    console.log("Total rows read:", jsonData.length);
    console.log("First 3 rows:", JSON.stringify(jsonData.slice(0, 3), null, 2));
    console.log("==================");

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Find the first non-empty row (header row)
    let headerRowIndex = 0;
    for (let i = 0; i < jsonData.length; i++) {
      if (jsonData[i] && jsonData[i].length > 0 && jsonData[i][0]) {
        headerRowIndex = i;
        break;
      }
    }

    // Clean and normalize headers
    const headers = jsonData[headerRowIndex].map((h) =>
      h?.toString().trim().replace(/\u00A0/g, " ").replace(/\s+/g, " ")
    );

    console.log("Headers found:", headers);

    // Get data rows (skip header and filter empty rows)
    const rows = jsonData.slice(headerRowIndex + 1).filter(row => 
      row && row.length > 0 && (row[0] || row[1])
    );

    console.log("Number of data rows:", rows.length);

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No data rows found",
        details: "The Excel file contains headers but no data rows",
        headers: headers,
      });
    }

    // Helper to safely parse numbers
    const cleanNumber = (val) => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    // Parse data rows
    const parsedData = rows.map((row) => {
      const obj = {
        buyer: row[0]?.toString().trim().toUpperCase() || "", // Convert to uppercase
        vendor: row[1]?.toString().trim() || "",
      };

      // Map month columns (starting from index 2)
      headers.slice(2).forEach((month, index) => {
        obj[month] = cleanNumber(row[index + 2]);
      });

      return obj;
    });

    // FILTER DATA BY CUSTOMER'S ALLOWED BUYERS
    const filteredData = allowedBuyers.length > 0
      ? parsedData.filter(row => allowedBuyers.includes(row.buyer))
      : parsedData; // If no buyers specified, return all data

    console.log("Total parsed rows:", parsedData.length);
    console.log("Filtered data rows:", filteredData.length);

    if (filteredData.length === 0 && allowedBuyers.length > 0) {
      return res.json({
        success: true,
        data: {
          headers,
          rows: [],
          summary: {
            totalRows: 0,
            totalsByMonth: {},
            totalsByBuyer: {},
            totalsByVendor: {},
            grandTotal: 0,
          },
          rowCount: 0,
          months: headers.slice(2),
        },
        message: "No data available for your assigned buyers",
        customerBuyers: allowedBuyers
      });
    }

    // Calculate summary statistics BASED ON FILTERED DATA
    const monthColumns = headers.slice(2);
    const summary = {
      totalRows: filteredData.length,
      totalsByMonth: {},
      totalsByBuyer: {},
      totalsByVendor: {},
      grandTotal: 0,
    };

    // Calculate totals by month
    monthColumns.forEach((month) => {
      summary.totalsByMonth[month] = filteredData.reduce(
        (sum, row) => sum + (row[month] || 0),
        0
      );
    });

    // Calculate totals by buyer
    filteredData.forEach((row) => {
      if (row.buyer) {
        if (!summary.totalsByBuyer[row.buyer]) {
          summary.totalsByBuyer[row.buyer] = 0;
        }
        monthColumns.forEach((month) => {
          summary.totalsByBuyer[row.buyer] += row[month] || 0;
        });
      }
    });

    // Calculate totals by vendor
    filteredData.forEach((row) => {
      if (row.vendor) {
        if (!summary.totalsByVendor[row.vendor]) {
          summary.totalsByVendor[row.vendor] = 0;
        }
        monthColumns.forEach((month) => {
          summary.totalsByVendor[row.vendor] += row[month] || 0;
        });
      }
    });

    // Calculate grand total
    summary.grandTotal = Object.values(summary.totalsByMonth).reduce(
      (sum, val) => sum + val,
      0
    );

    res.json({
      success: true,
      data: {
        headers,
        rows: filteredData,
        summary,
        rowCount: filteredData.length,
        months: monthColumns,
      },
      customerBuyers: allowedBuyers, // Include for debugging/transparency
    });
  } catch (err) { 
    console.error("Error fetching/parsing Excel file:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

router.get("/customer/:customerId/volume-origin", async (req, res) => {
  try {
    // Get customer ID from request (adjust based on your auth setup)
    const { customerId } = req.params; // or req.query.customerId, req.session.customerId, etc.

   if (!customerId) {
      return res.status(401).json({
        error: "Unauthorized",
        details: "Customer ID is required"
      });
    }

    // Fetch customer's buyers metafield
    const customerQuery = `
      query getCustomerBuyers($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "buyers") {
            value
          }
        }
      }
    `;

    const customerResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { 
        query: customerQuery, 
        variables: { customerId: `gid://shopify/Customer/${customerId}` }
      },
    });

    const customerBuyersValue = customerResponse.data?.data?.customer?.metafield?.value;
    
    // Parse the buyers list
    let allowedBuyers = [];
    if (customerBuyersValue) {
      try {
        // Try parsing as JSON first (for list metafield type)
        const parsed = JSON.parse(customerBuyersValue);
        allowedBuyers = Array.isArray(parsed) 
          ? parsed.map(b => b.trim().toUpperCase()).filter(b => b)
          : [customerBuyersValue.trim().toUpperCase()];
      } catch (e) {
        // If not JSON, treat as comma-separated string
        allowedBuyers = customerBuyersValue
          .split(',')
          .map(b => b.trim().toUpperCase())
          .filter(b => b);
      }
    }

    console.log("Customer ID:", customerId);
    console.log("Raw customer buyers value:", customerBuyersValue);
    console.log("Customer allowed buyers (normalized):", allowedBuyers);

    // Fetch shop metafield for Excel file
    const query = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "volumeshippedytd") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query },
    });

    console.log("Shopify Response:", JSON.stringify(shopifyResponse.data, null, 2));

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No volumeshippedytd metafield found",
        debugInfo: shopifyResponse.data
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      // Case 2: direct URL stored as value
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    // Parse Excel file
    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get the range for debugging
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log("Sheet range:", range);

    // Convert to JSON array format
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    console.log("=== DEBUG INFO ===");
    console.log("Total rows read:", jsonData.length);
    console.log("First 3 rows:", JSON.stringify(jsonData.slice(0, 3), null, 2));
    console.log("==================");

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Find the first non-empty row (header row)
    let headerRowIndex = 0;
    for (let i = 0; i < jsonData.length; i++) {
      if (jsonData[i] && jsonData[i].length > 0 && jsonData[i][0]) {
        headerRowIndex = i;
        break;
      }
    }

    // Clean and normalize headers
    const headers = jsonData[headerRowIndex].map((h) =>
      h?.toString().trim().replace(/\u00A0/g, " ").replace(/\s+/g, " ")
    );

    console.log("Headers found:", headers);

    // Find column indices for Total and Origin
    const totalIndex = headers.findIndex(h => 
      h.toLowerCase() === 'total'
    );
    const originIndex = headers.findIndex(h => 
      h.toLowerCase() === 'origin'
    );

    console.log("Total column index:", totalIndex);
    console.log("Origin column index:", originIndex);

    // Get month columns (between Vendor and Total, or all except Buyer/Vendor/Total/Origin)
    let monthColumns = [];
    if (totalIndex !== -1) {
      // Month columns are from index 2 (after Buyer and Vendor) up to Total
      monthColumns = headers.slice(2, totalIndex);
    } else {
      // Fallback: all columns except Buyer, Vendor, and Origin
      monthColumns = headers.slice(2).filter(h => 
        h.toLowerCase() !== 'origin' && h.toLowerCase() !== 'total'
      );
    }

    console.log("Month columns:", monthColumns);

    // Get data rows (skip header and filter empty rows)
    const rows = jsonData.slice(headerRowIndex + 1).filter(row => 
      row && row.length > 0 && (row[0] || row[1])
    );

    console.log("Number of data rows:", rows.length);

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No data rows found",
        details: "The Excel file contains headers but no data rows",
        headers: headers,
      });
    }

    // Helper to safely parse numbers
    const cleanNumber = (val) => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    // Parse data rows
    const parsedData = rows.map((row) => {
      const buyerRaw = row[0]?.toString().trim().toUpperCase() || "";
      const obj = {
        buyer: buyerRaw,
        vendor: row[1]?.toString().trim() || "",
        isTotalRow: buyerRaw.endsWith(" TOTAL"),
      };

      // Map month columns
      monthColumns.forEach((month) => {
        const monthIndex = headers.indexOf(month);
        obj[month] = cleanNumber(row[monthIndex]);
      });

      // Add Total column if it exists
      if (totalIndex !== -1) {
        obj.total = cleanNumber(row[totalIndex]);
      }

      // Add Origin column if it exists
      if (originIndex !== -1) {
        obj.origin = row[originIndex]?.toString().trim() || "";
      }

      return obj;
    });

    // FILTER DATA BY CUSTOMER'S ALLOWED BUYERS
    const filteredData = allowedBuyers.length > 0
      ? parsedData.filter(row => {
          const buyerName = row.buyer.replace(/ TOTAL$/, "").trim();
          return allowedBuyers.includes(buyerName);
        })
      : parsedData; // If no buyers specified, return all data

    console.log("Total parsed rows:", parsedData.length);
    console.log("Filtered data rows:", filteredData.length);

    if (filteredData.length === 0 && allowedBuyers.length > 0) {
      return res.json({
        success: true,
        data: {
          headers,
          rows: [],
          summary: {
            totalRows: 0,
            totalsByMonth: {},
            totalsByBuyer: {},
            totalsByVendor: {},
            totalsByOrigin: {},
            grandTotal: 0,
          },
          rowCount: 0,
          months: monthColumns,
          hasTotal: totalIndex !== -1,
          hasOrigin: originIndex !== -1,
        },
        message: "No data available for your assigned buyers",
        customerBuyers: allowedBuyers
      });
    }

    // Calculate summary statistics BASED ON FILTERED DATA
    const summary = {
      totalRows: filteredData.length,
      totalsByMonth: {},
      totalsByBuyer: {},
      totalsByVendor: {},
      totalsByOrigin: {},
      grandTotal: 0,
    };

    // Calculate totals by month
    monthColumns.forEach((month) => {
      summary.totalsByMonth[month] = filteredData.reduce(
        (sum, row) => sum + (row[month] || 0),
        0
      );
    });

    // Calculate totals by buyer
    filteredData.forEach((row) => {
      if (row.buyer) {
        if (!summary.totalsByBuyer[row.buyer]) {
          summary.totalsByBuyer[row.buyer] = 0;
        }
        // Use the Total column if available, otherwise sum months
        if (totalIndex !== -1 && row.total) {
          summary.totalsByBuyer[row.buyer] += row.total;
        } else {
          monthColumns.forEach((month) => {
            summary.totalsByBuyer[row.buyer] += row[month] || 0;
          });
        }
      }
    });

    // Calculate totals by vendor
    filteredData.forEach((row) => {
      if (row.vendor) {
        if (!summary.totalsByVendor[row.vendor]) {
          summary.totalsByVendor[row.vendor] = 0;
        }
        // Use the Total column if available, otherwise sum months
        if (totalIndex !== -1 && row.total) {
          summary.totalsByVendor[row.vendor] += row.total;
        } else {
          monthColumns.forEach((month) => {
            summary.totalsByVendor[row.vendor] += row[month] || 0;
          });
        }
      }
    });

    // Calculate totals by origin (if origin column exists)
    // Only use rows that are TOTAL rows (buyer totals) for origin aggregation
    let originData = [];
    let grandTotalValue = 0;
    
    if (originIndex !== -1 && totalIndex !== -1) {
      // Process only buyer TOTAL rows (not vendor detail rows, not grand total)
      // This will aggregate totals by origin for the filtered buyers only
      filteredData.forEach((row) => {
        if (row.isTotalRow && row.origin && row.total && 
            !(row.buyer.toUpperCase().includes('GRAND') && row.buyer.toUpperCase().includes('TOTAL'))) {
          
          if (!summary.totalsByOrigin[row.origin]) {
            summary.totalsByOrigin[row.origin] = 0;
          }
          summary.totalsByOrigin[row.origin] += row.total;
        }
      });
      
      // Calculate grand total from filtered buyer TOTAL rows (sum of all origins)
      grandTotalValue = Object.values(summary.totalsByOrigin).reduce(
        (sum, val) => sum + val,
        0
      );
      
      // Calculate percentages and prepare data for pie chart
      Object.entries(summary.totalsByOrigin).forEach(([origin, value]) => {
        const percentage = grandTotalValue > 0 ? (value / grandTotalValue) * 100 : 0;
        originData.push({
          origin: origin,
          value: value,
          percentage: percentage
        });
      });
      
      // Sort by value descending
      originData.sort((a, b) => b.value - a.value);
    }

    // Calculate grand total
    if (totalIndex !== -1) {
      // If Total column exists, sum all totals
      summary.grandTotal = filteredData.reduce(
        (sum, row) => sum + (row.total || 0),
        0
      );
    } else {
      // Otherwise sum all months
      summary.grandTotal = Object.values(summary.totalsByMonth).reduce(
        (sum, val) => sum + val,
        0
      );
    }

    res.json({
      success: true,
      data: {
        headers,
        rows: filteredData,
        summary,
        rowCount: filteredData.length,
        months: monthColumns,
        hasTotal: totalIndex !== -1,
        hasOrigin: originIndex !== -1,
        originData: originData, // Array of {origin, value, percentage}
        grandTotalValue: grandTotalValue, // For reference
      },
      customerBuyers: allowedBuyers, // Include for debugging/transparency
    });
  } catch (err) { 
    console.error("Error fetching/parsing Excel file:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

router.get("/customer/:customerId/buyer-volume-shipped", async (req, res) => {
  try {
    const { customerId } = req.params;

    if (!customerId) {
      return res.status(401).json({
        error: "Unauthorized",
        details: "Customer ID is required"
      });
    }

    // Fetch customer's buyer name from metafield
    const customerQuery = `
      query getCustomerBuyer($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "business_name") {
            value
          }
        }
      }
    `;

    const customerResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { 
        query: customerQuery, 
        variables: { customerId: `gid://shopify/Customer/${customerId}` }
      },
    });

    const buyerName = customerResponse.data?.data?.customer?.metafield?.value;
    
    if (!buyerName) {
      return res.status(404).json({
        error: "Buyer name not found",
        details: "Customer does not have a buyer_name metafield assigned"
      });
    }

    const normalizedBuyerName = buyerName.trim().toUpperCase();
    console.log("Customer ID:", customerId);
    console.log("Customer buyer name:", normalizedBuyerName);

    // Fetch shop metafield for Excel file
    const query = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "volumeshippedytd") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query },
    });

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No volumeshippedytd metafield found"
      });
    }

    let fileUrl;

    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;
      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl = fileResponse.data?.data?.node?.url || fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      fileUrl = metafieldData.value;
    }

    // Download and parse Excel file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Find header row
    let headerRowIndex = 0;
    for (let i = 0; i < jsonData.length; i++) {
      if (jsonData[i] && jsonData[i].length > 0 && jsonData[i][0]) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = jsonData[headerRowIndex].map((h) =>
      h?.toString().trim().replace(/\u00A0/g, " ").replace(/\s+/g, " ")
    );

    const rows = jsonData.slice(headerRowIndex + 1).filter(row => 
      row && row.length > 0 && (row[0] || row[1])
    );

    const cleanNumber = (val) => {
      if (val === null || val === undefined || val === "") return 0;
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    // Parse all data rows
    const parsedData = rows.map((row) => {
      const obj = {
        buyer: row[0]?.toString().trim().toUpperCase() || "",
        vendor: row[1]?.toString().trim() || "",
      };

      headers.slice(2).forEach((month, index) => {
        obj[month] = cleanNumber(row[index + 2]);
      });

      return obj;
    });

    // Filter by customer's buyer name
    const customerData = parsedData.filter(row => row.buyer === normalizedBuyerName);

    console.log("Total rows in file:", parsedData.length);
    console.log("Rows for this buyer:", customerData.length);

    if (customerData.length === 0) {
      return res.json({
        success: true,
        data: {
          buyerName: normalizedBuyerName,
          suppliers: [],
          volumeBySupplier: {},
          volumeByMonth: {},
          grandTotal: 0
        },
        message: "No volume data found for this buyer"
      });
    }

    // Get unique suppliers for this buyer
    const suppliers = [...new Set(customerData.map(row => row.vendor))].filter(v => v);

    // Calculate volume by supplier (aggregated across all months)
    const volumeBySupplier = {};
    const monthColumns = headers.slice(2);

    customerData.forEach((row) => {
      if (row.vendor) {
        if (!volumeBySupplier[row.vendor]) {
          volumeBySupplier[row.vendor] = {
            totalVolume: 0,
            byMonth: {}
          };
        }
        
        monthColumns.forEach((month) => {
          const value = row[month] || 0;
          volumeBySupplier[row.vendor].totalVolume += value;
          
          if (!volumeBySupplier[row.vendor].byMonth[month]) {
            volumeBySupplier[row.vendor].byMonth[month] = 0;
          }
          volumeBySupplier[row.vendor].byMonth[month] += value;
        });
      }
    });

    // Calculate total volume by month (across all suppliers)
    const volumeByMonth = {};
    monthColumns.forEach((month) => {
      volumeByMonth[month] = customerData.reduce(
        (sum, row) => sum + (row[month] || 0),
        0
      );
    });

    // Calculate grand total
    const grandTotal = Object.values(volumeByMonth).reduce((sum, val) => sum + val, 0);

    res.json({
      success: true,
      data: {
        buyerName: normalizedBuyerName,
        suppliers: suppliers.sort(),
        volumeBySupplier,
        volumeByMonth,
        monthColumns,
        grandTotal,
        rowCount: customerData.length
      }
    });

  } catch (err) { 
    console.error("Error fetching/parsing Excel file:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});


router.get("/customer/:customerId/recent-pos", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    console.log("📤 Fetching metafield for customer:", customerId);

    // 1. Fetch the metafield
    const query = `
      query getCustomerMetafield($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "recentpo") {
            id
            value
            type
          }
        }
      }
    `;

    const variables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
      data: { query, variables },
    });

    const metafieldData = shopifyResponse.data?.data?.customer?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Recent POs Excel file not found",
        details: `No 'recentpo' metafield found for customer ${customerId}`,
      });
    }

    console.log("✅ Metafield found, type:", metafieldData.type);

    let fileUrl;

    // 2. Resolve file URL
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;
      console.log("📤 Resolving file URL...");

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
        timeout: 10000,
      });

      fileUrl = fileResponse.data?.data?.node?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      fileUrl = metafieldData.value;
    }

    console.log("✅ File URL resolved, downloading...");

    // 3. Download Excel file with size limit
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024, // Limit to 10MB
    });

    console.log("📥 File downloaded:", fileResponse.data.length, "bytes");

    // 4. Parse Excel efficiently
    const XLSX = require("xlsx");
    
    // Use read options to reduce memory usage
    const workbook = XLSX.read(fileResponse.data, { 
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellHTML: false
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Get the range to avoid processing empty rows
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`📊 Sheet range: ${range.s.r} to ${range.e.r} rows`);

    // Convert to JSON with raw values only
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false // Get string values to reduce memory
    });

    console.log("📊 Parsed rows:", jsonData.length);

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean headers more thoroughly
    const headers = jsonData[0].map(h => {
      let cleaned = String(h || "")
        .trim()
        .replace(/\u00A0/g, " ")  // Non-breaking spaces
        .replace(/\s+/g, " ")      // Multiple spaces to single space
        .replace(/[\r\n\t]/g, ""); // Remove line breaks and tabs
      return cleaned;
    });

    console.log("📋 Cleaned Headers:", headers);

    // Define columns to keep
    const columnsToKeep = ["Purchase Order", "Supplier", "EWD", "AWD", "Due Date"];
    
    // Find indices with case-insensitive and flexible matching
    const columnIndices = columnsToKeep.map(col => {
      // Try exact match first
      let index = headers.indexOf(col);
      
      // If not found, try case-insensitive match
      if (index === -1) {
        index = headers.findIndex(h => 
          h.toLowerCase() === col.toLowerCase()
        );
      }
      
      // If still not found, try partial match (in case of extra characters)
      if (index === -1) {
        index = headers.findIndex(h => 
          h.toLowerCase().includes(col.toLowerCase())
        );
      }
      
      return {
        name: col,
        index: index,
        actualHeader: index !== -1 ? headers[index] : null
      };
    }).filter(col => col.index !== -1);

    console.log("✅ Column indices found:", columnIndices);

    // Log missing columns for debugging
    const missingColumns = columnsToKeep.filter(col => 
      !columnIndices.some(c => c.name === col)
    );
    if (missingColumns.length > 0) {
      console.log("⚠️ Missing columns:", missingColumns);
      console.log("Available headers:", headers);
    }

    // Also get indices for summary calculations
    const delayDaysIdx = headers.findIndex(h => h.toLowerCase().includes("delay"));
    const confirmedIdx = headers.findIndex(h => h.toLowerCase().includes("confirm"));
    const supplierIdx = headers.findIndex(h => h.toLowerCase() === "supplier");

    // Helper function
    const cleanNumber = (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const cleaned = val.replace(/[^0-9.\-]/g, "");
        return cleaned ? parseFloat(cleaned) : 0;
      }
      return 0;
    };

    // Process rows more efficiently - only keep required columns
    const rows = jsonData.slice(1);
    const parsedData = [];
    
    let totalDelay = 0;
    let delayedCount = 0;
    let onTimeCount = 0;
    let confirmedCount = 0;
    let maxDelay = 0;
    const supplierSet = new Set();

    // Single pass through data
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      
      // Only create object with required columns
      for (let col of columnIndices) {
        obj[col.name] = row[col.index] !== undefined ? row[col.index] : "";
      }
      
      parsedData.push(obj);
      
      // Calculate stats (still using all columns for accuracy)
      if (delayDaysIdx !== -1) {
        const delayDays = cleanNumber(row[delayDaysIdx]);
        if (delayDays > 0) {
          totalDelay += delayDays;
          delayedCount++;
          maxDelay = Math.max(maxDelay, delayDays);
        } else {
          onTimeCount++;
        }
      }
      
      if (confirmedIdx !== -1) {
        const confirmed = String(row[confirmedIdx] || "").toLowerCase();
        if (confirmed === "yes" || confirmed === "y") {
          confirmedCount++;
        }
      }
      
      if (supplierIdx !== -1) {
        const supplier = row[supplierIdx];
        if (supplier) {
          supplierSet.add(supplier);
        }
      }
    }

    const avgDelay = delayedCount > 0 ? (totalDelay / delayedCount) : 0;
    const totalPos = parsedData.length;

    const summary = {
      totalPurchaseOrders: totalPos,
      totalConfirmedPOs: confirmedCount,
      totalOnTimePOs: onTimeCount,
      totalDelayedPOs: delayedCount,
      onTimeRate: totalPos > 0 ? `${((onTimeCount / totalPos) * 100).toFixed(1)}%` : "N/A",
      avgDelayDays: avgDelay.toFixed(1),
      maxDelayDays: maxDelay,
      uniqueSuppliers: supplierSet.size,
      supplierList: Array.from(supplierSet),
    };

    console.log("✅ Processing complete");

    // Clear variables to help GC
    jsonData.length = 0;
    rows.length = 0;

    // Return only the column names that were found
    const returnedHeaders = columnIndices.map(col => col.name);

    res.json({
      success: true,
      data: {
        headers: returnedHeaders,
        rows: parsedData,
        summary,
        rowCount: parsedData.length,
      },
    });

    console.log("✅ Response sent");

  } catch (err) {
    console.error("💥 ERROR:", err.message);

    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: "Request timeout",
        details: "The file download or processing took too long",
      });
    }

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});
router.get("/customer/:customerId/buyer-recent-pos", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    console.log("📤 Fetching customer business name for:", customerId);

    // 1. Fetch the customer's business name metafield
    const customerQuery = `
      query getCustomerBusinessName($customerId: ID!) {
        customer(id: $customerId) {
          id
          metafield(namespace: "custom", key: "business_name") {
            value
          }
        }
      }
    `;

    const customerVariables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const customerResponse = await axios({
      method: "POST",
      url: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: customerQuery, variables: customerVariables },
    });

    const businessName = customerResponse.data?.data?.customer?.metafield?.value;

    if (!businessName) {
      return res.status(404).json({
        error: "Business name not found",
        details: `No 'businessname' metafield found for customer ${customerId}`,
      });
    }

    console.log("✅ Business name found:", businessName);

    // 2. Fetch the shop metafield containing the Excel file
    console.log("📤 Fetching shop metafield for recent POs...");

    const shopQuery = `
      query getShopMetafield {
        shop {
          metafield(namespace: "custom", key: "buyerrecentpo") {
            id
            value
            type
          }
        }
      }
    `;

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: shopQuery },
    });

    const metafieldData = shopifyResponse.data?.data?.shop?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Recent POs Excel file not found",
        details: "No 'recentpo' metafield found in shop metafields",
      });
    }

    console.log("✅ Shop metafield found, type:", metafieldData.type);

    let fileUrl;

    // 3. Resolve file URL
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;
      console.log("📤 Resolving file URL...");

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
        timeout: 10000,
      });

      fileUrl = fileResponse.data?.data?.node?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      fileUrl = metafieldData.value;
    }

    console.log("✅ File URL resolved, downloading...");

    // 4. Download Excel file with size limit
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024, // Limit to 10MB
    });

    console.log("📥 File downloaded:", fileResponse.data.length, "bytes");

    // 5. Parse Excel efficiently
    const XLSX = require("xlsx");
    
    const workbook = XLSX.read(fileResponse.data, { 
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellHTML: false
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`📊 Sheet range: ${range.s.r} to ${range.e.r} rows`);

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false
    });

    console.log("📊 Parsed rows:", jsonData.length);

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean headers
    const headers = jsonData[0].map(h => {
      let cleaned = String(h || "")
        .trim()
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .replace(/[\r\n\t]/g, "");
      return cleaned;
    });

    console.log("📋 Cleaned Headers:", headers);

    // Define columns to keep (updated based on new Excel structure)
    const columnsToKeep = ["Buyer", "Supplier", "PO No.", "Po Signed Date", "Ex factory Date"];
    
    // Find indices with flexible matching
    const columnIndices = columnsToKeep.map(col => {
      let index = headers.indexOf(col);
      
      if (index === -1) {
        index = headers.findIndex(h => 
          h.toLowerCase() === col.toLowerCase()
        );
      }
      
      if (index === -1) {
        index = headers.findIndex(h => 
          h.toLowerCase().includes(col.toLowerCase())
        );
      }
      
      return {
        name: col,
        index: index,
        actualHeader: index !== -1 ? headers[index] : null
      };
    }).filter(col => col.index !== -1);

    console.log("✅ Column indices found:", columnIndices);

    // Find Buyer column index for filtering
    const buyerIdx = headers.findIndex(h => 
      h.toLowerCase() === "buyer" || h.toLowerCase().includes("buyer")
    );

    if (buyerIdx === -1) {
      return res.status(500).json({
        error: "Invalid Excel structure",
        details: "Buyer column not found in Excel file",
      });
    }

    // Log missing columns for debugging
    const missingColumns = columnsToKeep.filter(col => 
      !columnIndices.some(c => c.name === col)
    );
    if (missingColumns.length > 0) {
      console.log("⚠️ Missing columns:", missingColumns);
      console.log("Available headers:", headers);
    }

    // Process rows and filter by business name
    const rows = jsonData.slice(1);
    const parsedData = [];
    
    let totalPos = 0;
    const supplierSet = new Set();

    // Single pass through data - filter and create objects
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const buyerValue = String(row[buyerIdx] || "").trim();
      
      // Only include rows where Buyer matches the customer's business name
      if (buyerValue.toLowerCase() === businessName.toLowerCase()) {
        const obj = {};
        
        // Only create object with required columns
        for (let col of columnIndices) {
          obj[col.name] = row[col.index] !== undefined ? row[col.index] : "";
        }
        
        parsedData.push(obj);
        totalPos++;
        
        // Track unique suppliers
        const supplierIdx = columnIndices.find(c => c.name === "Supplier")?.index;
        if (supplierIdx !== undefined) {
          const supplier = row[supplierIdx];
          if (supplier) {
            supplierSet.add(supplier);
          }
        }
      }
    }

    console.log(`✅ Filtered ${totalPos} POs for business: ${businessName}`);

    const summary = {
      businessName: businessName,
      totalPurchaseOrders: totalPos,
      uniqueSuppliers: supplierSet.size,
      supplierList: Array.from(supplierSet),
    };

    console.log("✅ Processing complete");

    // Clear variables to help GC
    jsonData.length = 0;
    rows.length = 0;

    // Return only the column names that were found
    const returnedHeaders = columnIndices.map(col => col.name);

    res.json({
      success: true,
      data: {
        headers: returnedHeaders,
        rows: parsedData,
        summary,
        rowCount: parsedData.length,
      },
    });

    console.log("✅ Response sent");

  } catch (err) {
    console.error("💥 ERROR:", err.message);

    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: "Request timeout",
        details: "The file download or processing took too long",
      });
    }

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});

router.get("/customer/:customerId/supplier-info", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: "Invalid customerId",
      details: "customerId is required",
    });
  }

  try {
    // Fetch customer metafield for the supplier info Excel file
    const customerMetafieldQuery = `
      query getCustomerMetafield($customerId: ID!) {
        customer(id: $customerId) {
          id
          email
          metafield(namespace: "custom", key: "supplier_info") {
            id
            value
            type
          }
        }
      }
    `;

    const customerVariables = {
      customerId: `gid://shopify/Customer/${customerId}`,
    };

    const shopifyResponse = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      data: { query: customerMetafieldQuery, variables: customerVariables },
    });

    const customerData = shopifyResponse.data?.data?.customer;
    const customerEmail = customerData?.email;

    if (!customerEmail) {
      return res.status(404).json({
        error: "Customer not found",
        details: `No customer found with ID ${customerId}`,
      });
    }

    const metafieldData = customerData?.metafield;

    if (!metafieldData) {
      return res.status(404).json({
        error: "Excel file not found",
        details: "No customer metafield found for supplier information",
      });
    }

    let fileUrl;

    // Case 1: metafield type is file_reference
    if (metafieldData.type === "file_reference") {
      const fileId = metafieldData.value;

      const fileQuery = `
        query getFileUrl($fileId: ID!) {
          node(id: $fileId) {
            ... on GenericFile {
              url
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      `;

      const fileResponse = await axios({
        method: "POST",
        url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        },
        data: { query: fileQuery, variables: { fileId } },
      });

      fileUrl =
        fileResponse.data?.data?.node?.url ||
        fileResponse.data?.data?.node?.image?.url;

      if (!fileUrl) {
        return res.status(404).json({
          error: "File URL not found",
          details: "Could not resolve file reference metafield",
        });
      }
    } else {
      // Case 2: direct URL stored as value
      fileUrl = metafieldData.value;
    }

    // Download the file
    const fileResponse = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "arraybuffer",
    });

    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileResponse.data, { type: "buffer" });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: false,
    });

    if (jsonData.length === 0) {
      return res.status(404).json({
        error: "Empty file",
        details: "The Excel file contains no data",
      });
    }

    // Clean and normalize headers
    const headers = jsonData[0].map(h =>
      h?.toString().trim().replace(/\u00A0/g, " ")
    );

    console.log("Supplier Info Headers found:", headers);

    const rows = jsonData.slice(1);

    const parsedData = rows.map((row) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] !== undefined ? row[index] : "";
      });
      return obj;
    });

    // Transform all rows to supplier format
    // If you want to filter by customer, uncomment the filter logic
    const suppliers = parsedData
      // .filter(row => row["Buyer Email"]?.toString().toLowerCase().trim() === customerEmail.toLowerCase().trim())
      .map((row, index) => ({
        id: index + 1,
        company: row["Supplier Name"] || row["Company"] || row["Supplier"] || "",
        contactPerson: row["Contact person"] || row["Contact"] || "",
        email: row["Email ID"] || row["Supplier Email"] || "",
      }))
      .filter(s => s.company); // Filter out empty entries

    if (suppliers.length === 0) {
      return res.status(404).json({
        error: "No suppliers found",
        details: `No supplier data found in the Excel file`,
      });
    }

    res.json({
      success: true,
      data: {
        suppliers,
        totalSuppliers: suppliers.length,
      },
    });
  } catch (err) {
    console.error("Error fetching/parsing supplier info:", err.message);
    console.error("Full error:", err);

    if (err.response?.status === 404) {
      return res.status(404).json({
        error: "File not found",
        details: "The Excel file URL is not accessible",
      });
    }

    return res.status(500).json({
      error: "Failed to fetch or parse Excel file",
      details: err.message || "An unexpected error occurred",
    });
  }
});
// Export the router to be used in server.js
module.exports = router;