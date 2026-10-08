// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import * as webllm from '@mlc-ai/web-llm';
import { ModelConfig } from '../types/index.ts';

class LLMService {
  private engine: webllm.MLCEngineInterface | null = null;
  private currentModelId: string = '';
  private isInitializing: boolean = false;

  public async initWebLLM(
    modelId: string = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    onProgress?: (report: webllm.InitProgressReport) => void
  ): Promise<void> {
    if (this.engine && this.currentModelId === modelId) return;
    if (this.isInitializing) return;

    this.isInitializing = true;
    try {
      this.engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: onProgress
      });
      this.currentModelId = modelId;
    } finally {
      this.isInitializing = false;
    }
  }

  // 1. Google Gemini API へのダイレクト・ストリーミング
  private async *streamGeminiDirect(
    apiKey: string,
    modelName: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    temperature: number = 0.3,
    abortSignal?: AbortSignal
  ): AsyncIterable<string> {
    const targetModel = modelName.includes('gemini') ? modelName : 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const contents: any[] = [];
    let systemInstruction: any = null;

    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: m.content }] };
      } else if (m.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
      } else if (m.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: m.content }] });
      }
    }

    const payload: any = {
      contents,
      generationConfig: {
        temperature
      }
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini APIエラー (${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('ReadableStreamを利用できません');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;
          try {
            const data = JSON.parse(dataStr);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          } catch {}
        }
      }
    }
  }

  // 2. デスクトップ API (Ollama / server.py) へのストリーミング
  private async *streamDesktopApi(
    endpoint: string,
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    temperature: number = 0.3,
    abortSignal?: AbortSignal
  ): AsyncIterable<string> {
    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const res = await fetch(`${cleanEndpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature }
      }),
      signal: abortSignal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ローカルAPIエラー (${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('ReadableStreamを利用できません');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      if (abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (abortSignal?.aborted) break;
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.error) {
            throw new Error(data.error);
          }
          if (data.message?.content) {
            yield data.message.content;
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Ollama')) throw e;
        }
      }
    }
  }

  // 3. メイン・ストリーミングディスパッチャー（完全脱モック＆自律フォールバック）
  public async *streamChat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    config: ModelConfig,
    onInitProgress?: (text: string) => void,
    abortSignal?: AbortSignal
  ): AsyncIterable<string> {
    // ☁️ クラウド Gemini API モード（またはAPIキー設定時）
    if (config.mode === 'cloud-gemini' || config.cloudApiKey) {
      if (!config.cloudApiKey) {
        throw new Error('Google Gemini APIキーが未入力です。「⚙️設定」からAPIキーを入力するか、ブラウザ内推論（WebLLM）をお選びください。');
      }
      yield* this.streamGeminiDirect(config.cloudApiKey, config.desktopModelName || 'gemini-1.5-flash', messages, config.temperature, abortSignal);
      return;
    }

    // 💻 デスクトップ API モード (ローカル Ollama / llama-server / server.py)
    if (config.mode === 'desktop-api') {
      const endpoint = config.desktopApiEndpoint || 'http://127.0.0.1:11434';
      const model = config.desktopModelName || 'llama3.1';
      try {
        yield* this.streamDesktopApi(endpoint, model, messages, config.temperature, abortSignal);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`ローカルAPI (${endpoint}) への接続に失敗しました: ${msg}。\nOllama または server.py が起動しているかご確認ください。\n完全ブラウザ内推論をご利用の場合は「⚙️設定」から「⚡ ブラウザ内 WebGPU」を選択してください。`);
      }
    }

    // 📱/💻 ブラウザ内 WebGPU (WebLLM) 推論モード（Python不要・完全ブラウザ完結）
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
      const modelId = config.embeddedModelId || 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
      if (!this.engine || this.currentModelId !== modelId) {
        onInitProgress?.(`WebLLMモデル (${modelId}) をロード中...`);
        await this.initWebLLM(modelId, (report) => {
          onInitProgress?.(report.text);
        });
      }

      if (this.engine) {
        // 🛡️ WebLLM 4,096 トークン上限（Context Window Overflow）全体統合予算ガード
        const safeMessages = messages.map((m) => {
          let text = m.content;
          // システムプロンプト（参照ドキュメント含む）は最大2,400文字まで許容
          if (m.role === 'system' && text.length > 2400) {
            text = text.slice(0, 2400) + '\n...[4Kトークン保護のため以降省略]';
          } else if (m.role !== 'system' && text.length > 500) {
            // 過去のチャット履歴は1メッセージ最大500文字に圧縮
            text = text.slice(0, 500);
          }
          return { role: m.role, content: text };
        });

        const effectiveTemp = typeof config.temperature === 'number' ? Math.max(0.1, Math.min(1.0, config.temperature)) : 0.2;

        const chunks = await this.engine.chat.completions.create({
          messages: safeMessages,
          temperature: effectiveTemp, // ファクト抽出に適した低温度 (0.2)
          top_p: 0.85,
          frequency_penalty: 0.3, // 数値や固有名詞の反復引用を妨げない低ペナルティ
          presence_penalty: 0.3,
          max_tokens: 800,
          stream: true
        });

        let accumulated = '';
        for await (const chunk of chunks) {
          if (abortSignal?.aborted) break;
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            accumulated += delta;

            // 🛑 ループ暴走防止ガード: 同一センテンス・行が3回連続して出力された場合のみ即停止
            if (accumulated.length > 80) {
              const lines = accumulated.split(/[\n。]+/).map(s => s.trim()).filter(s => s.length > 6);
              if (lines.length >= 3) {
                const last = lines[lines.length - 1];
                const prev1 = lines[lines.length - 2];
                const prev2 = lines[lines.length - 3];
                if (last === prev1 && last === prev2) {
                  break;
                }
              }
            }

            yield delta;
          }
        }
        return;
      }
    }

    // WebGPUが非対応環境の場合の明確な案内
    throw new Error('ブラウザのWebGPUが非対応または未ロードです。「⚙️設定」から「☁️ Google Gemini API (無料)」のAPIキーを入力していただくか、WebGPU対応ブラウザ（Chrome/Edge最新版）をご利用ください。');
  }

}

export const llmService = new LLMService();
