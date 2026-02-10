const dotenv = require("dotenv");
dotenv.config();

const { Resend } = require("resend");
const Bottleneck = require("bottleneck");

const resend = new Resend(process.env.RESEND_KEY);

// 👉 Rate limiter (2 emails per second)
const limiter = new Bottleneck({
  minTime: 600 // 600ms gap keeps you under limit safely
});

// 👉 Helper delay
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// 👉 Retry wrapper
async function sendEmailWithRetry(emailPayload, retries = 3) {
  try {
    return await resend.emails.send(emailPayload);
  } catch (error) {
    if (error?.status === 429 && retries > 0) {
      console.warn("⚠️ Rate limit hit. Retrying...");
      await delay(1000);
      return sendEmailWithRetry(emailPayload, retries - 1);
    }
    throw error;
  }
}

// 👉 Email template generator
function generateEmailTemplate(alertType, alertMessage, poDetails) {
  switch (alertType) {
    case 'PO_UPLOAD':
      return {
        subject: `New PO Uploaded: ${poDetails.buyer_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
            <div style="background-color: #4CAF50; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
              <h2 style="margin: 0;">📦 New Purchase Order Received</h2>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none;">
              <p style="font-size: 16px; color: #333;">
                A new purchase order has been uploaded to the system.
              </p>

              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="color: #4CAF50; margin-top: 0;">Order Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Buyer:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.buyer_name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Supplier:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.supplier_name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>PO Number:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.po_number || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Quantity:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.quantity_ordered || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Amount:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.amount || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Date:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.date || poDetails.po_received_date || 'N/A'}</td>
                  </tr>
                </table>
              </div>

              <div style="margin-top: 20px; padding: 15px; background-color: #e8f5e9; border-left: 4px solid #4CAF50; border-radius: 3px;">
                <p style="margin: 0; color: #2e7d32;">
                  <strong>Action Required:</strong> Please review and process this purchase order in your dashboard.
                </p>
              </div>

              <p style="margin-top: 20px; color: #666; font-size: 14px;">
                This is an automated notification from your PO management system.
              </p>
            </div>
          </div>
        `
      };

    case 'PI_UPLOAD':
      return {
        subject: `PI Confirmed: ${poDetails.buyer_name} - PO#${poDetails.po_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
            <div style="background-color: #2196F3; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
              <h2 style="margin: 0;">✅ Proforma Invoice Uploaded</h2>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none;">
              <p style="font-size: 16px; color: #333;">
                A Proforma Invoice (PI) has been uploaded and confirmed for this purchase order.
              </p>

              <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="color: #2196F3; margin-top: 0;">PI Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #666; width: 40%;"><strong>Buyer:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.buyer_name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Supplier:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.supplier_name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>PO Number:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.po_number || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>PI Received:</strong></td>
                    <td style="padding: 8px 0; color: #333;">${poDetails.pi_received_date || poDetails.date || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #666;"><strong>Status:</strong></td>
                    <td style="padding: 8px 0;">
                      <span style="background-color: #4CAF50; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px;">
                        CONFIRMED
                      </span>
                    </td>
                  </tr>
                </table>
              </div>

              <div style="margin-top: 20px; padding: 15px; background-color: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 3px;">
                <p style="margin: 0; color: #1565c0;">
                  <strong>Next Steps:</strong> The PI has been confirmed. Please proceed with the next stage of order processing.
                </p>
              </div>

              <p style="margin-top: 20px; color: #666; font-size: 14px;">
                This is an automated notification from your PO management system.
              </p>
            </div>
          </div>
        `
      };

    default:
      return {
        subject: `New Alert: ${poDetails.buyer_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Purchase Order Alert</h2>
            <p><strong>${alertMessage}</strong></p>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
              <h3>Order Details</h3>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Buyer:</strong> ${poDetails.buyer_name || 'N/A'}</li>
                <li><strong>Supplier:</strong> ${poDetails.supplier_name || 'N/A'}</li>
                <li><strong>PO Number:</strong> ${poDetails.po_number || 'N/A'}</li>
                <li><strong>Quantity:</strong> ${poDetails.quantity_ordered || 'N/A'}</li>
                <li><strong>Amount:</strong> ${poDetails.amount || 'N/A'}</li>
                <li><strong>Date:</strong> ${poDetails.date || 'N/A'}</li>
              </ul>
            </div>

            <p style="margin-top: 20px; color: #666;">
              This is an automated notification. Please log in to your dashboard for more details.
            </p>
          </div>
        `
      };
  }
}

