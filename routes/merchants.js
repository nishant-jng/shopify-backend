const express = require('express')
const router = express.Router()
const supabase = require('../supabaseClient')
const upload = require('../upload')

router.post('/upload-po',upload.single('poFile'), async (req, res) => {
  let filePath = null

  try {
    const { buyerName, poReceivedDate } = req.body
    const { createdBy} = req.query
    const file = req.file

    console.log('QUERY:', req.query)
  console.log('BODY:', req.body)
  console.log('FILE:', req.file)


    if (!buyerName || !poReceivedDate || !file || !createdBy) {
      return res.status(400).json({
        error: 'Missing required fields',
      })
    }

   // ---- 1. Upload file to Supabase Storage ----
        const safeBuyer = buyerName.replace(/[^a-zA-Z0-9_-]/g, '_')
        const safeName = file.originalname.replace(/\s+/g, '_')

        filePath = `${safeBuyer}/po_${Date.now()}_${safeName}`

        const { error: uploadError } = await supabase.storage
        .from('documents') // ✅ your existing bucket
        .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
        })

        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(filePath)

        const poFileUrl = publicUrlData.publicUrl


    // ---- 2. Insert PO into DB ----
    const { data: poRows, error: insertError } = await supabase
      .from('purchase_orders')
      .insert([{
        buyer_name: buyerName,
        po_received_date: poReceivedDate,
        created_by: createdBy,
        po_file_url: poFileUrl,
      }])
      .select()

    if (insertError) throw insertError

    const po = poRows[0]

    const shopifyAdminCustomers = await getShopifyAdminCustomers()

    if (shopifyAdminCustomers.length > 0) {
    const alertMessage = `PO received for ${buyerName} by ${createdBy} on ${poReceivedDate}`
     const alertInserts = shopifyAdminCustomers.map(customer => ({
        message: alertMessage,
        po_id: po.id,
        recipient_user_id: customer.id.toString(), // Shopify customer ID as string
        recipient_name: customer.name || `${customer.first_name} ${customer.last_name}`,
        is_read: false
      }))
    const { error: alertError } = await supabase
        .from('alerts')
        .insert(alertInserts)
     if (alertError) {
        console.error('Error creating alerts:', alertError)
        // Don't fail the whole request if alerts fail
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
      await supabase.storage.from('documents').remove([filePath])
    }

    res.status(500).json({ error: err.message || 'Upload failed' })
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
      `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2025-07/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
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
