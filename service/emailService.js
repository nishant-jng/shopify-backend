const dotenv = require("dotenv");
dotenv.config();

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_KEY);

// ─────────────────────────────────────────────
//  Shared layout wrapper — sleek black & white
// ─────────────────────────────────────────────
function wrapTemplate({ accentColor = '#000000', iconChar, badgeLabel, badgeColor = '#000', title, subtitle, rows, calloutText, calloutBg = '#f5f5f5', calloutBorder = '#000' }) {
  const tableRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#888888;font-size:13px;font-family:'Georgia',serif;letter-spacing:0.03em;width:42%;vertical-align:top;">
          ${label}
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e8e8e8;color:#111111;font-size:13px;font-family:'Courier New',monospace;font-weight:600;vertical-align:top;">
          ${value || '—'}
        </td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f0f0;font-family:'Georgia',serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f0f0;padding:40px 20px;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #d8d8d8;">

          <!-- Top accent bar -->
          <tr>
            <td style="background-color:${accentColor};height:4px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:36px 40px 28px;border-bottom:1px solid #e8e8e8;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <!-- Icon circle -->
                    <div style="display:inline-block;width:48px;height:48px;background-color:${accentColor};border-radius:50%;text-align:center;line-height:60px;margin-bottom:16px;vertical-align:middle;">
                      <table width="48" height="48" cellpadding="0" cellspacing="0" style="display:inline-table;"><tr><td align="center" valign="middle" style="padding:0;">${iconChar}</td></tr></table>
                    </div>
                    <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111111;font-family:'Georgia',serif;letter-spacing:-0.02em;">
                      ${title}
                    </h1>
                    <p style="margin:0;font-size:13px;color:#888888;font-family:'Georgia',serif;letter-spacing:0.04em;">
                      ${subtitle}
                    </p>
                  </td>
                  <td style="text-align:right;vertical-align:top;">
                    <span style="display:inline-block;background-color:${badgeColor};color:#ffffff;font-size:10px;font-family:'Courier New',monospace;letter-spacing:0.12em;padding:6px 14px;border-radius:2px;font-weight:700;text-transform:uppercase;">
                      ${badgeLabel}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Details table -->
          <tr>
            <td style="padding:28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${tableRows}
              </table>
            </td>
          </tr>

          <!-- Callout box -->
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:${calloutBg};border-left:3px solid ${calloutBorder};padding:16px 20px;">
                    <p style="margin:0;font-size:12px;color:#444444;font-family:'Georgia',serif;line-height:1.7;letter-spacing:0.02em;">
                      ${calloutText}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:#fafafa;border-top:1px solid #e8e8e8;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#aaaaaa;font-family:'Courier New',monospace;letter-spacing:0.06em;text-transform:uppercase;">
                      Automated · PO Management System
                    </p>
                  </td>
                  <td style="text-align:right;">
                    <p style="margin:0;font-size:11px;color:#aaaaaa;font-family:'Courier New',monospace;letter-spacing:0.04em;">
                      ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bottom accent bar -->
          <tr>
            <td style="background-color:${accentColor};height:2px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}


// ─────────────────────────────────────────────
//  Template generator
// ─────────────────────────────────────────────
function generateEmailTemplate(alertType, alertMessage, poDetails) {
  switch (alertType) {

    // ── New PO received ──────────────────────
    case 'PO_UPLOAD':
      return {
        subject: `New Purchase Order — ${poDetails.buyer_name || 'Unknown Buyer'} · PO#${poDetails.po_number || 'N/A'}`,
        html: wrapTemplate({
          accentColor: '#000000',
          iconChar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="3.27 6.96 12 12.01 20.73 6.96" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="22.08" x2="12" y2="12" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>',
          badgeLabel: 'New Order',
          badgeColor: '#000000',
          title: 'New Purchase Order Received',
          subtitle: `Order reference · PO#${poDetails.po_number || 'N/A'}`,
          rows: [
            ['Buyer',           poDetails.buyer_name],
            ['Supplier',        poDetails.supplier_name],
            ['PO Number',       poDetails.po_number],
            ['Quantity',        poDetails.quantity_ordered],
            ['Order Amount',    poDetails.amount],
            ['Date Received',   poDetails.date || poDetails.po_received_date],
          ],
          calloutBg: '#f5f5f5',
          calloutBorder: '#000000',
          calloutText: '<strong>Action Required:</strong> A new purchase order is awaiting review. Please log in to your dashboard to process and confirm the order details.',
        }),
      };

    // ── PI uploaded / confirmed ──────────────
    case 'PI_UPLOAD':
      return {
        subject: `PI Confirmed — ${poDetails.buyer_name || 'Unknown Buyer'} · PO#${poDetails.po_number || 'N/A'}`,
        html: wrapTemplate({
          accentColor: '#000000',
          iconChar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="9 15 11 17 15 13" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          badgeLabel: 'Confirmed',
          badgeColor: '#000000',
          title: 'Proforma Invoice Confirmed',
          subtitle: `PI received for order · PO#${poDetails.po_number || 'N/A'}`,
          rows: [
            ['Buyer',           poDetails.buyer_name],
            ['Supplier',        poDetails.supplier_name],
            ['PO Number',       poDetails.po_number],
            ['PI Received',     poDetails.pi_received_date || poDetails.date],
            ['Status',          'Confirmed'],
          ],
          calloutBg: '#f5f5f5',
          calloutBorder: '#000000',
          calloutText: '<strong>Next Steps:</strong> The Proforma Invoice has been confirmed successfully. Please proceed with the next stage of order processing.',
        }),
      };

    // ── PO deleted ───────────────────────────
   case 'PO_DELETED':
  return {
    subject: `Purchase Order Deleted — ${poDetails.buyer_name || 'Unknown Buyer'} · PO#${poDetails.po_number || 'N/A'}`,
    html: wrapTemplate({
      accentColor: '#000000',
      iconChar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="3 6 5 6 21 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      badgeLabel: 'Deleted',
      badgeColor: '#000000',
      title: 'Purchase Order Deleted',
      subtitle: `Order removed · PO#${poDetails.po_number || 'N/A'}`,
      rows: [
        ['Buyer',        poDetails.buyer_name],
        ['Supplier',     poDetails.supplier_name],
        ['PO Number',    poDetails.po_number],
        ['Quantity',     poDetails.quantity_ordered],
        ['Order Amount', poDetails.amount],
        ['Date',         poDetails.date],
        ['Deleted By',   poDetails.deleted_by],      
        ['Reason',       poDetails.reason],            
      ],
      calloutBg: '#f9f9f9',
      calloutBorder: '#000000',
      calloutText: `<strong>Notice:</strong> ${alertMessage}`, 
    }),
  };
 case 'PI_REMINDER':
  return {
    subject: `PI Due Tomorrow — ${poDetails.buyer_name} · PO#${poDetails.po_number || 'N/A'}`,
    html: wrapTemplate({
      accentColor: '#000000',
      iconChar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="white" stroke-width="1.8"/><polyline points="12 6 12 12 16 14" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      badgeLabel: 'Due Tomorrow',
      badgeColor: '#000000',
      title: 'PI Confirmation Due Tomorrow',
      subtitle: `Last day to confirm · PO#${poDetails.po_number || 'N/A'}`,
      rows: [
        ['Buyer',        poDetails.buyer_name],
        ['Supplier',     poDetails.supplier_name],
        ['PO Number',    poDetails.po_number],
        ['PO Received',  poDetails.date],
        ['Deadline',     'Tomorrow'],
      ],
      calloutBg: '#f5f5f5',
      calloutBorder: '#000000',
      calloutText: '<strong>Reminder:</strong> Tomorrow is the last day to confirm the Proforma Invoice for this order. Please log in to your dashboard and upload the PI before the deadline.',
    }),
  };

case 'PI_OVERDUE':
  return {
    subject: `PI Overdue — ${poDetails.buyer_name} · PO#${poDetails.po_number || 'N/A'}`,
    html: wrapTemplate({
      accentColor: '#000000',
      iconChar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" stroke-width="1.8" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>',
      badgeLabel: 'Overdue',
      badgeColor: '#000000',
      title: 'PI Confirmation Overdue',
      subtitle: `${poDetails.days_since} days since PO received · PO#${poDetails.po_number || 'N/A'}`,
      rows: [
        ['Buyer',        poDetails.buyer_name],
        ['Supplier',     poDetails.supplier_name],
        ['PO Number',    poDetails.po_number],
        ['PO Received',  poDetails.date],
        ['Days Elapsed', `${poDetails.days_since} days`],
      ],
      calloutBg: '#f5f5f5',
      calloutBorder: '#000000',
      calloutText: '<strong>Action Required:</strong> The 5-day window to confirm the Proforma Invoice has passed. Please log in to your dashboard to either upload the PI or <strong>state the reason for delay</strong>.',
    }),
  };
    // ── Default / fallback ───────────────────
    default:
      return {
        subject: `Purchase Order Alert — ${poDetails.buyer_name || 'Unknown Buyer'}`,
        html: wrapTemplate({
          accentColor: '#000000',
          iconChar: '🔔',
          badgeLabel: 'Alert',
          badgeColor: '#000000',
          title: 'Purchase Order Alert',
          subtitle: alertMessage || 'A new alert has been triggered in your system',
          rows: [
            ['Buyer',       poDetails.buyer_name],
            ['Supplier',    poDetails.supplier_name],
            ['PO Number',   poDetails.po_number],
            ['Quantity',    poDetails.quantity_ordered],
            ['Amount',      poDetails.amount],
            ['Date',        poDetails.date],
          ],
          calloutBg: '#f5f5f5',
          calloutBorder: '#000000',
          calloutText: 'Please log in to your dashboard for full details and to take any required action on this order.',
        }),
      };
  }
}


// ─────────────────────────────────────────────
//  Send function (unchanged logic)
// ─────────────────────────────────────────────
async function sendAlertEmail(recipients, alertMessage, poDetails, alertType = 'DEFAULT') {
  try {
    const excludedEmails = [
      "nitin@jnitin.com",
      "ritika@jnitin.com",
      "erp2@jnitin.com",
    ];

    const filteredRecipients = recipients.filter(
      (recipient) => !excludedEmails.includes(recipient.email)
    );

    console.log(`📧 Preparing to send ${filteredRecipients.length} emails (${recipients.length - filteredRecipients.length} excluded)...`);

    if (filteredRecipients.length === 0) {
      console.log('⚠️ No recipients after filtering');
      return { success: true, successCount: 0, failCount: 0, failedRecipients: [], successfulRecipients: [] };
    }

    const emailTemplate = generateEmailTemplate(alertType, alertMessage, poDetails);

    const batchEmails = filteredRecipients.map((recipient) => ({
      from: 'care@jnitin.com',
      to: [recipient.email],
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    }));

    console.log(`📨 Sending batch of ${batchEmails.length} emails...`);

    const { data, error } = await resend.batch.send(batchEmails);

    if (error) {
      console.error('❌ Batch send error:', error);
      return {
        success: false,
        successCount: 0,
        failCount: filteredRecipients.length,
        failedRecipients: filteredRecipients.map((r) => ({ email: r.email, error: error.message || 'Batch send failed' })),
        successfulRecipients: [],
        criticalError: error.message,
      };
    }

    const successfulRecipients = filteredRecipients.map((r) => r.email);

    console.log('\n📊 Email Summary:');
    console.log(`✅ Successfully sent: ${data.length}`);
    console.log('✅ Email IDs:', data.map((d) => d.id));

    return {
      success: true,
      successCount: data.length,
      failCount: 0,
      failedRecipients: [],
      successfulRecipients,
      emailIds: data.map((d) => d.id),
    };
  } catch (error) {
    console.error('❌ Critical email sending error:', error);
    return {
      success: false,
      successCount: 0,
      failCount: recipients.length,
      failedRecipients: recipients.map((r) => ({ email: r.email, error: error.message })),
      successfulRecipients: [],
      criticalError: error.message,
    };
  }
}

module.exports = { sendAlertEmail };



// const dotenv = require("dotenv");
// dotenv.config();

// const { Resend } = require("resend");

// const resend = new Resend(process.env.RESEND_KEY);

// // 👉 Email template generator
// function generateEmailTemplate(alertType, alertMessage, poDetails) {
//   switch (alertType) {
//     case 'PO_UPLOAD':
//       return {
//         subject: `New PO Uploaded: ${poDetails.buyer_name}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
//             <div style="background-color: #4CAF50; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
//               <h2 style="margin: 0;">📦 New Purchase Order Received</h2>
//             </div>
            
//             <div style="background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none;">
//               <p style="font-size: 16px; color: #333;">
//                 A new purchase order has been uploaded to the system.
//               </p>

//               <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
//                 <h3 style="color: #4CAF50; margin-top: 0;">Order Details</h3>
//                 <table style="width: 100%; border-collapse: collapse;">
//                   <tr>
//                     <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Buyer:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.buyer_name || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Supplier:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.supplier_name || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>PO Number:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.po_number || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Quantity:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.quantity_ordered || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Amount:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.amount || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Date:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.date || poDetails.po_received_date || 'N/A'}</td>
//                   </tr>
//                 </table>
//               </div>

//               <div style="margin-top: 20px; padding: 15px; background-color: #e8f5e9; border-left: 4px solid #4CAF50; border-radius: 3px;">
//                 <p style="margin: 0; color: #2e7d32;">
//                   <strong>Action Required:</strong> Please review and process this purchase order in your dashboard.
//                 </p>
//               </div>

//               <p style="margin-top: 20px; color: #666; font-size: 14px;">
//                 This is an automated notification from your PO management system.
//               </p>
//             </div>
//           </div>
//         `
//       };

//     case 'PI_UPLOAD':
//       return {
//         subject: `PI Confirmed: ${poDetails.buyer_name} - PO#${poDetails.po_number}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
//             <div style="background-color: #2196F3; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
//               <h2 style="margin: 0;">✅ Proforma Invoice Uploaded</h2>
//             </div>
            
//             <div style="background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none;">
//               <p style="font-size: 16px; color: #333;">
//                 A Proforma Invoice (PI) has been uploaded and confirmed for this purchase order.
//               </p>

//               <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
//                 <h3 style="color: #2196F3; margin-top: 0;">PI Details</h3>
//                 <table style="width: 100%; border-collapse: collapse;">
//                   <tr>
//                     <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Buyer:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.buyer_name || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Supplier:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.supplier_name || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>PO Number:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.po_number || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>PI Received:</strong></td>
//                     <td style="padding: 8px 0; color: #333;">${poDetails.pi_received_date || poDetails.date || 'N/A'}</td>
//                   </tr>
//                   <tr>
//                     <td style="padding: 8px 0; color: #666;"><strong>Status:</strong></td>
//                     <td style="padding: 8px 0;">
//                       <span style="background-color: #4CAF50; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
//                         CONFIRMED
//                       </span>
//                     </td>
//                   </tr>
//                 </table>
//               </div>

//               <div style="margin-top: 20px; padding: 15px; background-color: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 3px;">
//                 <p style="margin: 0; color: #1565c0;">
//                   <strong>Next Steps:</strong> The PI has been confirmed. Please proceed with the next stage of order processing.
//                 </p>
//               </div>

//               <p style="margin-top: 20px; color: #666; font-size: 14px;">
//                 This is an automated notification from your PO management system.
//               </p>
//             </div>
//           </div>
//         `
//       };
//       case 'PO_DELETED':
//   return {
//     subject: `PO Deleted: ${poDetails.buyer_name} - PO#${poDetails.po_number}`,
//     html: `
//       <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
//         <div style="background-color: #f44336; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
//           <h2 style="margin: 0;">🗑️ Purchase Order Deleted</h2>
//         </div>
        
//         <div style="background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none;">
//           <p style="font-size: 16px; color: #333;">
//             A purchase order has been permanently deleted from the system.
//           </p>

//           <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
//             <h3 style="color: #f44336; margin-top: 0;">Deleted Order Details</h3>
//             <table style="width: 100%; border-collapse: collapse;">
//               <tr>
//                 <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Buyer:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.buyer_name || 'N/A'}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; color: #666;"><strong>Supplier:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.supplier_name || 'N/A'}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; color: #666;"><strong>PO Number:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.po_number || 'N/A'}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; color: #666;"><strong>Quantity:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.quantity_ordered || 'N/A'}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; color: #666;"><strong>Amount:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.amount || 'N/A'}</td>
//               </tr>
//               <tr>
//                 <td style="padding: 8px 0; color: #666;"><strong>Deleted On:</strong></td>
//                 <td style="padding: 8px 0; color: #333;">${poDetails.deleted_date || poDetails.date || new Date().toLocaleDateString()}</td>
//               </tr>
//             </table>
//           </div>

//           <div style="margin-top: 20px; padding: 15px; background-color: #ffebee; border-left: 4px solid #f44336; border-radius: 3px;">
//             <p style="margin: 0; color: #c62828;">
//               <strong>Notice:</strong> This action cannot be undone. If this was a mistake, please contact your administrator immediately.
//             </p>
//           </div>

//           <p style="margin-top: 20px; color: #666; font-size: 14px;">
//             This is an automated notification from your PO management system.
//           </p>
//         </div>
//       </div>
//     `
//   };

//     default:
//       return {
//         subject: `New Alert: ${poDetails.buyer_name}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px;">
//             <h2>Purchase Order Alert</h2>
//             <p><strong>${alertMessage}</strong></p>

//             <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
//               <h3>Order Details</h3>
//               <ul style="list-style: none; padding: 0;">
//                 <li><strong>Buyer:</strong> ${poDetails.buyer_name || 'N/A'}</li>
//                 <li><strong>Supplier:</strong> ${poDetails.supplier_name || 'N/A'}</li>
//                 <li><strong>PO Number:</strong> ${poDetails.po_number || 'N/A'}</li>
//                 <li><strong>Quantity:</strong> ${poDetails.quantity_ordered || 'N/A'}</li>
//                 <li><strong>Amount:</strong> ${poDetails.amount || 'N/A'}</li>
//                 <li><strong>Date:</strong> ${poDetails.date || 'N/A'}</li>
//               </ul>
//             </div>

//             <p style="margin-top: 20px; color: #666;">
//               This is an automated notification. Please log in to your dashboard for more details.
//             </p>
//           </div>
//         `
//       };
//   }
// }

// async function sendAlertEmail(recipients, alertMessage, poDetails, alertType = 'DEFAULT') {
//   try {
//     // Filter excluded emails
//     const excludedEmails = [
//       "nitin@jnitin.com",
//       "ritika@jnitin.com",
//       "erp2@jnitin.com"
//     ];
    
//     const filteredRecipients = recipients.filter(
//       recipient => !excludedEmails.includes(recipient.email)
//     );

//     console.log(`📧 Preparing to send ${filteredRecipients.length} emails (${recipients.length - filteredRecipients.length} excluded)...`);

//     if (filteredRecipients.length === 0) {
//       console.log('⚠️ No recipients after filtering');
//       return {
//         success: true,
//         successCount: 0,
//         failCount: 0,
//         failedRecipients: [],
//         successfulRecipients: []
//       };
//     }

//     // Generate email template based on alert type
//     const emailTemplate = generateEmailTemplate(alertType, alertMessage, poDetails);

//     // Create batch email array - each email is sent individually to one recipient
//     const batchEmails = filteredRecipients.map(recipient => ({
//       from: 'care@jnitin.com',
//       to: [recipient.email], // Array with single email
//       subject: emailTemplate.subject,
//       html: emailTemplate.html
//     }));

//     console.log(`📨 Sending batch of ${batchEmails.length} emails...`);

//     // Send all emails in a single batch API call
//     const { data, error } = await resend.batch.send(batchEmails);

//     if (error) {
//       console.error('❌ Batch send error:', error);
      
//       return {
//         success: false,
//         successCount: 0,
//         failCount: filteredRecipients.length,
//         failedRecipients: filteredRecipients.map(r => ({ 
//           email: r.email, 
//           error: error.message || 'Batch send failed' 
//         })),
//         successfulRecipients: [],
//         criticalError: error.message
//       };
//     }

//     // All emails in batch were sent successfully
//     const successfulRecipients = filteredRecipients.map(r => r.email);

//     console.log('\n📊 Email Summary:');
//     console.log(`✅ Successfully sent: ${data.length}`);
//     console.log('✅ Email IDs:', data.map(d => d.id));

//     return {
//       success: true,
//       successCount: data.length,
//       failCount: 0,
//       failedRecipients: [],
//       successfulRecipients,
//       emailIds: data.map(d => d.id)
//     };

//   } catch (error) {
//     console.error("❌ Critical email sending error:", error);
    
//     return {
//       success: false,
//       successCount: 0,
//       failCount: recipients.length,
//       failedRecipients: recipients.map(r => ({ 
//         email: r.email, 
//         error: error.message 
//       })),
//       successfulRecipients: [],
//       criticalError: error.message
//     };
//   }
// }

// module.exports = { sendAlertEmail };









