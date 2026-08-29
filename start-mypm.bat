@echo off
cd /d "%~dp0app"
npx tsx src/index.ts >> ..\logs\mypm-run.log 2>&1
