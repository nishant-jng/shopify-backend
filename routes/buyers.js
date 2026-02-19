// const express = require("express");
// const { createClient } = require("@supabase/supabase-js");
// const PDFDocument = require("pdfkit");

// const router = express.Router();

// const supabase = createClient(
//   process.env.SUPABASE_URL,
//   process.env.SUPABASE_SERVICE_ROLE_KEY
// );

// // ─────────────────────────────────────────────────────────────
// // COMPANY CONSTANTS (JNITIN GLOBAL LLP — pre-filled on invoice)
// // ─────────────────────────────────────────────────────────────
// const COMPANY = {
//   name: "JNITIN GLOBAL LLP",
//   addressLines: [
//     "Plot No.36, Sector 37, Pace city-1,",
//     "Gurgaon, Haryana-122001",
//   ],
//   country: "INDIA",
//   gstin: "06AAPFJ1459D1ZD",
//   pan: "AAPFJ1459D",
//   cin: "AAO-8540",
//   email: "accounts@jnitinglobal.com",
// };

// const BANK = {
//   beneficiary: {
//     accountName: "JNITIN GLOBAL LLP",
//     accountNumber: "8613138240",
//     address: "PLOT NO. 36, PACE CITY I, SECTOR 37, GURGAON - 122 001",
//     bankName: "Kotak Mahindra Bank Ltd.",
//     bankAddress: "JMD Regent Square",
//     ifsc: "KKBK0000261",
//     swift: "KKBKINBBCPC",
//   },
//   intermediary: {
//     bankName: "Citi Bank NA",
//     nostroAccount: "36317907",
//     swift: "CITI US 33",
//   },
// };

// // ─────────────────────────────────────────────────────────────
// // HELPER: Format date from YYYY-MM-DD → "02 Feb 2026"
// // ─────────────────────────────────────────────────────────────
// function formatDate(dateStr) {
//   try {
//     const d = new Date(dateStr + "T00:00:00");
//     return d.toLocaleDateString("en-GB", {
//       day: "2-digit",
//       month: "short",
//       year: "numeric",
//     });
//   } catch {
//     return dateStr;
//   }
// }

// // ─────────────────────────────────────────────────────────────
// // HELPER: Format number with commas → "2,800.00"
// // ─────────────────────────────────────────────────────────────
// function formatAmount(num) {
//   return Number(num).toLocaleString("en-US", {
//     minimumFractionDigits: 2,
//     maximumFractionDigits: 2,
//   });
// }

// // ─────────────────────────────────────────────────────────────
// // PDF GENERATION FUNCTION
// // ─────────────────────────────────────────────────────────────
// function generateInvoicePDF(data) {
//   return new Promise((resolve, reject) => {
//     const doc = new PDFDocument({
//       size: "A4",
//       margins: { top: 40, bottom: 40, left: 40, right: 40 },
//     });

//     const chunks = [];
//     doc.on("data", (chunk) => chunks.push(chunk));
//     doc.on("end", () => resolve(Buffer.concat(chunks)));
//     doc.on("error", reject);

//     const pageWidth = doc.page.width;
//     const left = doc.page.margins.left;
//     const right = pageWidth - doc.page.margins.right;
//     const contentWidth = right - left;

//     const BLACK = "#1a1a1a";
//     const DARK_GRAY = "#374151";
//     const MID_GRAY = "#6b7280";
//     const LIGHT_GRAY = "#e5e7eb";
//     const LIGHTER_GRAY = "#f3f4f6";

//     let y = doc.page.margins.top;

//     // ══════════════════════════════════════
//     // HEADER — "INVOICE"
//     // ══════════════════════════════════════
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(28)
//       .fillColor(BLACK)
//       .text("INVOICE", left, y);

//     y += 36;

//     // Accent line
//     doc
//       .strokeColor(BLACK)
//       .lineWidth(2)
//       .moveTo(left, y)
//       .lineTo(left + 90, y)
//       .stroke();

