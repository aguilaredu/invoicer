# Invoice Sending System

This project is an automated system for generating PDF invoices from a CSV file and sending them to clients via WhatsApp.

The system is composed of two main microservices: a Python-based PDF generator and a Node.js-based WhatsApp sender.

## Core Components

### 1. PDF Generator (`services/pdf-generator`)

*   **Language**: Python
*   **Functionality**: This service reads client and invoice data from `shared-data/input.csv`. It uses a Jinja2 template (`invoice_template/`) and the WeasyPrint library to generate PDF invoices.
*   **Output**: It saves the generated PDFs to the `shared-data/pdfs/` directory and creates a `shared-data/output.json` file, which acts as a queue for the sending service.

### 2. WhatsApp Sender (`services/whatsapp-sender`)

*   **Language**: Node.js
*   **Functionality**: This service reads the `shared-data/output.json` queue. It uses the `whatsapp-web.js` library to connect to WhatsApp, requiring a QR code scan for authentication on the first run.
*   **Output**: It sends the corresponding PDF invoice and a customized message to each client based on their payment status. It logs the status of each message (Sent, Skipped, Failed) to the console.

## Basic Workflow

1.  **Populate Data**: Add your client and invoice information to the `shared-data/input.csv` file. You can use `shared-data/input.csv.example` as a reference.
2.  **Generate Invoices**: Run the `pdf-generator` service. This will create the PDFs and the `output.json` sending queue.
3.  **Send Invoices**: Run the `whatsapp-sender` service. You will need to scan a QR code with your phone to log in to WhatsApp. The service will then begin sending the invoices.
