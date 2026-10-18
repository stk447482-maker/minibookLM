import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { DocumentsPane } from './components/DocumentsPane.tsx';
import { ChatPane } from './components/ChatPane.tsx';
import { StudioPane } from './components/StudioPane.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { DocumentModal } from './components/DocumentModal.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DocumentSource, ChatMessage, StudioArtifact, StudioTab, ModelConfig, Project, SourceReference } from './types/index.ts';
import { ragManager } from './services/ragManager.ts';
import { llmService } from './services/llmService.ts';
import { dbService } from './services/db.ts';
import { securityGuard } from './services/securityGuard.ts';
import { DiagramService } from './services/diagramService.ts';
import { buildStudioPrompt } from './services/studioPrompts.ts';
import { ToastContainer, ToastMessage } from './components/ToastContainer.tsx';

const EXPECTED_HASH = '3c796256ccc298e53eb6c451fcff012416c8aabb41da6583c6192eecd1cae1fb';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('minibooklm_auth_token') === EXPECTED_HASH;
  });

  useEffect(() => {
    // セキュリティガード起動 (F12・右クリック禁止 & 開発者ツール検知即時ロック)
    securityGuard.init(() => {
      setIsAuthenticated(false);
    });
  }, []);

  const [config, setConfig] = useState<ModelConfig>(() => {
    const saved = localStorage.getItem('minibooklm_model_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      mode: 'embedded-mobile', // デフォルトで完全ブラウザ完結WebGPUモード
      embeddedModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      desktopApiEndpoint: 'http://127.0.0.1:11434',
      desktopModelName: 'llama3.1',
      temperature: 0.3
    };
  });

  const handleUpdateConfig = (newConfig: ModelConfig) => {
    setConfig(newConfig);
    localStorage.setItem('minibooklm_model_config', JSON.stringify(newConfig));
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'docs' | 'chat' | 'studio'>('chat');

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [selectedDocForModal, setSelectedDocForModal] = useState<DocumentSource | null>(null);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [docProgress, setDocProgress] = useState(0);
  const [docStatusText, setDocStatusText] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [artifacts, setArtifacts] = useState<StudioArtifact[]>([]);
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);
  const [streamingStudioArtifact, setStreamingStudioArtifact] = useState<{ type: StudioTab; title: string; content: string } | null>(null);
  const studioAbortControllerRef = useRef<AbortController | null>(null);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  const handleCancelStudio = () => {
    if (studioAbortControllerRef.current) {
      studioAbortControllerRef.current.abort();
      studioAbortControllerRef.current = null;
    }
    setIsGeneratingStudio(false);
    setStreamingStudioArtifact(null);
  };

  const handleCancelUpload = () => {
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }
    setIsProcessingDoc(false);
    setDocProgress(0);
    setDocStatusText('');
  };

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string, action?: { label: string; onClick: () => void }) => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    const newToast: ToastMessage = { id, type, message, title, action };
    setToasts(prev => [...prev, newToast]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const handleDismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // 1. 初回マウント時: IndexedDBからプロジェクト復元
  useEffect(() => {
    const initApp = async () => {
      try {
        const savedProjects = await dbService.getAllProjects();
        if (savedProjects.length === 0) {
          const defaultProj: Project = {
            id: `proj_${Date.now()}`,
            name: 'デフォルト プロジェクト',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await dbService.saveProject(defaultProj);
          setProjects([defaultProj]);
          setActiveProject(defaultProj);
        } else {
          setProjects(savedProjects);
          setActiveProject(savedProjects[0]);
        }
      } catch (err) {
        console.error('IndexedDB初期化エラー:', err);
      }
    };
    initApp();
  }, []);

  // 2. アクティブプロジェクト変更時: ドキュメント・チャンク・メッセージを復元
  useEffect(() => {
    if (!activeProject) return;

    const loadProjectData = async () => {
      try {
        const [docs, chunks, msgs, arts] = await Promise.all([
          dbService.getDocumentsByProject(activeProject.id),
          dbService.getChunksByProject(activeProject.id),
          dbService.getMessagesByProject(activeProject.id),
          dbService.getArtifactsByProject(activeProject.id)
        ]);

        setDocuments(docs);
        setMessages(msgs);
        setArtifacts(arts);

        await ragManager.loadProjectChunks(chunks);
      } catch (err) {
        console.error('プロジェクトデータ読み込みエラー:', err);
      }
    };

    loadProjectData();
  }, [activeProject]);

  // プロジェクト作成
  const handleCreateProject = async (name: string) => {
    const newProj: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await dbService.saveProject(newProj);
    setProjects(prev => [...prev, newProj]);
    setActiveProject(newProj);
  };

  // プロジェクト削除
  const handleDeleteProject = async (projectId: string) => {
    await dbService.deleteProject(projectId);
    const remaining = projects.filter(p => p.id !== projectId);
    setProjects(remaining);
    setActiveProject(remaining[0] || null);
  };

  // 📤 プロジェクト丸ごとエクスポート (.minibook JSON)
  const handleExportProject = async (projectId: string) => {
    try {
      const jsonStr = await dbService.exportProjectPackage(projectId);
      const proj = projects.find(p => p.id === projectId);
      const filename = `${proj?.name || 'project'}_${Date.now()}.minibook`;

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`エクスポートエラー: ${err.message}`);
    }
  };

  // 📥 プロジェクト丸ごとインポート (.minibook JSON)
  const handleImportProject = async (file: File) => {
    try {
      const text = await file.text();
      const imported = await dbService.importProjectPackage(text);
      setProjects(prev => [...prev, imported]);
      setActiveProject(imported);
      alert(`プロジェクト「${imported.name}」を正常にインポートしました！`);
    } catch (err: any) {
      alert(`インポート失敗: ${err.message}`);
    }
  };

  // ファイルアップロード処理＆IndexedDB永続化
  const handleUpload = async (files: FileList) => {
    if (!activeProject) return;

    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
    }
    const uploadAbort = new AbortController();
    uploadAbortControllerRef.current = uploadAbort;

    setIsProcessingDoc(true);
    setDocProgress(0);
    setDocStatusText('ファイルを解析中...');

    try {
      for (let i = 0; i < files.length; i++) {
        if (uploadAbort.signal.aborted) break;
        const file = files[i];
        try {
          // 同名ドキュメントが既に存在する場合は旧ドキュメント（旧メタデータや古い内容）を自動削除して置換
          const existingSameName = documents.find(d => d.title === file.name && d.projectId === activeProject.id);
          if (existingSameName) {
            await dbService.deleteDocument(existingSameName.id);
            setDocuments(prev => prev.filter(d => d.id !== existingSameName.id));
          }

          const { doc, chunks } = await ragManager.processDocument(
            file,
            activeProject.id,
            (percent, status) => {
              setDocProgress(percent);
              if (status) setDocStatusText(status);
            },
            {
              enginePreference: config.audioTranscriptionEngine,
              cloudApiKey: config.cloudApiKey,
              abortSignal: uploadAbort.signal,
              modelConfig: config
            }
          );

          await dbService.saveDocument(doc);
          await dbService.saveChunks(chunks);

          setDocuments(prev => {
            const exists = prev.some(d => d.id === doc.id);
            return exists ? prev.map(d => d.id === doc.id ? doc : d) : [...prev, doc];
          });
        } catch (err: unknown) {
          if (uploadAbort.signal.aborted) break;
          const msg = err instanceof Error ? err.message : String(err);
          showToast('error', `ドキュメント処理に失敗しました: ${msg}`, 'アップロード失敗');
        }
      }

      // 検索ワーカーのインデックスを最新状態に完全同期
      const updatedChunks = await dbService.getChunksByProject(activeProject.id);
      await ragManager.loadProjectChunks(updatedChunks);
    } finally {
      setIsProcessingDoc(false);
      setDocProgress(0);
      setDocStatusText('');
      uploadAbortControllerRef.current = null;
    }
  };

  // 生成物やチャット回答を新しいソースとして追加
  const handleAddContentToSource = async (title: string, content: string) => {
    if (!activeProject) return;

    setIsProcessingDoc(true);
    try {
      const { doc, chunks } = await ragManager.processTextContent(title, content, activeProject.id, 'markdown');
      await dbService.saveDocument(doc);
      await dbService.saveChunks(chunks);

      setDocuments(prev => [...prev, doc]);
      const updatedChunks = await dbService.getChunksByProject(activeProject.id);
      await ragManager.loadProjectChunks(updatedChunks);
      showToast('success', `「${title}」をソース一覧に追加・保存しました`, 'ソース追加完了');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `ソース追加エラー: ${msg}`, '追加失敗');
    } finally {
      setIsProcessingDoc(false);
    }
  };

  // ドキュメント有効/無効トグル
  const handleToggleDoc = async (id: string) => {
    const updated = documents.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d);
    setDocuments(updated);
    const target = updated.find(d => d.id === id);
    if (target) {
      await dbService.saveDocument(target);
    }
  };

  // 全ドキュメント一括選択/解除
  const handleToggleAllDocs = async (selectAll: boolean) => {
    const updated = documents.map(d => ({ ...d, enabled: selectAll }));
    setDocuments(updated);
    for (const d of updated) {
      await dbService.saveDocument(d);
    }
  };

  // 🧠 通常資料 ⇄ AI補助脳 の相互昇格・切り替え
  const handleToggleAuxiliaryBrain = async (doc: DocumentSource) => {
    if (!activeProject) return;

    const isCurrentlyBrain = doc.title.includes('AI補助脳');
    let newTitle: string;

    if (isCurrentlyBrain) {
      // 補助脳から解除（プレフィックスを除去）
      newTitle = doc.title.replace(/^\[AI補助脳(?::\s*[^\]]+)?\]\s*/, '').trim();
    } else {
      // 補助脳に昇格（プレフィックスを付与）
      newTitle = `[AI補助脳: ${doc.type.toUpperCase()}] ${doc.title}`;
    }

    const updatedDoc: DocumentSource = {
      ...doc,
      title: newTitle
    };

    // 1. Documents状態およびIndexedDBを更新
    setDocuments(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
    await dbService.saveDocument(updatedDoc);

    // 2. チャンク側のdocTitleも更新
    const docChunks = await dbService.getChunksByDocId(doc.id);
    for (const chunk of docChunks) {
      chunk.docTitle = newTitle;
    }
    await dbService.saveChunks(docChunks);

    // 3. 検索ワーカーへ更新済みチャンクを同期
    const allProjectChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(allProjectChunks);

    if (isCurrentlyBrain) {
      showToast('info', `「${newTitle}」を通常の資料に戻しました`, '補助脳解除');
    } else {
      showToast('success', `「${newTitle}」をAI補助脳に昇格・重み付け登録しました！`, '🧠 補助脳登録');
    }
  };

  // ドキュメント削除
  const handleRemoveDoc = async (id: string) => {
    if (!activeProject) return;
    await dbService.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    const remainingChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(remainingChunks);
  };

  // ドキュメント全削除＆インデックス完全初期化
  const handleRemoveAllDocs = async () => {
    if (!activeProject || documents.length === 0) return;
    if (!confirm(`プロジェクト「${activeProject.name}」の全ドキュメント（${documents.length}件）を完全に消去しますか？`)) return;
    
    for (const d of documents) {
      await dbService.deleteDocument(d.id);
    }
    setDocuments([]);
    await ragManager.loadProjectChunks([]);
  };

  // ドキュメントのプロジェクト間移動
  const handleMoveDoc = async (docId: string, targetProjectId: string) => {
    if (!activeProject) return;
    await dbService.moveDocument(docId, targetProjectId);
    setDocuments(prev => prev.filter(d => d.id !== docId));
    const remainingChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(remainingChunks);
  };

  // ドキュメントのプロジェクト間コピー
  const handleCopyDoc = async (docId: string, targetProjectId: string) => {
    await dbService.copyDocument(docId, targetProjectId);
  };

  // ドキュメント内容の直接編集・AI校正後の保存＆再インデックス
  const handleSaveDocumentContent = async (doc: DocumentSource, newContent: string) => {
    if (!activeProject) return;

    // 1. 旧ドキュメントのチャンクを削除
    await dbService.deleteDocument(doc.id);

    // 2. 新しい内容で階層チャンク分割＆埋め込みベクトル再計算
    const { doc: updatedDoc, chunks: newChunks } = await ragManager.processTextContent(
      doc.title,
      newContent,
      doc.projectId,
      doc.type,
      undefined,
      doc.id
    );

    // 3. IndexedDBに保存
    await dbService.saveDocument(updatedDoc);
    await dbService.saveChunks(newChunks);

    // 4. ステート同期
    setDocuments(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
    setSelectedDocForModal(updatedDoc);

    // 5. 検索ワーカーのインデックスを再同期
    const allChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(allChunks);

    alert(`「${doc.title}」を正常に更新し、検索インデックスを再構築しました！`);
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

  // 成果物削除
  const handleDeleteArtifact = async (artifactId: string) => {
    await dbService.deleteArtifact(artifactId);
    setArtifacts(prev => prev.filter(a => a.id !== artifactId));
  };

  // チャット質問送信＆RAGストリーミング
  const handleSendMessage = async (query: string, isDirectRAG: boolean = false) => {
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

      const finalAssistantMsg: ChatMessage = {
        ...assistantMsg,
        content: finalAnswer,
        isStreaming: false
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

  // Studio生成処理
  const handleGenerateStudio = async (type: StudioTab, customPrompt?: string) => {
    if (!activeProject) return;

    const enabledDocs = documents.filter(d => d.enabled);
    if (enabledDocs.length === 0) {
      alert('Studio生成を行うには、左側のドキュメント一覧で対象資料のチェックボックスを1つ以上選択してください。');
      return;
    }

    setIsGeneratingStudio(true);
    try {
      const enabledDocIds = enabledDocs.map(d => d.id);

      // 🎯 現在の高性能モデル構成（Gemma 12B QAT / Gemini）に最適化した大容量Studioコンテキスト予算
      let studioContextMaxChars = 16000;
      if (config.mode === 'cloud-gemini') {
        studioContextMaxChars = 80000; // Gemini 1.5/2.0 Flash (100万トークン対応・長尺会議全文一括投入)
      } else if (config.mode === 'desktop-api' || config.mode === 'lmstudio') {
        studioContextMaxChars = 24000; // LM Studio / Gemma-4-12B-QAT (8K-16Kトークン対応・約2.4万文字)
      } else if (config.embeddedModelId?.includes('0.5B')) {
        studioContextMaxChars = 3000;
      }

      const { contextText: fullContext, docTitles } = await ragManager.getStudioOptimizedContext(
        activeProject.id,
        enabledDocIds,
        customPrompt,
        studioContextMaxChars
      );

      // google/gemma-4-12b-qat や Whisper Large-v3 が稼働している場合、ハイエンド推論プロンプトを適用
      const isHighEndModel = config.mode === 'desktop-api' || config.mode === 'lmstudio' || config.mode === 'cloud-gemini';
      const hasAudioTranscript = enabledDocs.some(d => d.type === 'audio' || d.contentPreview?.includes('🎙️'));

      const { title, prompt, systemPrompt: studioSystemPrompt } = buildStudioPrompt({
        type,
        customPrompt,
        fullContext,
        docTitles,
        isHighEndModel,
        hasAudioTranscript
      });

      const controller = new AbortController();
      studioAbortControllerRef.current = controller;

      setStreamingStudioArtifact({
        type,
        title,
        content: ''
      });

      const stream = llmService.streamChat(
        [
          { role: 'system', content: studioSystemPrompt },
          { role: 'user', content: prompt }
        ],
        config,
        undefined,
        controller.signal
      );

      let content = '';
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        content += chunk;
        setStreamingStudioArtifact({
          type,
          title,
          content
        });
      }

      if (controller.signal.aborted) {
        return;
      }

      // 図解系（マインドマップ・フローチャート）は決定論的コンバータで100%安全なMermaidへ自動変換
      let finalContent = content;
      if (type === 'mindmap') {
        finalContent = DiagramService.toMermaidMindmap(content);
      } else if (type === 'flowchart') {
        finalContent = DiagramService.toMermaidFlowchart(content);
      }

      const newArtifact: StudioArtifact = {
        id: `art_${Date.now()}`,
        projectId: activeProject.id,
        type,
        title,
        content: finalContent,
        customPrompt,
        createdAt: Date.now()
      };

      setStreamingStudioArtifact(null);
      setArtifacts(prev => [newArtifact, ...prev]);
      await dbService.saveArtifact(newArtifact);
      showToast('success', `「${title}」の生成が完了しました`, 'Studio生成完了');
    } catch (err: unknown) {
      if (studioAbortControllerRef.current?.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `Studio生成エラー: ${msg}`, '生成失敗', {
        label: '設定を確認',
        onClick: () => setIsSettingsOpen(true)
      });
      setStreamingStudioArtifact(null);
    } finally {
      setIsGeneratingStudio(false);
      setStreamingStudioArtifact(null);
      studioAbortControllerRef.current = null;
    }
  };

  // Studio成果物のインライン編集・保存
  const handleUpdateArtifact = async (id: string, updatedContent: string, updatedTitle?: string) => {
    const target = artifacts.find(a => a.id === id);
    if (!target) return;

    const updated: StudioArtifact = {
      ...target,
      content: updatedContent,
      title: updatedTitle || target.title
    };

    setArtifacts(prev => prev.map(a => a.id === id ? updated : a));
    await dbService.saveArtifact(updated);
    showToast('success', `「${updated.title}」の変更を保存しました`, '保存完了');
  };

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('minibooklm_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('minibooklm_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  if (!isAuthenticated) {
    return <AuthGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden font-sans transition-colors duration-200 ${
      isDarkMode ? 'bg-slate-950 text-slate-100' : 'light-mode bg-slate-50 text-slate-900'
    }`}>
      <Header
        config={config}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeMobileTab={activeMobileTab}
        setActiveMobileTab={setActiveMobileTab}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />


      <main className="flex-1 flex overflow-hidden">
        {/* 左ペイン: ソース＆プロジェクト管理 */}
        <div
          className={`h-full md:w-80 lg:w-96 shrink-0 md:block ${
            activeMobileTab === 'docs' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <DocumentsPane
            projects={projects}
            activeProject={activeProject}
            onSelectProject={(id) => {
              const p = projects.find(proj => proj.id === id);
              if (p) setActiveProject(p);
            }}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onExportProject={handleExportProject}
            onImportProject={handleImportProject}
            onAddTextContent={handleAddContentToSource}
            documents={documents}
            onUpload={handleUpload}
            onToggleDoc={handleToggleDoc}
            onToggleAllDocs={handleToggleAllDocs}
            onRemoveDoc={handleRemoveDoc}
            onRemoveAllDocs={handleRemoveAllDocs}
            onViewDoc={(doc) => setSelectedDocForModal(doc)}
            onToggleAuxiliaryBrain={handleToggleAuxiliaryBrain}
            onMoveDoc={handleMoveDoc}
            onCopyDoc={handleCopyDoc}
            isProcessing={isProcessingDoc}
            processProgress={docProgress}
            processStatusText={docStatusText}
            onCancelUpload={handleCancelUpload}
            audioEngine={config.audioTranscriptionEngine || 'native-large-v3'}
            onChangeAudioEngine={(engine) => {
              handleUpdateConfig({ ...config, audioTranscriptionEngine: engine });
            }}
          />
        </div>

        {/* 中央ペイン: チャット画面 */}
        <div
          className={`h-full flex-1 min-w-0 overflow-hidden md:block ${
            activeMobileTab === 'chat' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <ChatPane
            messages={messages}
            onSendMessage={handleSendMessage}
            onClearMessages={handleClearMessages}
            onDeleteMessage={handleDeleteMessage}
            onAddToSource={handleAddContentToSource}
            onViewDocByName={(title) => {
              const matched = documents.find(d => d.title === title || d.title.includes(title));
              if (matched) setSelectedDocForModal(matched);
            }}
            isGenerating={isGenerating}
            statusMessage={statusMessage}
          />
        </div>

        {/* 右ペイン: Studio生成物 */}
        <div
          className={`h-full md:w-80 lg:w-96 shrink-0 md:block ${
            activeMobileTab === 'studio' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <StudioPane
            config={config}
            artifacts={artifacts}
            streamingArtifact={streamingStudioArtifact}
            enabledDocsCount={documents.filter(d => d.enabled).length}
            onGenerate={handleGenerateStudio}
            onCancel={handleCancelStudio}
            onDeleteArtifact={handleDeleteArtifact}
            onAddToSource={handleAddContentToSource}
            onUpdateArtifact={handleUpdateArtifact}
            isGeneratingStudio={isGeneratingStudio}
          />
        </div>
      </main>

      {/* ドキュメント詳細・文字起こし閲覧・編集・AI校正モーダル */}
      <DocumentModal
        document={selectedDocForModal}
        config={config}
        isOpen={!!selectedDocForModal}
        onClose={() => setSelectedDocForModal(null)}
        onSaveDocumentContent={handleSaveDocumentContent}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onChangeConfig={handleUpdateConfig}
      />

      {/* 🚀 トースト通知コンテナ */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
};

export default App;
