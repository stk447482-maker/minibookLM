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

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playLineWebSpeech(currentLineIndex);
    }
  };

  const [engineMode, setEngineMode] = useState<'google' | 'kokoro'>('google');
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
        const onInitMsg = (e: MessageEvent) => {
          if (e.data.type === 'INIT_SUCCESS') {
            worker.removeEventListener('message', onInitMsg);
            ttsWorkerRef.current = worker;
            resolve(worker);
          } else if (e.data.type === 'INIT_ERROR') {
            worker.removeEventListener('message', onInitMsg);
            reject(new Error(e.data.payload.error));
          } else if (e.data.type === 'PROGRESS') {
            setSynthesisProgress(e.data.payload.percent || 10);
          } else if (e.data.type === 'STATUS') {
            setSynthesisStatus(e.data.payload.message || 'ロード中...');
          }
        };

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

          const voice = line.isHost ? 'am_adam' : 'af_bella';
          const pcmData: { audioData: Float32Array; samplingRate: number } = await new Promise((resolve, reject) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data.type === 'SYNTHESIZE_SUCCESS' && e.data.payload.id === i) {
                worker.removeEventListener('message', onMsg);
                resolve(e.data.payload);
              } else if (e.data.type === 'SYNTHESIZE_ERROR' && e.data.payload.id === i) {
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
      } else {
        // --- ☁️ Google Cloud Neural2 ---
        const apiKey = config?.cloudApiKey;
        if (!apiKey) {
          alert('Google Neural2 音声合成には、右上の「設定」からGemini APIキーの登録が必要です。\n（※APIキー不要で使いたい場合は「⚡ Kokoro WebGPU」を選択してください）');
          setIsSynthesizing(false);
          return;
        }

        setSynthesisStatus('Google Neural2 サーバーに接続中...');
        for (let i = 0; i < parsedLines.length; i++) {
          const line = parsedLines[i];
          const speakerLabel = line.isHost ? 'アレックス (ホスト)' : 'サクラ (解説)';
          setSynthesisStatus(`[${i + 1}/${parsedLines.length}] ${speakerLabel} を音声合成中...`);

          const pcmBytes = await llmService.synthesizeSpeechWithGoogle(apiKey, line.text, line.isHost);
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
      {/* プレーヤーコントロール */}
      <div className="bg-gradient-to-r from-indigo-950/80 via-slate-900 to-violet-950/80 border border-indigo-500/30 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-100 flex items-center space-x-1.5">
                <span>AI ポッドキャスト オーディオ</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                  2話者対話
                </span>
              </h4>
              <p className="text-[10px] text-slate-400">
                {isPlaying ? '🎙️ 再生中' : '⏹️ 停止中'} • {currentLineIndex} / {parsedLines.length} 行
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* エンジン切り替えタブ */}
            {!synthesizedAudioUrl && (
              <div className="flex items-center bg-slate-800/80 p-0.5 rounded-xl border border-slate-700 text-[10px] font-semibold">
                <button
                  type="button"
                  onClick={() => setEngineMode('google')}
                  className={`px-2 py-1 rounded-lg transition-all ${
                    engineMode === 'google'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Google Neural2: 最高品質・自然な対話（Gemini APIキー利用）"
                >
                  ☁️ Google
                </button>
                <button
                  type="button"
                  onClick={() => setEngineMode('kokoro')}
                  className={`px-2 py-1 rounded-lg transition-all ${
                    engineMode === 'kokoro'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Kokoro-82M: ローカルWebGPU完全無料・高速実行"
                >
                  ⚡ Kokoro
                </button>
              </div>
            )}

            {!synthesizedAudioUrl ? (
              <button
                onClick={handleGenerateNeuralPodcast}
                disabled={isSynthesizing || parsedLines.length === 0}
                className="py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all text-xs font-bold flex items-center space-x-1.5 active:scale-95 disabled:opacity-50"
                title="Google Neural2最高音質でポッドキャスト音声を一括生成"
              >
                {isSynthesizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span className="text-[11px]">{synthesisProgress}%</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-200 fill-amber-200" />
                    <span className="text-[11px]">✨ 超高音質AI音声を生成</span>
                  </>
                )}
              </button>
            ) : (
              <a
                href={synthesizedAudioUrl}
                download={`Podcast_${Date.now()}.wav`}
                className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-emerald-600/30"
                title="生成されたポッドキャスト音声をWAVとしてダウンロード"
              >
                <Download className="w-4 h-4" />
                <span className="text-[11px]">音声保存 (.WAV)</span>
              </a>
            )}

            <button
              onClick={handleReset}
              className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
              title="最初から"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleTogglePlay}
              className="p-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all shadow-md shadow-indigo-600/30 active:scale-95"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
          </div>
        </div>

        {isSynthesizing && synthesisStatus && (
          <div className="bg-indigo-950/60 border border-indigo-500/40 rounded-xl p-2.5 flex items-center space-x-2 text-xs text-indigo-200 animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />
            <span className="truncate">{synthesisStatus}</span>
          </div>
        )}

        {synthesizedAudioUrl && (
          <audio
            ref={audioRef}
            src={synthesizedAudioUrl}
            onEnded={() => setIsPlaying(false)}
            controls
            className="w-full h-8 mt-2"
          />
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