//     y += 20;

//     // ══════════════════════════════════════
//     // COMPANY INFO (left) + INVOICE META (right)
//     // ══════════════════════════════════════
//     const companyTop = y;

//     // Company name
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(13)
//       .fillColor(BLACK)
//       .text(COMPANY.name, left, y);
//     y += 18;

//     // Address
//     doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);
//     for (const line of COMPANY.addressLines) {
//       doc.text(line, left, y);
//       y += 13;
//     }
//     doc.text(COMPANY.country, left, y);
//     y += 16;

//     // GSTIN, PAN, Email
//     doc.fontSize(8).fillColor(MID_GRAY);
//     doc.text(`GSTIN : ${COMPANY.gstin}`, left, y);
//     y += 11;
//     doc.text(`PAN : ${COMPANY.pan}, CIN : ${COMPANY.cin}`, left, y);
//     y += 11;
//     doc.text(`Email: ${COMPANY.email}`, left, y);

//     // ── Invoice No & Date — right side ──
//     const metaX = right - 190;
//     const metaY = companyTop;

//     // Background box
//     doc
//       .roundedRect(metaX - 10, metaY - 6, 200, 56, 4)
//       .fillColor(LIGHTER_GRAY)
//       .fill();

//     // Invoice No
//     doc.font("Helvetica").fontSize(8).fillColor(MID_GRAY);
//     doc.text("Invoice No", metaX, metaY);
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(11)
//       .fillColor(BLACK)
//       .text(data.invoiceNo, metaX, metaY + 12);

//     // Date
//     doc.font("Helvetica").fontSize(8).fillColor(MID_GRAY);
//     doc.text("Date", metaX + 110, metaY);
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(11)
//       .fillColor(BLACK)
//       .text(formatDate(data.invoiceDate), metaX + 110, metaY + 12);

//     y += 22;

//     // ══════════════════════════════════════
//     // INVOICE TO (Buyer)
//     // ══════════════════════════════════════
//     doc
//       .strokeColor(LIGHT_GRAY)
//       .lineWidth(0.5)
//       .moveTo(left, y)
//       .lineTo(right, y)
//       .stroke();
//     y += 16;

//     doc.font("Helvetica").fontSize(8).fillColor(MID_GRAY);
//     doc.text("INVOICE TO", left, y);
//     y += 14;

//     const buyer = data.buyer || {};

//     doc.font("Helvetica-Bold").fontSize(12).fillColor(BLACK);
//     doc.text(buyer.name || "", left, y);
//     y += 16;

//     doc.font("Helvetica").fontSize(9.5).fillColor(DARK_GRAY);
//     const addressLines = (buyer.address || "").split("\n");
//     for (const line of addressLines) {
//       const trimmed = line.trim();
//       if (trimmed) {
//         doc.text(trimmed, left, y);
//         y += 13;
//       }
//     }
//     if (buyer.country) {
//       doc.text(buyer.country, left, y);
//       y += 13;
//     }

//     y += 10;

//     // ══════════════════════════════════════
//     // LINE ITEMS TABLE
//     // ══════════════════════════════════════
//     const lineItems = data.lineItems || [];
//     const currency = data.currency || "USD";
//     const totalAmount = data.totalAmount || 0;

//     // Column definitions
//     const cols = [
//       { label: "Sr No.", width: 45, align: "center" },
//       {
//         label: "Description",
//         width: contentWidth - 45 - 90 - 100,
//         align: "left",
//       },
//       { label: "Purpose Code", width: 90, align: "center" },
//       { label: `Total (${currency})`, width: 100, align: "right" },
//     ];

//     const rowHeight = 30;
//     const headerHeight = 32;

//     // ── Header row ──
//     let xPos = left;
//     doc
//       .rect(left, y, contentWidth, headerHeight)
//       .fillColor(BLACK)
//       .fill();

