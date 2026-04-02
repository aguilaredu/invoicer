const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

// --- 0. CUSTOMIZABLE WAITS ---
const WAIT_ENABLED = true;
const WAIT_AFTER_N_RECORDS = 10;
const WAIT_TIME_MIN_S = 8 * 60;
const WAIT_TIME_MAX_S = 12 * 60;
const WAIT_MSG_MIN_S = 2 * 60;
const WAIT_MSG_MAX_S = 4 * 60;

// --- 1. CONFIGURATION & SETUP ---
const SHARED_DIR = path.join(__dirname, "../../../shared-data");
const DATA_FILE = path.join(SHARED_DIR, "output.json");
const PDF_DIR = path.join(SHARED_DIR, "pdfs");
const SESSIONS_DIR = path.join(__dirname, "../sessions");

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// --- 2. WHATSAPP CLIENT INITIALIZATION ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSIONS_DIR }),
  puppeteer: {
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.clear();
  console.log("Scan the QR code below to log in.");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.clear();
  console.log("✅ Client is ready!");
  await processQueue(client);
  console.log("\n🎉 All records processed.");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failure:", msg);
  process.exit(1);
});

client.initialize();

// --- 3. MODULAR COMPONENTS ---

/**
 * A simple logger to format messages consistently.
 * @param {string} name The name of the record being processed.
 * @param {string} emoji The emoji for the status.
 * @param {string} message The log message.
 */
const logStep = (name, emoji, message) => {
  console.log(`[${name}] ${emoji} ${message}`);
};

/**
 * Processes a single record from the queue.
 * @param {object} record The invoice record to process.
 * @param {Client} client The WhatsApp client instance.
 * @returns {string} The final status ('SENT' or 'FAILED').
 */
async function processRecord(record, client) {
  // Validate the number and set as online
  await client.sendPresenceAvailable(); // Set as online
  let rec_name = `${record.name}-${record.phone}`;
  logStep(rec_name, "📱", "Validating number...");
  const sanitized_number = record.phone.toString().replace(/[- )(]/g, "");
  const final_number = `${record.countryCode}${sanitized_number}`;
  const number_details = await client.getNumberId(final_number);

  if (!number_details) {
    logStep(rec_name, "❌", "Failed (Number not on WhatsApp)");
    await client.sendPresenceUnavailable();
    return "FAILED_NOT_ON_WHATSAPP";
  }

  // Wait before sending the message, we will wait 50s more in typing later
  const wait_time_s = randomDelay(WAIT_MSG_MIN_S, WAIT_MSG_MAX_S);
  logStep(rec_name, "⏳", `Waiting ${wait_time_s / 1000}s...`);
  await new Promise((resolve) => setTimeout(resolve, wait_time_s));

  // Simulate typing and wait 25s since that is the duration for sendStateTyping()
  // We do it twice to be extra sure, to be removed later once we are safer
  logStep(rec_name, "⏳", `Waiting to type 50s...`);
  const chatId = number_details._serialized;
  const chat = await client.getChatById(chatId);
  chat.sendStateTyping();
  await new Promise((resolve) => setTimeout(resolve, 25000));
  chat.sendStateTyping();
  await new Promise((resolve) => setTimeout(resolve, 25000));

  // Send the message
  logStep(rec_name, "📤", "Sending...");
  const filePath = path.join(PDF_DIR, record.filename);
  const media = MessageMedia.fromFilePath(filePath);

  try {
    await client.sendMessage(chatId, media, { caption: record.message });
    logStep(rec_name, "✅", "Sent successfully.");
    record.sent_at = new Date().toISOString();
    return "SENT";
  } catch (err) {
    logStep(rec_name, "❌", `Failed to send (${err.message})`);
    record.error_msg = err.message;
    client.sendPresenceUnavailable();
    return "FAILED";
  }
}

// --- 4. MAIN ORCHESTRATOR ---

/**
 * Orchestrates the entire invoice sending process.
 */
