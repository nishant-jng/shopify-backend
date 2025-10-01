const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

// Main function to run our logic
async function main() {
  if (!process.env.SERVICE || process.env.SERVICE.length < 100) {
    console.error("Firebase config error: SERVICE environment variable is not defined or is too short.");
    return; // Exit if the variable isn't set
  }

  try {
    const serviceAccountJson = Buffer.from(process.env.SERVICE, "base64").toString("utf8");
    const serviceAccount = JSON.parse(serviceAccountJson);

    // *** ADD THIS LOGGING ***
    // Log the key details to manually verify them
    console.log("--- Service Account Details ---");
    console.log("Project ID:", serviceAccount.project_id);
    console.log("Client Email:", serviceAccount.client_email);
    console.log("-----------------------------");

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // projectId is automatically inferred from the credential, but explicitly setting it is fine
        projectId: serviceAccount.project_id, 
        // *** VERY LIKELY THE FIX IS HERE ***
        databaseId: '(default)' // Or 'jng-app' if you are 100% sure you created a named database
      });
    }

    const db = admin.firestore();

    console.log(`Attempting to connect to Firebase project: ${serviceAccount.project_id}`);
    console.log(`Using database: ${db.databaseId}`); // Log the actual databaseId being used

    // Test the connection by trying to add a document
    const docRef = await db.collection('connection_tests').add({
      timestamp: new Date().toISOString(),
      message: 'Connection successful'
    });

    console.log("✅ Firebase connection successful! Document written with ID:", docRef.id);

  } catch (error) {
    console.error("❌ Firebase connection failed:", error);
    if (error.code === 5) {
        console.error("\n--- DEBUG INFO for NOT_FOUND error ---");
        console.error("1. Did you verify the 'databaseId' in your code matches the one in the Google Cloud Console (it's usually '(default)')?");
        console.error("2. Does the service account have the 'Cloud Datastore User' or 'Editor' role in IAM?");
        console.error("3. Is the 'Cloud Firestore API' enabled for this project?");
        console.error("--------------------------------------\n");
    }
  }
}

// Run the main function
main();