//     doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
//     xPos = left;
//     for (const col of cols) {
//       const textX =
//         col.align === "center"
//           ? xPos + col.width / 2
//           : col.align === "right"
//           ? xPos + col.width - 8
//           : xPos + 8;
//       const textOpts =
//         col.align === "center"
//           ? { width: col.width, align: "center" }
//           : col.align === "right"
//           ? { width: col.width - 8, align: "right" }
//           : {};

//       if (col.align === "center") {
//         doc.text(col.label, xPos, y + 10, {
//           width: col.width,
//           align: "center",
//         });
//       } else if (col.align === "right") {
//         doc.text(col.label, xPos, y + 10, {
//           width: col.width - 8,
//           align: "right",
//         });
//       } else {
//         doc.text(col.label, xPos + 8, y + 10);
//       }
//       xPos += col.width;
//     }

//     y += headerHeight;

//     // ── Data rows ──
//     for (let i = 0; i < lineItems.length; i++) {
//       const item = lineItems[i];

//       // Alternating row background
//       if (i % 2 === 1) {
//         doc
//           .rect(left, y, contentWidth, rowHeight)
//           .fillColor("#fafbfc")
//           .fill();
//       }

//       doc.font("Helvetica").fontSize(9).fillColor(DARK_GRAY);

//       xPos = left;

//       // Sr No
//       doc.text(String(item.srNo || i + 1), xPos, y + 9, {
//         width: cols[0].width,
//         align: "center",
//       });
//       xPos += cols[0].width;

//       // Description
//       doc.text(item.description || "", xPos + 8, y + 9, {
//         width: cols[1].width - 16,
//       });
//       xPos += cols[1].width;

//       // Purpose Code
//       doc.text(item.purposeCode || "", xPos, y + 9, {
//         width: cols[2].width,
//         align: "center",
//       });
//       xPos += cols[2].width;

//       // Total
//       doc.text(formatAmount(item.total || 0), xPos, y + 9, {
//         width: cols[3].width - 8,
//         align: "right",
//       });

//       // Bottom line
//       doc
//         .strokeColor(LIGHT_GRAY)
//         .lineWidth(0.3)
//         .moveTo(left, y + rowHeight)
//         .lineTo(right, y + rowHeight)
//         .stroke();

//       y += rowHeight;
//     }

//     // ── Total row ──
//     doc
//       .rect(left, y, contentWidth, rowHeight + 4)
//       .fillColor(LIGHTER_GRAY)
//       .fill();

//     doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK);

//     // "TOTAL" label
//     doc.text("TOTAL", left + cols[0].width + 8, y + 10);

//     // Total amount
//     doc.text(formatAmount(totalAmount), left + contentWidth - cols[3].width, y + 10, {
//       width: cols[3].width - 8,
//       align: "right",
//     });

//     // Bottom border
//     doc
//       .strokeColor(BLACK)
//       .lineWidth(1)
//       .moveTo(left, y + rowHeight + 4)
//       .lineTo(right, y + rowHeight + 4)
//       .stroke();

//     y += rowHeight + 24;

//     // ══════════════════════════════════════
//     // BANK DETAILS
//     // ══════════════════════════════════════
//     doc
//       .strokeColor(LIGHT_GRAY)
//       .lineWidth(0.5)
//       .moveTo(left, y)
//       .lineTo(right, y)
//       .stroke();
//     y += 14;

//     doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BLACK);
//     doc.text(
//       "KINDLY REMIT FUNDS TO OUR BANK AS PER FOLLOWING DETAILS",
//       left,
//       y
//     );
//     y += 18;

//     // ── Beneficiary (left column) ──
//     const bankLeftX = left;
//     const bankRightX = left + contentWidth / 2 + 20;
//     let bankY = y;

