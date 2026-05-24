@echo off
title NHGOne - Development Environment
echo ==========================================
echo    NHGOne Development Environment
echo ==========================================
echo.
echo [1/2] Starting FastAPI Backend (Port 8000)...
start "NHGOne Backend" cmd /k "cd /d %~dp0api && py -m uvicorn app.main:app --port 8000 --reload"

echo [2/2] Starting Next.js Frontend (Port 3000)...
timeout /t 2 /nobreak >nul
start "NHGOne Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo ==========================================
echo  Both servers are starting...
echo  Backend:  http://localhost:8000
echo  Frontend: http://localhost:3000
echo ==========================================
echo.
echo Press any key to open the app in browser...
pause >nul
start http://localhost:3000
