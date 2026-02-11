#!/bin/bash

# Function to keep shell open on exit
trap 'echo "Press Enter to exit..."; read' EXIT

# 1. Print invoice_configs.yaml
CONFIG_FILE="shared-data/invoice_configs.yaml"
echo "--- Current Invoice Configuration ($CONFIG_FILE) ---"
if [ -f "$CONFIG_FILE" ]; then
    cat "$CONFIG_FILE"
else
    echo "Warning: $CONFIG_FILE not found."
fi
echo -e "\n----------------------------------------------------\n"

# 2. Run PDF Generator
echo ">>> Starting PDF Generator..."
cd services/pdf-generator || { echo "Directory services/pdf-generator not found"; exit 1; }

if command -v uv &> /dev/null; then
    uv run src/main.py
else
    echo "uv not found, attempting to run with python3..."
    python3 src/main.py
fi
PDF_EXIT_CODE=$?
cd ../..

if [ $PDF_EXIT_CODE -ne 0 ]; then
    echo "PDF Generator finished with errors."
else
    echo "PDF Generator finished successfully."
fi

# 3. Wait 5 minutes with countdown (skippable)
echo -e "\n>>> Waiting 5 minutes before sending messages..."
DURATION=300
START_TIME=$SECONDS
END_TIME=$((START_TIME + DURATION))

while [ $SECONDS -lt $END_TIME ]; do
    REMAINING=$((END_TIME - SECONDS))
    MINUTES=$((REMAINING / 60))
    SECONDS_REM=$((REMAINING % 60))

    # Print countdown on the same line
    printf "\rTime remaining: %02d:%02d - Press 'c' to skip... " $MINUTES $SECONDS_REM

    # Read user input with 1 second timeout
    read -t 1 -n 1 key
    if [[ "$key" == "c" || "$key" == "C" ]]; then
        echo -e "\nSkipping wait time."
        break
    fi
done
echo -e "\n"

# 4. Run Whatsapp Sender
echo ">>> Starting WhatsApp Sender..."
cd services/whatsapp-sender || { echo "Directory services/whatsapp-sender not found"; exit 1; }

# Clear previous session
echo "Clearing previous WhatsApp session..."
rm -rf sessions/session

if [ -f "src/index.js" ]; then
    node src/index.js
else
    echo "Error: src/index.js not found in services/whatsapp-sender"
fi
cd ../..

echo -e "\n>>> Process sequence completed."

# The trap defined at the top will handle holding the window open
