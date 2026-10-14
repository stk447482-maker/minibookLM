@echo off
chcp 65001 > nul
cd /d "%~dp0"
title MiniBookLM All-in-One Launcher

echo ========================================================
echo   🚀 MiniBookLM 完全ワンクリック起動
echo ========================================================
echo.

:: 1. LM Studio (Port 1234) のチェック & 自動起動試行
echo [1/3] LM Studio サーバー確認中 (Port 1234)...
netstat -aon | findstr ":1234" | findstr "LISTENING" > nul
if %errorlevel% neq 0 (
    echo [INFO] LM Studio サーバーが未起動です。自動起動を試みます...
    where lms >nul 2>nul
    if %errorlevel% equ 0 (
        start /b lms server start >nul 2>nul
        timeout /t 2 /nobreak > nul
    ) else (
        echo [WARN] LM Studio が起動していない可能性があります。
        echo        ポート 1234 でサーバーを開始してください。
    )
) else (
    echo [OK] LM Studio は稼働中です。
)

:: 2. Whisper C++ サーバー (Port 8080) の自動起動
echo [2/3] Whisper C++ サーバー確認中 (Port 8080)...
netstat -aon | findstr ":8080" | findstr "LISTENING" > nul
if %errorlevel% neq 0 (
    echo [INFO] Whisper C++ サーバーをバックグラウンド起動します...
    start "Whisper-Native-Server" /min cmd /c "cd /d ""%~dp0"" && set ""PATH=%~dp0tools\whisper\Release;%PATH%"" && start_whisper_server.bat"
    timeout /t 3 /nobreak > nul
) else (
    echo [OK] Whisper サーバーは既に稼働しています。
)

:: 3. MiniBookLM 起動 ＆ ブラウザ自動オープン
echo [3/3] MiniBookLM を起動し、ブラウザを自動で開きます...
echo.
echo ※ 終了時はこのウィンドウを閉じてください。
echo ========================================================
echo.

call npm run dev -- --port 3005 --open
pause
