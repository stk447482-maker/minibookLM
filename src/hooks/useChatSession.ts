import { useState, useRef } from 'react';
import { Project, DocumentSource, ChatMessage, ModelConfig, SourceReference } from '../types';
import { dbService } from '../services/db';
import { ragManager } from '../services/ragManager';
import { llmService } from '../services/llmService';
import { WebSearchService, WebSearchResult } from '../services/webSearchService';

interface UseChatSessionProps {
  activeProject: Project | null;
  documents: DocumentSource[];
  config: ModelConfig;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export function useChatSession({
  activeProject,
  documents,
  config,
  messages,
  setMessages
}: UseChatSessionProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const chatAbortControllerRef = useRef<AbortController | null>(null);

  const cancelChat = () => {
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
      chatAbortControllerRef.current = null;
    }
    setIsGenerating(false);
    setStatusMessage('');
  };

  // チャットメッセージ個別削除
  const handleDeleteMessage = async (msgId: string) => {
    await dbService.deleteMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  // チャット履歴全クリア
  const handleClearMessages = async () => {
    if (!activeProject) return;
    await dbService.clearMessagesByProject(activeProject.id);
    setMessages([]);
  };

  // チャット質問送信＆RAGストリーミング
  const handleSendMessage = async (query: string, isDirectRAG: boolean = false, enableWebSearch: boolean = false) => {
    if (!activeProject) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      projectId: activeProject.id,
      role: 'user',
      content: query,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    await dbService.saveMessage(userMsg);

    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
    }
    const chatController = new AbortController();
    chatAbortControllerRef.current = chatController;

    setIsGenerating(true);
    setStatusMessage('選択されたソースからハイブリッド検索中...');

    try {
      const enabledDocIds = documents.filter(d => d.enabled).map(d => d.id);
      let searchResults: any[] = [];
      let graphSummary = '';
      let activeDocTitles: string[] = [];

      // 🌐 Web検索補助情報の取得（ONの場合のみ、手元資料を補完するために実行）
      let webSources: WebSearchResult[] = [];
      if (enableWebSearch) {
        setStatusMessage('🌐 インターネットから最新情報を収集・補完中...');
        try {
          webSources = await WebSearchService.searchWeb(query, 3);
        } catch (webErr) {
          console.warn('Web search error:', webErr);
        }
      }

      // 🎯 モデル能力階層（Tier）の判定
      // tier 1: 0.5B (超軽量・整文特化)
      // tier 2: 1.0B〜2.5B (1.5B, Gemma 2B, Llama 1B: 構造化解説)
      // tier 3: 7B〜8B以上 / クラウドGemini (NotebookLM級の多角的ディープ分析)
      let modelTier: 1 | 2 | 3 = 2; // デフォルトはTier 2 (1.5B)
      let maxContextChars = 3500;

      if (config.mode === 'cloud-gemini' || config.cloudApiKey) {
        modelTier = 3;
        maxContextChars = 60000;
      } else if (config.mode === 'desktop-api') {
        const mName = (config.desktopModelName || '').toLowerCase();
        if (mName.includes('12b') || mName.includes('gemma') || mName.includes('8b') || mName.includes('7b') || mName.includes('9b') || mName.includes('14b') || mName.includes('llama3') || mName.includes('qwen')) {
          modelTier = 3;
          maxContextChars = 24000;
        } else {
          modelTier = 3;
          maxContextChars = 16000;
        }
      } else {
        // embedded-mobile (WebGPU)
        const embId = config.embeddedModelId.toLowerCase();
        if (embId.includes('0.5b')) {
          modelTier = 1;
          maxContextChars = 1500;
        } else if (embId.includes('gemma') || embId.includes('1.5b') || embId.includes('1b')) {
          modelTier = 2;
          maxContextChars = 3500;
        }
      }

      if (enabledDocIds.length > 0) {
        // 🎯 1. 【最優先】クエリ特化のハイブリッド検索（核心ヒットを直接抽出）
        const focusedHits = await ragManager.search(query, enabledDocIds, 6);
        
        // 2. ドキュメント全体の背景コンテキストを補足取得
        const comp = await ragManager.getComprehensiveContext(activeProject.id, enabledDocIds, maxContextChars, query);
        activeDocTitles = comp.docTitles;

        // 核心ヒット（focusedHits）を先頭に、全体背景（comp.sources）を後方に結合
        const mergedSources: SourceReference[] = [...focusedHits];
        comp.sources.forEach(cs => {
          if (!mergedSources.some(ms => ms.chunkId === cs.chunkId || ms.docTitle === cs.docTitle)) {
            mergedSources.push(cs);
          }
        });

        searchResults = mergedSources;

        if (focusedHits.length > 0) {
          graphSummary = ragManager.extractGraphRAGTriples(focusedHits);
        }
      }

      // 🎯 核心ヒット群から確定ファクト骨格を構築
      const skeleton = ragManager.buildFactSkeleton(query, searchResults);

      // 🎯 2. 厳密RAGモードの場合: アルゴリズム抽出ファクトカードを直接出力
      if (isDirectRAG) {
        if (enabledDocIds.length === 0) {
          throw new Error('厳密RAG抽出を行うには、左側のドキュメント一覧で対象の資料にチェックを入れてください。');
        }
        if (!skeleton.hasMatch) {
          const directMsg: ChatMessage = {
            id: `asst_${Date.now()}`,
            projectId: activeProject.id,
            role: 'assistant',
            content: `### 🎯 厳密RAG 抽出結果 (選択資料: ${activeDocTitles.join(', ')})\n\n選択された資料内に「**${query}**」に合致する確定数値や規定は見つかりませんでした。別のキーワードでお試しください。`,
            timestamp: Date.now(),
            sources: searchResults,
            isStreaming: false
          };
          setMessages(prev => [...prev, directMsg]);
          await dbService.saveMessage(directMsg);
          return;
        }

        const directContent = `### 🎯 厳密RAG 構造化ファクトシート (選択資料: ${activeDocTitles.join(', ')})\n${skeleton.rawEvidenceCard}${graphSummary ? `\n\n${graphSummary}` : ''}`;
        const directMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          projectId: activeProject.id,
          role: 'assistant',
          content: directContent,
          timestamp: Date.now(),
          sources: searchResults,
          isStreaming: false
        };
        setMessages(prev => [...prev, directMsg]);
        await dbService.saveMessage(directMsg);
        return;
      }

      // 🎯 3. 通常AIチャット回答: 資料内に該当記述が一切ない場合の安全装置
      if (enabledDocIds.length > 0 && !skeleton.hasMatch && modelTier === 1) {
        const noMatchMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          projectId: activeProject.id,
          role: 'assistant',
          content: `選択されたドキュメント（${activeDocTitles.join(', ')}）内を精査しましたが、「**${query}**」に関する明確な記述や数値は見つかりませんでした。\n\n別のキーワードでお尋ねいただくか、左側のドキュメント一覧で対象資料がチェックされているかご確認ください。`,
          timestamp: Date.now(),
          sources: searchResults,
          isStreaming: false
        };
        setMessages(prev => [...prev, noMatchMsg]);
        await dbService.saveMessage(noMatchMsg);
        return;
      }

