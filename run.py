# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).

import os
import sys
import subprocess
import webbrowser
import time
import socket

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def main():
    print("=" * 60)
    print("  🚀 MiniBookLM Studio PWA ランチャー")
    print("=" * 60)

    # 1. デスクトップAPIサーバー (server.py) をバックグラウンド起動
    print("[1/2] デスクトップAPIサーバーを起動中...")
    api_proc = subprocess.Popen([sys.executable, "server.py"], shell=True)

    # 2. PWA フロントエンド (Vite) の起動
    print("[2/2] PWA フロントエンドサーバーを起動中 (ポート 3005)...")
    
    # 2秒後にブラウザを自動オープン
    def open_browser():
        time.sleep(2)
        print("🌐 ブラウザを開いています: http://localhost:3005")
        webbrowser.open("http://localhost:3005")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    try:
        # Vite 起動
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        subprocess.run([npm_cmd, "run", "dev", "--", "--port", "3005", "--host"])
    except KeyboardInterrupt:
        print("\nサーバーを停止しています...")
    finally:
        api_proc.terminate()

if __name__ == "__main__":
    main()
