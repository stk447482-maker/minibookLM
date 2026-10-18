import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { DocumentsPane } from './components/DocumentsPane.tsx';
import { ChatPane } from './components/ChatPane.tsx';
import { StudioPane } from './components/StudioPane.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { DocumentModal } from './components/DocumentModal.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DocumentSource, ChatMessage, StudioArtifact, ModelConfig, Project } from './types/index.ts';
import { ragManager } from './services/ragManager.ts';
import { dbService } from './services/db.ts';
import { securityGuard } from './services/securityGuard.ts';
import { localSyncService } from './services/localSyncService.ts';
import { useChatSession } from './hooks/useChatSession.ts';
import { useDocumentManager } from './hooks/useDocumentManager.ts';
import { useStudioManager } from './hooks/useStudioManager.ts';
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
  const {
    isGeneratingStudio,
    streamingStudioArtifact,
    handleGenerateStudio,
    handleCancelStudio,
    handleDeleteArtifact,
    handleUpdateArtifact
  } = useStudioManager({
    activeProject,
    documents,
    artifacts,
    setArtifacts,
    config,
    showToast,
    openSettings: () => setIsSettingsOpen(true)
  });

  // 1. 初回マウント時: IndexedDBからプロジェクト復元
  useEffect(() => {
    const initApp = async () => {
      try {
        let savedProjects = await dbService.getAllProjects();

        // 📁 PCローカル同期フォルダから自動読込（設定されている場合）
        try {
          const localPackages = await localSyncService.checkAndLoadFromDirectory();
          if (localPackages && localPackages.length > 0) {
            for (const pkg of localPackages) {
              const exists = savedProjects.some(p => p.id === pkg.project.id);
              if (!exists) {
                await dbService.importProjectPackage(JSON.stringify(pkg));
              }
            }
            savedProjects = await dbService.getAllProjects();
          }
        } catch {
          // ignore
        }

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

        // 📁 ローカル同期フォルダへ最新状態を自動保存
        localSyncService.autoSaveToDirectory(activeProject, docs, chunks, msgs, arts);
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

    // 📁 ローカル同期フォルダへ即時自動バックアップ
    localSyncService.autoSaveToDirectory(newProj, [], [], [], []);
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

  // 📐 3ペインのドラッグ自由リサイズ（幅保存＆復元）
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    const saved = localStorage.getItem('minibooklm_left_width');
    return saved ? Math.max(220, Math.min(600, parseInt(saved, 10))) : 340;
  });
  const [rightPaneWidth, setRightPaneWidth] = useState<number>(() => {
    const saved = localStorage.getItem('minibooklm_right_width');
    return saved ? Math.max(260, Math.min(800, parseInt(saved, 10))) : 380;
  });
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft) {
        const newWidth = Math.max(220, Math.min(600, e.clientX));
        setLeftPaneWidth(newWidth);
        localStorage.setItem('minibooklm_left_width', String(newWidth));
      } else if (isDraggingRight) {
        const newWidth = Math.max(260, Math.min(800, window.innerWidth - e.clientX));
        setRightPaneWidth(newWidth);
        localStorage.setItem('minibooklm_right_width', String(newWidth));
      }
    };
    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
    };

    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingLeft, isDraggingRight]);

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


      <main className="flex-1 flex overflow-hidden relative">
        {/* 左ペイン: ソース＆プロジェクト管理 */}
        <div
          style={{ width: activeMobileTab === 'docs' ? '100%' : `${leftPaneWidth}px` }}
          className={`h-full shrink-0 md:block ${
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
            geminiApiKey={config.cloudApiKey}
          />
        </div>

        {/* ↔️ 左ペイン リサイズスプリッター（PC用ドラッグバー） */}
        <div
          onMouseDown={() => setIsDraggingLeft(true)}
          onDoubleClick={() => {
            setLeftPaneWidth(340);
            localStorage.setItem('minibooklm_left_width', '340');
          }}
          title="ドラッグで幅を自由にリサイズ（ダブルクリックで既定値に戻す）"
          className="hidden md:flex w-1.5 hover:w-2 shrink-0 cursor-col-resize bg-slate-800/80 hover:bg-indigo-500 active:bg-indigo-400 transition-all items-center justify-center group z-10"
        >
          <div className="w-0.5 h-8 bg-slate-600 group-hover:bg-white rounded-full transition-colors" />
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

        {/* ↔️ 右ペイン リサイズスプリッター（PC用ドラッグバー） */}
        <div
          onMouseDown={() => setIsDraggingRight(true)}
          onDoubleClick={() => {
            setRightPaneWidth(380);
            localStorage.setItem('minibooklm_right_width', '380');
          }}
          title="ドラッグで幅を自由にリサイズ（ダブルクリックで既定値に戻す）"
          className="hidden md:flex w-1.5 hover:w-2 shrink-0 cursor-col-resize bg-slate-800/80 hover:bg-indigo-500 active:bg-indigo-400 transition-all items-center justify-center group z-10"
        >
          <div className="w-0.5 h-8 bg-slate-600 group-hover:bg-white rounded-full transition-colors" />
        </div>

        {/* 右ペイン: Studio生成物 */}
        <div
          style={{ width: activeMobileTab === 'studio' ? '100%' : `${rightPaneWidth}px` }}
          className={`h-full shrink-0 md:block ${
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
            onSelectGraphNode={(nodeName) => {
              setActiveMobileTab('chat');
              handleSendMessage(`「${nodeName}」に関する詳細情報、定義、および関連する記述を教えて`, false);
            }}
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
