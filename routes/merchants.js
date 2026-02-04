const express = require('express')
const router = express.Router()
const supabase = require('../supabaseClient')
const upload = require('../upload')
const { sendAlertEmail } = require('../service/emailService');
router.post('/upload-po', upload.single('poFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26' // Updated bucket name

  try {
    const { buyerName, poReceivedDate, quantity, value, poId } = req.body
    const { createdBy } = req.query
    const file = req.file

    console.log('QUERY:', req.query)
    console.log('BODY:', req.body)
    console.log('FILE:', req.file)

    if (!buyerName || !poReceivedDate || !file || !createdBy || !quantity || !value || !poId) {
      return res.status(400).json({
        error: 'Missing required fields',
      })
    }
    // ---- Date Helpers ----
    const dateObj = new Date(poReceivedDate)
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

    const monthFolder = months[dateObj.getMonth()] // e.g., "January"
    const dayFolder = String(dateObj.getDate()).padStart(2, '0') // e.g., "15"
    const year = dateObj.getFullYear()

    // 1. Date format for Database record
    const dbFormattedDate = `${monthFolder}-${dayFolder}-${year}`

    // ---- Upload file to Supabase Storage (POFY26) ----

    // Sanitize names to prevent path issues
    const safeBuyer = buyerName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() 
    const safeName = file.originalname.replace(/\s+/g, '_')

    // ✅ New Path: Buyer Name / Month / Day / po_timestamp_filename
    filePath = `${safeBuyer}/${monthFolder}/${dayFolder}/${poId}/po_${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) throw uploadError
    // ---- Insert PO into DB ----
    const { data: poRows, error: insertError } = await supabase
      .from('purchase_orders')
      .insert([{
        buyer_name: buyerName,
        po_received_date: dbFormattedDate, 
        created_by: createdBy,
        po_file_url: filePath,
        quantity_ordered: quantity,
        amount: value,
        po_number: poId
      }])
      .select()

    if (insertError) throw insertError

    const po = poRows[0]

    // ---- Handle Alerts (Shopify Admin) ----
    const shopifyAdminCustomers = await getShopifyAdminCustomers()

    if (shopifyAdminCustomers.length > 0) {
      const alertMessage = `PO received for ${buyerName} by ${createdBy} on ${dbFormattedDate}`
      const alertInserts = shopifyAdminCustomers.map(customer => ({
        message: alertMessage,
        po_id: po.id,
        recipient_user_id: customer.id.toString(),
        recipient_name: customer.name || `${customer.first_name} ${customer.last_name}`,
        is_read: false
      }))

      const { error: alertError } = await supabase
        .from('alerts')
        .insert(alertInserts)

      if (alertError) {
        console.error('Error creating alerts:', alertError)
      } else {
        console.log(`✅ Created ${alertInserts.length} alerts for admins`)

        sendAlertEmail(
      shopifyAdminCustomers,
      alertMessage,
      {
        buyer_name: buyerName,
        po_number: poId,
        quantity_ordered: quantity,
        amount: value,
        date: dbFormattedDate
      }
      ).catch(err => console.error('Email failed:', err));
      }
    }

    // ---- Success ----
    return res.json({
      success: true,
      poId: po.id,
      message: 'PO uploaded and alerts created',
      alertsSent: shopifyAdminCustomers.length
    })

  } catch (err) {
    console.error('PO Upload Error:', err)

    // ---- Rollback file if DB failed ----
    if (filePath) {
      // ✅ Ensure rollback deletes from the correct bucket
      await supabase.storage.from(BUCKET_NAME).remove([filePath])
    }

    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})


router.post('/upload-buyer-po', upload.single('poFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26'

  try {
    const {
      buyerName,      // buyer_org_id
      supplierName,   // supplier_org_id
      poReceivedDate,
      quantity,
      value,
      poId
    } = req.body

    const { createdBy } = req.query
    const file = req.file

    /* =========================
       BASIC VALIDATION
    ========================= */

    if (
      !buyerName ||
      !supplierName ||
      !poReceivedDate ||
      !file ||
      !createdBy ||
      !quantity ||
      !value ||
      !poId
    ) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const quantityNum = Number(quantity)
    const valueNum = Number(value)

    if (Number.isNaN(quantityNum) || Number.isNaN(valueNum)) {
      return res.status(400).json({ error: 'Invalid quantity or value' })
    }


    /* =========================
       RESOLVE BUYER–SUPPLIER LINK
    ========================= */

    const { data: link, error: linkError } = await supabase
      .from('buyer_supplier_links')
      .select('id')
      .eq('buyer_org_id', buyerName)
      .eq('supplier_org_id', supplierName)
      .eq('relationship_status', 'active')
      .maybeSingle()

    if (linkError || !link) {
      return res.status(400).json({
        error: 'Invalid buyer–supplier relationship',
      })
    }

    const buyerSupplierLinkId = link.id

    /* =========================
       DATE HELPERS
    ========================= */

    const dateObj = new Date(poReceivedDate)
    const months = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ]

    const monthFolder = months[dateObj.getMonth()]
    const dayFolder = String(dateObj.getDate()).padStart(2, '0')
    const year = dateObj.getFullYear()

    const dbFormattedDate = `${monthFolder}-${dayFolder}-${year}`

    /* =========================
       RESOLVE BUYER NAME (FOR PATH)
    ========================= */

    const { data: buyerOrg } = await supabase
      .from('organizations')
      .select('display_name')
      .eq('id', buyerName)
      .maybeSingle()

    const buyerDisplayName = buyerOrg?.display_name || 'UnknownBuyer'
    const safeBuyer = buyerDisplayName.replace(/[^a-zA-Z0-9 _-]/g, '').trim()

    /* =========================
       UPLOAD FILE
    ========================= */

    const safeFileName = file.originalname.replace(/\s+/g, '_')

    filePath =
      `${safeBuyer}/${monthFolder}/${dayFolder}/${poId}/` +
      `po_${Date.now()}_${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) throw uploadError

    /* =========================
       INSERT PURCHASE ORDER
    ========================= */

    const { data: poRows, error: insertError } = await supabase
      .from('purchase_orders')
      .insert([{
        buyer_supplier_link_id: buyerSupplierLinkId,
        po_received_date: dbFormattedDate,
        created_by: createdBy,
        po_file_url: filePath,
        quantity_ordered: quantity,
        amount: value,
        po_number: poId
      }])
      .select()

    if (insertError) throw insertError
    const po = poRows[0]

    /* =========================
       RESOLVE BUYER + SUPPLIER NAMES (FOR ALERT)
    ========================= */

    const { data: orgNames } = await supabase
      .from('buyer_supplier_links')
      .select(`
        buyer:organizations!buyer_supplier_links_buyer_org_id_fkey (
          display_name
        ),
        supplier:organizations!buyer_supplier_links_supplier_org_id_fkey (
          display_name
        )
      `)
      .eq('id', buyerSupplierLinkId)
      .maybeSingle()

    const buyerNameText =
      orgNames?.buyer?.display_name || 'Unknown Buyer'
    const supplierNameText =
      orgNames?.supplier?.display_name || 'Unknown Supplier'

    /* =========================
       CREATE SNAPSHOT
       (Moved here so names are defined)
    ========================= */
    
    const poSnapshot = {
      po_id: po.id,
      po_number: po.po_number,
      buyer_name: buyerNameText,    // Now defined!
      supplier_name: supplierNameText, // Now defined!
      po_received_date: po.po_received_date,
      quantity_ordered: po.quantity_ordered,
      amount: po.amount,
      currency: po.currency || 'USD',
      pi_confirmed: false,
      pi_received_date: null,
      po_file_url: po.po_file_url,
      pi_file_url: null
    }

    /* =========================
       FETCH MERCHANT MEMBERS
       WHO HAVE ACCESS TO THIS BUYER
    ========================= */

    // 1. Get merchant org
    const { data: merchantOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('type', 'merchant')
      .maybeSingle()

    if (!merchantOrg) {
      throw new Error('Merchant organization not found')
    }

    // 2. Get members with access to buyer org
    const { data: accessRows, error: accessError } = await supabase
      .from('member_organization_access')
      .select(`
        organization_members (
          id,
          full_name,
          email,
          organization_id
        )
      `)
      .eq('organization_id', buyerName)

    if (accessError) throw accessError

    // 3. Filter to merchant members only
    const eligibleMembers = accessRows
      .map(r => r.organization_members)
      .filter(m => m.organization_id === merchantOrg.id)

    /* =========================
       CREATE ALERTS (BUYER-SCOPED)
    ========================= */

    if (eligibleMembers.length > 0) {
      const alertMessage =
        `PO received for ${buyerNameText} → ${supplierNameText} ` +
        `by ${createdBy} on ${dbFormattedDate}`

      const alertInserts = eligibleMembers.map(member => ({
        message: alertMessage,
        po_id: po.id,
        po_snapshot: poSnapshot,
        recipient_user_id: member.id,   // organization_members.id
        recipient_name: member.full_name,
        is_read: false
      }))

      const { error: alertError } = await supabase
        .from('alerts')
        .insert(alertInserts)

      if (alertError) {
        console.error('Alert creation failed:', alertError)
      } else {
        console.log(`✅ Created ${alertInserts.length} buyer-scoped alerts`)
      }

      // Optional email notification
      sendAlertEmail(
        eligibleMembers.map(m => ({
          email: m.email,
          name: m.full_name
        })),
        alertMessage,
        {
          buyer_name: buyerNameText,
          supplier_name: supplierNameText,
          po_number: poId,
          quantity_ordered: quantity,
          amount: value,
          date: dbFormattedDate
        }
      ).catch(err => console.error('Email failed:', err))
    }

    /* =========================
       SUCCESS
    ========================= */

    return res.json({
      success: true,
      poId: po.id,
      message: 'PO uploaded successfully',
    })

  } catch (err) {
    console.error('PO Upload Error:', err)

    /* =========================
       ROLLBACK FILE IF NEEDED
    ========================= */

    if (filePath) {
      await supabase.storage.from(BUCKET_NAME).remove([filePath])
    }

    return res.status(500).json({
      error: err.message || 'Upload failed',
    })
  }
})

router.post('/upload-buyer-pi/:poId', upload.single('piFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26'

  try {
    const databasePoId = req.params.poId
    const { poNumber, piReceivedDate } = req.body
    const { createdBy } = req.query
    const file = req.file

    if (!databasePoId || !piReceivedDate || !file) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    /* =========================
       FETCH PO
    ========================= */

    const { data: poData } = await supabase
      .from('purchase_orders')
      .select('po_file_url, po_number, buyer_supplier_link_id')
      .eq('id', databasePoId)
      .maybeSingle()

    if (!poData) {
      return res.status(404).json({ error: 'Purchase Order not found' })
    }

    /* =========================
       RESOLVE BUYER + SUPPLIER
    ========================= */

    const { data: link } = await supabase
      .from('buyer_supplier_links')
      .select(`
        buyer_org_id,
        buyer:organizations!buyer_supplier_links_buyer_org_id_fkey (display_name),
        supplier:organizations!buyer_supplier_links_supplier_org_id_fkey (display_name)
      `)
      .eq('id', poData.buyer_supplier_link_id)
      .maybeSingle()

    if (!link) throw new Error('Buyer–Supplier link not found')

    const buyerOrgId = link.buyer_org_id
    const buyerNameText = link.buyer.display_name
    const supplierNameText = link.supplier.display_name

    /* =========================
       REUSE DIRECTORY
    ========================= */

    const parts = poData.po_file_url.split('/')
    const bucketIndex = parts.indexOf(BUCKET_NAME)
    const directoryPath = parts.slice(bucketIndex + 1, -1).join('/')

    /* =========================
       UPLOAD PI FILE
    ========================= */

    const safeName = file.originalname.replace(/\s+/g, '_')
    filePath = `${directoryPath}/pi_${Date.now()}_${safeName}`

    await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    /* =========================
       FORMAT DATE
    ========================= */

    const d = new Date(piReceivedDate)
    const months = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ]
    const dbFormattedDate =
      `${months[d.getMonth()]}-${String(d.getDate()).padStart(2,'0')}-${d.getFullYear()}`

    /* =========================
       UPDATE PO
    ========================= */

    await supabase
      .from('purchase_orders')
      .update({
        pi_received_date: dbFormattedDate,
        pi_file_url: filePath,
        pi_confirmed: true,
        ...(poNumber && poNumber !== 'N/A' ? { po_number: poNumber } : {})
      })
      .eq('id', databasePoId)

    const finalPoNumber = poNumber && poNumber !== 'N/A'
      ? poNumber
      : poData.po_number

    /* =========================
       FETCH MERCHANT MEMBERS
    ========================= */

    const { data: merchantOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('type', 'merchant')
      .maybeSingle()

    const { data: accessRows } = await supabase
      .from('member_organization_access')
      .select(`
        organization_members (
          id,
          full_name,
          email,
          organization_id
        )
      `)
      .eq('organization_id', buyerOrgId)

    const eligibleMembers = accessRows
      .map(r => r.organization_members)
      .filter(m => m.organization_id === merchantOrg.id)

    /* =========================
       CREATE ALERTS + SNAPSHOT
    ========================= */

    const poSnapshot = {
      po_id: databasePoId,
      po_number: finalPoNumber,
      buyer_name: buyerNameText,
      supplier_name: supplierNameText,
      po_received_date: null,
      quantity_ordered: null,
      amount: null,
      pi_confirmed: true,
      pi_received_date: dbFormattedDate,
      po_file_url: poData.po_file_url,
      pi_file_url: filePath
    }

    if (eligibleMembers.length > 0) {
      const alertMessage =
        `PI uploaded for ${buyerNameText} → ${supplierNameText} (PO#${finalPoNumber})`

      const alerts = eligibleMembers.map(m => ({
        message: alertMessage,
        po_id: databasePoId,
        po_snapshot: poSnapshot,
        recipient_user_id: m.id,
        recipient_name: m.full_name,
        is_read: false
      }))

      await supabase.from('alerts').insert(alerts)
    }

    /* =========================
       SUCCESS
    ========================= */

    return res.json({
      success: true,
      poId: databasePoId,
      poNumber: finalPoNumber,
      message: 'PI uploaded successfully',
    })

  } catch (err) {
    console.error('PI Upload Error:', err)

    if (filePath) {
      await supabase.storage.from(BUCKET_NAME).remove([filePath])
    }

    return res.status(500).json({
      error: err.message || 'PI upload failed',
    })
  }
})





router.post('/upload-pi/:poId', upload.single('piFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26'

  try {
    const databasePoId = req.params.poId
    const { poNumber, piReceivedDate } = req.body  // ✅ Changed from 'poId' to 'poNumber'
    const file = req.file

    console.log('DATABASE PO ID:', databasePoId)
    console.log('PO NUMBER:', poNumber)  // ✅ Updated log
    console.log('BODY:', req.body)
    console.log('FILE:', req.file)

    // ✅ Validation: poNumber is optional (backward compatibility)
    if (!databasePoId || !piReceivedDate || !file) {
      return res.status(400).json({
        error: 'Missing required fields: piReceivedDate or piFile',
      })
    }

    // ---- Fetch existing PO to get directory path and current po_number ----
    const { data: poData, error: fetchError } = await supabase
      .from('purchase_orders')
      .select('po_file_url, buyer_name, created_by, po_number')  // ✅ Also select po_number
      .eq('id', databasePoId)
      .single()

    if (fetchError || !poData) {
      return res.status(404).json({ error: 'Purchase Order not found' })
    }

    // ✅ Use provided poNumber if available, otherwise keep existing po_number
    const finalPoNumber = poNumber && poNumber !== 'N/A' ? poNumber : poData.po_number
    
    const urlParts = poData.po_file_url.split('/')
    const bucketIndex = urlParts.indexOf(BUCKET_NAME)
    
    if (bucketIndex === -1) {
      throw new Error('Could not parse PO file path from URL')
    }

    // Extract path segments after bucket name until the filename
    const pathSegments = urlParts.slice(bucketIndex + 1, -1)
    const directoryPath = pathSegments.join('/')

    // ---- Upload PI file to the same directory ----
    const safeName = file.originalname.replace(/\s+/g, '_')
    filePath = `${directoryPath}/pi_${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) throw uploadError


    // ---- Format PI received date ----
    const dateObj = new Date(piReceivedDate)
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const monthFolder = months[dateObj.getMonth()]
    const dayFolder = String(dateObj.getDate()).padStart(2, '0')
    const year = dateObj.getFullYear()
    const dbFormattedDate = `${monthFolder}-${dayFolder}-${year}`

    // ---- Update PO record with PI details ----
    // ✅ Build update object conditionally
    const updateData = {
      pi_received_date: dbFormattedDate,
      pi_file_url: filePath,
      pi_confirmed: true
    }

    // ✅ Only update po_number if a new one was provided
    if (poNumber && poNumber !== 'N/A') {
      updateData.po_number = poNumber
    }

    const { data: updatedPO, error: updateError } = await supabase
      .from('purchase_orders')
      .update(updateData)
      .eq('id', databasePoId)
      .select()

    if (updateError) throw updateError

    // ---- ✅ CREATE ALERTS FOR PI UPLOAD ----
    const shopifyAdminCustomers = await getShopifyAdminCustomers()

    if (shopifyAdminCustomers.length > 0) {
      const alertMessage = `PI uploaded for ${poData.buyer_name} (PO#${finalPoNumber}) by ${poData.created_by} on ${dbFormattedDate}`
      
      const alertInserts = shopifyAdminCustomers.map(customer => ({
        message: alertMessage,
        po_id: databasePoId,
        recipient_user_id: customer.id.toString(),
        recipient_name: customer.name || `${customer.first_name} ${customer.last_name}`,
        is_read: false
      }))

      const { error: alertError } = await supabase
        .from('alerts')
        .insert(alertInserts)

      if (alertError) {
        console.error('Error creating PI alerts:', alertError)
      } else {
        console.log(`✅ Created ${alertInserts.length} PI alerts for admins`)

        sendAlertEmail(
      shopifyAdminCustomers,
      alertMessage,
      {
        buyer_name: buyerName,
        po_number: poId,
        quantity_ordered: quantity,
        amount: value,
        date: dbFormattedDate
      }
      ).catch(err => console.error('Email failed:', err));
      }
    }

    // ---- Success ----
    return res.json({
      success: true,
      poId: databasePoId,
      message: 'PI uploaded, PO updated, and alerts created',
      piFileUrl: piFileUrl,
      poNumber: finalPoNumber,  // ✅ Return the PO number used
      alertsSent: shopifyAdminCustomers.length
    })

  } catch (err) {
    console.error('PI Upload Error:', err)

    // ---- Rollback file if DB update failed ----
    if (filePath) {
      await supabase.storage.from(BUCKET_NAME).remove([filePath])
    }

    res.status(500).json({ error: err.message || 'PI upload failed' })
  }
})


async function getShopifyAdminCustomers() {
  try {
    // Using Shopify Admin API (GraphQL)
    const query = `
      query {
        customers(first: 250, query: "metafields.custom.isadmin:true") {
          edges {
            node {
              id
              email
              firstName
              lastName
              metafield(namespace: "custom", key: "isadmin") {
                value
              }
            }
          }
        }
      }
    `

    const response = await fetch(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN
        },
        body: JSON.stringify({ query })
      }
    )

    const result = await response.json()

    if (result.errors) {
      console.error('Shopify GraphQL errors:', result.errors)
      return []
    }

    // Filter and format admin customers
    const adminCustomers = result.data.customers.edges
      .filter(edge => edge.node.metafield?.value === 'true')
      .map(edge => ({
        id: edge.node.id.split('/').pop(), // Extract numeric ID from gid://shopify/Customer/123456
        email: edge.node.email,
        name: `${edge.node.firstName} ${edge.node.lastName}`.trim(),
        first_name: edge.node.firstName,
        last_name: edge.node.lastName
      }))

    console.log(`Found ${adminCustomers.length} admin customers`)
    return adminCustomers

  } catch (error) {
    console.error('Error fetching admin customers:', error)
    return []
  }
}


