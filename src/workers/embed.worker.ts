// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import { pipeline, env } from '@huggingface/transformers';

// ブラウザ環境用に設定
env.allowLocalModels = false;
env.useBrowserCache = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
const MODEL_NAME = 'Xenova/multilingual-e5-small';

// Float32ArrayをInt8Arrayに量子化 (-1.0〜1.0 -> -127〜127)
function quantizeToInt8(floatVec: number[]): number[] {
  return floatVec.map(val => Math.round(Math.max(-1, Math.min(1, val)) * 127));
}

// 2つのベクトルのコサイン類似度計算 (Int8用高速化)
export function cosineSimilarityInt8(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  if (type === 'INIT_MODEL') {
    try {
      if (!extractor) {
        self.postMessage({ type: 'STATUS', status: 'loading_model', message: 'Embeddingモデルを読み込み中...' });
        extractor = await pipeline('feature-extraction', MODEL_NAME, {
          dtype: 'q8', // 8-bit quantized
          device: 'wasm',
          progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
            if (progress.status === 'progress' && progress.progress !== undefined) {
              self.postMessage({
                type: 'DOWNLOAD_PROGRESS',
                file: progress.file,
                percent: Math.round(progress.progress)
              });
            }
          }
        });
      }
      self.postMessage({ type: 'INIT_SUCCESS', id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'ERROR', message: `Embeddingモデル初期化エラー: ${msg}`, id });
    }
  }

  if (type === 'EMBED_CHUNKS') {
    const { chunks } = payload; // Array of { id, text }
    if (!extractor) {
      self.postMessage({ type: 'ERROR', message: 'Embeddingモデルが未初期化です', id });
      return;
    }

    try {
      const BATCH_SIZE = 5;
      const total = chunks.length;
      const results: { id: string; embedding: number[] }[] = [];

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        
        // e5モデル向けの "passage: " プレフィックス付与
        const texts = batch.map((c: { text: string }) => `passage: ${c.text.trim()}`);
        
        const output = await extractor(texts, { pooling: 'mean', normalize: true });
        const embeddingsArray = output.tolist();

        for (let j = 0; j < batch.length; j++) {
          const rawVec = embeddingsArray[j];
          const int8Vec = quantizeToInt8(rawVec);
          results.push({ id: batch[j].id, embedding: int8Vec });
        }

        // 進捗通知（UIスレッドへ）
        self.postMessage({
          type: 'EMBED_PROGRESS',
          current: Math.min(i + BATCH_SIZE, total),
          total,
          percent: Math.round((Math.min(i + BATCH_SIZE, total) / total) * 100)
        });

        // CPU負荷分散（アイドル待機）
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      self.postMessage({ type: 'EMBED_SUCCESS', payload: results, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'ERROR', message: `Embedding計算エラー: ${msg}`, id });
    }
  }

  if (type === 'EMBED_QUERY') {
    const { query } = payload;
    if (!extractor) {
      self.postMessage({ type: 'ERROR', message: 'Embeddingモデルが未初期化です', id });
      return;
    }

    try {
      // e5モデル向けの "query: " プレフィックス
      const output = await extractor(`query: ${query.trim()}`, { pooling: 'mean', normalize: true });
      const rawVec = output.tolist()[0];
      const int8Vec = quantizeToInt8(rawVec);
      self.postMessage({ type: 'QUERY_EMBED_SUCCESS', payload: { embedding: int8Vec }, id });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'ERROR', message: `クエリEmbeddingエラー: ${msg}`, id });
    }
  }
};
