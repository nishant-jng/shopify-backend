const express = require('express')
const router = express.Router()
const supabase = require('../supabaseClient')
const upload = require('../upload')

router.post('/upload-po', upload.single('poFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26' // Updated bucket name

  try {
    const { buyerName, poReceivedDate, quantity, value } = req.body
    const { createdBy } = req.query
    const file = req.file

    console.log('QUERY:', req.query)
    console.log('BODY:', req.body)
    console.log('FILE:', req.file)

    if (!buyerName || !poReceivedDate || !file || !createdBy || !quantity || !value) {
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
    filePath = `${safeBuyer}/${monthFolder}/${dayFolder}/po_${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      })

    if (uploadError) throw uploadError

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME) // ✅ Changed to POFY26
      .getPublicUrl(filePath)

    const poFileUrl = publicUrlData.publicUrl

    // ---- Insert PO into DB ----
    const { data: poRows, error: insertError } = await supabase
      .from('purchase_orders')
      .insert([{
        buyer_name: buyerName,
        po_received_date: dbFormattedDate, 
        created_by: createdBy,
        po_file_url: poFileUrl,
        quantity_ordered: quantity,
        amount: value
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


router.post('/upload-pi/:poId', upload.single('piFile'), async (req, res) => {
  let filePath = null
  const BUCKET_NAME = 'POFY26'

  try {
    const databasePoId = req.params.poId  // Get from URL parameter
    const { poId: userPoNumber, piReceivedDate } = req.body  // poId from form is actually the PO number
    const file = req.file

    console.log('DATABASE PO ID:', databasePoId)
    console.log('USER PO NUMBER:', userPoNumber)
    console.log('BODY:', req.body)
    console.log('FILE:', req.file)

    if (!databasePoId || !userPoNumber || !piReceivedDate || !file) {
      return res.status(400).json({
        error: 'Missing required fields: poId, piReceivedDate, or piFile',
      })
    }

    // ---- Fetch existing PO to get the directory path ----
    const { data: poData, error: fetchError } = await supabase
      .from('purchase_orders')
      .select('po_file_url, buyer_name')
      .eq('id', databasePoId)  // Use database ID from URL
      .single()

    if (fetchError || !poData) {
      return res.status(404).json({ error: 'Purchase Order not found' })
    }    
    const urlParts = poData.po_file_url.split('/')
    const bucketIndex = urlParts.indexOf(BUCKET_NAME)
    
    if (bucketIndex === -1) {
      throw new Error('Could not parse PO file path from URL')
    }

    // Extract path segments after bucket name until the filename
    const pathSegments = urlParts.slice(bucketIndex + 1, -1) // Exclude filename
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

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath)

    const piFileUrl = publicUrlData.publicUrl

    // ---- Format PI received date ----
    const dateObj = new Date(piReceivedDate)
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const monthFolder = months[dateObj.getMonth()]
    const dayFolder = String(dateObj.getDate()).padStart(2, '0')
    const year = dateObj.getFullYear()
    const dbFormattedDate = `${monthFolder}-${dayFolder}-${year}`

    // ---- Update PO record with PI details ----
    const { data: updatedPO, error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        pi_received_date: dbFormattedDate,
        pi_file_url: piFileUrl,
        po_number: userPoNumber,  // Use the user-entered PO number
        pi_confirmed: true
      })
      .eq('id', databasePoId)  // Use database ID from URL
      .select()

    if (updateError) throw updateError

    // ---- Success ----
    return res.json({
      success: true,
      poId: databasePoId,
      message: 'PI uploaded and PO updated successfully',
      piFileUrl: piFileUrl
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
          created_by
        )
      `)
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

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

module.exports = router
