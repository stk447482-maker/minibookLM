@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================================
echo   🚀 MiniBookLM Studio PWA を起動しています...
echo ========================================================
echo.

:: 既存のポート3005の競合プロセスを解放
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3005" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a > nul 2>&1
)

:: デスクトップAPIサーバー (server.py) を最小化で起動
if exist "venv\Scripts\python.exe" (
    start "MiniBookLM API Server" /min "venv\Scripts\python.exe" server.py
) else (
    start "MiniBookLM API Server" /min python server.py
)


echo サーバー起動完了時にブラウザが自動的に開きます...
echo (終了時はこの黒い画面を閉じてください)
echo.

:: Viteネイティブの --open オプションでブラウザを自動オープン
call npm run dev -- --port 3005 --host --open
pause