//     const beneficiaryRows = [
//       ["BENEFICIARY ACCOUNT NAME", BANK.beneficiary.accountName],
//       ["BENEFICIARY ACCOUNT NUMBER", BANK.beneficiary.accountNumber],
//       ["BENEFICIARY ADDRESS", BANK.beneficiary.address],
//       ["BENEFICIARY BANK NAME", BANK.beneficiary.bankName],
//       ["BENEFICIARY BANK ADDRESS", BANK.beneficiary.bankAddress],
//       ["IFSC", BANK.beneficiary.ifsc],
//       ["SWIFT CODE", BANK.beneficiary.swift],
//     ];

//     for (const [label, value] of beneficiaryRows) {
//       doc.font("Helvetica").fontSize(7).fillColor(MID_GRAY);
//       doc.text(label, bankLeftX, bankY);
//       bankY += 10;
//       doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK_GRAY);
//       doc.text(value, bankLeftX, bankY, {
//         width: contentWidth / 2 - 10,
//       });
//       bankY += 14;
//     }

//     // ── Intermediary bank (right column) ──
//     let interY = y;

//     doc.font("Helvetica-Bold").fontSize(8).fillColor(BLACK);
//     doc.text("INTERMEDIARY / CORRESPONDENT BANK", bankRightX, interY);
//     interY += 16;

//     const intermediaryRows = [
//       ["BANK NAME", BANK.intermediary.bankName],
//       ["NOSTRO ACCOUNT NUMBER", BANK.intermediary.nostroAccount],
//       ["SWIFT CODE", BANK.intermediary.swift],
//     ];

//     for (const [label, value] of intermediaryRows) {
//       doc.font("Helvetica").fontSize(7).fillColor(MID_GRAY);
//       doc.text(label, bankRightX, interY);
//       interY += 10;
//       doc.font("Helvetica-Bold").fontSize(8.5).fillColor(DARK_GRAY);
//       doc.text(value, bankRightX, interY);
//       interY += 14;
//     }

//     // ══════════════════════════════════════
//     // SIGNATURE AREA
//     // ══════════════════════════════════════
//     const sigY = Math.max(bankY, interY) + 16;

//     doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK);
//     doc.text("FOR JNITIN GLOBAL LLP", right - 160, sigY, {
//       width: 160,
//       align: "right",
//     });

//     doc
//       .strokeColor(LIGHT_GRAY)
//       .lineWidth(0.5)
//       .moveTo(right - 150, sigY + 36)
//       .lineTo(right, sigY + 36)
//       .stroke();

//     doc.font("Helvetica").fontSize(8).fillColor(MID_GRAY);
//     doc.text("AUTHORISED SIGNATORY", right - 160, sigY + 42, {
//       width: 160,
//       align: "right",
//     });

//     doc.end();
//   });
// }

// // ═════════════════════════════════════════════════════════════
// // POST /generate-invoice
// // ═════════════════════════════════════════════════════════════
// router.post("/generate-invoice", async (req, res) => {
//   try {
//     const createdBy = req.query.createdBy || "Unknown";
//     const data = req.body;

//     // ── Validation ──
//     if (!data.invoiceNo || !data.invoiceNo.trim()) {
//       return res.status(400).json({ error: "Invoice number is required." });
//     }
//     if (!data.invoiceDate) {
//       return res.status(400).json({ error: "Invoice date is required." });
//     }
//     if (!data.buyer || !data.buyer.id) {
//       return res.status(400).json({ error: "Buyer is required." });
//     }
//     if (!data.lineItems || data.lineItems.length === 0) {
//       return res.status(400).json({ error: "At least one line item is required." });
//     }

//     // ── Generate PDF buffer ──
//     const pdfBuffer = await generateInvoicePDF(data);

//     // ── Upload PDF to Supabase Storage ──
//     const fileName = `invoices/${data.invoiceNo.replace(/[^a-zA-Z0-9\-]/g, "_")}_${Date.now()}.pdf`;

//     const { data: uploadData, error: uploadError } = await supabase.storage
//       .from("invoice-documents")
//       .upload(fileName, pdfBuffer, {
//         contentType: "application/pdf",
//         upsert: false,
//       });

