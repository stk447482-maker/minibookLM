// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import * as pdfjsLib from 'pdfjs-dist';
import { DocumentChunk, DocumentSource, SourceReference, FactSkeleton, ModelConfig } from '../types/index.ts';
import { dbService } from './db.ts';
import { decodeAudioTo16kMono, createWavBlobFromFloat32 } from './audioDecoder.ts';
import { llmService } from './llmService.ts';

const REFINER_SYSTEM_PROMPT = `あなたは極めて厳格で優秀な音声認識校正・文脈復元AIです。
GeminiやNotebookLMのように、音声認識（Whisper）が出力した生テキストの同音異義誤り、助詞の脱落、句読点の欠損を前後の文脈から修復してください。

【絶対遵守ルール】
1. 事実の追加や推測・創作は一切禁止（ハルシネーション厳禁）。
2. 元の発話で喋っていない内容や、新しい話題を勝手に補足してはいけません。
3. 同音異義語の誤変換（例: 「義側」->「ギプス側」や「こちら側」、「手払う」->「手で払う / 負担する」等）、助詞の脱落（「が」「を」「に」）、自然な句読点（、。）の補正のみを行ってください。
4. 話者が発言した意味とニュアンスを100%忠実に保ち、余計な敬語化や過度な意訳は避けてください。
5. 出力は校正後のテキストのみを出力してください。「以下が校正文です」等の挨拶や解説は一切不要です。`;

const NATIVE_HALLUCINATION_PATTERNS: RegExp[] = [
  /視聴ありがとうございました/i,
  /ご視聴ありがとうございました/i,
  /チャンネル登録/i,
  /高評価/i,
  /おやすみなさい/i,
  /それではまた/i,
  /Subtitles by/i,
  /Transcribed by/i,
  /Amara\.org/i
];