      // 🎯 4. モデル階層（Tier）別の最適化プロンプト生成（自然で豊かな解説を解放）
      let systemPrompt = '';
      if (modelTier === 1) {
        // 【Tier 1: 0.5B】端的かつ丁寧な回答（結論＋理由・背景）
        systemPrompt = `あなたは親切で正確なAIアシスタントです。
提供された【確定ファクト】と資料に基づき、質問に対して結論と確定数値を明確に述べた上で、その背景や理由も含めて分かりやすく丁寧に日本語（です・ます調）で回答してください。

【確定ファクト】
${skeleton.formattedContextForLLM}`;
      } else if (modelTier === 2) {
        // 【Tier 2: 1.5B / Gemma 2B】充実した構造化解説（NotebookLMライト版）
        systemPrompt = `あなたは優秀なドキュメント分析AIアシスタントです。
提供されたドキュメントのファクトおよび関連文脈を深く読み解き、ユーザーの質問に対して充実したわかりやすい解説を作成してください。

### 【回答ガイドライン】
- 冒頭で質問の核心（確定数値、仕様、要件、結論）をズバリわかりやすく明示してください。
- 根拠とする資料箇所には、文末や該当文に [1] や [2] のように参照番号を必ず付与してください。
- 続いて、具体的な仕様内容、背景、関連するルールや手順を、Markdown（箇条書きや強調）を活用して見やすく論理的に解説してください。
- 関連する法令条項、前提条件、例外規定、留意事項があれば、それらも丁寧に補足してください。

【抽出された確定ファクト・条項】
${skeleton.formattedContextForLLM}

【ドキュメント関連文脈抜粋】
${searchResults.slice(0, 5).map((s, idx) => `[${idx + 1}] 資料: ${s.docTitle}\n${s.fullContext}`).join('\n\n')}`;
      } else {
        // 【Tier 3: 7B〜8B / Gemini】多角的プロフェッショナル分析（NotebookLM級）
        systemPrompt = `あなたは最高峰のナレッジアナリストです。
提供された資料群を網羅的・多角的に分析し、質問に対して専門的かつ実践的なインサイトを提供する充実した総合レポートを作成してください。

### 【レポート構成】
1. **要約と結論（Key Findings）**: 質問に対する確定数値・コアメッセージの明確な提示（根拠文末に [1], [2] などの引用番号を付与）
2. **詳細分析・構造化解説**: 規定・仕様・手順・背景の論理的ブレイクダウン
3. **制約事項・リスク・例外条件**: 留意すべきルールや適用外ケースの提示
4. **横断的考察・インサイト**: 各資料間の関係性や実務上のポイント

※ 根拠とする記述には文中または文末に [1], [2] などの引用番号を積極的に付与してください。

【抽出ファクト・条項】
${skeleton.formattedContextForLLM}

【参照ドキュメント全文抜粋】
${searchResults.map((s, idx) => `[${idx + 1}] 資料: ${s.docTitle}\n${s.fullContext}`).join('\n\n')}`;
      }

