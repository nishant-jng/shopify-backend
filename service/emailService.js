const dotenv = require("dotenv");
dotenv.config();

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_KEY);

async function sendAlertEmail(recipients, alertMessage, poDetails) {
  try {
    const emailPromises = recipients.map(recipient => 
      resend.emails.send({
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
      })
    );

    await Promise.all(emailPromises);
    console.log(`✅ Sent ${recipients.length} alert emails`);
    return true;
  } catch (error) {
    console.error('❌ Email sending error:', error);
    return false;
  }
}

module.exports = { sendAlertEmail };