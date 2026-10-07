import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { DocumentsPane } from './components/DocumentsPane.tsx';
import { ChatPane } from './components/ChatPane.tsx';
import { StudioPane } from './components/StudioPane.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DocumentSource, ChatMessage, StudioArtifact, StudioTab, ModelConfig, Project } from './types/index.ts';
import { ragManager } from './services/ragManager.ts';
import { llmService } from './services/llmService.ts';
import { dbService } from './services/db.ts';
import { securityGuard } from './services/securityGuard.ts';

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

  const [config, setConfig] = useState<ModelConfig>({
    mode: 'desktop-api', // デフォルトでOllama / server.pyローカルAPIモード
    embeddedModelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    desktopApiEndpoint: 'http://127.0.0.1:11434',
    desktopModelName: 'llama3.1',
    temperature: 0.3
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'docs' | 'chat' | 'studio'>('chat');

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [docProgress, setDocProgress] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [artifacts, setArtifacts] = useState<StudioArtifact[]>([]);
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);

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

    setIsProcessingDoc(true);
    setDocProgress(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { doc, chunks } = await ragManager.processDocument(file, activeProject.id, (percent) => {
          setDocProgress(percent);
        });

        await dbService.saveDocument(doc);
        await dbService.saveChunks(chunks);

        setDocuments(prev => [...prev, doc]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`ドキュメント処理に失敗しました: ${msg}`);
      }
    }

    setIsProcessingDoc(false);
    setDocProgress(0);
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
      alert(`「${title}」をソース一覧に追加しました！`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`ソース追加エラー: ${msg}`);
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

  // ドキュメント削除
  const handleRemoveDoc = async (id: string) => {
    await dbService.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
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

    setIsGenerating(true);
    setStatusMessage('選択されたソースからハイブリッド検索中...');

    try {
      const enabledDocIds = documents.filter(d => d.enabled).map(d => d.id);
      let searchResults: any[] = [];
      let graphSummary = '';
      let fullDocsContext = '';
      let totalContextChars = 0;
      let activeDocTitles: string[] = [];

      // モデル種別に応じた安全なトークン枠（WebGPUブラウザ: 2,500文字, Gemini: 60,000文字, デスクトップAPI: 12,000文字）
      let maxContextChars = 2500;
      if (config.mode === 'cloud-gemini') {
        maxContextChars = 60000;
      } else if (config.mode === 'desktop-api') {
        maxContextChars = 12000;
      } else if (config.mode === 'desktop-gguf') {
        maxContextChars = 8000;
      }

      if (enabledDocIds.length > 0) {
        // 1. 選択された全ドキュメントの包括的コンテキストをモデルの許容文字数内で動的抽出
        const comp = await ragManager.getComprehensiveContext(activeProject.id, enabledDocIds, maxContextChars, query);
        fullDocsContext = comp.contextText;
        totalContextChars = comp.totalChars;
        activeDocTitles = comp.docTitles;
        searchResults = comp.sources;

        // 2. クエリ特化のハイブリッド検索（特定箇所フォーカス用）
        const focusedHits = await ragManager.search(query, enabledDocIds, 4);
        if (focusedHits.length > 0) {
          graphSummary = ragManager.extractGraphRAGTriples(focusedHits);
        }
      }

      // 🎯 厳密RAG直接抽出モードの場合
      if (isDirectRAG) {
        if (enabledDocIds.length === 0) {
          throw new Error('厳密RAG直接抽出を行うには、左側のドキュメント一覧で対象の資料にチェックを入れてください。');
        }
        if (searchResults.length === 0) {
          throw new Error('選択されたドキュメント内に関連する該当箇所が見つかりませんでした。');
        }

        let directContent = `### 🎯 厳密RAG 抽出結果 (選択資料: ${activeDocTitles.join(', ')})\n\n`;
        directContent += `選択された **${enabledDocIds.length}** 件のドキュメント (計 ${totalContextChars.toLocaleString()} 文字) から該当コンテキストを抽出しました。\n\n`;

        searchResults.forEach((r, idx) => {
          directContent += `#### 📄 [${idx + 1}] ${r.docTitle}\n`;
          directContent += `> ${r.snippet}\n\n`;
          directContent += `<details><summary>ドキュメント本文コンテキストを展開</summary>\n\n${r.fullContext}\n\n</details>\n\n---\n\n`;
        });

        if (graphSummary) {
          directContent += `\n${graphSummary}\n`;
        }

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

      // 🤖 通常AI回答モード (長文ドキュメント完全把握・NotebookLM型グラウンディング)
      let systemPrompt = '';
      if (fullDocsContext) {
        systemPrompt = `あなたはGoogle NotebookLMのように、ユーザーから提供された【参照ドキュメント】の内容を完璧に読解・分析して回答する専任AIアシスタントです。

【最重要原則】
1. あなたの知識の源泉は、以下の【参照ドキュメント】に記載された全情報です。
2. ユーザーの質問に対して、ドキュメントに書かれている事実、決定事項、数値、用語、文脈を徹底的に読み解き、網羅的かつ具体的に回答してください。
3. 回答時には「ドキュメント【${activeDocTitles[0]}】によると...」のように資料名を根拠として明示してください。
4. ドキュメント内に一切記述のない事柄を問われた場合のみ、「提供されたドキュメントには記載がありません」と明確に区別して回答してください。

【参照ドキュメント (選択中: ${activeDocTitles.join(', ')} / 計 ${totalContextChars.toLocaleString()} 文字)】
${fullDocsContext}

${graphSummary ? `【ナレッジネットワーク関係性】\n${graphSummary}` : ''}`;
      } else {
        systemPrompt = `あなたは親切で博識なAIアシスタントです。ユーザーの質問に対して論理的かつ分かりやすい日本語で丁寧に回答してください。`;
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
      setStatusMessage(`ドキュメント (${activeDocTitles.length}件) を解析して回答生成中...`);

      const userPromptWithContext = fullDocsContext
        ? `【質問】${query}\n\n(※上記の提供ドキュメント【${activeDocTitles.join(', ')}】の内容を把握した上で、質問に対する回答を日本語で答えてください)`
        : query;

      const recentMessages = config.mode === 'embedded-mobile' ? messages.slice(-4) : messages.slice(-10);
      const chatHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...recentMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userPromptWithContext }
      ];

      const stream = llmService.streamChat(chatHistory, config, (prog) => {
        setStatusMessage(prog);
      });

      let accumulatedText = '';
      for await (const chunk of stream) {
        accumulatedText += chunk;
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, content: accumulatedText } : m))
        );
      }

      if (graphSummary && !accumulatedText.includes('GraphRAG')) {
        accumulatedText += `\n\n${graphSummary}`;
      }

      const finalAssistantMsg: ChatMessage = {
        ...assistantMsg,
        content: accumulatedText,
        isStreaming: false
      };

      setMessages(prev =>
        prev.map(m => (m.id === assistantMsgId ? finalAssistantMsg : m))
      );

      await dbService.saveMessage(finalAssistantMsg);
    } catch (err: unknown) {
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
      const fullContext = await ragManager.getActiveDocsFullText(activeProject.id, enabledDocIds);

      let prompt = '';
      let title = '';

      const userRequirement = customPrompt ? `\n【ユーザーからの特別指示・こだわり条件】\n${customPrompt}\n` : '';

      if (type === 'briefing') {
        title = customPrompt ? `要約: ${customPrompt.slice(0, 15)}...` : '総合要約ブリーフィング';
        prompt = `以下の資料内容から、重要な要点、概要、決定事項、背景を整理した要約ブリーフィング文書を作成してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'minutes') {
        title = customPrompt ? `議事録: ${customPrompt.slice(0, 15)}...` : '会議議事録・決定事項・ToDo';
        prompt = `以下の資料（音声文字起こしや会議記録）から、ビジネス基準の高品質な【会議議事録】を作成してください。\n構成案:\n1. 議題・会議目的\n2. 決定事項 (Decisions)\n3. 議論の詳細・発言要点\n4. 持ち越し課題・次回検討事項\n5. アクションプラン / ToDo (担当者・期日・タスク一覧表)${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'study_report') {

        title = customPrompt ? `レポート: ${customPrompt.slice(0, 15)}...` : '詳細研究・調査レポート';
        prompt = `以下の資料群を多角的に分析し、1. 概要・背景, 2. 主要な発見・要点分析, 3. 課題と解決策, 4. 総合結論 を含む詳細な研究・調査レポート(Markdown形式)を作成してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'faq') {
        title = customPrompt ? `FAQ: ${customPrompt.slice(0, 15)}...` : '想定問答集 (FAQ)';
        prompt = `以下の資料内容から、最も重要な質問とそれに対する正確な回答ペア(FAQ)を作成してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'learning_guide') {
        title = customPrompt ? `学習ガイド: ${customPrompt.slice(0, 15)}...` : 'ステップ別 学習ガイド';
        prompt = `以下の資料内容から、重要概念を分かりやすく解説した学習ガイドと確認テストを作成してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'slide') {
        title = customPrompt ? `スライド: ${customPrompt.slice(0, 15)}...` : 'Marp プレゼンテーションスライド';
        prompt = `以下の資料内容を分析し、プレゼンテーション用スライド（Marp Markdown形式）を作成してください。\nルール:\n- スライド区切りは \`---\` を使用\n- 1枚目: 表題\n- 2枚目: アジェンダ\n- 本論（要点、箇条書き、結論）\n- テーマヘッダー \`<!-- theme: default -->\` を冒頭に付与${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'mindmap') {
        title = customPrompt ? `マインドマップ: ${customPrompt.slice(0, 15)}...` : 'Mermaid マインドマップ';
        prompt = `以下の資料の概念構造を、必ずMermaid記法の \`mindmap\` フォーマットのみでコードブロック形式で出力してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'flowchart') {
        title = customPrompt ? `フローチャート: ${customPrompt.slice(0, 15)}...` : 'Mermaid フローチャート';
        prompt = `以下の資料から業務プロセスや概念処理フローを抽出し、必ずMermaid記法の \`graph TD\` または \`flowchart TD\` フォーマットのみでコードブロック形式で出力してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'graph3d') {
        title = customPrompt ? `3Dグラフ: ${customPrompt.slice(0, 15)}...` : '3D ナレッジグラフデータ';
        prompt = `以下の資料から主要な概念（ノード）と関係性（リンク）を抽出し、必ず以下のJSONフォーマットのみで出力してください（解説不要）:\n\`\`\`json\n{\n  "nodes": [{"id": "1", "name": "主要概念名", "val": 12, "color": "#6366f1"}],\n  "links": [{"source": "1", "target": "2", "label": "関係性"}]\n}\n\`\`\`${userRequirement}\n\n資料内容:\n${fullContext}`;
      } else if (type === 'podcast') {
        title = customPrompt ? `ポッドキャスト: ${customPrompt.slice(0, 15)}...` : 'ポッドキャスト対話スクリプト';
        prompt = `以下の資料を題材に、ホスト（アレックス）と専門家（サクラ）による親しみやすい会話形式のポッドキャスト原稿（**アレックス:** ... / **サクラ:** ...）を作成してください。${userRequirement}\n\n資料内容:\n${fullContext}`;
      }

      const stream = llmService.streamChat(
        [
          { role: 'system', content: 'あなたはプロフェッショナルなコンテンツプロデューサーです。ユーザーの要望に正確に従ってください。' },
          { role: 'user', content: prompt }
        ],
        config
      );

      let content = '';
      for await (const chunk of stream) {
        content += chunk;
      }

      const newArtifact: StudioArtifact = {
        id: `art_${Date.now()}`,
        projectId: activeProject.id,
        type,
        title,
        content,
        customPrompt,
        createdAt: Date.now()
      };

      setArtifacts(prev => [newArtifact, ...prev]);
      await dbService.saveArtifact(newArtifact);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Studio生成エラー: ${msg}`);
    } finally {
      setIsGeneratingStudio(false);
    }
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
            documents={documents}
            onUpload={handleUpload}
            onToggleDoc={handleToggleDoc}
            onToggleAllDocs={handleToggleAllDocs}
            onRemoveDoc={handleRemoveDoc}
            isProcessing={isProcessingDoc}
            processProgress={docProgress}
          />
        </div>

        {/* 中央ペイン: チャット画面 */}
        <div
          className={`h-full flex-1 md:block ${
            activeMobileTab === 'chat' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <ChatPane
            messages={messages}
            onSendMessage={handleSendMessage}
            onClearMessages={handleClearMessages}
            onDeleteMessage={handleDeleteMessage}
            onAddToSource={handleAddContentToSource}
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
            artifacts={artifacts}
            onGenerate={handleGenerateStudio}
            onDeleteArtifact={handleDeleteArtifact}
            onAddToSource={handleAddContentToSource}
            isGeneratingStudio={isGeneratingStudio}
          />
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onChangeConfig={setConfig}
      />
    </div>
  );
};

export default App;
