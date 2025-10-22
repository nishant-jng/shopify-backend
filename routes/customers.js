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

router.post("/", async (req, res) => {
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

    // const headers = jsonData[0];
    const rows = jsonData.slice(1);

   // Clean and normalize headers
const headers = jsonData[0].map(h =>
  h?.toString().trim().replace(/\u00A0/g, " ")
);

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

const summary = {
  totalRows: parsedData.length,
  totalOpenPos: parsedData.reduce(
    (sum, row) => sum + cleanNumber(row["Open Pos"]),
    0
  ),
  totalOrders: parsedData.reduce(
    (sum, row) => sum + cleanNumber(row["Total orders"]),
    0
  ),
  totalOTIF: parsedData.reduce(
    (sum, row) => sum + cleanNumber(row["OTIF"]),
    0
  ),
  totalQualityClaimsLY: parsedData.reduce(
    (sum, row) => sum + cleanNumber(row["Quality Claims LY"]),
    0
  ),
  totalQualityClaims: parsedData.reduce(
    (sum, row) => sum + cleanNumber(row["Quality Claims"]),
    0
  ),
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
// Export the router to be used in server.js
module.exports = router;