async function sendAlertEmail(recipients, alertMessage, poDetails, alertType = 'DEFAULT') {
  const failedRecipients = [];
  const successfulRecipients = [];

  try {
    console.log(`📧 Preparing to send ${recipients.length} emails...`);

    // Generate email template based on alert type
    const emailTemplate = generateEmailTemplate(alertType, alertMessage, poDetails);

    const tasks = recipients.map((recipient, index) => {
      const emailPayload = {
        from: 'care@jnitin.com',
        to: recipient.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html
      };

      // 👉 Queue through limiter and track individual results
      return limiter.schedule(async () => {
        try {
          const result = await sendEmailWithRetry(emailPayload);
          console.log(`✅ Email sent to ${recipient.email} (${index + 1}/${recipients.length})`);
          successfulRecipients.push(recipient.email);
          return { success: true, email: recipient.email, result };
        } catch (error) {
          console.error(`❌ Failed to send to ${recipient.email}:`, error.message);
          failedRecipients.push({ email: recipient.email, error: error.message });
          return { success: false, email: recipient.email, error: error.message };
        }
      });
    });

    // Wait for all emails to attempt sending
    const results = await Promise.allSettled(tasks);

    const successCount = results.filter(r => r.status === "fulfilled" && r.value.success).length;
    const failCount = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)).length;

    console.log(`\n📊 Email Summary:`);
    console.log(`✅ Successfully sent: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    
    if (failedRecipients.length > 0) {
      console.log(`\n⚠️ Failed recipients:`);
      failedRecipients.forEach(({ email, error }) => {
        console.log(`  - ${email}: ${error}`);
      });
    }

    // Return true only if ALL emails were sent successfully
    return {
      success: failCount === 0,
      successCount,
      failCount,
      failedRecipients,
      successfulRecipients
    };

  } catch (error) {
    console.error("❌ Critical email sending error:", error);
    return {
      success: false,
      successCount: successfulRecipients.length,
      failCount: recipients.length - successfulRecipients.length,
      failedRecipients,
      successfulRecipients,
      criticalError: error.message
    };
  }
}

module.exports = { sendAlertEmail };




































// const dotenv = require("dotenv");
// dotenv.config();

// const { Resend } = require("resend");
// const Bottleneck = require("bottleneck");

// const resend = new Resend(process.env.RESEND_KEY);

// // 👉 Rate limiter (2 emails per second)
// const limiter = new Bottleneck({
//   minTime: 600 // 600ms gap keeps you under limit safely
// });

// // 👉 Helper delay
// const delay = (ms) => new Promise(res => setTimeout(res, ms));

// // 👉 Retry wrapper
// async function sendEmailWithRetry(emailPayload, retries = 3) {
//   try {
//     return await resend.emails.send(emailPayload);
//   } catch (error) {

//     if (error?.status === 429 && retries > 0) {
//       console.warn("⚠️ Rate limit hit. Retrying...");
//       await delay(1000);
//       return sendEmailWithRetry(emailPayload, retries - 1);
//     }

//     throw error;
//   }
// }

// async function sendAlertEmail(recipients, alertMessage, poDetails) {
//   try {

//     const tasks = recipients.map(recipient => {
//       const emailPayload = {
//         from: 'care@jnitin.com',
//         to: recipient.email,
//         subject: `New Alert: ${poDetails.buyer_name}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px;">
//             <h2>Purchase Order Alert</h2>
//             <p><strong>${alertMessage}</strong></p>

//             <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
//               <h3>Order Details</h3>
//               <ul style="list-style: none; padding: 0;">
//                 <li><strong>Buyer:</strong> ${poDetails.buyer_name}</li>
//                 <li><strong>PO Number:</strong> ${poDetails.po_number || 'N/A'}</li>
//                 <li><strong>Quantity:</strong> ${poDetails.quantity_ordered || 'N/A'}</li>
//                 <li><strong>Amount:</strong> ${poDetails.amount || 'N/A'}</li>
//                 <li><strong>Date:</strong> ${poDetails.date}</li>
//               </ul>
//             </div>

//             <p style="margin-top: 20px; color: #666;">
//               This is an automated notification. Please log in to your dashboard for more details.
//             </p>
//           </div>
//         `
//       };

//       // 👉 Queue through limiter
//       return limiter.schedule(() => sendEmailWithRetry(emailPayload));
//     });

//     const results = await Promise.allSettled(tasks);

//     const successCount = results.filter(r => r.status === "fulfilled").length;
//     const failCount = results.filter(r => r.status === "rejected").length;

//     console.log(`✅ Emails sent: ${successCount}`);
//     console.log(`❌ Emails failed: ${failCount}`);

//     return failCount === 0;

//   } catch (error) {
//     console.error("❌ Email sending error:", error);
//     return false;
//   }
// }

// module.exports = { sendAlertEmail };