//     if (uploadError) {
//       console.error("Storage upload error:", uploadError);
//       return res.status(500).json({ error: "Failed to upload invoice PDF." });
//     }

//     // ── Get public/signed URL ──
//     const { data: urlData } = supabase.storage
//       .from("invoice-documents")
//       .getPublicUrl(fileName);

//     const downloadUrl = urlData?.publicUrl || null;

//     // ── Save record to database ──
//     const { data: record, error: dbError } = await supabase
//       .from("invoices")
//       .insert({
//         invoice_no: data.invoiceNo.trim(),
//         invoice_date: data.invoiceDate,
//         buyer_org_id: data.buyer.id,
//         buyer_name: data.buyer.name,
//         buyer_address: data.buyer.address,
//         buyer_country: data.buyer.country,
//         line_items: data.lineItems,
//         total_amount: data.totalAmount,
//         currency: data.currency || "USD",
//         pdf_path: fileName,
//         pdf_url: downloadUrl,
//         created_by: createdBy,
//       })
//       .select()
//       .single();

//     if (dbError) {
//       console.error("DB insert error:", dbError);
//       // PDF was uploaded successfully, but DB insert failed
//       return res.status(500).json({
//         error: "Invoice PDF generated but failed to save record.",
//         downloadUrl, // still provide the PDF
//       });
//     }

//     return res.json({
//       success: true,
//       invoiceId: record.id,
//       downloadUrl,
//       message: "Invoice generated successfully.",
//     });
//   } catch (error) {
//     console.error("Invoice generation error:", error);
//     return res.status(500).json({ error: "Internal server error." });
//   }
// });


// const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // e.g. "my-store.myshopify.com"
// const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// // Month mapping (column indices in the sheet)
// const MONTHS = [
//   { month: "Apr 2025", countCol: 1, valueCol: 2 },
//   { month: "May 2025", countCol: 3, valueCol: 4 },
//   { month: "Jun 2025", countCol: 5, valueCol: 6 },
//   { month: "Jul 2025", countCol: 7, valueCol: 8 },
//   { month: "Aug 2025", countCol: 9, valueCol: 10 },
//   { month: "Sep 2025", countCol: 11, valueCol: 12 },
//   { month: "Oct 2025", countCol: 13, valueCol: 14 },
//   { month: "Nov 2025", countCol: 15, valueCol: 16 },
//   { month: "Dec 2025", countCol: 17, valueCol: 18 },
//   { month: "Jan 2026", countCol: 19, valueCol: 20 },
//   { month: "Feb 2026", countCol: 21, valueCol: 22 },
//   { month: "Mar 2026", countCol: 23, valueCol: 24 },
// ];

// /**
//  * Fetch the shop metafield "poCountandValue" from Shopify,
//  * download the file, and parse it as an Excel workbook.
//  */
// async function getExcelFromMetafield() {
//   // Step 1: Fetch the shop metafield by key
//   const metafieldRes = await fetch(
//     `https://${SHOPIFY_STORE}/admin/api/2024-01/metafields.json?namespace=custom&key=poCountandValue`,
//     {
//       headers: {
//         "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
//         "Content-Type": "application/json",
//       },
//     }
//   );

//   if (!metafieldRes.ok) {
//     throw new Error(`Failed to fetch metafield: ${metafieldRes.status} ${metafieldRes.statusText}`);
//   }

//   const { metafields } = await metafieldRes.json();

//   if (!metafields || metafields.length === 0) {
//     throw new Error('Shop metafield "poCountandValue" not found.');
//   }

//   const metafield = metafields[0];

//   // Step 2: Determine the file URL
//   // If the metafield type is "file_reference", the value is a GID like
//   // "gid://shopify/GenericFile/12345" — resolve via GraphQL
//   let fileUrl;

//   if (metafield.type === "file_reference") {
//     fileUrl = await resolveFileUrl(metafield.value);
//   } else {
//     // If stored as a direct URL string
//     fileUrl = metafield.value;
//   }

