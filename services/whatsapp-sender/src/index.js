const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

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
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
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
  try {
    logStep(record.name, "📱", "Validating number...");
    const sanitized_number = record.phone.toString().replace(/[- )(]/g, "");
    const final_number = `${record.countryCode}${sanitized_number}`;
    const number_details = await client.getNumberId(final_number);

    if (!number_details) {
      logStep(record.name, "❌", "Failed (Number not on WhatsApp)");
      return "FAILED";
    }

    const chatId = number_details._serialized;
    const wait_time_s = randomDelay(2000, 5000);
    logStep(record.name, "⏳", `Waiting ${wait_time_s}s...`);
    await new Promise((resolve) => setTimeout(resolve, wait_time_s * 1000));

    logStep(record.name, "📤", "Sending...");
    const filePath = path.join(PDF_DIR, record.filename);
    const media = MessageMedia.fromFilePath(filePath);
    await client.sendMessage(chatId, media, { caption: record.message });

    logStep(record.name, "✅", "Sent successfully.");
    record.sent_at = new Date().toISOString();
    return "SENT";
  } catch (err) {
    logStep(record.name, "❌", `Failed (${err.message.substring(0, 30)}...)`);
    record.error_msg = err.message;
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
  console.log(`📂 Loaded ${queue.length} records.\n`);

  for (let i = 0; i < queue.length; i++) {
    let record = queue[i];
    console.log("-----------------------------------");
    logStep(record.name, "⚙️", "Processing...");

    if (record.status !== "PENDING") {
      logStep(record.name, "⏩", `Skipping (Status: ${record.status})`);
    } else if (record.send_receipt === false) {
      logStep(record.name, "⏩", "Skipping (Receipt not required)");
      record.status = "SKIPPED_NO_RECEIPT";
      saveProgress(queue);
    } else if (!record.phone || !record.countryCode) {
      logStep(record.name, "❌", "Error (Phone/Country Code missing)");
      record.status = "ERROR_PHONE_MISSING";
      saveProgress(queue);
    } else {
      const filePath = path.join(PDF_DIR, record.filename);
      if (!fs.existsSync(filePath)) {
        logStep(
          record.name,
          "❌",
          `Error (PDF file missing: ${record.filename})`,
        );
        record.status = "ERROR_FILE_MISSING";
        saveProgress(queue);
      } else {
        const finalStatus = await processRecord(record, client);
        record.status = finalStatus;
        saveProgress(queue);
      }
    }
  }
}

// --- 5. UTILITY FUNCTIONS ---

function saveProgress(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return (ms / 1000).toFixed(1);
}
