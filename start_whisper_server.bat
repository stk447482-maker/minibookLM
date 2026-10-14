@echo off
chcp 65001 > nul
title Whisper Large-v3 C++ Native Server (Port 8080)
echo ======================================================================
echo  🎙️ MiniBookLM C++ Native Whisper Server (Python不要・単体動作)
echo  - Port: 8080
echo  - Model: models/ggml-large-v3.bin (Large-v3 3.09GB)
echo  - Engine: whisper.cpp AVX2 高速マルチスレッド (8スレッド)
echo ======================================================================
cd /d "%~dp0"

if not exist "tools\whisper\Release\whisper-server.exe" (
    echo [ERROR] tools\whisper\Release\whisper-server.exe が見つかりません。
    pause
    exit /b 1
)

set "MODEL_PATH=models\ggml-small.bin"
if not exist "%MODEL_PATH%" (
    if exist "models\ggml-large-v3.bin" (
        set "MODEL_PATH=models\ggml-large-v3.bin"
    ) else (
        echo [ERROR] モデルが見つかりません。python download_model.py を実行してください。
        pause
        exit /b 1
    )
)

set "PATH=%~dp0tools\whisper\Release;%PATH%"

echo  起動モデル: %MODEL_PATH%
tools\whisper\Release\whisper-server.exe -m "%MODEL_PATH%" --host 127.0.0.1 --port 8080 -l ja -t 8 -mc 64 -bs 4 --best-of 4 --convert
pause
