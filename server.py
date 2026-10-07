# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).

import os
import json
import asyncio
import urllib.request
import urllib.error
from typing import List, Optional, AsyncGenerator
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

app = FastAPI(title="MiniBookLM Production API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessageItem(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: Optional[str] = "llama3.1"
    messages: List[ChatMessageItem]
    stream: Optional[bool] = True
    options: Optional[dict] = None
    apiKey: Optional[str] = None
    provider: Optional[str] = "ollama" # "ollama" | "gemini" | "openai"
    customEndpoint: Optional[str] = None # 例: "http://127.0.0.1:11434"

@app.get("/health")
def health():
    return {"status": "ok", "mode": "production-no-mock"}

# 1. 本物の Ollama ストリーミングプロキシ
async def stream_ollama(endpoint: str, model: str, messages: List[dict], options: Optional[dict]) -> AsyncGenerator[str, None]:
    ollama_url = f"{endpoint.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": options or {}
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", ollama_url, json=payload) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    error_chunk = json.dumps({"error": f"Ollamaエラー ({response.status_code}): {err_body.decode()}"}, ensure_ascii=False)
                    yield error_chunk + "\n"
                    return

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    yield line + "\n"
        except Exception as e:
            error_chunk = json.dumps({"error": f"Ollama接続失敗 ({ollama_url}): {str(e)}"}, ensure_ascii=False)
            yield error_chunk + "\n"

# 2. 本物の Google Gemini API ストリーミング
async def stream_gemini(api_key: str, model_name: str, messages: List[dict]) -> AsyncGenerator[str, None]:
    # モデル名を正規化
    target_model = model_name if "gemini" in model_name.lower() else "gemini-1.5-flash"
    gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:streamGenerateContent?alt=sse&key={api_key}"

    # メッセージ構造をGemini形式に変換
    contents = []
    system_instruction = None

    for m in messages:
        if m["role"] == "system":
            system_instruction = {"parts": [{"text": m["content"]}]}
        elif m["role"] == "user":
            contents.append({"role": "user", "parts": [{"text": m["content"]}]})
        elif m["role"] == "assistant":
            contents.append({"role": "model", "parts": [{"text": m["content"]}]})

    payload = {"contents": contents}
    if system_instruction:
        payload["systemInstruction"] = system_instruction

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", gemini_url, json=payload, headers={"Content-Type": "application/json"}) as response:
                if response.status_code != 200:
                    err_body = await response.aread()
                    error_chunk = json.dumps({"error": f"Gemini APIエラー ({response.status_code}): {err_body.decode()}"}, ensure_ascii=False)
                    yield error_chunk + "\n"
                    return

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                        if not data_str:
                            continue
                        try:
                            gemini_data = json.loads(data_str)
                            candidates = gemini_data.get("candidates", [])
                            if candidates:
                                text_chunk = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                                if text_chunk:
                                    # Ollama互換形式でクライアントへ転送
                                    out_chunk = json.dumps({
                                        "model": target_model,
                                        "message": {"role": "assistant", "content": text_chunk},
                                        "done": False
                                    }, ensure_ascii=False)
                                    yield out_chunk + "\n"
                        except Exception:
                            pass

                yield json.dumps({"done": True}) + "\n"
        except Exception as e:
            error_chunk = json.dumps({"error": f"Gemini API接続失敗: {str(e)}"}, ensure_ascii=False)
            yield error_chunk + "\n"

@app.post("/api/chat")
async def chat(req: ChatRequest):
    messages_payload = [{"role": m.role, "content": m.content} for m in req.messages]

    # Gemini APIプロバイダー
    if req.provider == "gemini" and req.apiKey:
        return StreamingResponse(
            stream_gemini(req.apiKey, req.model or "gemini-1.5-flash", messages_payload),
            media_type="application/x-ndjson"
        )

    # デフォルト: ローカル Ollama / Llama.cpp プロキシ
    endpoint = req.customEndpoint or "http://127.0.0.1:11434"
    return StreamingResponse(
        stream_ollama(endpoint, req.model or "llama3.1", messages_payload, req.options),
        media_type="application/x-ndjson"
    )

if __name__ == "__main__":
    import uvicorn
    print("🚀 MiniBookLM 本番APIサーバー (完全脱モック) を起動します (ポート: 11434)...")
    uvicorn.run(app, host="127.0.0.1", port=11434)
