@echo off
echo Starting Zain POS Mobile Dashboard...
echo.
echo Starting API Server...
start cmd /k "cd zain-pos-api && npm run dev"
timeout /t 3 /nobreak > nul
echo.
echo Starting Dashboard...
start cmd /k "cd zain-pos-dashboard && npm run dev"
echo.
echo Both servers are starting!
echo API: http://localhost:3001
echo Dashboard: http://localhost:5173
echo.
echo Login with: admin / admin123
pause