// Get alerts for a user
router.get('/alerts', async (req, res) => {
  try {
    const { userId } = req.query

    if (!userId) {
      return res.status(400).json({ error: 'userId required' })
    }

    const { data: alerts, error } = await supabase
      .from('alerts')
      .select(`
        *,
        purchase_orders (
          buyer_name,
          po_received_date,
          po_file_url,
          quantity_ordered,
          amount,
          pi_received_date,
          pi_file_url,
          po_number,
          pi_confirmed,
          created_by
        )
      `)
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return res.json({
      success: true,
      alerts: alerts || []
    })

  } catch (err) {
    console.error('Error fetching alerts:', err)
    res.status(500).json({ error: 'Failed to fetch alerts' })
  }
})

router.get('/my-alerts', async (req, res) => {
  try {
    const { shopifyCustomerId } = req.query

    if (!shopifyCustomerId) {
      return res.status(400).json({
        error: 'shopifyCustomerId required'
      })
    }

    /* =========================
       RESOLVE MEMBER (IF EXISTS)
    ========================= */

    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('shopify_customer_id', shopifyCustomerId)
      .maybeSingle()

    const recipientIds = [shopifyCustomerId]

    // If mapped, include new-style alerts
    if (member?.id) {
      recipientIds.push(member.id)
    }

    /* =========================
       FETCH ALERTS (OLD + NEW)
    ========================= */

    const { data: alerts, error } = await supabase
      .from('alerts')
      .select(`
        id,
        message,
        is_read,
        created_at,
        purchase_orders (
          po_received_date,
          po_file_url,
          quantity_ordered,
          amount,
          pi_received_date,
          pi_file_url,
          po_number,
          pi_confirmed,
          created_by
        )
      `)
      .in('recipient_user_id', recipientIds)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return res.json({
      success: true,
      alerts: alerts || []
    })

  } catch (err) {
    console.error('Error fetching alerts:', err)
    res.status(500).json({
      error: 'Failed to fetch alerts'
    })
  }
})


