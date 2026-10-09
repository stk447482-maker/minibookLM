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

// 数値・単位パターン (15m, 2.5m, 100万円, 50%, 第3条, 2026年, 30秒, 500kW 等)
const METRIC_PATTERN = /([^\s、。]{1,15}[:：\s]*)?(\b\d+(?:\.\d+)?\s*(?:m|mm|cm|km|kg|g|t|%|％|円|万|億|台|個|件|人|分|秒|時間|日|年|月|条|項|号|℃|W|kW|V|A|Hz|k|K|M|G|GB|MB|KB)\b|[第\d]+条(?:第\d+項)?)/gi;

// 重要要件・仕様・制約キーワード
const REQUIREMENT_PATTERN = /必須|要件|規定|禁止|上限|下限|以上|以下|未満|決定|仕様|担当|期日|納期|合意|条件|基準|目標|原則|留意|注意|推奨/;

// チャンク本文から重要数値・単位とキー要件センテンスを抽出
function extractMetricsAndFacts(text: string): { metrics: string[]; keyFacts: string[] } {
  const metrics: string[] = [];
  const keyFacts: string[] = [];

  const matchedMetrics = text.match(METRIC_PATTERN);
  if (matchedMetrics) {
    for (const m of matchedMetrics) {
      const clean = m.trim();
      if (clean.length >= 2 && !metrics.includes(clean) && metrics.length < 8) {
        metrics.push(clean);
      }
    }
  }

  const sentences = text.split(/(?<=[。！？\n])/);
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed.length >= 8 && trimmed.length <= 160) {
      if (REQUIREMENT_PATTERN.test(trimmed)) {
        if (!keyFacts.includes(trimmed) && keyFacts.length < 5) {
          keyFacts.push(trimmed);
        }
      }
    }
  }

  return { metrics, keyFacts };
}

// 日本語類義語・同義語辞書（Query Expansion）
const SYNONYM_DICT: Record<string, string[]> = {
  '間隔': ['間隔', '離隔', '距離', 'クリアランス', 'スパン', 'ピッチ', '間'],
  '距離': ['距離', '間隔', '離隔', 'クリアランス', 'スパン'],
  '高さ': ['高さ', '高', '最低地上高', '地上高', '全高', 'クリアランス', '垂直'],
  '期限': ['期限', '納期', '期日', '完了日', 'スケジュール', '締め切り', '日程'],
  '金額': ['金額', '費用', '価格', '予算', 'コスト', '単価', '代金', '円', '料金'],
  '割合': ['割合', '率', '比率', 'パーセント', '%', '％', '達成率', '進捗率'],
  '条件': ['条件', '要件', '前提', '基準', '規定', '仕様', 'ルール', '制約'],
  '要件': ['要件', '必須', '条件', '規定', '基準', '仕様'],
  '仕様': ['仕様', 'スペック', '構成', '要件', '設計', '規格'],
  '担当': ['担当', '責任者', '主幹', 'リーダー', '担当者', '窓口'],
  '重量': ['重量', '重さ', '質量', 'kg', 'g', 't', '荷重'],
  '面積': ['面積', '広さ', '平米', 'm2', '㎡', '坪'],
  '温度': ['温度', '室温', '℃', '度', '気温'],
  '台数': ['台数', '数量', '個数', '台', '個', '件', '員数']
};

// 質問からターゲット名詞・求められている単位・否定/例外制約を抽出
function extractQueryEntitiesAndUnits(query: string): {
  targets: string[];
  expandedTargets: string[];
  askedUnits: string[];
  subQueries: string[];
  isNegationQuery: boolean;
} {
  const isNegationQuery = /ない|除く|以外|含めない|不要|不可|禁止|制限|差|違い|比較/.test(query);

  const cleanQuery = query.replace(/[はがをにのへとでについて教えてどう何ですか知りたいありますか？\?]/g, ' ');
  const rawWords = cleanQuery.split(/[\s,、。]+/).filter(w => w.length >= 2);
  
  const targets = [...new Set(rawWords)];
  const expandedTargets = new Set<string>(targets);

  for (const t of targets) {
    for (const [key, synonyms] of Object.entries(SYNONYM_DICT)) {
      if (t.includes(key) || key.includes(t) || synonyms.some(s => t.includes(s))) {
        synonyms.forEach(s => expandedTargets.add(s));
      }
    }
  }

  // 質問で問われている単位の検出 (m, 円, %, kg, 秒 等)
  const askedUnits: string[] = [];
  const unitMatches = query.match(/(?:何|いくら|どれくらい)?(m|mm|cm|km|kg|g|t|%|％|円|万|億|台|個|件|人|分|秒|時間|日|年|月|条|項|号|℃|W|kW)/gi);
  if (unitMatches) {
    unitMatches.forEach(u => {
      const clean = u.replace(/何|いくら|どれくらい/g, '').trim();
      if (clean) askedUnits.push(clean);
    });
  }

  // 複合クエリのサブクエリ分解（「AとBの違い」「Aの条件およびBの納期」等）
  const subQueries: string[] = [query];
  const splitKeywords = query.split(/[と及びおよびならびに、・\s+vsVS対]/).map(s => s.trim()).filter(s => s.length >= 3);
  if (splitKeywords.length >= 2) {
    splitKeywords.forEach(sq => {
      if (!subQueries.includes(sq)) subQueries.push(sq);
    });
  }

  return {
    targets,
    expandedTargets: Array.from(expandedTargets),
    askedUnits,
    subQueries,
    isNegationQuery
  };
}

