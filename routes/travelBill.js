const express = require('express')
const upload = require('../upload')
const supabase = require('../supabaseClient')

const router = express.Router()

router.post(
  '/upload-travel-bill',
  upload.single('billFile'),
  async (req, res) => {
    let filePath = null
    const BUCKET_NAME = 'TRAVEL_BILLS'

    try {
      const { travelDate, comments, email } = req.body
      const file = req.file

      // ---- Validation ----
      if (!travelDate || !comments || !email || !file) {
        return res.status(400).json({
          error: 'Missing required fields'
        })
      }

      // ---- Find organization member by email ----
      const { data: member, error: memberError } = await supabase
        .from('organization_members')
        .select('id')
        .eq('email', email)
        .single()

      if (memberError || !member) {
        return res.status(404).json({
          error: 'Organization member not found'
        })
      }

      const organizationMemberId = member.id

      // ---- Date Helpers ----
      const dateObj = new Date(travelDate)
      const months = [
        'January','February','March','April','May','June',
        'July','August','September','October','November','December'
      ]

      const month = months[dateObj.getMonth()]
      const day = String(dateObj.getDate()).padStart(2, '0')

      // ---- File Path (AS REQUESTED) ----
      const safeName = file.originalname.replace(/\s+/g, '_')
      filePath = `${month}/${day}/travel_${Date.now()}_${safeName}`

      // ---- Upload to Supabase Storage ----
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        })

      if (uploadError) throw uploadError

      // ---- Insert Travel Bill ----
      const { data, error: insertError } = await supabase
        .from('travel_bill_request')
        .insert([
          {
            organization_member_id: organizationMemberId,
            travel_bill_date: travelDate,
            travel_bill_url: filePath,
            travel_bill_comment: comments
          }
        ])
        .select()
        .single()

      if (insertError) throw insertError

      // ---- Success ----
      return res.json({
        success: true,
        travelBillId: data.id,
        message: 'Travel bill uploaded successfully'
      })

    } catch (err) {
      console.error('Travel Bill Upload Error:', err)

      // ---- Rollback file if DB insert fails ----
      if (filePath) {
        await supabase.storage
          .from(BUCKET_NAME)
          .remove([filePath])
      }

      return res.status(500).json({
        error: err.message || 'Travel bill upload failed'
      })
    }
  }
)

module.exports = router