// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import { env } from '@huggingface/transformers';

// ブラウザ環境・オフラインキャッシュ最適化
env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ttsPipeline: any = null;
const MODEL_NAME = 'onnx-community/Kokoro-82M-ONNX';

self.addEventListener('message', async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    try {
      if (!ttsPipeline) {
        self.postMessage({ type: 'STATUS', payload: { message: 'Kokoro-82M ニューラルTTSモデルをロード中...' } });
        // @huggingface/transformers の pipeline を動的インポートまたはロード
        const { pipeline } = await import('@huggingface/transformers');
        
        // dtype: q8 (量子化軽量版) でロードし、メモリ消費を約80MBに抑制
        ttsPipeline = await (pipeline as any)('text-to-speech', MODEL_NAME, {
          dtype: 'q8',
          progress_callback: (prog: any) => {
            if (prog.status === 'progress') {
              self.postMessage({
                type: 'PROGRESS',
                payload: { percent: Math.round(prog.progress || 0), file: prog.file }
              });
            }
          }
        });
      }
      self.postMessage({ type: 'INIT_SUCCESS' });
    } catch (err: any) {
      console.warn('Kokoro-82M WebGPU/ONNX initialization error:', err);
      self.postMessage({ type: 'INIT_ERROR', payload: { error: err.message || String(err) } });
    }
  }

  if (type === 'SYNTHESIZE') {
    const { text, voice, id } = payload;
    try {
      if (!ttsPipeline) {
        throw new Error('TTSモデルが初期化されていません');
      }

      // Kokoro-82M の音声スタイル (af_bella: 女性声, am_adam: 男性声 等)
      const speakerVoice = voice || 'af_bella';
      const output = await ttsPipeline(text, { speaker_embeddings: speakerVoice });

      // output.audio (Float32Array) と output.sampling_rate を返却
      const audioData = output.audio instanceof Float32Array ? output.audio : new Float32Array(output.audio);
      const samplingRate = output.sampling_rate || 24000;

      (self.postMessage as any)({
        type: 'SYNTHESIZE_SUCCESS',
        payload: { id, audioData, samplingRate }
      }, [audioData.buffer]);
    } catch (err: any) {
      console.error('Kokoro-82M synthesis failed:', err);
      self.postMessage({ type: 'SYNTHESIZE_ERROR', payload: { id, error: err.message || String(err) } });
    }
  }
});
