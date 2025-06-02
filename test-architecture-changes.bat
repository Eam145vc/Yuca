@echo off
echo ===================================================
echo Testing Architecture Changes - AirbnBOT
echo ===================================================
echo.
echo This script will:
echo 1. Start the server in a new terminal
echo 2. Wait for the server to initialize
echo 3. Run the dashboard access test
echo.
echo Press Ctrl+C to cancel or any key to continue...
pause > nul

echo.
echo Starting server in a new terminal...
start cmd /k "cd %CD% && npm start"

echo.
echo Waiting for server to initialize (15 seconds)...
timeout /t 15 /nobreak > nul

echo.
echo Running dashboard access test...
npm run test:dashboard

echo.
echo Test completed. You can close the server terminal when done.
echo.