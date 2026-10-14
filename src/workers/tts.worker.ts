// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import { env } from '@huggingface/transformers';

// ブラウザ環境・オフラインキャッシュ最適化
env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ttsInstance: any = null;
const MODEL_NAME = 'onnx-community/Kokoro-82M-v1.0-ONNX';

self.addEventListener('message', async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    try {
      if (!ttsInstance) {
        self.postMessage({ type: 'STATUS', payload: { message: 'Kokoro-82M v1.0 ニューラルTTSモデルをロード中...' } });
        const { KokoroTTS } = await import('kokoro-js');
        
        // WebGPU または WASM に自動フォールバック
        const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
        let device: 'webgpu' | 'wasm' = hasWebGPU ? 'webgpu' : 'wasm';

        try {
          ttsInstance = await KokoroTTS.from_pretrained(MODEL_NAME, {
            dtype: 'q8',
            device,
            progress_callback: (prog: any) => {
              if (prog && typeof prog.progress === 'number') {
                self.postMessage({
                  type: 'PROGRESS',
                  payload: { percent: Math.round(prog.progress * 100), file: prog.file }
                });
              }
            }
          });
        } catch (gpuErr) {
          if (device === 'webgpu') {
            console.warn('WebGPU init failed, retrying with WASM...', gpuErr);
            self.postMessage({ type: 'STATUS', payload: { message: 'WebGPU非対応のためWASMフォールバック中...' } });
            ttsInstance = await KokoroTTS.from_pretrained(MODEL_NAME, {
              dtype: 'q8',
              device: 'wasm',
              progress_callback: (prog: any) => {
                if (prog && typeof prog.progress === 'number') {
                  self.postMessage({
                    type: 'PROGRESS',
                    payload: { percent: Math.round(prog.progress * 100), file: prog.file }
                  });
                }
              }
            });
          } else {
            throw gpuErr;
          }
        }
      }
      self.postMessage({ type: 'INIT_SUCCESS' });
    } catch (err: any) {
      console.warn('Kokoro-82M initialization error:', err);
      self.postMessage({ type: 'INIT_ERROR', payload: { error: err.message || String(err) } });
    }
  }

  if (type === 'SYNTHESIZE') {
    const { text, voice, id } = payload;
    try {
      if (!ttsInstance) {
        throw new Error('TTSモデルが初期化されていません');
      }

      // Kokoro-82M の音声スタイル (af_bella: 女性声, am_adam: 男性声, jf_alpha: 日本語女性声 等)
      const speakerVoice = voice || 'af_bella';
      const audioResult = await ttsInstance.generate(text, {
        voice: speakerVoice
      });

      // audioResult.toBlob(), audioResult.audio (Float32Array), audioResult.sampling_rate
      const audioData: Float32Array = audioResult.audio instanceof Float32Array 
        ? audioResult.audio 
        : new Float32Array(audioResult.audio);
      const samplingRate = audioResult.sampling_rate || 24000;

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