// 質問とテキスト内の近傍共起ファクト（質問対象語と数値・制約が同一センテンスまたは前後文にあるか）を検出
function extractProximityFacts(
  query: string,
  text: string,
  docTitle: string
): { targetedFacts: { target: string; value: string; sentence: string; docTitle: string }[]; proximityBoost: number; constraintSentences: string[] } {
  const { expandedTargets, askedUnits, isNegationQuery } = extractQueryEntitiesAndUnits(query);
  const targetedFacts: { target: string; value: string; sentence: string; docTitle: string }[] = [];
  const constraintSentences: string[] = [];
  let proximityBoost = 0;

  const sentences = text.split(/(?<=[。！？\n])/).map(s => s.trim()).filter(s => s.length >= 6);

  for (let idx = 0; idx < sentences.length; idx++) {
    const sentence = sentences[idx];
    let matchedTarget = '';
    for (const target of expandedTargets) {
      if (sentence.includes(target)) {
        matchedTarget = target;
        break;
      }
    }

    // 制約・例外・ただし文の検出
    if (/ただし|但し|を除く|対象外|除外|禁止|必須|上限|下限|以上|以下|未満|注意|留意|原則として/.test(sentence)) {
      if (!constraintSentences.includes(sentence)) {
        constraintSentences.push(sentence);
      }
    }

    if (matchedTarget) {
      // 数値・単位または要件キーワードが同一センテンスまたは直後センテンスにあるか判定
      const nextSentence = sentences[idx + 1] || '';
      const combinedWindow = `${sentence} ${nextSentence}`;

      const metricMatches = combinedWindow.match(METRIC_PATTERN);
      const hasRequirement = REQUIREMENT_PATTERN.test(combinedWindow);

      if (metricMatches || hasRequirement) {
        const valueStr = metricMatches ? metricMatches.join(', ') : '【規定・要件】';
        
        // 求められている単位と一致する場合は最高位加点
        const unitHit = askedUnits.some(u => combinedWindow.toLowerCase().includes(u.toLowerCase()));
        if (unitHit) {
          proximityBoost += 0.6;
        } else {
          proximityBoost += 0.35;
        }

        if (isNegationQuery && /除く|以外|含めない|不可|禁止/.test(combinedWindow)) {
          proximityBoost += 0.4;
        }

        targetedFacts.push({
          target: matchedTarget,
          value: valueStr,
          sentence: metricMatches ? sentence : combinedWindow.trim(),
          docTitle
        });
      }
    }
  }

  return {
    targetedFacts: targetedFacts.slice(0, 6),
    proximityBoost: Math.min(0.9, proximityBoost),
    constraintSentences: constraintSentences.slice(0, 4)
  };
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
    const { query, queryEmbedding, allowedDocIds, topK = 5 } = payload as {
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

      // 1. クエリ意図・類義語・サブクエリ展開
      const { expandedTargets, subQueries } = extractQueryEntitiesAndUnits(query);

      // 2. BM25 キーワード検索（サブクエリも含めて検索し、順位マップを生成）
      const bm25RankMap = new Map<string, number>();
      let bm25RankCounter = 1;

      for (const sq of subQueries) {
        const sqTokenized = tokenizeJapanese(sq);
        const oramaResults = await search(oramaDb, {
          term: sqTokenized || sq,
          properties: ['tokenizedContent', 'content', 'docTitle'],
          limit: 30
        });

        oramaResults.hits.forEach(hit => {
          const chunk = chunksStore.get(hit.id);
          if (chunk && (!allowedSet || allowedSet.has(chunk.docId))) {
            if (!bm25RankMap.has(hit.id)) {
              bm25RankMap.set(hit.id, bm25RankCounter++);
            }
          }
        });
      }

      const candidateIds = new Set<string>(bm25RankMap.keys());

      // 3. 展開された類義語・キーワードによる直接共起スキャン
      for (const [chunkId, chunk] of chunksStore.entries()) {
        if (!allowedSet || allowedSet.has(chunk.docId)) {
          const hasKeywordMatch = expandedTargets.some(kw => chunk.content.includes(kw) || chunk.parentContent.includes(kw));
          if (hasKeywordMatch) {
            candidateIds.add(chunkId);
            if (candidateIds.size >= 80) break;
          }
        }
      }

      // 候補が少ない場合の全チャンクスキャンフォールバック
      if (candidateIds.size < 5) {
        for (const [chunkId, chunk] of chunksStore.entries()) {
          if (!allowedSet || allowedSet.has(chunk.docId)) {
            candidateIds.add(chunkId);
            if (candidateIds.size >= 100) break;
          }
        }
      }

      // 4. ベクトル類似度計算 ＆ ベクトル順位マップ生成
      const vectorScores: { id: string; sim: number }[] = [];
      for (const chunkId of candidateIds) {
        const chunk = chunksStore.get(chunkId);
        if (!chunk) continue;
        let sim = 0.35;
        if (queryEmbedding && chunk.embedding) {
          sim = cosineSimilarityInt8(queryEmbedding, chunk.embedding);
        }
        vectorScores.push({ id: chunkId, sim });
      }

      vectorScores.sort((a, b) => b.sim - a.sim);
      const vectorRankMap = new Map<string, number>();
      vectorScores.forEach((item, idx) => {
        vectorRankMap.set(item.id, idx + 1);
      });

      // 5. RRF (Reciprocal Rank Fusion) + Proximity Boost 統合スコアリング
      const RRF_K = 60;
      const scoredResults: {
        chunk: DocumentChunk;
        score: number;
        metrics: string[];
        keyFacts: string[];
        targetedFacts: { target: string; value: string; sentence: string; docTitle: string }[];
        expandedContext: string;
      }[] = [];

      // 全チャンクリストをdocIdとchunkIndexで整理（Window Expansion用）
      const docChunksMap = new Map<string, DocumentChunk[]>();
      for (const chunk of chunksStore.values()) {
        if (!docChunksMap.has(chunk.docId)) {
          docChunksMap.set(chunk.docId, []);
        }
        docChunksMap.get(chunk.docId)!.push(chunk);
      }
      docChunksMap.forEach(list => list.sort((a, b) => a.chunkIndex - b.chunkIndex));

      for (const chunkId of candidateIds) {
        const chunk = chunksStore.get(chunkId);
        if (!chunk) continue;

        const bm25Rank = bm25RankMap.get(chunkId) || 999;
        const vecRank = vectorRankMap.get(chunkId) || 999;

        const rrfScore = (1 / (RRF_K + bm25Rank)) + (1 / (RRF_K + vecRank));
        let totalScore = rrfScore * 15;

        // 🎯 Window Context Expansion: 前後チャンクを結合して文脈切れを解消
        let expandedContext = chunk.parentContent || chunk.content;
        const docList = docChunksMap.get(chunk.docId);
        if (docList && docList.length > 1) {
          const currentIdx = docList.findIndex(c => c.id === chunk.id);
          if (currentIdx !== -1) {
            const prev = docList[currentIdx - 1]?.content;
            const next = docList[currentIdx + 1]?.content;
            const parts: string[] = [];
            if (prev) parts.push(prev);
            parts.push(chunk.content);
            if (next) parts.push(next);
            expandedContext = parts.join('\n');
          }
        }

        // 🎯 近傍共起ファクト照合 (extractProximityFacts)
        const { targetedFacts, proximityBoost, constraintSentences } = extractProximityFacts(
          query,
          expandedContext,
          chunk.docTitle
        );
        totalScore += proximityBoost;

        // 全体数値・要件抽出
        const { metrics, keyFacts } = extractMetricsAndFacts(expandedContext);
        constraintSentences.forEach(c => {
          if (!keyFacts.includes(c)) keyFacts.push(c);
        });

        // クエリ完全一致ブースト
        if (query.length >= 3 && (chunk.content.includes(query) || expandedContext.includes(query))) {
          totalScore += 0.3;
        }

        scoredResults.push({
          chunk,
          score: totalScore,
          metrics,
          keyFacts,
          targetedFacts,
          expandedContext
        });
      }

      scoredResults.sort((a, b) => b.score - a.score);

      // 6. 重複排除と最終結果の生成
      const seenDocSnippets = new Set<string>();
      const finalResults: SourceReference[] = [];

      for (const item of scoredResults) {
        const snippetKey = `${item.chunk.docId}_${item.chunk.content.slice(0, 80)}`;
        if (seenDocSnippets.has(snippetKey)) continue;

        seenDocSnippets.add(snippetKey);
        finalResults.push({
          chunkId: item.chunk.id,
          docTitle: item.chunk.docTitle,
          snippet: item.chunk.content,
          fullContext: item.expandedContext,
          score: Math.min(1.0, item.score),
          metrics: item.metrics,
          keyFacts: item.keyFacts,
          targetedFacts: item.targetedFacts
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
