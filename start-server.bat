@echo off
cd /d %~dp0server
if not exist node_modules call npm install --omit=dev
node server.js
pause
