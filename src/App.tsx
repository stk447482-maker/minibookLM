import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { DocumentsPane } from './components/DocumentsPane.tsx';
import { ChatPane } from './components/ChatPane.tsx';
import { StudioPane } from './components/StudioPane.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { DocumentModal } from './components/DocumentModal.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DocumentSource, ChatMessage, StudioArtifact, StudioTab, ModelConfig, Project } from './types/index.ts';
import { ragManager } from './services/ragManager.ts';
import { llmService } from './services/llmService.ts';
import { dbService } from './services/db.ts';
import { securityGuard } from './services/securityGuard.ts';
import { DiagramService } from './services/diagramService.ts';
import { buildStudioPrompt } from './services/studioPrompts.ts';
import { useChatSession } from './hooks/useChatSession.ts';
import { useDocumentManager } from './hooks/useDocumentManager.ts';
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

  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [selectedDocForModal, setSelectedDocForModal] = useState<DocumentSource | null>(null);

  const {
    isProcessingDoc,
    docProgress,
    docStatusText,
    handleUpload,
    handleCancelUpload,
    handleAddContentToSource,
    handleToggleDoc,
    handleToggleAllDocs,
    handleToggleAuxiliaryBrain,
    handleRemoveDoc,
    handleRemoveAllDocs,
    handleMoveDoc,
    handleCopyDoc,
    handleSaveDocumentContent
  } = useDocumentManager({
    activeProject,
    documents,
    setDocuments,
    config,
    showToast,
    setSelectedDocForModal
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const {
    isGenerating,
    statusMessage,
    handleSendMessage,
    handleDeleteMessage,
    handleClearMessages,
    cancelChat: _cancelChat
  } = useChatSession({
    activeProject,
    documents,
    config,
    messages,
    setMessages
  });

  const [artifacts, setArtifacts] = useState<StudioArtifact[]>([]);
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);
  const [streamingStudioArtifact, setStreamingStudioArtifact] = useState<{ type: StudioTab; title: string; content: string } | null>(null);
  const studioAbortControllerRef = useRef<AbortController | null>(null);

  const handleCancelStudio = () => {
    if (studioAbortControllerRef.current) {
      studioAbortControllerRef.current.abort();
      studioAbortControllerRef.current = null;
    }
    setIsGeneratingStudio(false);
    setStreamingStudioArtifact(null);
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




  // 成果物削除
  const handleDeleteArtifact = async (artifactId: string) => {
    await dbService.deleteArtifact(artifactId);
    setArtifacts(prev => prev.filter(a => a.id !== artifactId));
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