      // 🌐 Web検索補助情報のプロンプト結合
      let webPromptSection = '';
      if (webSources.length > 0) {
        webPromptSection = `\n\n【🌐 Web最新補足情報（手元資料に不足している最新情報や補足用）】
※【絶対ルール】手元資料の内容を最優先とし、手元資料に書かれていない最新動向や定義の補足としてのみ以下のWeb情報を活用してください。Web由来の情報には文中に [🌐 サイト名] と出典を明記してください。
${webSources.map((w, idx) => `[Web ${idx + 1}] ${w.title}\nURL: ${w.url}\n概要: ${w.snippet}`).join('\n\n')}`;
        systemPrompt += webPromptSection;

        // チャットUIの根拠ソースチップにも Web 補足情報を追加
        webSources.forEach((w, idx) => {
          searchResults.push({
            chunkId: `web_${idx}_${Date.now()}`,
            docTitle: `🌐 [Web] ${w.title.slice(0, 30)}`,
            snippet: w.snippet,
            fullContext: `【タイトル】${w.title}\n【URL】${w.url}\n\n【概要】\n${w.snippet}`,
            score: 0.95
          });
        });
      }

      const assistantMsgId = `asst_${Date.now()}`;

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        projectId: activeProject.id,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        sources: searchResults,
        isStreaming: true
      };

      setMessages(prev => [...prev, assistantMsg]);
      setStatusMessage(
        modelTier === 1
          ? '0.5B で確定ファクトを整文中...'
          : modelTier === 2
          ? '1.5B で構造化解説を生成中...'
          : 'ディープ分析レポートを生成中...'
      );

      // 過去履歴の長さをモデルTierに応じて調整
      const historyLimit = modelTier === 1 ? -2 : modelTier === 2 ? -4 : -8;
      const charLimit = modelTier === 1 ? 150 : modelTier === 2 ? 400 : 1200;

      const recentMessages = messages.slice(historyLimit).map(m => ({
        role: m.role,
        content: m.content.length > charLimit ? m.content.slice(0, charLimit) + '...' : m.content
      }));

      const chatHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...recentMessages,
        { role: 'user', content: query }
      ];

      const stream = llmService.streamChat(
        chatHistory,
        config,
        (prog) => {
          setStatusMessage(prog);
        },
        chatController.signal
      );

      let accumulatedText = '';
      for await (const chunk of stream) {
        if (chatController.signal.aborted) break;
        accumulatedText += chunk;
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, content: accumulatedText } : m))
        );
      }

      if (chatController.signal.aborted) {
        return;
      }

      // Tier 1 / Tier 2 では確定エビデンスカードを末尾に付与（透明性の確保）
      let finalAnswer = accumulatedText.trim();
      if (skeleton.hasMatch && skeleton.rawEvidenceCard && !finalAnswer.includes('アルゴリズム抽出 根拠エビデンス')) {
        finalAnswer += skeleton.rawEvidenceCard;
      }
      if (graphSummary && !finalAnswer.includes('GraphRAG') && modelTier >= 2) {
        finalAnswer += `\n\n${graphSummary}`;
      }

      // 回答末尾の【深掘りサジェスト質問】ブロックを抽出
      let suggestedQuestions: string[] = [];
      const suggestMatch = finalAnswer.match(/(?:【関連する深掘り質問】|【次に深掘りできる問い】|【おすすめの質問】|💡\s*関連質問)([\s\S]*)$/i);
      if (suggestMatch && suggestMatch[1]) {
        const lines = suggestMatch[1].split('\n')
          .map(l => l.replace(/^[-*•\d.]+\s*/, '').trim())
          .filter(l => l.length > 5 && (l.endsWith('？') || l.endsWith('?') || l.includes('ですか') || l.includes('について')));
        if (lines.length > 0) {
          suggestedQuestions = lines.slice(0, 3);
        }
      }

      // サジェストがLLM側で出力されなかった場合のドキュメントキーワードベースのフォールバック
      if (suggestedQuestions.length === 0 && searchResults.length > 0) {
        const topDocs = activeDocTitles.slice(0, 2);
        suggestedQuestions = [
          `${topDocs[0] || '資料'}の重要ポイントを3行で要約して`,
          `関連する留意点や例外規定はありますか？`,
          `他の資料との関連性や背景を教えて`
        ];
      }

      const finalAssistantMsg: ChatMessage = {
        ...assistantMsg,
        content: finalAnswer,
        isStreaming: false,
        suggestedQuestions
      };

      setMessages(prev =>
        prev.map(m => (m.id === assistantMsgId ? finalAssistantMsg : m))
      );

      await dbService.saveMessage(finalAssistantMsg);
    } catch (err: unknown) {
      if (chatAbortControllerRef.current?.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        projectId: activeProject.id,
        role: 'assistant',
        content: `⚠️ ${msg}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
      await dbService.saveMessage(errorMsg);
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
      chatAbortControllerRef.current = null;
    }
  };

  return {
    isGenerating,
    statusMessage,
    handleSendMessage,
    handleDeleteMessage,
    handleClearMessages,
    cancelChat
  };
}
