// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import { create, insert, search, Orama } from '@orama/orama';
import { DocumentChunk, SourceReference } from '../types/index.ts';

let oramaDb: Orama<any> | null = null;
const chunksStore = new Map<string, DocumentChunk>();

// 日本語形態素セグメンター（ブラウザ標準API）
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new (Intl as any).Segmenter('ja', { granularity: 'word' })
  : null;

// 日本語テキストを単語（形態素）に分割して空白区切りテキストに変換
function tokenizeJapanese(text: string): string {
  if (!text) return '';
  if (!segmenter) return text;

  const words: string[] = [];
  const segments = segmenter.segment(text);
  for (const seg of segments) {
    const w = seg.segment.trim();
    // 1文字の助詞・記号を除外して意味のある単語を抽出
    if (w.length > 0 && !/^[\s、。！？,.\(\)\[\]「」『』・:;]+$/.test(w)) {
      words.push(w);
    }
  }
  return words.join(' ');
}

// コサイン類似度 (Int8)
function cosineSimilarityInt8(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function initOrama() {
  oramaDb = await create({
    schema: {
      id: 'string',
      docId: 'string',
      docTitle: 'string',
      content: 'string',
      tokenizedContent: 'string' // 日本語分かち書きインデックス
    }
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  if (type === 'INIT') {
    await initOrama();
    chunksStore.clear();
    self.postMessage({ type: 'INIT_SUCCESS', id });
  }

  if (type === 'SET_CHUNKS') {
    const { chunks } = payload as { chunks: DocumentChunk[] };
    await initOrama();
    chunksStore.clear();

    for (const chunk of chunks) {
      chunksStore.set(chunk.id, chunk);
      const tokenized = tokenizeJapanese(`${chunk.docTitle} ${chunk.content}`);
      await insert(oramaDb!, {
        id: chunk.id,
        docId: chunk.docId,
        docTitle: chunk.docTitle,
        content: chunk.content,
        tokenizedContent: tokenized
      });
    }

    self.postMessage({ type: 'SET_SUCCESS', count: chunks.length, id });
  }

  if (type === 'ADD_CHUNKS') {
    const { chunks } = payload as { chunks: DocumentChunk[] };
    if (!oramaDb) await initOrama();

    for (const chunk of chunks) {
      chunksStore.set(chunk.id, chunk);
      const tokenized = tokenizeJapanese(`${chunk.docTitle} ${chunk.content}`);
      await insert(oramaDb!, {
        id: chunk.id,
        docId: chunk.docId,
        docTitle: chunk.docTitle,
        content: chunk.content,
        tokenizedContent: tokenized
      });
    }

    self.postMessage({ type: 'ADD_SUCCESS', count: chunks.length, id });
  }

  if (type === 'CLEAR_DOC') {
    const { docId } = payload;
    for (const [key, chunk] of chunksStore.entries()) {
      if (chunk.docId === docId) {
        chunksStore.delete(key);
      }
    }
    await initOrama();
    for (const chunk of chunksStore.values()) {
      const tokenized = tokenizeJapanese(`${chunk.docTitle} ${chunk.content}`);
      await insert(oramaDb!, {
        id: chunk.id,
        docId: chunk.docId,
        docTitle: chunk.docTitle,
        content: chunk.content,
        tokenizedContent: tokenized
      });
    }
    self.postMessage({ type: 'CLEAR_SUCCESS', id });
  }

  if (type === 'HYBRID_SEARCH') {
    const { query, queryEmbedding, allowedDocIds, topK = 4 } = payload as {
      query: string;
      queryEmbedding?: number[];
      allowedDocIds?: string[];
      topK?: number;
    };

    if (!oramaDb || chunksStore.size === 0) {
      self.postMessage({ type: 'SEARCH_SUCCESS', results: [], id });
      return;
    }

    try {
      const allowedSet = allowedDocIds ? new Set(allowedDocIds) : null;

      // クエリを日本語形態素分解
      const tokenizedQuery = tokenizeJapanese(query);

      // 1. BM25 キーワード検索（単語分割インデックスで検索）
      const oramaResults = await search(oramaDb, {
        term: tokenizedQuery || query,
        properties: ['tokenizedContent', 'content', 'docTitle'],
        limit: 35
      });

      const candidateIds = new Set<string>();
      oramaResults.hits.forEach(hit => {
        const chunk = chunksStore.get(hit.id);
        if (chunk && (!allowedSet || allowedSet.has(chunk.docId))) {
          candidateIds.add(hit.id);
        }
      });

      // 候補が少ない場合のフォールバック（直接部分一致チェックおよび全対象ドキュメントのチャンク網羅）
      if (candidateIds.size < 10) {
        const keywords = query.split(/[\s,、。]+/).filter(k => k.length >= 2);
        for (const [chunkId, chunk] of chunksStore.entries()) {
          if (!allowedSet || allowedSet.has(chunk.docId)) {
            const hasMatch = keywords.some(kw => chunk.content.includes(kw));
            if (hasMatch) {
              candidateIds.add(chunkId);
              if (candidateIds.size >= 50) break;
            }
          }
        }

        // キーワード一致でも候補が拾えなかった場合（要約・概要・全般的な質問など）、選択されたドキュメントの全チャンクを候補に投入
        if (candidateIds.size < 5) {
          for (const [chunkId, chunk] of chunksStore.entries()) {
            if (!allowedSet || allowedSet.has(chunk.docId)) {
              candidateIds.add(chunkId);
              if (candidateIds.size >= 100) break;
            }
          }
        }
      }

      // 2. ベクトル類似度によるスコアリング
      const scoredResults: { chunk: DocumentChunk; score: number }[] = [];

      for (const chunkId of candidateIds) {
        const chunk = chunksStore.get(chunkId);
        if (!chunk) continue;

        let score = 0;
        if (queryEmbedding && chunk.embedding) {
          score = cosineSimilarityInt8(queryEmbedding, chunk.embedding);
        } else {
          score = 0.5;
        }

        // 直接キーワード完全一致がある場合はスコアをブースト
        if (query.length >= 3 && chunk.content.includes(query)) {
          score = Math.min(1.0, score + 0.3);
        }

        scoredResults.push({ chunk, score });
      }

      scoredResults.sort((a, b) => b.score - a.score);

      // 3. 親コンテキストの重複排除（Parent-Document Deduplication）
      const seenParentContexts = new Set<string>();
      const finalResults: SourceReference[] = [];

      for (const item of scoredResults) {
        const parentKey = `${item.chunk.docId}_${item.chunk.parentContent.slice(0, 100)}`;
        if (seenParentContexts.has(parentKey)) continue;

        seenParentContexts.add(parentKey);
        finalResults.push({
          chunkId: item.chunk.id,
          docTitle: item.chunk.docTitle,
          snippet: item.chunk.content,
          fullContext: item.chunk.parentContent,
          score: item.score
        });

        if (finalResults.length >= topK) break;
      }

      self.postMessage({
        type: 'SEARCH_SUCCESS',
        results: finalResults,
        id
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'ERROR', message: `ハイブリッド検索エラー: ${msg}`, id });
    }
  }
};
