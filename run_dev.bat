@echo off
REM Unset ELECTRON_RUN_AS_NODE to allow Electron API to work
set "ELECTRON_RUN_AS_NODE="
REM Ensure Node.js is in PATH (adjust path if installed elsewhere)
set "PATH=C:\Program Files\nodejs;%PATH%"

echo Starting Zain POS v3...
npm run dev
