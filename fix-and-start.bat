@echo off
echo ========================================
echo Fixing Zain POS Dashboard Login
echo ========================================
echo.

echo Step 1: Checking if .env file exists in dashboard...
if not exist "zain-pos-dashboard\.env" (
    echo Creating .env file...
    echo VITE_API_URL=http://localhost:3001 > zain-pos-dashboard\.env
    echo ✓ .env file created!
) else (
    echo ✓ .env file already exists!
)
echo.

echo Step 2: Creating database with admin user...
cd zain-pos-api
call npm run seed
if %errorlevel% neq 0 (
    echo ERROR: Failed to seed database
    pause
    exit /b 1
)
cd ..
echo ✓ Database seeded successfully!
echo.

echo Step 3: Starting API Server...
echo API will run on http://localhost:3001
echo.
start "Zain POS API" cmd /k "cd /d %~dp0zain-pos-api && npm run dev"
timeout /t 5 /nobreak >nul
echo ✓ API Server started!
echo.

echo Step 4: Starting Dashboard...
echo Dashboard will run on http://localhost:5173
echo.
start "Zain POS Dashboard" cmd /k "cd /d %~dp0zain-pos-dashboard && npm run dev"
timeout /t 3 /nobreak >nul
echo ✓ Dashboard started!
echo.

echo ========================================
echo ✅ ALL DONE!
echo ========================================
echo.
echo Your dashboard should open automatically.
echo If not, visit: http://localhost:5173
echo.
echo Login with:
echo   Username: admin
echo   Password: admin123
echo.
echo Press any key to close this window...
pause >nul