//   // Step 3: Download the Excel file
//   const fileRes = await fetch(fileUrl);
//   if (!fileRes.ok) {
//     throw new Error(`Failed to download Excel file: ${fileRes.status}`);
//   }

//   const arrayBuffer = await fileRes.arrayBuffer();
//   const buffer = Buffer.from(arrayBuffer);

//   // Step 4: Parse with XLSX
//   const workbook = XLSX.read(buffer, { type: "buffer" });
//   return workbook;
// }

// /**
//  * Resolve a Shopify file GID to a download URL using the GraphQL Admin API.
//  */
// async function resolveFileUrl(gid) {
//   const query = `
//     {
//       node(id: "${gid}") {
//         ... on GenericFile {
//           url
//         }
//         ... on MediaImage {
//           image {
//             url
//           }
//         }
//       }
//     }
//   `;

//   const graphqlRes = await fetch(
//     `https://${SHOPIFY_STORE}/admin/api/2024-01/graphql.json`,
//     {
//       method: "POST",
//       headers: {
//         "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ query }),
//     }
//   );

//   if (!graphqlRes.ok) {
//     throw new Error(`GraphQL request failed: ${graphqlRes.status}`);
//   }

//   const { data } = await graphqlRes.json();

//   const url = data?.node?.url || data?.node?.image?.url;
//   if (!url) {
//     throw new Error("Could not resolve file URL from metafield GID.");
//   }

//   return url;
// }

// /**
//  * GET /api/buyer/:buyerName
//  *
//  * Fetches the Excel from the Shopify shop metafield "poCountandValue",
//  * finds the buyer row, and returns monthly count & value.
//  *
//  * Example: GET /api/buyer/NKUKU
//  *
//  * Response:
//  * {
//  *   "success": true,
//  *   "buyer": "NKUKU",
//  *   "totalCount": 86,
//  *   "totalValue": 570893.22,
//  *   "monthly": [
//  *     { "month": "Apr 2025", "count": 0, "value": 0 },
//  *     { "month": "May 2025", "count": 0, "value": 0 },
//  *     ...
//  *   ]
//  * }
//  */
// router.get("po-count-value/:buyerName", async (req, res) => {
//   try {
//     const buyerName = req.params.buyerName.trim();

//     // Fetch & parse the Excel from Shopify metafield
//     const workbook = await getExcelFromMetafield();
//     const sheet = workbook.Sheets[workbook.SheetNames[0]];
//     const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: 0 });

//     // Find buyer row (case-insensitive match, skip header)
//     const buyerRow = data.slice(1).find(
//       (row) =>
//         row[0] &&
//         row[0].toString().trim().toLowerCase() === buyerName.toLowerCase()
//     );

//     if (!buyerRow) {
//       return res.status(404).json({
//         success: false,
//         message: `Buyer "${buyerName}" not found.`,
//         availableBuyers: data
//           .slice(1)
//           .filter((r) => r[0] && r[0] !== "Total")
//           .map((r) => r[0]),
//       });
//     }

//     // Build monthly breakdown
//     const monthlyData = MONTHS.map(({ month, countCol, valueCol }) => ({
//       month,
//       count: buyerRow[countCol] || 0,
//       value: buyerRow[valueCol] || 0,
//     }));

//     const totalCount = monthlyData.reduce((sum, m) => sum + m.count, 0);
//     const totalValue = monthlyData.reduce((sum, m) => sum + m.value, 0);

//     return res.json({
//       success: true,
//       buyer: buyerRow[0],
//       totalCount,
//       totalValue: Math.round(totalValue * 100) / 100,
//       monthly: monthlyData,
//     });
//   } catch (err) {
//     console.error("Error:", err.message);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// });


// module.exports = router;

const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");
const express = require("express");

