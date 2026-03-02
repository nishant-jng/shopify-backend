const express = require('express')
const router = express.Router()
const supabase = require('../supabaseClient')
const { sendAlertEmail } = require('../service/emailService');

router.post('/pi-reminder', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Calculate target dates
    const day4Date = new Date(today);
    day4Date.setDate(today.getDate() - 4);
    const day4Str = day4Date.toISOString().split('T')[0];

    const day5Date = new Date(today);
    day5Date.setDate(today.getDate() - 5);
    const day5Str = day5Date.toISOString().split('T')[0];

    // ── Fetch POs received exactly on day 4 or day 5, PI not confirmed ──
    const { data: overduePOs, error: poError } = await supabase
      .from('purchase_orders')
      .select(`
        id,
        po_number,
        po_received_date,
        quantity_ordered,
        amount,
        buyer_supplier_link_id,
        buyer_supplier_links (
          buyer_org_id,
          buyer:organizations!buyer_supplier_links_buyer_org_id_fkey (display_name),
          supplier:organizations!buyer_supplier_links_supplier_org_id_fkey (display_name)
        )
      `)
      .is('pi_confirmed', null)
      .in('po_received_date', [day4Str, day5Str])
      .is('deleted_at', null);

    if (poError) throw poError;

    console.log(`📋 Found ${overduePOs?.length || 0} POs to process`);

    if (!overduePOs || overduePOs.length === 0) {
      return res.status(200).json({ success: true, reminded: 0 });
    }

    // ── Fetch merchant org once ──
    const { data: merchantOrg, error: merchantError } = await supabase
      .from('organizations')
      .select('id')
      .eq('type', 'merchant')
      .maybeSingle();

    if (merchantError) console.error('❌ Merchant fetch error:', merchantError);
    if (!merchantOrg) {
      return res.status(200).json({ success: true, reminded: 0, reason: 'No merchant org' });
    }

    let totalAlertsCreated = 0;

    for (const po of overduePOs) {
      const buyerOrgId       = po.buyer_supplier_links?.buyer_org_id;
      const buyerNameText    = po.buyer_supplier_links?.buyer?.display_name    || 'Unknown Buyer';
      const supplierNameText = po.buyer_supplier_links?.supplier?.display_name || 'Unknown Supplier';

      if (!buyerOrgId) {
        console.warn(`⚠️ No buyer org for PO ${po.id} — skipping`);
        continue;
      }

      const daysSinceReceived = Math.floor(
        (today - new Date(po.po_received_date)) / (1000 * 60 * 60 * 24)
      );

      // Determine alert type for this PO
      const alertType = daysSinceReceived === 4 ? 'PI_REMINDER' : 'PI_OVERDUE';

      // ── Check if this alert type already sent today ──
      const { data: existingReminder } = await supabase
        .from('alerts')
        .select('id')
        .eq('po_id', po.id)
        .eq('alert_type', alertType)
        .gte('created_at', `${todayStr}T00:00:00.000Z`)
        .maybeSingle();

      if (existingReminder) {
        console.log(`ℹ️ ${alertType} already sent today for PO ${po.po_number} — skipping`);
        continue;
      }

      // ── Fetch eligible members ──
      const { data: accessRows, error: accessError } = await supabase
        .from('member_organization_access')
        .select(`organization_members ( id, full_name, email, organization_id, role )`)
        .eq('organization_id', buyerOrgId);

        if (accessError) {
        console.error(`❌ Access fetch error for PO ${po.id}:`, accessError);
        continue;
        }

        const allEligibleMembers = (accessRows || [])
        .map(r => r.organization_members)
        .filter(m => m && m.organization_id === merchantOrg.id);

        // PI_REMINDER → exclude admins
        // PI_OVERDUE  → everyone
        const recipients = alertType === 'PI_REMINDER'
        ? allEligibleMembers.filter(m => m.role !== 'admin' && m.role !== 'owner')
        : allEligibleMembers;

        if (recipients.length === 0) continue;

      // ── Build snapshot from existing PO_UPLOAD alert if available ──
      const { data: existingAlert } = await supabase
        .from('alerts')
        .select('po_snapshot')
        .eq('po_id', po.id)
        .eq('alert_type', 'PO_UPLOAD')
        .maybeSingle();

      const poSnapshot = existingAlert?.po_snapshot || {
        po_id:            po.id,
        po_number:        po.po_number,
        buyer_name:       buyerNameText,
        supplier_name:    supplierNameText,
        po_received_date: po.po_received_date,
        quantity_ordered: po.quantity_ordered,
        amount:           po.amount,
        pi_confirmed:     false,
        pi_file_url:      null,
      };

      // ── Build alert message ──
      const alertMessage = alertType === 'PI_REMINDER'
        ? `PI confirmation due tomorrow for ${buyerNameText} → ${supplierNameText} · PO#${po.po_number}. Today is the last day to confirm.`
        : `PI confirmation overdue for ${buyerNameText} → ${supplierNameText} · PO#${po.po_number}. Please state reason for delay on dashboard.`;

      // ── Insert alerts ──
      const alertInserts = recipients.map(m => ({
        message:           alertMessage,
        alert_type:        alertType,
        po_id:             po.id,
        po_snapshot:       poSnapshot,
        recipient_user_id: m.id,
        recipient_name:    m.full_name,
        is_read:           false,
        email_sent:        false,
        retry_count:       0,
        scheduled_for:     new Date().toISOString(),
      }));

      const { data: insertedAlerts, error: alertError } = await supabase
        .from('alerts')
        .insert(alertInserts)
        .select();

      if (alertError) {
        console.error(`❌ Alert insert error for PO ${po.id}:`, alertError);
        continue;
      }

      totalAlertsCreated += insertedAlerts?.length || 0;
      console.log(`✅ ${alertType} alerts created for PO ${po.po_number}`);

      // ── Send email (fire and forget) ──
      sendAlertEmail(
        recipients.map(m => ({ email: m.email, name: m.full_name })),
        alertMessage,
        {
          buyer_name:       buyerNameText,
          supplier_name:    supplierNameText,
          po_number:        po.po_number,
          date:             po.po_received_date,
          days_since:       daysSinceReceived,
        },
        alertType
      ).then(result => {
        console.log(`📧 ${alertType} email sent for PO ${po.po_number}:`, result.successCount);
      }).catch(err => {
        console.error(`❌ Email failed for PO ${po.po_number}:`, err);
      });
    }

    return res.status(200).json({
      success:        true,
      pos_processed:  overduePOs.length,
      alerts_created: totalAlertsCreated,
    });

  } catch (err) {
    console.error('❌ PI reminder cron error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;