const express = require('express')
const router = express.Router()
const supabase = require('../supabaseClient')
const upload = require('../upload')
const { authenticateManualHmac } = require('../middleware/authenticate')

router.post('/upload-po', authenticateManualHmac, upload.single('poFile'), async (req, res) => {
  let filePath = null

  try {
    const { buyerName, poReceivedDate } = req.body
    const { createdBy} = req.querys
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

    // ---- 3. Create Alert ----
    const alertMessage = `PO received for ${buyerName} by ${createdBy} on ${poReceivedDate}`

    const { error: alertError } = await supabase
      .from('alerts')
      .insert([{
        message: alertMessage,
        po_id: po.id,
      }])

    if (alertError) throw alertError

    // ---- Success ----
    return res.json({
      success: true,
      poId: po.id,
      message: 'PO uploaded and alert created',
    })

  } catch (err) {
    console.error('PO Upload Error:', err)

    // ---- Rollback file if DB failed ----
    if (filePath) {
      await supabase.storage.from('po-files').remove([filePath])
    }

    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

module.exports = router
