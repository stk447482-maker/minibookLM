import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Loader2, Mic, Sparkles } from 'lucide-react';
import { marked } from 'marked';
import { ModelConfig } from '../../types/index.ts';
import { createWavBlobFromFloat32 } from '../../services/audioDecoder.ts';
import { llmService } from '../../services/llmService.ts';

interface PodcastPlayerProps {
  script: string;
  config?: ModelConfig;
}

interface DialogueLine {
  speaker: string;
  isHost: boolean;
  text: string;
}

export const PodcastPlayer: React.FC<PodcastPlayerProps> = ({ script, config }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesizedAudioUrl, setSynthesizedAudioUrl] = useState<string | null>(null);
  const [synthesisProgress, setSynthesisProgress] = useState<number>(0);
  const [synthesisStatus, setSynthesisStatus] = useState<string>('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 会話行の厳密なパース（アレックス / サクラ / ホスト / ゲスト等の柔軟判定）
  const parsedLines: DialogueLine[] = React.useMemo(() => {
    const rawLines = script.split('\n').map(l => l.trim()).filter(Boolean);
    const results: DialogueLine[] = [];

    for (const line of rawLines) {
      const clean = line.replace(/^\*+|\*+$/g, '').trim();
      const match = clean.match(/^([^:：]+)[:：]\s*(.+)$/);
      if (match) {
        const speaker = match[1].trim();
        const text = match[2].trim();
        const isHost = speaker.includes('アレックス') || speaker.includes('Alex') || speaker.includes('ホスト');
        results.push({ speaker, isHost, text });
      } else if (results.length > 0 && !clean.startsWith('#') && !clean.startsWith('---')) {
        results[results.length - 1].text += ` ${clean}`;
      }
    }
    return results;
  }, [script]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      if (synthesizedAudioUrl) {
        URL.revokeObjectURL(synthesizedAudioUrl);
      }
    };
  }, [synthesizedAudioUrl]);

  // 1. Web Speech APIによるフォールバック再生
  const playLineWebSpeech = (index: number) => {
    if (index >= parsedLines.length) {
      setIsPlaying(false);
      setCurrentLineIndex(0);
      return;
    }

    window.speechSynthesis.cancel();
    const line = parsedLines[index];
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.lang = 'ja-JP';
    utterance.pitch = line.isHost ? 0.92 : 1.15;
    utterance.rate = line.isHost ? 1.02 : 1.08;

    const voices = window.speechSynthesis.getVoices();
    const jaVoices = voices.filter(v => v.lang.startsWith('ja') || v.lang.includes('JP'));
    if (jaVoices.length > 0) {
      const maleVoice = jaVoices.find(v => /ichiro|keita|otoya|male|男/i.test(v.name));
      const femaleVoice = jaVoices.find(v => /haruka|ayumi|nanami|sayaka|kyoko|female|女|google/i.test(v.name));
      utterance.voice = line.isHost ? (maleVoice || jaVoices[0]) : (femaleVoice || jaVoices[1] || jaVoices[0]);
    }

    utterance.onend = () => {
      setCurrentLineIndex(index + 1);
      if (index + 1 < parsedLines.length) {
        playLineWebSpeech(index + 1);
      } else {
        setIsPlaying(false);
        setCurrentLineIndex(0);
      }
    };

    utterance.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utterance);
  };

  const [engineMode, setEngineMode] = useState<'google' | 'voicevox' | 'kokoro'>(
    config?.podcastTtsEngine === 'google' || config?.podcastTtsEngine === 'kokoro' 
      ? config.podcastTtsEngine 
      : 'voicevox'
  );
  const [speakingRate, setSpeakingRate] = useState<number>(config?.podcastSpeakingRate || 1.05);

  useEffect(() => {
    if (config?.podcastTtsEngine && config.podcastTtsEngine !== 'webspeech') {
      setEngineMode(config.podcastTtsEngine as any);
    }
  }, [config?.podcastTtsEngine]);

  const handleTogglePlay = () => {
    if (synthesizedAudioUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    // まだ高音質AI音声が生成されていない場合、自動的にニューラル音声生成をトリガー
    if (!isSynthesizing) {
      handleGenerateNeuralPodcast();
    }
  };

  const ttsWorkerRef = useRef<Worker | null>(null);

  const handleReset = () => {
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentLineIndex(0);
  };

  // Kokoro Web Workerの初期化
  const getTTSWorker = (): Promise<Worker> => {
    return new Promise((resolve, reject) => {
      if (ttsWorkerRef.current) return resolve(ttsWorkerRef.current);

      try {
        const worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), { type: 'module' });
        
        // 120秒の初期化タイムアウト（初回ONNXモデルダウンロード用）
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error('Kokoro-82Mモデルの読み込みがタイムアウトしました。通信環境を確認するか「☁️ Google」モードをお試しください。'));
        }, 120000);

        const onInitMsg = (e: MessageEvent) => {
          if (e.data.type === 'INIT_SUCCESS') {
            clearTimeout(timer);
            worker.removeEventListener('message', onInitMsg);
            ttsWorkerRef.current = worker;
            resolve(worker);
          } else if (e.data.type === 'INIT_ERROR') {
            clearTimeout(timer);
            worker.removeEventListener('message', onInitMsg);
            worker.terminate();
            reject(new Error(e.data.payload.error));
          } else if (e.data.type === 'PROGRESS') {
            setSynthesisProgress(e.data.payload.percent || 10);
          } else if (e.data.type === 'STATUS') {
            setSynthesisStatus(e.data.payload.message || 'ロード中...');
          }
        };

        worker.addEventListener('error', (errEvt) => {
          clearTimeout(timer);
          worker.removeEventListener('message', onInitMsg);
          reject(new Error(`Web Worker起動エラー: ${errEvt.message}`));
        });

        worker.addEventListener('message', onInitMsg);
        worker.postMessage({ type: 'INIT' });
      } catch (err) {
        reject(err);
      }
    });
  };

  // 🎯 2. 【本家NotebookLM品質】音声合成パイプライン (Google Neural2 または Kokoro-82M WebGPU)
  const handleGenerateNeuralPodcast = async () => {
    if (isSynthesizing || parsedLines.length === 0) return;

    setIsSynthesizing(true);
    setSynthesisProgress(5);

    try {
      const audioBuffers: Float32Array[] = [];
      let sampleRate = 24000;

      if (engineMode === 'kokoro') {
        // --- ⚡ Kokoro-82M (WebGPU / 完全無料ローカル) ---
        setSynthesisStatus('Kokoro-82M ニューラルTTSエンジンを準備中...');
        const worker = await getTTSWorker();

        for (let i = 0; i < parsedLines.length; i++) {
          const line = parsedLines[i];
          const speakerLabel = line.isHost ? 'アレックス (ホスト)' : 'サクラ (解説)';
          setSynthesisStatus(`[${i + 1}/${parsedLines.length}] ${speakerLabel} をローカル推論中...`);

          // Kokoro-82M 有効ボイス: ホスト(男性)=am_adam, ゲスト(女性)=af_bella (最高品質ボイス)
          const voice = line.isHost ? 'am_adam' : 'af_bella';
          const pcmData: { audioData: Float32Array; samplingRate: number } = await new Promise((resolve, reject) => {
            const lineTimer = setTimeout(() => {
              worker.removeEventListener('message', onMsg);
              reject(new Error(`「${line.text.slice(0, 15)}...」の音声合成がタイムアウトしました`));
            }, 60000);

            const onMsg = (e: MessageEvent) => {
              if (e.data.type === 'SYNTHESIZE_SUCCESS' && e.data.payload.id === i) {
                clearTimeout(lineTimer);
                worker.removeEventListener('message', onMsg);
                resolve(e.data.payload);
              } else if (e.data.type === 'SYNTHESIZE_ERROR' && e.data.payload.id === i) {
                clearTimeout(lineTimer);
                worker.removeEventListener('message', onMsg);
                reject(new Error(e.data.payload.error));
              }
            };
            worker.addEventListener('message', onMsg);
            worker.postMessage({
              type: 'SYNTHESIZE',
              payload: { id: i, text: line.text, voice }
            });
          });

          sampleRate = pcmData.samplingRate;
          audioBuffers.push(pcmData.audioData);

          // 0.25秒のポーズ
          const pauseSamples = Math.floor(0.25 * sampleRate);
          audioBuffers.push(new Float32Array(pauseSamples));
          setSynthesisProgress(10 + Math.round(((i + 1) / parsedLines.length) * 85));
        }
      } else if (engineMode === 'voicevox') {
        // --- 🎌 VOICEVOX (案B: 日本語完璧・自然な肉声TTS) ---
        sampleRate = 24000;
        setSynthesisStatus('VOICEVOX 音声合成エンジンに接続中...');
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

        for (let i = 0; i < parsedLines.length; i++) {
          const line = parsedLines[i];
          const speakerLabel = line.isHost ? '青山龍星 (ホスト)' : '四国めたん (解説)';
          setSynthesisStatus(`[${i + 1}/${parsedLines.length}] ${speakerLabel} を音声合成中...`);

          const audioBytes = await llmService.synthesizeSpeechWithVoicevox(line.text, line.isHost, speakingRate);
          
          // AudioContext でデコードして Float32Array を抽出
          const arrayBufferCopy = audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength) as ArrayBuffer;
          const audioBuffer = await audioCtx.decodeAudioData(arrayBufferCopy);
          const channelData = audioBuffer.getChannelData(0);
          sampleRate = audioBuffer.sampleRate;

          audioBuffers.push(new Float32Array(channelData));
          const pauseSamples = Math.floor(0.25 * sampleRate);
          audioBuffers.push(new Float32Array(pauseSamples));

          setSynthesisProgress(5 + Math.round(((i + 1) / parsedLines.length) * 90));
        }
      } else {
        // --- ☁️ Google Cloud Neural2 ---
        const apiKey = config?.cloudApiKey;
        if (!apiKey) {
          alert('Google Neural2 音声合成には、右上の「設定」からGemini APIキーの登録が必要です。\n（※APIキー不要で使いたい場合は「🎌 VOICEVOX」または「⚡ Kokoro」を選択してください）');
          setIsSynthesizing(false);
          return;
        }

        setSynthesisStatus('Google Neural2 サーバーに接続中...');
        for (let i = 0; i < parsedLines.length; i++) {
          const line = parsedLines[i];
          const speakerLabel = line.isHost ? 'アレックス (ホスト)' : 'サクラ (解説)';
          setSynthesisStatus(`[${i + 1}/${parsedLines.length}] ${speakerLabel} を音声合成中...`);

          const pcmBytes = await llmService.synthesizeSpeechWithGoogle(apiKey, line.text, line.isHost, speakingRate);
          const dataOffset = pcmBytes.length > 44 && String.fromCharCode(...pcmBytes.slice(0, 4)) === 'RIFF' ? 44 : 0;
          const pcmView = new DataView(pcmBytes.buffer, pcmBytes.byteOffset + dataOffset, pcmBytes.byteLength - dataOffset);
          const numSamples = Math.floor(pcmView.byteLength / 2);
          const floatSamples = new Float32Array(numSamples);

          for (let s = 0; s < numSamples; s++) {
            const int16 = pcmView.getInt16(s * 2, true);
            floatSamples[s] = int16 / 32768.0;
          }

          audioBuffers.push(floatSamples);
          const pauseSamples = Math.floor(0.25 * sampleRate);
          audioBuffers.push(new Float32Array(pauseSamples));

          setSynthesisProgress(5 + Math.round(((i + 1) / parsedLines.length) * 90));
        }
      }

      setSynthesisStatus('オーディオトラックを結合・マスタリング中...');

      const totalLen = audioBuffers.reduce((acc, c) => acc + c.length, 0);
      const combined = new Float32Array(totalLen);
      let offset = 0;
      for (const chunk of audioBuffers) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const wavBlob = createWavBlobFromFloat32(combined, sampleRate);
      const url = URL.createObjectURL(wavBlob);
      setSynthesizedAudioUrl(url);

      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play();
          setIsPlaying(true);
        }
      }, 300);
    } catch (err: any) {
      console.error('Neural podcast synthesis failed:', err);
      alert(`ニューラル音声合成エラー: ${err?.message || err}`);
    } finally {
      setIsSynthesizing(false);
      setSynthesisProgress(0);
      setSynthesisStatus('');
    }
  };

  return (
    <div className="space-y-4">
      {/* プレーヤーコントロール（洗練されたモダンオーディオデッキ） */}
      <div className="bg-gradient-to-b from-slate-900 to-indigo-950/70 border border-indigo-500/30 rounded-2xl p-4 shadow-xl space-y-4">
        {/* 上段: ステータス ＆ 設定バー */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-800/80 gap-2.5">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <span>AI ポッドキャスト</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                  2話者対話 ({parsedLines.length} 行)
                </span>
              </h4>
            </div>
          </div>

          {/* 音声エンジン & 速度設定ピル */}
          <div className="flex items-center space-x-1.5 self-start sm:self-auto">
            <div className="flex items-center bg-slate-950/90 rounded-lg border border-slate-800 p-0.5 text-[10px]">
              <span className="text-slate-400 px-1.5 font-medium">エンジン:</span>
              <button
                type="button"
                onClick={() => setEngineMode('voicevox')}
                className={`px-2 py-0.5 rounded-md transition-all font-bold ${
                  engineMode === 'voicevox'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🎌 VOICEVOX
              </button>
              <button
                type="button"
                onClick={() => setEngineMode('google')}
                className={`px-2 py-0.5 rounded-md transition-all font-bold ${
                  engineMode === 'google'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ☁️ Google
              </button>
              <button
                type="button"
                onClick={() => setEngineMode('kokoro')}
                className={`px-2 py-0.5 rounded-md transition-all font-bold ${
                  engineMode === 'kokoro'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ⚡ Kokoro
              </button>
            </div>

            <div className="flex items-center bg-slate-950/90 rounded-lg border border-slate-800 px-2 py-1 text-[10px]">
              <span className="text-slate-400 mr-1 font-medium">速度:</span>
              <select
                value={speakingRate}
                onChange={(e) => setSpeakingRate(parseFloat(e.target.value))}
                className="bg-transparent text-slate-200 font-bold outline-none cursor-pointer"
              >
                <option value="0.85" className="bg-slate-900 text-slate-100">0.85x</option>
                <option value="1.0" className="bg-slate-900 text-slate-100">1.0x</option>
                <option value="1.05" className="bg-slate-900 text-slate-100">1.05x (標準)</option>
                <option value="1.15" className="bg-slate-900 text-slate-100">1.15x</option>
                <option value="1.3" className="bg-slate-900 text-slate-100">1.3x</option>
              </select>
            </div>
          </div>
        </div>

        {/* 中段: メインオーディオコントロール（中央揃え・明快な役割分担） */}
        <div className="flex items-center justify-between sm:justify-center sm:space-x-6 py-1">
          {/* 巻き戻し・最初から */}
          <button
            onClick={handleReset}
            className="flex items-center space-x-1 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all text-xs font-medium border border-slate-700/60"
            title="最初から再生"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">最初から</span>
          </button>

          {/* メイン主役ボタン: 再生 / 一時停止 / AI音声生成 */}
          <button
            onClick={handleTogglePlay}
            disabled={isSynthesizing}
            className={`px-6 py-2.5 rounded-xl font-bold text-xs flex items-center space-x-2 transition-all shadow-lg active:scale-95 disabled:opacity-50 ${
              synthesizedAudioUrl
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-600/30 ring-1 ring-white/10'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-600/30'
            }`}
          >
            {isSynthesizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>AI音声合成中 ({synthesisProgress}%)</span>
              </>
            ) : isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                <span>一時停止</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>{synthesizedAudioUrl ? '再生する' : '✨ 自然なAI音声で再生'}</span>
              </>
            )}
          </button>

          {/* 右サイド: 保存ボタン または 生成ボタン */}
          {synthesizedAudioUrl ? (
            <a
              href={synthesizedAudioUrl}
              download={`Podcast_${Date.now()}.wav`}
              className="flex items-center space-x-1 px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 hover:text-emerald-200 transition-all text-xs font-bold border border-emerald-500/40"
              title="生成したWAV音声を保存"
            >
              <Download className="w-3.5 h-3.5" />
              <span>WAV保存</span>
            </a>
          ) : (
            <button
              onClick={handleGenerateNeuralPodcast}
              disabled={isSynthesizing}
              className="flex items-center space-x-1 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 transition-all text-xs font-medium border border-slate-700/60 disabled:opacity-50"
              title="事前に音声を生成して保存可能にします"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline">事前生成</span>
            </button>
          )}
        </div>

        {/* 下段: 進捗状況 & オーディオプレイヤー */}
        {isSynthesizing && synthesisStatus && (
          <div className="bg-indigo-950/60 border border-indigo-500/40 rounded-xl p-2.5 flex items-center space-x-2 text-xs text-indigo-200 animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            <span className="truncate">{synthesisStatus}</span>
          </div>
        )}

        {synthesizedAudioUrl && (
          <div className="pt-2 border-t border-slate-800/60">
            <audio
              ref={audioRef}
              src={synthesizedAudioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              controls
              className="w-full h-8 outline-none"
            />
          </div>
        )}
      </div>

      {/* スクリプト会話タイムライン表示 */}
      <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 text-xs leading-relaxed max-h-72 overflow-y-auto space-y-2.5">
        {parsedLines.length === 0 ? (
          <div className="prose prose-invert prose-sm" dangerouslySetInnerHTML={{ __html: marked.parse(script) as string }} />
        ) : (
          parsedLines.map((line, idx) => (
            <div
              key={idx}
              className={`p-2.5 rounded-xl border transition-all ${
                idx === currentLineIndex && isPlaying
                  ? 'bg-indigo-950/60 border-indigo-500/60 shadow-md ring-1 ring-indigo-500/30'
                  : 'bg-slate-900/50 border-slate-800/80 text-slate-300'
              }`}
            >
              <div className="flex items-center space-x-1.5 mb-1 font-bold">
                <span className={`w-2 h-2 rounded-full ${line.isHost ? 'bg-sky-400' : 'bg-emerald-400'}`} />
                <span className={line.isHost ? 'text-sky-300' : 'text-emerald-300'}>
                  {line.speaker}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed pl-3.5 text-slate-200">{line.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
