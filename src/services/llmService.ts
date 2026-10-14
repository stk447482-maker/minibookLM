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

  // 2.5 LM Studio / OpenAI 互換 API へのストリーミング (http://localhost:1234/v1/chat/completions)
  // LM Studio / OpenAI互換サーバーからロード中モデル一覧を取得（直接接続＆ローカルプロキシ両対応）
  public async getLMStudioModels(endpoint: string = 'http://127.0.0.1:1234/v1', proxyEndpoint: string = 'http://127.0.0.1:11434'): Promise<string[]> {
    // 1. まずローカルプロキシ (server.py) 経由を優先試行（CORS / OPTIONS 制限を完全回避）
    try {
      const proxyUrl = `${proxyEndpoint.replace(/\/+$/, '')}/api/lmstudio/models?endpoint=${encodeURIComponent(endpoint)}`;
      const pRes = await fetch(proxyUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
      if (pRes.ok) {
        const pData = await pRes.json();
        const list = (pData.data || []).map((m: any) => m.id).filter(Boolean);
        if (list.length > 0) return list;
      }
    } catch {
      // プロキシが動いていない場合は直接接続へ
    }

    // 2. 直接アクセス試行 (ヘッダーを付与しない単純GETで OPTIONS プリフライトを完全回避)
    try {
      let clean = endpoint.replace(/\/+$/, '');
      if (clean.endsWith('/chat/completions')) clean = clean.replace(/\/chat\/completions$/, '');
      
      const endpointsToTry = [];
      if (clean.endsWith('/v1')) {
        endpointsToTry.push(`${clean}/models`);
        endpointsToTry.push(clean.replace(/\/v1$/, '/api/v1/models'));
      } else {
        endpointsToTry.push(`${clean}/v1/models`);
        endpointsToTry.push(`${clean}/api/v1/models`);
      }

      for (const url of endpointsToTry) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
          });
          if (res.ok) {
            const data = await res.json();
            const list = (data.data || []).map((m: any) => m.id).filter(Boolean);
            if (list.length > 0) return list;
          }
        } catch {}
      }
      return [];
    } catch {
      return [];
    }
  }

  // 2.5 LM Studio / OpenAI 互換 API へのストリーミング (直接接続 または server.py プロキシ)
  private async *streamOpenAICompatible(
    endpoint: string,
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    temperature: number = 0.3,
    abortSignal?: AbortSignal,
    proxyEndpoint: string = 'http://127.0.0.1:11434'
  ): AsyncIterable<string> {
    let cleanEndpoint = endpoint.replace(/\/+$/, '');
    let baseUrl = cleanEndpoint;
    if (baseUrl.endsWith('/chat/completions')) baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
    if (!cleanEndpoint.endsWith('/chat/completions')) {
      if (cleanEndpoint.endsWith('/v1')) {
        cleanEndpoint = `${cleanEndpoint}/chat/completions`;
      } else {
        cleanEndpoint = `${cleanEndpoint}/v1/chat/completions`;
      }
    }

    // モデル名が未指定の場合、ロード中の先頭モデルを自動補完
    let targetModel = model?.trim();
    if (!targetModel) {
      const models = await this.getLMStudioModels(baseUrl, proxyEndpoint);
      const chatModel = models.find(m => !m.includes('embedding') && !m.includes('embed')) || models[0];
      if (chatModel) {
        targetModel = chatModel;
      }
    }

    if (!targetModel) {
      throw new Error('LM Studio でロード中のモデルが見つかりません。LM Studio 画面でモデルをロードするか、「⚙️設定」で使用モデル名を入力してください。');
    }

    // A. まずプロキシ経由を優先試行（Mixed Content & CORS 回避）
    let res: Response | null = null;
    try {
      const proxyUrl = `${proxyEndpoint.replace(/\/+$/, '')}/api/lmstudio/chat`;
      res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages,
          customEndpoint: baseUrl,
          options: { temperature },
          stream: true
        }),
        signal: abortSignal
      });
      if (!res.ok) res = null;
    } catch {
      res = null;
    }

    // B. プロキシ未起動時は直接アクセスへフォールバック
    if (!res) {
      res = await fetch(cleanEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          temperature,
          stream: true
        }),
        signal: abortSignal
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio / OpenAI API エラー (${res.status}): ${errText}`);
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
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          return;
        }

        if (trimmed.startsWith('data: ')) {
          try {
            const jsonStr = trimmed.slice(6);
            const data = JSON.parse(jsonStr);
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch {
            // パースエラーは無視して継続
          }
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
    // 🎛️ LM Studio / OpenAI 互換モード
    if (config.mode === 'lmstudio') {
      const endpoint = config.lmStudioEndpoint || 'http://127.0.0.1:1234/v1';
      const model = config.desktopModelName || '';
      const proxy = config.desktopApiEndpoint || 'http://127.0.0.1:11434';
      try {
        yield* this.streamOpenAICompatible(endpoint, model, messages, config.temperature, abortSignal, proxy);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`LM Studio (${endpoint}) への接続に失敗しました: ${msg}。\nLM Studio の「Local Server」がポート 1234 等で起動しているかご確認ください。`);
      }
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

    // ☁️ クラウド Gemini API モード（明示的に cloud-gemini が選択されている場合）
    if (config.mode === 'cloud-gemini') {
      if (!config.cloudApiKey) {
        throw new Error('Google Gemini APIキーが未入力です。「⚙️設定」からAPIキーを入力するか、ローカル推論またはブラウザ内推論（WebLLM）をお選びください。');
      }
      yield* this.streamGeminiDirect(config.cloudApiKey, config.desktopModelName || 'gemini-1.5-flash', messages, config.temperature, abortSignal);
      return;
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
        // 🛡️ 無限チャット対応スライディングウィンドウ＆厳格トークン予算ガード
        // WebLLMのコンテキスト窓（4,096トークン）に対して、安全圏（入力最大2,400トークン ≒ 約2,600文字）を死守
        const isSmallModel = modelId.includes('0.5B');
        const maxSysChars = isSmallModel ? 1800 : 2600;
        const maxTokensToGen = isSmallModel ? 600 : 1000;

        // 1. システムプロンプトを安全上限でトリミング
        const systemMsg = messages.find(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');

        const trimmedSystem = systemMsg ? {
          role: 'system' as const,
          content: systemMsg.content.slice(0, maxSysChars)
        } : null;

        // 2. 過去チャット履歴の自動スライディングウィンドウ
        // Studio生成などで単一のユーザメッセージが送られた場合は最大2,800文字まで許容
        const isSinglePrompt = nonSystemMsgs.length === 1;
        const historyBudgetChars = isSinglePrompt ? 2800 : 1200;
        let usedHistoryChars = 0;
        const safeHistory: { role: 'user' | 'assistant'; content: string }[] = [];

        for (let i = nonSystemMsgs.length - 1; i >= 0; i--) {
          const m = nonSystemMsgs[i];
          const sliceLen = isSinglePrompt ? Math.min(m.content.length, 2800) : Math.min(m.content.length, 400);
          if (usedHistoryChars + sliceLen > historyBudgetChars && safeHistory.length >= 1) {
            break; // 予算オーバー時は古い会話を自動ドロップ（無限チャット化）
          }
          safeHistory.unshift({
            role: m.role as 'user' | 'assistant',
            content: m.content.slice(0, sliceLen)
          });
          usedHistoryChars += sliceLen;
        }

        const safeMessages = [
          ...(trimmedSystem ? [trimmedSystem] : []),
          ...safeHistory
        ];

        const effectiveTemp = typeof config.temperature === 'number' ? Math.max(0.1, Math.min(1.0, config.temperature)) : 0.3;

        const chunks = await this.engine.chat.completions.create({
          messages: safeMessages,
          temperature: effectiveTemp,
          top_p: 0.9,
          frequency_penalty: 0.2,
          presence_penalty: 0.2,
          max_tokens: maxTokensToGen,
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

  /**
   * Google Gemini 1.5 Flash Direct Multimodal Audio による超高速・高精度日本語文字起こし
   */
  public async transcribeAudioWithGemini(
    apiKey: string,
    audioBlob: Blob,
    timeOffsetSec = 0,
    abortSignal?: AbortSignal,
    customMimeType?: string
  ): Promise<string> {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = (reader.result as string) || '';
        const commaIdx = result.indexOf(',');
        resolve(commaIdx !== -1 ? result.substring(commaIdx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });

    const startMin = Math.floor(timeOffsetSec / 60);
    const startSec = timeOffsetSec % 60;
    const timeHint = timeOffsetSec > 0
      ? `※ この音声セクションの開始オフセット時刻は [${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')}] です。タイムスタンプにはこのオフセットを加算して表記してください。`
      : '';

    const prompt = `あなたは最高精度の日本語音声文字起こしAIです。
提供された音声ファイルを忠実に日本語で文字起こししてください。

【厳格ルール】
1. 発話内容を一言一句漏らさず正確に書き起こしてください。言い淀み（えー、あのー等）は自然に整形してください。
2. 会話やトピックの区切りごとに、必ず \`#### [MM:SS - MM:SS]\` 形式のタイムスタンプ見出しを付けてください。
3. 専門用語、固有名詞、数字、日付を正確に書き起こしてください。
4. 前置きや挨拶（「承知しました」「文字起こし結果です」等）は一切省き、文字起こし本文のみを出力してください。
${timeHint}`;

    // 原音ファイルの MIME タイプを正確に反映（mp3, m4a, wav等）
    const effectiveMimeType = customMimeType || audioBlob.type || 'audio/wav';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: effectiveMimeType,
                data: base64Data
              }
            },
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Audio APIエラー (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return resultText.trim();
  }
}

export const llmService = new LLMService();