router.get('/my-pos', async (req, res) => {
  try {
    const { createdBy } = req.query;

    console.log('Fetching POs for:', createdBy);

    if (!createdBy) {
      return res.status(400).json({
        error: 'Missing createdBy parameter'
      });
    }

    // Fetch POs created by this customer
    const { data: pos, error } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('created_by', createdBy)
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`✅ Found ${pos.length} POs for ${createdBy}`);

    return res.json({
      success: true,
      pos: pos,
      count: pos.length
    });

  } catch (err) {
    console.error('Fetch POs Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch POs' });
  }
});

router.get('/my-buyer-pos', async (req, res) => {
  try {
    const { shopifyCustomerId } = req.query
    if (!shopifyCustomerId) {
      return res.status(400).json({ error: 'shopifyCustomerId required' })
    }

    /* =========================
       RESOLVE MEMBER + ACCESS
    ========================= */

    const { data: member, error: memberError } = await supabase
      .from('organization_members')
      .select(`
        id,
        member_organization_access ( organization_id )
      `)
      .eq('shopify_customer_id', shopifyCustomerId)
      .maybeSingle()

    if (memberError) throw memberError

    if (!member || !member.member_organization_access?.length) {
      return res.json({ success: true, pos: [], count: 0 })
    }

    const buyerOrgIds = member.member_organization_access.map(
      a => a.organization_id
    )

    /* =========================
       FETCH BUYER ORG NAMES
       (needed for legacy POs)
    ========================= */

    const { data: buyerOrgs } = await supabase
      .from('organizations')
      .select('id, display_name')
      .in('id', buyerOrgIds)

    const buyerNameMap = new Map(
      buyerOrgs.map(o => [o.id, o.display_name])
    )

    const buyerNames = buyerOrgs.map(o => o.display_name)

    /* =========================
       NEW POs (RELATIONSHIP BASED)
    ========================= */

    const { data: newPOs, error: newPoError } = await supabase
      .from('purchase_orders')
      .select(`
        *,
        buyer_supplier_links!inner (
          buyer_org_id,
          buyer:organizations!buyer_supplier_links_buyer_org_id_fkey (
            display_name
          ),
          supplier:organizations!buyer_supplier_links_supplier_org_id_fkey (
            display_name
          )
        )
      `)
      .in('buyer_supplier_links.buyer_org_id', buyerOrgIds)
      .order('created_at', { ascending: false })

    if (newPoError) throw newPoError

    /* =========================
       LEGACY POs (STRING BASED)
    ========================= */

    const { data: legacyPOs, error: legacyError } = await supabase
      .from('purchase_orders')
      .select('*')
      .is('buyer_supplier_link_id', null)
      .in('buyer_name', buyerNames)
      .order('created_at', { ascending: false })

    if (legacyError) throw legacyError

    /* =========================
       NORMALIZE RESPONSE
    ========================= */

    const normalizedNew = newPOs.map(po => ({
      ...po,
      buyer_name: po.buyer_supplier_links?.buyer?.display_name || null,
      supplier_name: po.buyer_supplier_links?.supplier?.display_name || null,
      _source: 'relational'
    }))

    const normalizedLegacy = legacyPOs.map(po => ({
      ...po,
      buyer_name: po.buyer_name,
      supplier_name: null,
      _source: 'legacy'
    }))

    const allPOs = [...normalizedNew, ...normalizedLegacy]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    /* =========================
       RESPONSE
    ========================= */

    return res.json({
      success: true,
      pos: allPOs,
      count: allPOs.length
    })

  } catch (err) {
    console.error('❌ Fetch buyer POs failed:', err)
    res.status(500).json({
      error: err.message || 'Server Error'
    })
  }
})








