@echo off
chcp 65001 > nul
title Screen Mirror Pro Launcher
echo ========================================================
echo   DANG KHOI DONG APP CHIEU MAN HINH DIEN THOAI LEN PC
echo ========================================================
echo Dang khoi dong may chu va mo trinh duyet...
start /min powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
echo Ung dung mo tai http://localhost:8080 (hoac http://localhost:8081 neu cong 8080 ban)
timeout /t 3 > nul
exit
