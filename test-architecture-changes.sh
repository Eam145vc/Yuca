#!/bin/bash

echo "==================================================="
echo "Testing Architecture Changes - AirbnBOT"
echo "==================================================="
echo ""
echo "This script will:"
echo "1. Start the server in a new terminal"
echo "2. Wait for the server to initialize"
echo "3. Run the dashboard access test"
echo ""
echo "Press Ctrl+C to cancel or Enter to continue..."
read

echo ""
echo "Starting server in a new terminal..."

# Detect the terminal based on the platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    osascript -e 'tell app "Terminal" to do script "cd \"$(pwd)\" && npm start"'
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v gnome-terminal &> /dev/null; then
        gnome-terminal -- bash -c "cd \"$(pwd)\" && npm start; exec bash"
    elif command -v xterm &> /dev/null; then
        xterm -e "cd \"$(pwd)\" && npm start" &
    else
        echo "Could not find a suitable terminal emulator. Please start the server manually with 'npm start' in another terminal."
        exit 1
    fi
else
    echo "Unsupported platform. Please start the server manually with 'npm start' in another terminal."
    exit 1
fi

echo ""
echo "Waiting for server to initialize (15 seconds)..."
sleep 15

echo ""
echo "Running dashboard access test..."
npm run test:dashboard

echo ""
echo "Test completed. You can close the server terminal when done."
echo ""