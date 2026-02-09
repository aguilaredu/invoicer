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
  puppeteer: {
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
  try {
    // Set as online
    await client.sendPresenceAvailable();

    logStep(`${record.name}-${record.phone}`, "📱", "Validating number...");
    const sanitized_number = record.phone.toString().replace(/[- )(]/g, "");
    const final_number = `${record.countryCode}${sanitized_number}`;
    const number_details = await client.getNumberId(final_number);

    if (!number_details) {
      logStep(
        `${record.name}-${record.phone}`,
        "❌",
        "Failed (Number not on WhatsApp)",
      );
      await client.sendPresenceUnavailable();
      return "FAILED";
    }

    const chatId = number_details._serialized;
    const chat = await client.getChatById(chatId);

    // Wait before sending the message, we will wait 50s more in typing later
    const wait_time_s = randomDelay(140000, 200000);
    // const wait_time_s = randomDelay(140000, 200000);
    logStep(
      `${record.name}-${record.phone}`,
      "⏳",
      `Waiting ${wait_time_s}s...`,
    );
    await new Promise((resolve) => setTimeout(resolve, wait_time_s * 1000));

    // Simulate typing and wait 25s since that is the duration for sendStateTyping()
    // We do it twice to be extra sure, to be removed later once we are safer
    logStep(`${record.name}-${record.phone}`, "⏳", `Waiting to type 50s...`);
    chat.sendStateTyping();
    await new Promise((resolve) => setTimeout(resolve, 25000));
    chat.sendStateTyping();
    await new Promise((resolve) => setTimeout(resolve, 25000));

    logStep(`${record.name}-${record.phone}`, "📤", "Sending...");
    const filePath = path.join(PDF_DIR, record.filename);
    const media = MessageMedia.fromFilePath(filePath);
    await client.sendMessage(chatId, media, { caption: record.message });

    logStep(`${record.name}-${record.phone}`, "✅", "Sent successfully.");
    record.sent_at = new Date().toISOString();
    return "SENT";
  } catch (err) {
    logStep(
      `${record.name}-${record.phone}`,
      "❌",
      `Failed (${err.message.substring(0, 30)}...)`,
    );
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
  console.log(`📂 Loaded ${queue.length} records.\n`);

  for (let i = 0; i < queue.length; i++) {
    let record = queue[i];
    console.log("-----------------------------------");
    logStep(`${record.name}-${record.phone}`, "⚙️", "Processing...");

    if (record.status !== "PENDING") {
      logStep(
        `${record.name}-${record.phone}`,
        "⏩",
        `Skipping (Status: ${record.status})`,
      );
    } else if (record.send_receipt === false) {
      logStep(
        `${record.name}-${record.phone}`,
        "⏩",
        "Skipping (Receipt not required)",
      );
      record.status = "SKIPPED_NO_RECEIPT";
      saveProgress(queue);
    } else if (!record.phone || !record.countryCode) {
      logStep(
        `${record.name}-${record.phone}`,
        "❌",
        "Error (Phone/Country Code missing)",
      );
      record.status = "ERROR_PHONE_MISSING";
      saveProgress(queue);
    } else {
      const filePath = path.join(PDF_DIR, record.filename);
      if (!fs.existsSync(filePath)) {
        logStep(
          `${record.name}-${record.phone}`,
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
