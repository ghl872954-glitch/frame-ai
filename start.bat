@echo off
cd /d "%~dp0"
title frame
echo.
echo   frame - local dev server
echo.
echo   Open  http://localhost:3000  in your browser.
echo   Close this window to stop the server.
echo.
echo   (first start may take a few seconds)
echo.
npm run dev
echo.
echo   Server stopped.
pause
