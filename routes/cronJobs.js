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

    const poIds = overduePOs.map(po => po.id);
    const buyerOrgIds = [...new Set(overduePOs.map(po => po.buyer_supplier_links?.buyer_org_id).filter(Boolean))];

    // ── Batch fetch: members for all buyer orgs ──
    const { data: allAccessRows, error: accessError } = await supabase
      .from('member_organization_access')
      .select(`organization_id, organization_members ( id, full_name, email, organization_id, role )`)
      .in('organization_id', buyerOrgIds);

    if (accessError) throw accessError;

    // Build cache: { [buyerOrgId]: [members] }
    const membersByBuyerOrg = {};
    for (const row of allAccessRows || []) {
      const m = row.organization_members;
      if (!m || m.organization_id !== merchantOrg.id) continue;
      if (!membersByBuyerOrg[row.organization_id]) membersByBuyerOrg[row.organization_id] = [];
      membersByBuyerOrg[row.organization_id].push(m);
    }

    // ── Batch fetch: existing PI_REMINDER / PI_OVERDUE alerts for all POs ──
    const { data: existingReminderAlerts } = await supabase
      .from('alerts')
      .select('id, po_id, alert_type')
      .in('po_id', poIds)
      .in('alert_type', ['PI_REMINDER', 'PI_OVERDUE']);

    // Build cache: { [po_id]: { PI_REMINDER: [ids], PI_OVERDUE: [ids] } }
    const alertsByPo = {};
    for (const a of existingReminderAlerts || []) {
      if (!alertsByPo[a.po_id]) alertsByPo[a.po_id] = { PI_REMINDER: [], PI_OVERDUE: [] };
      alertsByPo[a.po_id][a.alert_type]?.push(a.id);
    }

    // ── Batch fetch: PO_UPLOAD snapshots for all POs ──
    const { data: uploadAlerts } = await supabase
      .from('alerts')
      .select('po_id, po_snapshot')
      .in('po_id', poIds)
      .eq('alert_type', 'PO_UPLOAD');

    // Build cache: { [po_id]: po_snapshot }
    const snapshotByPo = {};
    for (const a of uploadAlerts || []) {
      snapshotByPo[a.po_id] = a.po_snapshot;
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

      const alertType = daysSinceReceived === 4 ? 'PI_REMINDER' : 'PI_OVERDUE';

      // ── Resolve recipients from cache ──
      const allEligibleMembers = membersByBuyerOrg[buyerOrgId] || [];
      const recipients = alertType === 'PI_REMINDER'
        ? allEligibleMembers.filter(m => m.role !== 'admin' && m.role !== 'owner')
        : allEligibleMembers;

      if (recipients.length === 0) continue;

      // ── If overdue, update existing PI_REMINDER alerts in place ──
      if (alertType === 'PI_OVERDUE') {
        const existingReminderIds = alertsByPo[po.id]?.PI_REMINDER || [];

        if (existingReminderIds.length > 0) {
          const overdueMessage = `PI confirmation overdue for ${buyerNameText} → ${supplierNameText} · PO#${po.po_number}. Please state reason for delay on dashboard.`;

          const { error: updateError } = await supabase
            .from('alerts')
            .update({
              alert_type: 'PI_OVERDUE',
              message:    overdueMessage,
              is_read:    false,
              email_sent: false,
            })
            .in('id', existingReminderIds);

          if (updateError) {
            console.error(`❌ Update error for PO ${po.po_number}:`, updateError);
            continue;
          }

          console.log(`🔄 Updated ${existingReminderIds.length} PI_REMINDER → PI_OVERDUE for PO ${po.po_number}`);

          sendAlertEmail(
            recipients.map(m => ({ email: m.email, name: m.full_name })),
            overdueMessage,
            { buyer_name: buyerNameText, supplier_name: supplierNameText, po_number: po.po_number, date: po.po_received_date, days_since: daysSinceReceived },
            'PI_OVERDUE'
          ).then(async () => {
            const { error } = await supabase
              .from('alerts')
              .update({ email_sent: true })
              .in('id', existingReminderIds);
            if (error) console.error('❌ Email flag update failed:', error);
          }).catch(err => {
            console.error(`❌ Overdue email failed for PO ${po.po_number}:`, err);
          });

          totalAlertsCreated += existingReminderIds.length;
          continue; // skip insert
        }
      }

      // ── For PI_REMINDER, skip if already sent ──
      if (alertType === 'PI_REMINDER') {
        const alreadySent = (alertsByPo[po.id]?.PI_REMINDER || []).length > 0;
        if (alreadySent) {
          console.log(`ℹ️ PI_REMINDER already sent for PO ${po.po_number} — skipping`);
          continue;
        }
      }

      // ── Resolve snapshot from cache ──
      const poSnapshot = snapshotByPo[po.id] || {
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
      ).then(async () => {
        const { error } = await supabase
          .from('alerts')
          .update({ email_sent: true })
          .in('id', insertedAlerts.map(a => a.id));
        if (error) console.error('❌ Email flag update failed:', error);
        console.log(`📧 ${alertType} email sent for PO ${po.po_number}`);
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