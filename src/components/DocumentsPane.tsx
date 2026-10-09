import React, { useRef, useState } from 'react';
import {
  FileUp,
  FileText,
  CheckCircle2,
  Loader2,
  Trash2,
  FolderPlus,
  Folder,
  CheckSquare,
  Square,
  DownloadCloud,
  UploadCloud,
  Mic,
  Eye
} from 'lucide-react';
import { DocumentSource, Project } from '../types/index.ts';

interface DocumentsPaneProps {
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  onExportProject: (id: string) => void;
  onImportProject: (file: File) => void;
  documents: DocumentSource[];
  onUpload: (files: FileList) => void;
  onToggleDoc: (id: string) => void;
  onToggleAllDocs: (selectAll: boolean) => void;
  onRemoveDoc: (id: string) => void;
  onRemoveAllDocs?: () => void;
  onViewDoc?: (doc: DocumentSource) => void;
  isProcessing: boolean;
  processProgress: number;
  processStatusText?: string;
  onCancelUpload?: () => void;
  audioEngine?: 'auto' | 'gemini' | 'kotoba-whisper' | 'whisper-local';
  onChangeAudioEngine?: (engine: 'auto' | 'gemini' | 'kotoba-whisper' | 'whisper-local') => void;
}

export const DocumentsPane: React.FC<DocumentsPaneProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onExportProject,
  onImportProject,
  documents,
  onUpload,
  onToggleDoc,
  onToggleAllDocs,
  onRemoveDoc,
  onRemoveAllDocs,
  onViewDoc,
  isProcessing,
  processProgress,
  processStatusText,
  onCancelUpload,
  audioEngine,
  onChangeAudioEngine
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');

  const enabledCount = documents.filter(d => d.enabled).length;
  const isAllSelected = documents.length > 0 && enabledCount === documents.length;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleCreateProjSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    onCreateProject(newProjName.trim());
    setNewProjName('');
    setIsCreatingProj(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/50 border-r border-slate-800/80 p-4">
      {/* 隠しインポートInput */}
      <input
        type="file"
        ref={importInputRef}
        onChange={(e) => e.target.files && onImportProject(e.target.files[0])}
        accept=".minibook,.json"
        className="hidden"
      />

      {/* プロジェクト管理ヘッダー */}
      <div className="mb-3 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-300">
            <Folder className="w-4 h-4 text-indigo-400" />
            <span>プロジェクト</span>
          </div>

          <div className="flex items-center space-x-1">
            {/* 📥 インポート */}
            <button
              onClick={() => importInputRef.current?.click()}
              className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[11px] flex items-center"
              title="プロジェクト読込 (.minibook)"
            >
              <UploadCloud className="w-3.5 h-3.5" />
            </button>

            {/* 📤 エクスポート */}
            {activeProject && (
              <button
                onClick={() => onExportProject(activeProject.id)}
                className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[11px] flex items-center"
                title="プロジェクト出力 (.minibook)"
              >
                <DownloadCloud className="w-3.5 h-3.5" />
              </button>
            )}

            {/* ＋新規作成 */}
            <button
              onClick={() => setIsCreatingProj(!isCreatingProj)}
              className="flex items-center space-x-0.5 text-[11px] px-2 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-all"
            >
              <FolderPlus className="w-3 h-3" />
              <span>＋新規</span>
            </button>
          </div>
        </div>

        {isCreatingProj ? (
          <form onSubmit={handleCreateProjSubmit} className="flex items-center space-x-1 pt-1">
            <input
              type="text"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="プロジェクト名..."
              autoFocus
              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium"
            >
              作成
            </button>
          </form>
        ) : (
          <div className="flex items-center space-x-1">
            <select
              value={activeProject?.id || ''}
              onChange={(e) => onSelectProject(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {projects.length > 1 && activeProject && (
              <button
                onClick={() => {
                  if (confirm(`「${activeProject.name}」を削除しますか？`)) {
                    onDeleteProject(activeProject.id);
                  }
                }}
                className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded transition-colors"
                title="プロジェクト削除"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ソース操作バー */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onToggleAllDocs(!isAllSelected)}
            disabled={documents.length === 0}
            className="flex items-center space-x-1 text-xs text-slate-300 hover:text-white font-medium disabled:opacity-40"
          >
            {isAllSelected ? (
              <CheckSquare className="w-4 h-4 text-indigo-400" />
            ) : (
              <Square className="w-4 h-4 text-slate-500" />
            )}
            <span>全て選択</span>
          </button>

          {documents.length > 0 && onRemoveAllDocs && (
            <button
              onClick={onRemoveAllDocs}
              className="text-[10px] text-rose-400/80 hover:text-rose-300 hover:underline flex items-center space-x-0.5 ml-1"
              title="ドキュメント全削除＆検索キャッシュ初期化"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>全消去</span>
            </button>
          )}
        </div>

        <span className="text-[11px] text-slate-400 font-mono">
          <span className="text-indigo-400 font-semibold">{enabledCount}</span> / {documents.length} 件 選択中
        </span>
      </div>

      {/* 🎙️ 文字起こし専用AIモデル切替ピッカー */}
      <div className="mb-2.5 bg-slate-800/90 border border-purple-500/30 rounded-xl p-2.5 flex flex-col space-y-1.5 shadow-sm shadow-purple-950/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-purple-300 font-bold text-xs">
            <Mic className="w-3.5 h-3.5 text-purple-400" />
            <span>文字起こし専用AI:</span>
          </div>
          <span className="text-[9px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700/50">
            STT専用
          </span>
        </div>
        <select
          value={audioEngine || 'kotoba-whisper'}
          onChange={(e) => onChangeAudioEngine?.(e.target.value as any)}
          className="w-full bg-slate-900 border border-purple-500/40 rounded-lg px-2.5 py-1.5 text-xs text-purple-200 focus:outline-none focus:border-purple-400 font-medium"
        >
          <option value="kotoba-whisper">🇯🇵 Kotoba-Whisper v2.2 (日本語特化ONNX・推奨)</option>
          <option value="auto">🚀 自動最適化 (Gemini優先 / Kotobaフォールバック)</option>
          <option value="gemini">☁️ Gemini 1.5 Flash (超高速クラウド / 10秒解析)</option>
          <option value="whisper-local">⚡ Whisper-Tiny (超軽量・英語/多言語)</option>
        </select>
      </div>

      {/* ドロップゾーン */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-all ${
          isProcessing
            ? 'border-indigo-500/40 bg-indigo-500/5'
            : 'border-slate-700/80 hover:border-indigo-500/60 bg-slate-800/30 hover:bg-slate-800/60'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files && onUpload(e.target.files)}
          multiple
          accept=".pdf,.txt,.md,.mp3,.mp4,.wav,.wma,.m4a,.ogg,.webm,.mov"
          className="hidden"
        />
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center space-y-1.5 py-1">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            <span className="text-xs text-slate-200 font-medium text-center truncate max-w-full px-2">
              {processStatusText || '解析＆文字起こし中...'} ({processProgress}%)
            </span>
            <div className="w-full bg-slate-700 rounded-full h-1 overflow-hidden">
              <div
                className="bg-indigo-500 h-1 rounded-full transition-all duration-300"
                style={{ width: `${processProgress}%` }}
              />
            </div>
            {onCancelUpload && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelUpload();
                }}
                className="text-[10px] text-rose-400 hover:text-rose-300 hover:underline pt-0.5"
              >
                処理を中止する
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-1 py-1">
            <FileUp className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-200">
              PDF / 音声 / 動画 / テキストを追加
            </span>
            <span className="text-[10px] text-slate-500">
              PDF, MP3, MP4, WMA, M4A, TXT対応
            </span>
          </div>
        )}
      </div>

      {/* ドキュメント一覧 */}
      <div className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
        {documents.length === 0 ? (
          <div className="h-36 flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
            ドキュメントがありません。<br />
            ファイルをアップロードすると自動保存されます。
          </div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className={`group p-2.5 rounded-xl border transition-all flex items-start justify-between ${
                doc.enabled
                  ? 'bg-slate-800/70 border-slate-700/80'
                  : 'bg-slate-900/40 border-slate-800/40 opacity-60'
              }`}
            >
              <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                <button
                  onClick={() => onToggleDoc(doc.id)}
                  className="mt-0.5 text-slate-400 hover:text-indigo-400 transition-colors"
                >
                  {doc.enabled ? (
                    <CheckSquare className="w-4 h-4 text-indigo-400" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </button>

                <div className={`p-1 rounded mt-0.5 ${
                  doc.type === 'audio' || doc.type === 'video'
                    ? 'bg-purple-500/10 text-purple-400'
                    : 'bg-indigo-500/10 text-indigo-400'
                }`}>
                  <FileText className="w-3.5 h-3.5" />
                </div>

                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => onViewDoc ? onViewDoc(doc) : onToggleDoc(doc.id)}
                >
                  <h3 className="text-xs font-semibold text-slate-200 hover:text-indigo-300 transition-colors truncate" title={`${doc.title} (クリックで全文表示・編集・AI校正)`}>
                    {doc.title}
                  </h3>
                  <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                    <span className="flex items-center text-emerald-400">
                      <CheckCircle2 className="w-3 h-3 mr-0.5" />
                      {doc.totalChunks} チャンク
                    </span>
                    <span>•</span>
                    <span className={`font-mono px-1 py-0.2 rounded text-[9px] ${
                      doc.type === 'audio' ? 'bg-purple-900/60 text-purple-300 border border-purple-700/50' : 'text-cyan-300'
                    }`}>
                      {doc.type === 'audio' ? '🎙️ 音声' : doc.type.toUpperCase()}
                    </span>
                  </div>
                  {doc.contentPreview?.includes('音声トラックがドキュメントとして登録されました') && (
                    <div className="mt-1 bg-amber-500/15 border border-amber-500/40 rounded px-2 py-1 text-[10px] text-amber-200">
                      ⚠️ <strong className="font-bold">旧バージョンの未文字起こしデータです</strong><br />
                      音声ファイルを再度ドラッグ＆ドロップするとKotoba-Whisperで自動解析されます。
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-0.5 ml-1 shrink-0">
                {onViewDoc && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDoc(doc);
                    }}
                    className="p-1.5 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-300 rounded-lg transition-all"
                    title="文字起こし全文の表示・編集・AI校正"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveDoc(doc.id);
                  }}
                  className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-all"
                  title="このドキュメントを削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