// Mark single alert as read
router.post('/alerts/:alertId/read', async (req, res) => {
  try {
    const { alertId } = req.params

    const { error } = await supabase
      .from('alerts')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('id', alertId)

    if (error) throw error

    return res.json({ success: true })

  } catch (err) {
    console.error('Error marking alert as read:', err)
    res.status(500).json({ error: 'Failed to mark alert as read' })
  }
})

router.post('/alerts-all-read', async (req, res) => {
  try {
    const { shopifyCustomerId } = req.query

    if (!shopifyCustomerId) {
      return res.status(400).json({
        error: 'shopifyCustomerId required'
      })
    }

    /* =========================
       RESOLVE MEMBER (IF EXISTS)
    ========================= */

    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('shopify_customer_id', shopifyCustomerId)
      .maybeSingle()

    const recipientIds = [shopifyCustomerId]

    // Include new-style alerts if mapped
    if (member?.id) {
      recipientIds.push(member.id)
    }

    /* =========================
       MARK ALERTS AS READ
    ========================= */

    const { error } = await supabase
      .from('alerts')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      })
      .in('recipient_user_id', recipientIds)
      .eq('is_read', false)

    if (error) throw error

    return res.json({
      success: true
    })

  } catch (err) {
    console.error('Error marking alerts as read:', err)
    res.status(500).json({
      error: 'Failed to mark alerts as read'
    })
  }
})