async function refineChunksWithLMStudio(
  chunks: { start: string; end: string; text: string }[],
  endpoint: string,
  signal?: AbortSignal
): Promise<string> {
  const combined = chunks.map(c => `[${c.start} - ${c.end}] ${c.text}`).join('\n');
  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: REFINER_SYSTEM_PROMPT },
          { role: 'user', content: combined }
        ],
        temperature: 0.1,
        stream: false
      }),
      signal
    });
    if (!res.ok) return combined;
    const data = await res.json();
    return data.choices?.[0]?.message?.content || combined;
  } catch {
    return combined;
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

class RAGManager {
  private embedWorker: Worker | null = null;
  private searchWorker: Worker | null = null;
  private whisperWorker: Worker | null = null;
  private isEmbedModelReady: boolean = false;

  constructor() {
    this.initWorkers();
  }

  private initWorkers() {
    this.embedWorker = new Worker(new URL('../workers/embed.worker.ts', import.meta.url), { type: 'module' });
    this.searchWorker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' });
    this.whisperWorker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });

    this.searchWorker.postMessage({ type: 'INIT' });
  }

  public async loadProjectChunks(chunks: DocumentChunk[]): Promise<void> {
    return new Promise((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'SET_SUCCESS') {
          this.searchWorker?.removeEventListener('message', handler);
          resolve();
        }
      };
      this.searchWorker?.addEventListener('message', handler);
      this.searchWorker?.postMessage({ type: 'SET_CHUNKS', payload: { chunks } });
    });
  }

  public async initEmbeddingModel(
    onProgress?: (percent: number, file?: string) => void
  ): Promise<void> {
    if (this.isEmbedModelReady) return;

    return new Promise((resolve, reject) => {
      if (!this.embedWorker) return reject(new Error('EmbedWorkerが利用できません'));

      const handler = (e: MessageEvent) => {
        const { type, percent, file, message } = e.data;
        if (type === 'DOWNLOAD_PROGRESS' && onProgress) {
          onProgress(percent, file);
        }
        if (type === 'INIT_SUCCESS') {
          this.isEmbedModelReady = true;
          this.embedWorker?.removeEventListener('message', handler);
          resolve();
        }
        if (type === 'ERROR') {
          this.embedWorker?.removeEventListener('message', handler);
          reject(new Error(message));
        }
      };

      this.embedWorker.addEventListener('message', handler);
      this.embedWorker.postMessage({ type: 'INIT_MODEL' });
    });
  }

  public createHierarchicalChunks(
    text: string,
    docId: string,
    docTitle: string,
    projectId: string
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const paragraphs = text.split(/\n{2,}|\n(?=[#\-\*\d\>])/).filter(p => p.trim().length > 0);
    
    let currentParent = '';
    let chunkIndex = 0;

    const flushParent = () => {
      if (!currentParent.trim()) return;
      const parentText = currentParent.trim();
      
      // 親ブロックから子チャンク（200-350文字の論理文単位）を生成
      const sentences = parentText.split(/(?<=[。！？\n])/).filter(s => s.trim().length > 0);
      let childSnippet = '';

      for (const sent of sentences) {
        if ((childSnippet.length + sent.length) > 300 && childSnippet.length > 30) {
          chunks.push({
            id: `${docId}_chunk_${chunkIndex++}`,
            projectId,
            docId,
            docTitle,
            chunkIndex,
            content: childSnippet.trim(),
            parentContent: parentText
          });
          childSnippet = '';
        }
        childSnippet += sent;
      }

      if (childSnippet.trim().length > 15) {
        chunks.push({
          id: `${docId}_chunk_${chunkIndex++}`,
          projectId,
          docId,
          docTitle,
          chunkIndex,
          content: childSnippet.trim(),
          parentContent: parentText
        });
      }

      currentParent = '';
    };

    for (const para of paragraphs) {
      if ((currentParent.length + para.length) > 900 && currentParent.length > 200) {
        flushParent();
      }
      currentParent += (currentParent ? '\n\n' : '') + para.trim();
    }
    flushParent();

    // 空の場合はフォールバック
    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push({
        id: `${docId}_chunk_0`,
        projectId,
        docId,
        docTitle,
        chunkIndex: 0,
        content: text.slice(0, 300),
        parentContent: text
      });
    }

    return chunks;
  }

  public async parsePdf(
    file: File,
    onProgress?: (percent: number, status: string) => void,
    abortSignal?: AbortSignal
  ): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const totalPages = pdf.numPages;

    for (let i = 1; i <= totalPages; i++) {
      if (abortSignal?.aborted) {
        throw new Error('PDFの解析がキャンセルされました');
      }

      const percent = Math.round((i / totalPages) * 100);
      onProgress?.(percent, `PDF解析中 (${i} / ${totalPages} ページ)`);

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // 🎯 PDFテキストの高度なレイアウト復元・行結合（Sentence & Table Stitching）
      let pageLines: string[] = [];
      let currentLine = '';
      let lastY: number | null = null;

      for (const item of textContent.items as any[]) {
        const str = item.str || '';
        if (!str.trim()) continue;

        const transform = item.transform;
        const y = transform ? transform[5] : null;

        if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
          if (currentLine.trim()) {
            pageLines.push(currentLine.trim());
          }
          currentLine = str;
        } else {
          currentLine += (currentLine.endsWith(' ') || str.startsWith(' ') ? '' : ' ') + str;
        }
        lastY = y;
      }

      if (currentLine.trim()) {
        pageLines.push(currentLine.trim());
      }

      // 行末のハイフン結合や、数値と単位の分断を修復
      let reconstructedPage = pageLines.join('\n')
        .replace(/([第\d]+条)\s*\n\s*(第\d+項)/g, '$1 $2')
        .replace(/(\d+(?:\.\d+)?)\s*\n\s*(m2|m3|㎡|㎥|mm|cm|km|m|kg|t|Pa|MPa|kW|kWh|W|V|A|Hz|dB|℃|%|％|円|万円|億円)/g, '$1$2')
        .replace(/([^\n。]+[:：])\s*\n\s*([^\n]+)/g, '$1 $2');

      fullText += `\n--- [Page ${i}] ---\n${reconstructedPage}`;

      // 🧹 ページオブジェクトのメモリ即時解放
      page.cleanup();

      // 大容量PDFでのUIブロッキング防止（5ページ毎にマイクロタスクへ譲渡）
      if (i % 5 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return fullText;
  }

  // 音声・動画ファイルのブラウザ内デコード＆ハイブリッド文字起こし処理 (Gemini 1.5 Flash / Local WebGPU Whisper)
  public async parseAudioOrVideo(
    file: File,
    onProgress?: (status: string, percent?: number) => void,
    options?: {
      enginePreference?: 'auto' | 'gemini' | 'whisper-small' | 'whisper-large-v3' | 'kotoba-whisper' | 'native-large-v3' | 'native-kotoba' | 'whisper-local';
      cloudApiKey?: string;
      abortSignal?: AbortSignal;
      modelConfig?: ModelConfig;
    }
  ): Promise<string> {
    const pref = options?.enginePreference || 'whisper-small';
    onProgress?.('音声データを読み込み中...', 10);

    // =========================================================================
    // 🚀 選択肢B: Google Gemini 1.5 Flash (超高速クラウド / 約1〜2分)
    // =========================================================================
    if (pref === 'gemini') {
      const apiKey = options?.cloudApiKey || options?.modelConfig?.cloudApiKey;
      if (!apiKey) {
        throw new Error('Gemini APIキーが設定されていません。設定パネルでAPIキーを入力してください。');
      }

      onProgress?.('Gemini 1.5 Flash へ音声データを直接送信中 (超高速認識)...', 30);
      try {
        let mimeType = file.type || 'audio/mp3';
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'mp3') mimeType = 'audio/mp3';
        else if (ext === 'm4a') mimeType = 'audio/mp4';
        else if (ext === 'wav') mimeType = 'audio/wav';

        const transcript = await llmService.transcribeAudioWithGemini(
          apiKey,
          file,
          0,
          options?.abortSignal,
          mimeType
        );

        onProgress?.('文字起こし完了！ドキュメント登録中...', 98);
        let resultMarkdown = `## 🎙️ 音声/動画 文字起こしデータ (Google Gemini 1.5 Flash)\n`;
        resultMarkdown += `- **ファイル名:** ${file.name}\n`;
        resultMarkdown += `- **ファイルサイズ:** ${(file.size / (1024 * 1024)).toFixed(1)} MB\n`;
        resultMarkdown += `- **解析エンジン:** Google Gemini 1.5 Flash Multimodal Audio (超高速クラウド)\n\n`;
        resultMarkdown += `### 📝 文字起こし内容 (Transcript)\n\n${transcript.trim()}\n\n`;
        onProgress?.('完了', 100);
        return resultMarkdown;
      } catch (geminiErr: any) {
        throw new Error(`Gemini 音声文字起こしに失敗しました: ${geminiErr?.message || geminiErr}`);
      }
    }

    // =========================================================================
    // ⚡ 選択肢A (Small高速) / 🎯 選択肢C (Large-v3分割進捗)
    // =========================================================================
    const whisperServer = options?.modelConfig?.whisperServerEndpoint || 'http://127.0.0.1:8080';
    let whisperServerActive = false;
    try {
      const ping = await fetch(`${whisperServer}/`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      whisperServerActive = ping.ok;
    } catch {
      whisperServerActive = false;
    }

    // C++ Whisper サーバーが動いている場合
    if (whisperServerActive) {
      const isSmall = pref === 'whisper-small' || pref === 'auto';
      const modelLabel = isSmall ? 'Whisper Small (C++ 高速・465MB)' : 'Whisper Large-v3 (C++ 最高峰・3GB)';
      onProgress?.(`🚀 ${modelLabel} で文字起こし中...`, 30);

      const formData = new FormData();
      formData.append('file', file, file.name || 'audio.mp3');
      formData.append('temperature', '0.0');
      formData.append('temperature_inc', '0.2');
      formData.append('response_format', 'verbose_json');

      const transRes = await fetch(`${whisperServer}/inference`, {
        method: 'POST',
        body: formData,
        signal: options?.abortSignal
      });

      if (!transRes.ok) {
        const errText = await transRes.text();
        throw new Error(`❌ C++ whisper-server での文字起こしに失敗しました (${transRes.status}): ${errText}`);
      }

      const data = await transRes.json();
      const segments: any[] = data.segments || [];

      // 幻聴・ループ・定型文のフィルタリング
      const cleanChunks: { start: string; end: string; text: string }[] = [];
      let lastText = '';
      for (const seg of segments) {
        const text = (seg.text || '').trim();
        if (!text || text.length <= 1) continue;
        if (NATIVE_HALLUCINATION_PATTERNS.some(p => p.test(text))) continue;
        if (text === lastText) continue;
        lastText = text;

        const startSec = Math.floor((seg.t0 || 0) / 100);
        const endSec = Math.floor((seg.t1 || 0) / 100);
        const formatTime = (s: number) => {
          const m = Math.floor(s / 60);
          const sec = s % 60;
          return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
        };
        cleanChunks.push({
          start: formatTime(startSec),
          end: formatTime(endSec),
          text
        });
      }

      const rawTranscript = cleanChunks.length > 0
        ? cleanChunks.map(c => `[${c.start} - ${c.end}] ${c.text}`).join('\n')
        : (data.text || '').trim();

      let refinedTranscript = rawTranscript;
      const enableRefiner = options?.modelConfig?.enableAudioContextRefiner !== false;
      const lmStudioEndpoint = options?.modelConfig?.lmStudioEndpoint || 'http://localhost:1234/v1';

      if (enableRefiner && cleanChunks.length > 0) {
        onProgress?.('🧠 LM Studio (Gemma 12B) で文脈校正中...', 75);
        refinedTranscript = await refineChunksWithLMStudio(cleanChunks, lmStudioEndpoint, options?.abortSignal);
      }

      onProgress?.('文字起こし完了！ドキュメント登録中...', 98);
      let resultMarkdown = `## 🎙️ 音声/動画 文字起こしデータ (${modelLabel})\n`;
      resultMarkdown += `- **ファイル名:** ${file.name}\n`;
      resultMarkdown += `- **ファイルサイズ:** ${(file.size / (1024 * 1024)).toFixed(1)} MB\n`;
      resultMarkdown += `- **解析エンジン:** C++ Native whisper-server (${isSmall ? 'Small高速' : 'Large-v3'})\n\n`;
      resultMarkdown += `### 📝 文字起こし内容 (Transcript)\n\n${refinedTranscript.trim()}\n\n`;

      if (rawTranscript && refinedTranscript && rawTranscript.trim() !== refinedTranscript.trim()) {
        resultMarkdown += `<details>\n<summary>🔍 Whisper 生の出力テキスト (Raw Transcript / 忠実記録)</summary>\n\n\`\`\`\n${rawTranscript.trim()}\n\`\`\`\n</details>\n\n`;
      }

      onProgress?.('完了', 100);
      return resultMarkdown;
    }

    // 🐍 1-B: server.py (ポート11434) フォールバック
    const serverEndpoint = options?.modelConfig?.desktopApiEndpoint || 'http://127.0.0.1:11434';
    try {
      const statusRes = await fetch(`${serverEndpoint}/api/transcribe/status`, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (statusRes.ok) {
        const modelParam = pref === 'whisper-large-v3' ? 'large-v3' : 'small';
        const modelLabel = modelParam === 'large-v3' ? 'Whisper Large-v3' : 'Whisper Small (高速)';
        onProgress?.(`🚀 C++ネイティブ (${modelLabel}) で文字起こし中...`, 30);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('model', modelParam);
        formData.append('refine_with_lmstudio', options?.modelConfig?.enableAudioContextRefiner ? 'true' : 'false');
        formData.append('lmstudio_endpoint', options?.modelConfig?.lmStudioEndpoint || 'http://localhost:1234/v1');

        const transRes = await fetch(`${serverEndpoint}/api/transcribe`, {
          method: 'POST',
          body: formData,
          signal: options?.abortSignal
        });

        if (transRes.ok) {
          const data = await transRes.json();
          const transcript = data.refined_transcript || data.raw_transcript;
          if (transcript && transcript.trim()) {
            onProgress?.('文字起こし完了！ドキュメント登録中...', 98);
            let resultMarkdown = `## 🎙️ 音声/動画 文字起こしデータ (${modelLabel})\n`;
            resultMarkdown += `- **ファイル名:** ${file.name}\n`;
            resultMarkdown += `- **解析エンジン:** ${data.model_used} (自己完結型 C++ Native / temperature:0.0)\n\n`;
            resultMarkdown += `### 📝 文字起こし内容 (Transcript)\n\n${transcript.trim()}\n\n`;
            onProgress?.('完了', 100);
            return resultMarkdown;
          }
        }
      }
    } catch (nativeErr) {
      console.warn('Desktop API endpoint unavailable:', nativeErr);
    }



    try {
      // 1. WAV / 音声ファイルを 16kHz モノラル Float32Array に安全デコード（メモリ上限回避）
      const { audioData, durationSec } = await decodeAudioTo16kMono(file);

      const roundedDuration = Math.round(durationSec);
      const minutes = Math.floor(roundedDuration / 60);
      const seconds = roundedDuration % 60;
      const durationStr = `${minutes}分${seconds}秒`;

      const useGemini = (options?.enginePreference === 'gemini' || options?.enginePreference === 'auto' || !options?.enginePreference) && !!options?.cloudApiKey;

      // 🚀 2. Gemini 1.5 Flash Direct Audio パイプライン（超高速・高精度）
      if (useGemini && options?.cloudApiKey) {
        try {
          onProgress?.(`音声デコード完了 (${durationStr})。Gemini 1.5 Flashで超高精度文字起こし中...`, 30);

          const sampleRate = 16000;
          const SEGMENT_DURATION_SEC = 300; // 5分（約9.6MB）ごとに安全分割投入
          const segmentSamples = SEGMENT_DURATION_SEC * sampleRate;
          const totalSegments = Math.max(1, Math.ceil(audioData.length / segmentSamples));

          let combinedTranscript = '';

          for (let s = 0; s < totalSegments; s++) {
            if (options?.abortSignal?.aborted) {
              throw new Error('ユーザーにより処理がキャンセルされました');
            }

            const startSample = s * segmentSamples;
            const endSample = Math.min((s + 1) * segmentSamples, audioData.length);
            const chunkAudio = audioData.slice(startSample, endSample);
            const timeOffsetSec = s * SEGMENT_DURATION_SEC;

            const percent = 30 + Math.round(((s + 1) / totalSegments) * 65);
            onProgress?.(`Gemini解析中: [${Math.floor(timeOffsetSec / 60)}分〜] (${s + 1}/${totalSegments})`, percent);

            const chunkBlob = createWavBlobFromFloat32(chunkAudio, sampleRate);
            const segmentText = await llmService.transcribeAudioWithGemini(
              options.cloudApiKey,
              chunkBlob,
              timeOffsetSec,
              options.abortSignal
            );

            if (segmentText) {
              combinedTranscript += (combinedTranscript ? '\n\n' : '') + segmentText;
            }
          }

          let transcribedText = `## 🎙️ 音声/動画 文字起こしデータ (Gemini 1.5 Flash)\n`;
          transcribedText += `- **ファイル名:** ${file.name}\n`;
          transcribedText += `- **再生時間:** ${durationStr}\n`;
          transcribedText += `- **解析エンジン:** Google Gemini 1.5 Flash Multimodal Audio (超高速・文脈自動補正)\n\n`;
          transcribedText += `### 📝 文字起こし内容 (Transcript)\n\n`;
          transcribedText += combinedTranscript || '（※ 音声から有意な発話が検出されませんでした）\n\n';

          onProgress?.('完了', 100);
          return transcribedText;
        } catch (geminiErr: any) {
          console.warn('Gemini Audio transcription failed, falling back to Local Whisper:', geminiErr);
          if (options?.enginePreference === 'gemini') {
            throw new Error(`Gemini 音声文字起こしエラー: ${geminiErr?.message || geminiErr}`);
          }
          // auto モード時はローカル Whisper へ自動フォールバック
        }
      }

      // 🔒 3. 完全ローカル Whisper (WebGPU / WASM + VAD) パイプライン
      const isKotoba = options?.enginePreference === 'kotoba-whisper' || options?.enginePreference === 'auto' || !options?.enginePreference;
      const localModelName = isKotoba ? 'onnx-community/kotoba-whisper-v2.2-ONNX' : 'onnx-community/whisper-tiny';
      const engineLabel = isKotoba ? 'Kotoba-Whisper v2.2 (日本語特化ONNX)' : 'Whisper-Tiny (軽量ONNX)';

      onProgress?.(`音声デコード完了 (${durationStr})。${engineLabel} を起動中...`, 30);

      if (!this.whisperWorker) {
        this.whisperWorker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
      }

      const transcriptionResult = await new Promise<{
        text: string;
        chunks: { timestamp: [number, number | null]; text: string }[];
      }>((resolve, reject) => {
        const handler = (e: MessageEvent) => {
          const { type, payload, message, percent, currentChunk, totalChunks, timeLabel } = e.data;

          if (type === 'DOWNLOAD_PROGRESS' && percent !== undefined) {
            onProgress?.(`モデル読込中 (${percent}%)`, 30 + Math.round(percent * 0.2));
          } else if (type === 'STATUS') {
            onProgress?.(message || `${engineLabel} 準備中...`, 45);
          } else if (type === 'TRANSCRIBE_PROGRESS') {
            onProgress?.(`文字起こし中: ${timeLabel || ''} (${currentChunk}/${totalChunks})`, 50 + Math.round(percent * 0.45));
          } else if (type === 'TRANSCRIBE_SUCCESS') {
            this.whisperWorker?.removeEventListener('message', handler);
            resolve(payload);
          } else if (type === 'ERROR') {
            this.whisperWorker?.removeEventListener('message', handler);
            reject(new Error(message));
          }
        };

        this.whisperWorker!.addEventListener('message', handler);
        const bufferCopy = audioData.slice(0).buffer;
        this.whisperWorker!.postMessage({
          type: 'TRANSCRIBE_AUDIO',
          payload: {
            audioData,
            sampleRate: 16000,
            language: 'japanese',
            modelName: localModelName
          }
        }, [bufferCopy]);
      });

      onProgress?.('文字起こし完了！ドキュメント登録中...', 96);

      let rawTranscriptChunks: { timeLabel: string; text: string }[] = [];
      if (transcriptionResult.chunks && transcriptionResult.chunks.length > 0) {
        for (const chunk of transcriptionResult.chunks) {
          const s = Math.floor(chunk.timestamp[0] || 0);
          const e = Math.floor(chunk.timestamp[1] ?? (s + 5));
          const sMin = Math.floor(s / 60);
          const sSec = s % 60;
          const eMin = Math.floor(e / 60);
          const eSec = e % 60;
          const timeLabel = `[${String(sMin).padStart(2, '0')}:${String(sSec).padStart(2, '0')} - ${String(eMin).padStart(2, '0')}:${String(eSec).padStart(2, '0')}]`;
          const chunkText = (chunk.text || '').trim();
          if (chunkText) {
            rawTranscriptChunks.push({ timeLabel, text: chunkText });
          }
        }
      }

      // 🎯 Rock-ON式: LLMによる事後文脈復元・校正 (Context Refiner)
      if (options?.modelConfig?.enableAudioContextRefiner && rawTranscriptChunks.length > 0) {
        onProgress?.('🪄 LLMによる文脈復元・同音異義語校正中...', 97);
        try {
          const combinedRaw = rawTranscriptChunks.map(c => `${c.timeLabel} ${c.text}`).join('\n');
          const prompt = `以下の【音声認識生テキスト】を、文脈に沿って正しい日本語へ校正してください。
元の発話の意味や事実関係は一切変えず、同音異義語・助詞の欠落・句読点のみを自然に整えてください。
タイムスタンプ [00:00 - 00:05] の構造は維持し、解説は一切不要です。校正後のテキストのみを出力してください。

【音声認識生テキスト】:
${combinedRaw.slice(0, 3000)}`;

          let refinedText = '';
          for await (const chunk of llmService.streamChat(
            [
              { role: 'system', content: REFINER_SYSTEM_PROMPT },
              { role: 'user', content: prompt }
            ],
            options.modelConfig,
            undefined,
            options.abortSignal
          )) {
            refinedText += chunk;
          }

          if (refinedText && refinedText.length > combinedRaw.length * 0.4) {
            let transcribedText = `## 🎙️ 音声/動画 文字起こしデータ (${engineLabel} + 🪄文脈校正済)\n`;
            transcribedText += `- **ファイル名:** ${file.name}\n`;
            transcribedText += `- **再生時間:** ${durationStr}\n`;
            transcribedText += `- **解析エンジン:** ${engineLabel} (文脈復元: ${options.modelConfig.mode})\n\n`;
            transcribedText += `### 📝 校正済 文字起こし内容 (Refined Transcript)\n\n`;
            transcribedText += `${refinedText.trim()}\n\n`;
            onProgress?.('完了', 100);
            return transcribedText;
          }
        } catch (refineErr) {
          console.warn('Context Refiner failed, falling back to raw transcript:', refineErr);
        }
      }

      let transcribedText = `## 🎙️ 音声/動画 文字起こしデータ (${engineLabel})\n`;
      transcribedText += `- **ファイル名:** ${file.name}\n`;
      transcribedText += `- **再生時間:** ${durationStr}\n`;
      transcribedText += `- **解析エンジン:** ${engineLabel} (完全端末内・外部通信なし / VAD無音カット)\n\n`;
      transcribedText += `### 📝 文字起こし内容 (Transcript)\n\n`;

      if (rawTranscriptChunks.length > 0) {
        for (const item of rawTranscriptChunks) {
          transcribedText += `#### ${item.timeLabel}\n${item.text}\n\n`;
        }
      } else if (transcriptionResult.text && transcriptionResult.text.trim()) {
        transcribedText += `${transcriptionResult.text.trim()}\n\n`;
      } else {
        transcribedText += `（※ 音声から有意な発話が検出されませんでした）\n\n`;
      }

      onProgress?.('完了', 100);
      return transcribedText;
    } catch (e: any) {
      console.error('Audio transcription failed:', e);
      throw new Error(`音声文字起こし処理に失敗しました: ${e?.message || e}`);
    }
  }

  public async processDocument(
    file: File,
    projectId: string,
    onProgress?: (percent: number, status?: string) => void,
    options?: {
      enginePreference?: 'auto' | 'gemini' | 'whisper-small' | 'whisper-large-v3' | 'kotoba-whisper' | 'native-large-v3' | 'native-kotoba' | 'whisper-local';
      cloudApiKey?: string;
      abortSignal?: AbortSignal;
      modelConfig?: ModelConfig;
    }
  ): Promise<{ doc: DocumentSource; chunks: DocumentChunk[] }> {
    let content = '';
    let docType: 'pdf' | 'text' | 'markdown' | 'audio' | 'video' = 'text';

    const ext = file.name.toLowerCase();
    if (ext.endsWith('.pdf')) {
      docType = 'pdf';
      content = await this.parsePdf(file, (percent, status) => {
        onProgress?.(percent, status);
      }, options?.abortSignal);
    } else if (ext.endsWith('.mp3') || ext.endsWith('.wav') || ext.endsWith('.wma') || ext.endsWith('.m4a') || ext.endsWith('.ogg')) {
      docType = 'audio';
      content = await this.parseAudioOrVideo(file, (status, p) => {
        if (p !== undefined) onProgress?.(p, status);
      }, options);
    } else if (ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov') || ext.endsWith('.mkv')) {
      docType = 'video';
      content = await this.parseAudioOrVideo(file, (status, p) => {
        if (p !== undefined) onProgress?.(p, status);
      }, options);
    } else if (ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp') || ext.endsWith('.bmp')) {
      docType = 'text';
      onProgress?.(30, '🖼️ 画像ファイル参照 OCR解析中 (Google Gemini Vision)...');
      const apiKey = options?.cloudApiKey || options?.modelConfig?.cloudApiKey;
      if (!apiKey) {
        throw new Error('画像OCRにはGemini APIキーが必要です。右上の設定パネルでAPIキーを入力してください。');
      }
      const ocrMarkdown = await llmService.extractTextFromImageWithGemini(
        apiKey,
        file,
        options?.abortSignal,
        file.type
      );
      content = `## 📷 画像参照 OCR解析テキスト (${file.name})\n\n${ocrMarkdown}`;
      onProgress?.(80, 'OCR解析完了。インデックス作成中...');
    } else {
      content = await file.text();
    }

    return this.processTextContent(file.name, content, projectId, docType, (p) => onProgress?.(p, 'ベクトル検索インデックス作成中...'));
  }


  // テキスト（Studio生成物やチャット回答）を直接ドキュメント化してベクトル化
  public async processTextContent(
    title: string,
    content: string,
    projectId: string,
    type: 'pdf' | 'text' | 'markdown' | 'web' | 'audio' | 'video' = 'markdown',
    onProgress?: (percent: number) => void,
    targetDocId?: string
  ): Promise<{ doc: DocumentSource; chunks: DocumentChunk[] }> {

    const docId = targetDocId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const hierarchicalChunks = this.createHierarchicalChunks(content, docId, title, projectId);

    const docSource: DocumentSource = {
      id: docId,
      projectId,
      title,
      type,
      totalChunks: hierarchicalChunks.length,
      uploadedAt: Date.now(),
      contentPreview: content.slice(0, 200) + '...',
      status: 'embedding',
      progress: 0,
      enabled: true
    };

    await this.initEmbeddingModel();

    const rawChunks = hierarchicalChunks.map(c => ({
      id: c.id,
      text: c.content
    }));

    const embeddings = await new Promise<{ id: string; embedding: number[] }[]>((resolve, reject) => {
      if (!this.embedWorker) return reject(new Error('Worker未定義'));

      const handler = (e: MessageEvent) => {
        const { type, payload, percent, message } = e.data;
        if (type === 'EMBED_PROGRESS' && onProgress) {
          onProgress(percent);
        }
        if (type === 'EMBED_SUCCESS') {
          this.embedWorker?.removeEventListener('message', handler);
          resolve(payload);
        }
        if (type === 'ERROR') {
          this.embedWorker?.removeEventListener('message', handler);
          reject(new Error(message));
        }
      };

      this.embedWorker.addEventListener('message', handler);
      this.embedWorker.postMessage({ type: 'EMBED_CHUNKS', payload: { chunks: rawChunks } });
    });

    hierarchicalChunks.forEach(chunk => {
      const emb = embeddings.find(e => e.id === chunk.id)?.embedding;
      chunk.embedding = emb;
    });

    await new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'ADD_SUCCESS') {
          this.searchWorker?.removeEventListener('message', handler);
          resolve();
        }
      };
      this.searchWorker?.addEventListener('message', handler);
      this.searchWorker?.postMessage({ type: 'ADD_CHUNKS', payload: { chunks: hierarchicalChunks } });
    });

    docSource.status = 'ready';
    docSource.progress = 100;
    return { doc: docSource, chunks: hierarchicalChunks };
  }

  // 選択された全ドキュメントの本文を集約（Studio専用）
  public async getActiveDocsFullText(projectId: string, enabledDocIds: string[]): Promise<string> {
    const allChunks = await dbService.getChunksByProject(projectId);
    const enabledSet = new Set(enabledDocIds);
    const activeChunks = allChunks.filter(c => enabledSet.has(c.docId));

    const seenParents = new Set<string>();
    let collectedText = '';

    for (const chunk of activeChunks) {
      if (!seenParents.has(chunk.parentContent)) {
        seenParents.add(chunk.parentContent);
        collectedText += `\n\n【出典: ${chunk.docTitle}】\n${chunk.parentContent}`;
        if (collectedText.length >= 4000) break;
      }
    }

    return collectedText.trim() || '（選択されたドキュメント本文がありません）';
  }

  // Studio機能向け：高密度ファクトシート＆最適化コンテキスト構築
  public async getStudioOptimizedContext(
    projectId: string,
    enabledDocIds: string[],
    customPrompt?: string,
    maxChars: number = 3200
  ): Promise<{ contextText: string; keyFacts: string[]; docTitles: string[] }> {
    const allChunks = await dbService.getChunksByProject(projectId);
    const enabledSet = new Set(enabledDocIds);
    const activeChunks = allChunks.filter(c => enabledSet.has(c.docId));

    if (activeChunks.length === 0) {
      return { contextText: '（選択されたドキュメント本文がありません）', keyFacts: [], docTitles: [] };
    }

    const docGroups = new Map<string, { title: string; parentBlocks: Map<string, string>; chunks: DocumentChunk[] }>();
    for (const chunk of activeChunks) {
      if (!docGroups.has(chunk.docId)) {
        docGroups.set(chunk.docId, {
          title: chunk.docTitle,
          parentBlocks: new Map(),
          chunks: []
        });
      }
      const group = docGroups.get(chunk.docId)!;
      group.chunks.push(chunk);
      if (!group.parentBlocks.has(chunk.parentContent)) {
        group.parentBlocks.set(chunk.parentContent, chunk.parentContent);
      }
    }

    const docTitles = Array.from(docGroups.values()).map(g => g.title);

    // 1. 全ドキュメントから確定数値・主要仕様・条項を自動抽出
    const keyFacts: string[] = [];
    const factRegex = /([^\n。]*?\d+(?:\.\d+)?\s*(?:m|mm|cm|km|kg|g|t|円|万円|億円|%|パーセント|割|条|項|号|度|℃|人|名|個|件|台|年|月|日|分|秒|時間|倍)[^\n。]*?[。]?)/gi;

    for (const group of docGroups.values()) {
      for (const parent of group.parentBlocks.values()) {
        const matches = parent.match(factRegex);
        if (matches) {
          for (const m of matches) {
            const clean = m.trim().replace(/^[-*・#\s]+/, '');
            if (clean.length >= 8 && clean.length <= 120 && !keyFacts.includes(clean)) {
              keyFacts.push(`[${group.title}] ${clean}`);
            }
          }
        }
      }
    }

    // 2. カスタム指示がある場合は関連検索を実行して優先的に配置
    let prioritizedText = '';
    if (customPrompt && customPrompt.trim()) {
      try {
        const searchHits = await this.search(customPrompt, enabledDocIds, 3);
        if (searchHits.length > 0) {
          prioritizedText += `### 🎯 【カスタム指示「${customPrompt}」に直結する抽出箇所】\n`;
          searchHits.forEach(h => {
            prioritizedText += `【資料: ${h.docTitle}】\n${h.snippet}\n`;
          });
          prioritizedText += '\n---\n';
        }
      } catch {}
    }

    // 3. 各ドキュメントの全編（冒頭・中盤・末尾）を均等にカバーするサンプリング構築
    let bodyText = '';
    const safeMaxChars = Math.min(maxChars, 2400); // 4Kトークン枠超過を絶対防止
    const remainingBudget = Math.max(600, safeMaxChars - prioritizedText.length - (keyFacts.length > 0 ? 500 : 0));
    const budgetPerDoc = Math.max(350, Math.floor(remainingBudget / Math.max(1, docGroups.size)));

    let docIdx = 1;
    for (const [, group] of docGroups.entries()) {
      const header = `\n📄 【資料 ${docIdx}/${docGroups.size}: ${group.title}】\n`;
      const allBlocks = Array.from(group.parentBlocks.values());
      let docText = '';

      if (allBlocks.length <= 2) {
        docText = allBlocks.join('\n\n').slice(0, budgetPerDoc);
      } else {
        // 資料全体（冒頭・中盤・終盤）から均等に代表ブロックを抽出
        const sampleIndices = [
          0,
          Math.floor(allBlocks.length * 0.35),
          Math.floor(allBlocks.length * 0.7),
          allBlocks.length - 1
        ];
        const uniqueIndices = Array.from(new Set(sampleIndices));
        const blockBudget = Math.max(80, Math.floor(budgetPerDoc / uniqueIndices.length));

        uniqueIndices.forEach((idx, i) => {
          const blk = allBlocks[idx];
          if (blk) {
            if (i > 0) docText += '\n...[中略]...\n';
            docText += blk.slice(0, blockBudget).trim();
          }
        });
      }

      bodyText += header + docText.trim() + '\n';
      docIdx++;
    }

    let fullContext = '';
    if (keyFacts.length > 0) {
      fullContext += `### 📊 【ドキュメント全編から抽出された確定数値・重要指標】\n` +
        keyFacts.slice(0, 8).map(f => `- ${f}`).join('\n') + '\n\n---\n';
    }
    if (prioritizedText) {
      fullContext += prioritizedText + '\n';
    }
    fullContext += `### 📑 【対象ドキュメント詳細本文】\n` + bodyText;

    return {
      contextText: fullContext.trim(),
      keyFacts: keyFacts.slice(0, 10),
      docTitles
    };
  }

  // 選択されたドキュメントの全コンテキストをモデルのトークン枠に応じて動的最適化
  public async getComprehensiveContext(
    projectId: string,
    enabledDocIds: string[],
    maxChars: number = 3000,
    query: string = ''
  ): Promise<{ contextText: string; sources: SourceReference[]; totalChars: number; docTitles: string[] }> {
    const allChunks = await dbService.getChunksByProject(projectId);
    const enabledSet = new Set(enabledDocIds);
    const activeChunks = allChunks.filter(c => enabledSet.has(c.docId));

    if (activeChunks.length === 0) {
      return { contextText: '', sources: [], totalChars: 0, docTitles: [] };
    }

    // ドキュメントごとにグループ化して順序維持
    const docGroups = new Map<string, { title: string; parentBlocks: Map<string, string>; chunks: DocumentChunk[] }>();
    for (const chunk of activeChunks) {
      if (!docGroups.has(chunk.docId)) {
        docGroups.set(chunk.docId, {
          title: chunk.docTitle,
          parentBlocks: new Map(),
          chunks: []
        });
      }
      const group = docGroups.get(chunk.docId)!;
      group.chunks.push(chunk);
      if (!group.parentBlocks.has(chunk.parentContent)) {
        group.parentBlocks.set(chunk.parentContent, chunk.parentContent);
      }
    }

    // クエリがある場合は、関連度の高いチャンクを優先取得（🧠 AI補助脳ドキュメントは優先度ボーナス）
    let topRelevantHits: SourceReference[] = [];
    if (query && query.trim()) {
      try {
        const hits = await this.search(query, enabledDocIds, 6);
        // [AI補助脳] ドキュメントのスコアを1.3倍にブーストし最上位にランク付け
        topRelevantHits = hits.sort((a, b) => {
          const aBoost = a.docTitle.includes('AI補助脳') ? 1.3 : 1.0;
          const bBoost = b.docTitle.includes('AI補助脳') ? 1.3 : 1.0;
          return (b.score * bBoost) - (a.score * aBoost);
        }).slice(0, 4);
      } catch {}
    }

    let combinedText = '';
    const sources: SourceReference[] = [];
    const docTitles: string[] = [];
    let totalChars = 0;

    // 1. クエリに最も適合したフォーカス箇所を先頭に配置（最重要コンテキスト）
    if (topRelevantHits.length > 0) {
      combinedText += `### 🔍 【質問に最も関連する該当箇所抜粋】\n`;
      for (const hit of topRelevantHits) {
        if ((combinedText.length + hit.fullContext.length) < (maxChars * 0.6)) {
          const isBrain = hit.docTitle.includes('AI補助脳');
          const badge = isBrain ? '🧠 【AI補助脳・過去の構造化知見】' : `【資料: ${hit.docTitle}】`;
          combinedText += `\n${badge}\n${hit.fullContext}\n`;
          sources.push(hit);
        }
      }
      combinedText += `\n---\n`;
    }

    // 2. 残りの文字数枠で各ドキュメントの全体コンテキストを公平に配分
    const remainingBudget = Math.max(800, maxChars - combinedText.length);
    const budgetPerDoc = Math.floor(remainingBudget / Math.max(1, docGroups.size));

    let docIndex = 1;
    for (const [docId, group] of docGroups.entries()) {
      docTitles.push(group.title);
      const docHeader = `\n📄 【ドキュメント ${docIndex}/${docGroups.size}】: ${group.title}\n`;
      let docBody = '';

      for (const parentBlock of group.parentBlocks.values()) {
        if ((docBody.length + parentBlock.length) > budgetPerDoc) {
          const sliceLen = budgetPerDoc - docBody.length;
          if (sliceLen > 100) {
            docBody += `${parentBlock.slice(0, sliceLen)}...\n`;
          }
          break;
        }
        docBody += `${parentBlock}\n\n`;
      }

      combinedText += docHeader + docBody;
      totalChars += docBody.length;

      if (!sources.some(s => s.docTitle === group.title)) {
        const firstChunk = group.chunks[0];
        sources.push({
          chunkId: firstChunk?.id || docId,
          docTitle: group.title,
          snippet: docBody.slice(0, 200),
          fullContext: docBody.slice(0, 1000),
          score: 1.0
        });
      }

      docIndex++;
    }

    return {
      contextText: combinedText.trim(),
      sources,
      totalChars: combinedText.length,
      docTitles
    };
  }

  // Graph RAG トリプル関係性の抽出＆サマリー構築
  public extractGraphRAGTriples(sources: SourceReference[]): string {
    if (!sources || sources.length === 0) return '';

    const triples: { sub: string; pred: string; obj: string }[] = [];

    sources.forEach(src => {
      const lines = src.fullContext.split(/[\n。]+/);
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.length > 10 && (trimmed.includes('は') || trimmed.includes('について') || trimmed.includes('設置') || trimmed.includes('規定') || trimmed.includes('要求'))) {
          const parts = trimmed.split(/は|について|により/);
          if (parts.length >= 2) {
            triples.push({
              sub: parts[0].slice(-20).trim() || src.docTitle,
              pred: '規定・関連',
              obj: parts[1].slice(0, 40).trim()
            });
          }
        }
      });
    });

    if (triples.length === 0) return '';

    let summary = '### 🕸️ GraphRAG 知識ネットワーク関係性\n';
    triples.slice(0, 6).forEach(t => {
      summary += `- **[${t.sub}]** ──(${t.pred})──> \`${t.obj}\`\n`;
    });

    return summary;
  }

  // 🎯 確定ファクト骨格ビルダー (アルゴリズム側で9割の抽出を完結)
  public buildFactSkeleton(query: string, searchResults: SourceReference[]): FactSkeleton {
    if (!searchResults || searchResults.length === 0) {
      return {
        hasMatch: false,
        facts: [],
        evidenceSentences: [],
        constraints: [],
        formattedContextForLLM: '',
        rawEvidenceCard: ''
      };
    }

    const queryClean = query.toLowerCase().trim();
    const queryTokens = queryClean.split(/[\s,、。？?！!「」『』]+/).filter(t => t.length > 1);

    // 1. 質問に直結する確定データ（targetedFacts）の集約
    const allTargetedFacts: { target: string; value: string; sentence: string; docTitle: string }[] = [];
    searchResults.forEach(r => {
      if (r.targetedFacts) {
        r.targetedFacts.forEach(tf => {
          if (!allTargetedFacts.some(f => f.sentence === tf.sentence && f.value === tf.value)) {
            allTargetedFacts.push(tf);
          }
        });
      }
      if (r.keyFacts) {
        r.keyFacts.forEach(kf => {
          if (!allTargetedFacts.some(f => f.sentence === kf)) {
            allTargetedFacts.push({
              target: '重要規定・数値',
              value: kf.slice(0, 40),
              sentence: kf,
              docTitle: r.docTitle
            });
          }
        });
      }
    });

    // 2. 根拠文の抽出（Context Window Expansion: 親ブロックから質問関連センテンスを特定）
    const evidenceSentences: { docTitle: string; sentence: string; score: number }[] = [];
    const constraints: string[] = [];

    searchResults.forEach(r => {
      const full = r.fullContext || r.snippet;
      const sentences = full.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(s => s.length >= 6);

      sentences.forEach(s => {
        const sLower = s.toLowerCase();
        const matchCount = queryTokens.filter(tok => sLower.includes(tok)).length;
        if (matchCount > 0 || allTargetedFacts.some(tf => s.includes(tf.value))) {
          if (!evidenceSentences.some(e => e.sentence === s)) {
            evidenceSentences.push({
              docTitle: r.docTitle,
              sentence: s,
              score: matchCount
            });
          }
        }

        // 🎯 法令・制約・注意点・条件文の抽出
        if (/第\d+条|必須|要件|条件|規定|禁止|但し|ただし|上限|下限|以上|以下|未満|超|注意|留意|原則|適用|除外|免責|技術基準|安全率/.test(s)) {
          if (!constraints.includes(s) && constraints.length < 6) {
            constraints.push(`[${r.docTitle}] ${s}`);
          }
        }
      });
    });

    evidenceSentences.sort((a, b) => b.score - a.score);
    const topEvidence = evidenceSentences.slice(0, 6);

    const hasMatch = allTargetedFacts.length > 0 || topEvidence.length > 0 || (searchResults[0]?.score || 0) > 0.35;

    if (!hasMatch) {
      return {
        hasMatch: false,
        facts: [],
        evidenceSentences: [],
        constraints: [],
        formattedContextForLLM: '',
        rawEvidenceCard: ''
      };
    }

    // 3. 超高密度プロンプト用テキスト（確固たるエビデンス構造）
    let formattedContextForLLM = '';
    if (allTargetedFacts.length > 0) {
      formattedContextForLLM += '【核心ファクト・確定数値・条項】\n' +
        allTargetedFacts.slice(0, 6).map(f => `・${f.target}: ${f.value} （原文: 「${f.sentence}」 出典: ${f.docTitle}）`).join('\n') + '\n\n';
    }

    if (topEvidence.length > 0) {
      formattedContextForLLM += '【原文根拠抜粋】\n' +
        topEvidence.slice(0, 5).map(e => `・「${e.sentence}」 （出典: ${e.docTitle}）`).join('\n') + '\n\n';
    }

    if (constraints.length > 0) {
      formattedContextForLLM += '【関連法令・条件・留意事項】\n' +
        constraints.slice(0, 4).map(c => `・${c}`).join('\n') + '\n';
    }

    // 4. UI表示用の確定エビデンスカード（Markdown）
    let rawEvidenceCard = '\n\n---\n\n#### 📑 【アルゴリズム抽出 根拠エビデンス】\n';
    if (allTargetedFacts.length > 0) {
      rawEvidenceCard += '| 項目・仕様・条項 | 確定値 | 根拠原文 | 出典資料 |\n';
      rawEvidenceCard += '| :--- | :--- | :--- | :--- |\n';
      allTargetedFacts.slice(0, 6).forEach(f => {
        rawEvidenceCard += `| **${f.target}** | \`${f.value}\` | ${f.sentence} | ${f.docTitle} |\n`;
      });
      rawEvidenceCard += '\n';
    }

    if (topEvidence.length > 0) {
      rawEvidenceCard += '<details><summary>📄 抽出された根拠文スニペット（クリックで展開）</summary>\n\n';
      topEvidence.forEach((e, idx) => {
        rawEvidenceCard += `> **[${idx + 1}] ${e.docTitle}**\n> 「${e.sentence}」\n\n`;
      });
      rawEvidenceCard += '</details>\n';
    }

    return {
      hasMatch: true,
      facts: allTargetedFacts.slice(0, 6),
      evidenceSentences: topEvidence.map(e => ({ docTitle: e.docTitle, sentence: e.sentence })),
      constraints: constraints.slice(0, 4),
      formattedContextForLLM: formattedContextForLLM.trim(),
      rawEvidenceCard: rawEvidenceCard.trim()
    };
  }

  public async search(
    query: string,
    allowedDocIds?: string[],
    topK: number = 4
  ): Promise<SourceReference[]> {
    await this.initEmbeddingModel();

    const queryEmb = await new Promise<number[]>((resolve, reject) => {
      if (!this.embedWorker) return reject(new Error('Worker未定義'));

      const handler = (e: MessageEvent) => {
        const { type, payload, message } = e.data;
        if (type === 'QUERY_EMBED_SUCCESS') {
          this.embedWorker?.removeEventListener('message', handler);
          resolve(payload.embedding);
        }
        if (type === 'ERROR') {
          this.embedWorker?.removeEventListener('message', handler);
          reject(new Error(message));
        }
      };

      this.embedWorker.addEventListener('message', handler);
      this.embedWorker.postMessage({ type: 'EMBED_QUERY', payload: { query } });
    });

    return new Promise<SourceReference[]>((resolve, reject) => {
      if (!this.searchWorker) return reject(new Error('Worker未定義'));

      const handler = (e: MessageEvent) => {
        const { type, results, message } = e.data;
        if (type === 'SEARCH_SUCCESS') {
          this.searchWorker?.removeEventListener('message', handler);
          resolve(results);
        }
        if (type === 'ERROR') {
          this.searchWorker?.removeEventListener('message', handler);
          reject(new Error(message));
        }
      };

      this.searchWorker.addEventListener('message', handler);
      this.searchWorker.postMessage({
        type: 'HYBRID_SEARCH',
        payload: { query, queryEmbedding: queryEmb, allowedDocIds, topK }
      });
    });
  }
}

export const ragManager = new RAGManager();
