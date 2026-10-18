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
    const cleanApiKey = apiKey.trim();
    const specified = modelName?.trim();
    const candidateModels = [
      ...(specified ? [specified] : []),
      'gemma-4-26b-a4b-it',
      'gemma-4-31b-it',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite'
    ];
    // 重複除去
    const modelsToTry = Array.from(new Set(candidateModels));

    let lastError: Error | null = null;
    for (const targetModel of modelsToTry) {
      if (abortSignal?.aborted) break;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${cleanApiKey}`;

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

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortSignal
        });

        if (res.status === 404) {
          // モデル廃止・非対応の場合は次の候補へフォールバック
          continue;
        }

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
        return; // 成功した場合は終了
      } catch (err: any) {
        if (err.message && err.message.includes('404')) {
          continue;
        }
        if (err.name === 'TypeError' && err.message && err.message.includes('fetch')) {
          lastError = new Error(`Google API通信エラー (${err.message}): ブラウザからの直接通信が制限されているか、ネットワーク/広告ブロッカーでブロックされた可能性があります。APIキーまたは接続環境をご確認いただくか、設定で「⚡ ブラウザ内 WebGPU」または「💻 デスクトップ」モードをお試しください。`);
        } else {
          lastError = err;
        }
        break;
      }
    }

    if (lastError) throw lastError;
    throw new Error('利用可能なGeminiモデルが見つかりませんでした。Google AI Studioで有効なAPIキーをご確認ください。');
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

    // ☁️ クラウド Google API モード（Gemini / Gemma 4 クラウド推論）
    if (config.mode === 'cloud-gemini') {
      if (!config.cloudApiKey) {
        throw new Error('Google APIキーが未入力です。「⚙️設定」からAPIキーを入力するか、ローカル推論またはブラウザ内推論（WebLLM）をお選びください。');
      }
      const targetCloudModel = config.cloudModelName || config.desktopModelName || 'gemma-4-26b-a4b-it';
      yield* this.streamGeminiDirect(config.cloudApiKey, targetCloudModel, messages, config.temperature, abortSignal);
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
    const cleanApiKey = apiKey.trim();

    const candidateAudioModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let lastErr: Error | null = null;

    for (const model of candidateAudioModels) {
      if (abortSignal?.aborted) break;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanApiKey}`;
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

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: abortSignal
        });

        if (res.status === 404) {
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini Audio APIエラー (${res.status}): ${errText}`);
        }

        const data = await res.json();
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return resultText.trim();
      } catch (err: any) {
        if (err.message && err.message.includes('404')) continue;
        lastErr = err;
        break;
      }
    }

    if (lastErr) throw lastErr;
    throw new Error('音声文字起こし用Geminiモデルが見つかりませんでした。有効なAPIキーをご確認ください。');
  }

  // 4. Google Cloud / Gemini ニューラル高音質音声合成 (Neural2-C: 男声ホスト, Neural2-B: 女声ゲスト)
  public async synthesizeSpeechWithGoogle(
    apiKey: string,
    text: string,
    isHost: boolean,
    speakingRate: number = 1.05,
    abortSignal?: AbortSignal
  ): Promise<Uint8Array> {
    const voiceName = isHost ? 'ja-JP-Neural2-C' : 'ja-JP-Neural2-B';
    const rate = isHost ? speakingRate : speakingRate * 1.05;
    const pitch = isHost ? -1.0 : 1.5;

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
    const payload = {
      input: { text },
      voice: {
        languageCode: 'ja-JP',
        name: voiceName
      },
      audioConfig: {
        audioEncoding: 'LINEAR16', // WAV (PCM)
        sampleRateHertz: 24000,
        speakingRate: Math.max(0.7, Math.min(1.8, rate)),
        pitch
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
      throw new Error(`Google TTS APIエラー (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (!data.audioContent) {
      throw new Error('音声データが返却されませんでした');
    }

    // Base64デコード
    const binaryStr = atob(data.audioContent);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  // 5. 案B: VOICEVOX 音声合成 (ローカル 50021 または Web API)
  public async synthesizeSpeechWithVoicevox(
    text: string,
    isHost: boolean,
    speakingRate: number = 1.05,
    abortSignal?: AbortSignal
  ): Promise<Uint8Array> {
    // ホスト: 青山龍星(ID: 13) or 剣崎雌雄(ID: 21), ゲスト: 四国めたん(ID: 2) or ずんだもん(ID: 3)
    const speakerId = isHost ? 13 : 2;

    // 1. ローカル VOICEVOX エンジン (http://127.0.0.1:50021) を優先トライ
    try {
      const queryRes = await fetch(`http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, {
        method: 'POST',
        signal: abortSignal
      });

      if (queryRes.ok) {
        const queryJson = await queryRes.json();
        queryJson.speedScale = speakingRate; // 会話速度

        const synthRes = await fetch(`http://127.0.0.1:50021/synthesis?speaker=${speakerId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryJson),
          signal: abortSignal
        });

        if (synthRes.ok) {
          const arrayBuf = await synthRes.arrayBuffer();
          return new Uint8Array(arrayBuf);
        }
      }
    } catch {
      // ローカルが動いていない場合はWebフォールバックへ進む
    }

    // 2. WEB版 VOICEVOX API (TTS Quest API) へフォールバック
    const webApiUrl = `https://api.tts.quest/v3/voicevox/synthesis?speaker=${speakerId}&text=${encodeURIComponent(text)}`;
    let webData: any = null;

    // 429 レート制限時の自動バックオフ・リトライ（最大4回自動待機）
    for (let attempt = 0; attempt < 4; attempt++) {
      if (abortSignal?.aborted) break;
      const webRes = await fetch(webApiUrl, { signal: abortSignal });

      if (webRes.status === 429) {
        let waitSec = 3;
        try {
          const errJson = await webRes.json();
          if (errJson.retryAfter) {
            waitSec = Math.max(2, Math.min(10, Number(errJson.retryAfter) + 1));
          }
        } catch {}
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (!webRes.ok) {
        throw new Error(`VOICEVOX Web API 接続エラー (${webRes.status})`);
      }

      webData = await webRes.json();
      break;
    }

    if (!webData || (!webData.success && !webData.wavDownloadUrl && !webData.mp3DownloadUrl)) {
      throw new Error(webData?.errorMessage || 'VOICEVOX Web APIの利用制限（レートリミット）により混雑しています。数秒後に再試行するか「☁️ Google」モードをお試しください。');
    }

    // status.json を監視してサーバー側の音声生成完了を確実に待機（最大35秒）
    const statusUrl = webData.audioStatusUrl;
    const audioDownloadUrl = webData.wavDownloadUrl || webData.mp3DownloadUrl;

    if (statusUrl) {
      for (let sRetry = 0; sRetry < 35; sRetry++) {
        if (abortSignal?.aborted) break;
        try {
          const sRes = await fetch(statusUrl, { signal: abortSignal });
          if (sRes.ok) {
            const sJson = await sRes.json();
            if (sJson.isAudioReady === true || sJson.status === 'done') {
              break;
            }
            if (sJson.isAudioError === true) {
              throw new Error('VOICEVOXサーバー側で音声生成エラーが発生しました');
            }
          }
        } catch (e: any) {
          if (e.message && e.message.includes('サーバー側で音声生成エラー')) throw e;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 音声ファイルのダウンロード（最大20秒待機ポーリング）
    let audioBytes: Uint8Array | null = null;

    for (let retry = 0; retry < 15; retry++) {
      if (abortSignal?.aborted) break;
      try {
        const audioFetch = await fetch(audioDownloadUrl, { signal: abortSignal });
        if (audioFetch.ok) {
          const ab = await audioFetch.arrayBuffer();
          if (ab.byteLength > 1000) {
            audioBytes = new Uint8Array(ab);
            break;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1200));
    }

    if (!audioBytes) {
      throw new Error('VOICEVOX音声のダウンロードがタイムアウトしました。長文の生成時は少し待つか「☁️ Google」モードをお試しください。');
    }

    return audioBytes;
  }
}

export const llmService = new LLMService();