// Mark all alerts as read
router.post('/alerts/mark-all-read', async (req, res) => {
  try {
    const { userId } = req.query

    if (!userId) {
      return res.status(400).json({ error: 'userId required' })
    }

    const { error } = await supabase
      .from('alerts')
      .update({ 
        is_read: true, 
        read_at: new Date().toISOString() 
      })
      .eq('recipient_user_id', userId)
      .eq('is_read', false)

    if (error) throw error

    return res.json({ success: true })

  } catch (err) {
    console.error('Error marking all alerts as read:', err)
    res.status(500).json({ error: 'Failed to mark alerts as read' })
  }
})


// GET /api/buyers/:buyerOrgId/suppliers
router.get("/buyers/:buyerOrgId/suppliers", async (req, res) => {
  const { buyerOrgId } = req.params;

  const { data, error } = await supabase
    .from("buyer_supplier_links")
    .select(`
      organizations!buyer_supplier_links_supplier_org_id_fkey (
        id,
        display_name
      )
    `)
    .eq("buyer_org_id", buyerOrgId)
    .eq("relationship_status", "active");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const suppliers = data.map(
    (row) => row.organizations
  );

  res.json(suppliers);
});



// GET /api/merchant/:memberId/buyers
// GET /api/buyers?email=
router.get("/buyers", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  // 1. Find member by email
  const { data: member, error: memberError } = await supabase
    .from("organization_members")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (memberError || !member) {
    return res.status(403).json({ error: "Invalid member" });
  }

  // 2. Fetch buyers this member can access
  const { data, error } = await supabase
    .from("member_organization_access")
    .select(`
      organizations (
        id,
        display_name,
        type
      )
    `)
    .eq("member_id", member.id)
    .eq("organizations.type", "buyer");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const buyers = data.map(row => row.organizations);

  res.json(buyers);
});


module.exports = router