async function processQueue(client) {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ Data file missing: ${DATA_FILE}`);
    return;
  }

  let queue = JSON.parse(fs.readFileSync(DATA_FILE));
  let queue_len = queue.length;
  console.log(`📂 Loaded ${queue_len} records.\n`);
  let skipped_records = 0;
  let processed_records = 0;

  for (let i = 0; i < queue_len; i++) {
    // Keep track of total records processed

    let total_recs_process = skipped_records + processed_records + 1;

    // Log
    logStep("SYSTEM", "ℹ️", `Processed ${total_recs_process} of ${queue_len}`);

    // The record we are going to process
    let rec = queue[i];
    let rec_name = `${rec.name}-${rec.phone}`;
    let rec_stat = rec.status;
    let rec_send = rec.send_receipt;
    let rec_phone = rec.phone;
    let rec_ccode = rec.countryCode;
    let rec_filename = rec.filename;
    let rec_filepath = path.join(PDF_DIR, rec_filename);
    let file_exists = fs.existsSync(rec_filepath);

    // Early stopping conditions that don't send a message
    if (rec.status !== "PENDING") {
      logStep(rec_name, "⏩", `Skipping (Status: ${rec_stat})`);
      skipped_records += 1;
      continue;
    }

    if (rec_send === false) {
      logStep(rec_name, "⏩", "Skipping (Receipt not required)");
      rec.status = "SKIPPED_NO_RECEIPT";
      saveProgress(queue);
      skipped_records += 1;
      continue;
    }

    if (!rec_phone || !rec_ccode) {
      logStep(rec_name, "❌", "Error (Phone/Country Code missing)");
      rec.status = "ERROR_PHONE_MISSING";
      saveProgress(queue);
      skipped_records += 1;
      continue;
    }

    if (!file_exists) {
      logStep(rec_name, "❌", `Error (PDF file missing: ${rec_filename})`);
      rec.status = "ERROR_FILE_MISSING";
      saveProgress(queue);
      skipped_records += 1;
      continue;
    }

    try {
      // 1. Handle Batch Waiting
      // If batchWait fails (e.g., internal timer error), it goes to catch
      await batchWait(processed_records);

      // 2. Process the Record
      // We assume processRecord is async and returns "SENT", "FAILED", etc.
      const finalStatus = await processRecord(rec, client);

      rec.status = finalStatus;
      processed_records += 1;

      // 3. Save Progress
      // Doing this before the exit check ensures we record the failure status
      saveProgress(queue);

      // 4. Exit on Logical Failure ("FAILED" status returned)
      if (finalStatus === "FAILED") {
        logStep(rec.name, "🛑", "Failure stopping.");
        break; // Hard exit to stop the bash script entirely
      }
    } catch (error) {
      // 5. Exit on Execution "Breakage" (Code crashes)
      logStep("SYSTEM", "💥", `CRITICAL ERROR: ${error.message}`);

      // Save progress one last time if possible before dying
      try {
        saveProgress(queue);
      } catch (e) {
        /* ignore secondary error */
      }

      console.error("Script execution broke. Terminating process...");
      break;
    }
  }
}

// --- 5. UTILITY FUNCTIONS ---

function saveProgress(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function randomDelay(min, max) {
  const s = Math.floor(Math.random() * (max - min + 1) + min);
  return (s * 1000).toFixed(1);
}

/**
 * Handles batch waiting logic to prevent rate-limiting.
 * @param {number} currentCount - The number of records processed so far.
 */
async function batchWait(currentCount) {
  // Check if waiting is enabled and if we've reached the Nth record
  if (
    WAIT_ENABLED &&
    currentCount > 0 &&
    currentCount % WAIT_AFTER_N_RECORDS === 0
  ) {
    const wait_time_ms = randomDelay(WAIT_TIME_MIN_S, WAIT_TIME_MAX_S);

    logStep(
      "SYSTEM",
      "😴",
      `Waiting for ${wait_time_ms / 1000}s before the next batch...`,
    );

    // Create a promise that resolves after the calculated milliseconds
    await new Promise((resolve) => setTimeout(resolve, wait_time_ms));
  }
}
