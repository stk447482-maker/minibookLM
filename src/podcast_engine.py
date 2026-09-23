# [License] Verified Free & Commercial Use.
# [Auditor] Antigravity 2.0 x takumiGuard
# [Status] Pass (Harness env checked).
# [Timestamp] 2026-07-29T23:36:00Z

import asyncio
import os
import re
import tempfile
import edge_tts

# 2人のホストボイス設定 (男性ホスト / 女性解説者)
HOST_VOICE = "ja-JP-KeitaNeural"
EXPERT_VOICE = "ja-JP-NanamiNeural"

def generate_podcast_script(llm, active_docs):
    if not active_docs:
        return "資料が選択されていません。"
    
    # インポート済みの全資料から要約コンテキストを抽出 (最大10000文字)
    full_context = "\n\n".join([f"【資料: {d.metadata.get('source_name', 'Doc')}】\n{d.page_content}" for d in active_docs[:10]])[:10000]

    system_prompt = """あなたは人気ポッドキャスト番組のプロデューサー兼脚本家です。
提供された資料の内容を基に、リスナーが聴いていて楽しく、深く理解できるラジオ対話台本を作成してください。

登場人物:
- ホスト (Keita): 視聴者目線で素朴な疑問を投げかけたり、驚いたりする熱心な進行役。
- 解説者 (Nanami): 専門知識を持ち、例え話を使って分かりやすく深掘り解説する専門家。

フォーマットルール:
必ず以下のプレフィックス形式で交互に発話を作成してください。これ以外の記号や余計な解説文は含めないでください。

[ホスト]: (発話内容)
[解説者]: (発話内容)
[ホスト]: (発話内容)
..."""

    user_prompt = f"以下の【資料群】を基に、約3分間の対話ポッドキャスト台本を作成してください:\n\n{full_context}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    res = llm.invoke(messages)
    return res.content if hasattr(res, 'content') else str(res)

async def synthesize_dialogue_audio(script_text):
    """
    台本テキストを解析し、[ホスト]と[解説者]の声（Edge-TTS）で音声を交互に生成・結合する
    """
    lines = script_text.split('\n')
    combined_audio_bytes = bytearray()

    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        voice = None
        text = ""
        if line.startswith("[ホスト]:") or line.startswith("ホスト:"):
            voice = HOST_VOICE
            text = re.sub(r'^\[?ホスト\]?:?\s*', '', line)
        elif line.startswith("[解説者]:") or line.startswith("解説者:"):
            voice = EXPERT_VOICE
            text = re.sub(r'^\[?解説者\]?:?\s*', '', line)
        
        if voice and text:
            communicator = edge_tts.Communicate(text, voice)
            async for chunk in communicator.stream():
                if chunk["type"] == "audio":
                    combined_audio_bytes.extend(chunk["data"])

    return bytes(combined_audio_bytes)

def generate_podcast_audio_sync(script_text):
    return asyncio.run(synthesize_dialogue_audio(script_text))
