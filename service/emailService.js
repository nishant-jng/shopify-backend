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

async function sendAlertEmail(recipients, alertMessage, poDetails) {
  try {

    const tasks = recipients.map(recipient => {
      const emailPayload = {
        from: 'care@jnitin.com',
        to: recipient.email,
        subject: `New Alert: ${poDetails.buyer_name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Purchase Order Alert</h2>
            <p><strong>${alertMessage}</strong></p>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px;">
              <h3>Order Details</h3>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Buyer:</strong> ${poDetails.buyer_name}</li>
                <li><strong>PO Number:</strong> ${poDetails.po_number || 'N/A'}</li>
                <li><strong>Quantity:</strong> ${poDetails.quantity_ordered || 'N/A'}</li>
                <li><strong>Amount:</strong> ${poDetails.amount || 'N/A'}</li>
                <li><strong>Date:</strong> ${poDetails.date}</li>
              </ul>
            </div>

            <p style="margin-top: 20px; color: #666;">
              This is an automated notification. Please log in to your dashboard for more details.
            </p>
          </div>
        `
      };

      // 👉 Queue through limiter
      return limiter.schedule(() => sendEmailWithRetry(emailPayload));
    });

    const results = await Promise.allSettled(tasks);

    const successCount = results.filter(r => r.status === "fulfilled").length;
    const failCount = results.filter(r => r.status === "rejected").length;

    console.log(`✅ Emails sent: ${successCount}`);
    console.log(`❌ Emails failed: ${failCount}`);

    return failCount === 0;

  } catch (error) {
    console.error("❌ Email sending error:", error);
    return false;
  }
}

module.exports = { sendAlertEmail };