// Month mapping (column indices in the sheet)
const MONTHS = [
  { month: "Apr 2025", countCol: 1, valueCol: 2 },
  { month: "May 2025", countCol: 3, valueCol: 4 },
  { month: "Jun 2025", countCol: 5, valueCol: 6 },
  { month: "Jul 2025", countCol: 7, valueCol: 8 },
  { month: "Aug 2025", countCol: 9, valueCol: 10 },
  { month: "Sep 2025", countCol: 11, valueCol: 12 },
  { month: "Oct 2025", countCol: 13, valueCol: 14 },
  { month: "Nov 2025", countCol: 15, valueCol: 16 },
  { month: "Dec 2025", countCol: 17, valueCol: 18 },
  { month: "Jan 2026", countCol: 19, valueCol: 20 },
  { month: "Feb 2026", countCol: 21, valueCol: 22 },
  { month: "Mar 2026", countCol: 23, valueCol: 24 },
];

/**
 * GET /api/po-count-value/:buyerName
 *
 * Reads the Excel file from the local public folder,
 * finds the buyer row, and returns monthly count & value.
 *
 * Example: GET /api/po-count-value/NKUKU
 */

const router = express.Router();

router.get("/po-count-value/:buyerName", async (req, res) => {
  try {
    const buyerName = req.params.buyerName.trim();

    // Read the Excel file from /public in the project root
    const filePath = path.join(__dirname, "..", "public", "openpos.xlsx");

    if (!fs.existsSync(filePath)) {
      return res.status(500).json({
        success: false,
        message: `Excel file not found at ${filePath}. Make sure poCountandValue.xlsx is in the /public folder.`,
      });
    }

    const workbook = XLSX.read(filePath, { type: "file" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: 0 });

    // Find buyer row (case-insensitive match, skip header)
    const buyerRow = data.slice(1).find(
      (row) =>
        row[0] &&
        row[0].toString().trim().toLowerCase() === buyerName.toLowerCase()
    );

    if (!buyerRow) {
      return res.status(404).json({
        success: false,
        message: `Buyer "${buyerName}" not found.`,
        availableBuyers: data
          .slice(1)
          .filter((r) => r[0] && r[0] !== "Total")
          .map((r) => r[0]),
      });
    }

    // Build monthly breakdown
    const monthlyData = MONTHS.map(({ month, countCol, valueCol }) => ({
      month,
      count: buyerRow[countCol] || 0,
      value: buyerRow[valueCol] || 0,
    }));

    const totalCount = monthlyData.reduce((sum, m) => sum + m.count, 0);
    const totalValue = monthlyData.reduce((sum, m) => sum + m.value, 0);

    return res.json({
      success: true,
      buyer: buyerRow[0],
      totalCount,
      totalValue: Math.round(totalValue * 100) / 100,
      monthly: monthlyData,
    });
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/po-count-value/all", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "..", "public", "openpos.xlsx");

    if (!fs.existsSync(filePath)) {
      return res.status(500).json({ success: false, message: `Excel file not found.` });
    }

    // Expect comma-separated buyer names: ?buyers=NKUKU,HOUSE DOCTOR
    const allowedBuyers = req.query.buyers
      ? req.query.buyers.split(',').map(b => b.trim().toUpperCase()).filter(Boolean)
      : [];

    if (!allowedBuyers.length) {
      return res.status(400).json({ success: false, message: 'No buyers specified.' });
    }

    const workbook = XLSX.read(filePath, { type: "file" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: 0 });

    const buyerBreakdown = {};

    data.slice(1).forEach(row => {
      const name = row[0]?.toString().trim();
      if (!name || name.toLowerCase() === 'total') return;
      if (!allowedBuyers.includes(name.toUpperCase())) return; // filter here

      buyerBreakdown[name] = MONTHS.map(({ month, countCol, valueCol }) => ({
        month,
        count: row[countCol] || 0,
        value: row[valueCol] || 0,
      }));
    });

    return res.json({ success: true, buyerBreakdown });

  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;