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
  Eye,
  ArrowRightLeft,
  Copy,
  Sparkles,
  Globe,
  Plus
} from 'lucide-react';
import { DocumentSource, Project } from '../types/index.ts';
import { YoutubeAudioService } from '../services/youtubeAudioService.ts';

interface DocumentsPaneProps {
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  onDeleteProject: (id: string) => void;
  onExportProject: (id: string) => void;
  onImportProject: (file: File) => void;
  onAddTextContent?: (title: string, content: string) => Promise<void>;
  documents: DocumentSource[];
  onUpload: (files: FileList) => void;
  onToggleDoc: (id: string) => void;
  onToggleAllDocs: (selectAll: boolean) => void;
  onRemoveDoc: (id: string) => void;
  onRemoveAllDocs?: () => void;
  onViewDoc?: (doc: DocumentSource) => void;
  onToggleAuxiliaryBrain?: (doc: DocumentSource) => Promise<void>;
  onMoveDoc?: (docId: string, targetProjectId: string) => Promise<void>;
  onCopyDoc?: (docId: string, targetProjectId: string) => Promise<void>;
  isProcessing: boolean;
  processProgress: number;
  processStatusText?: string;
  onCancelUpload?: () => void;
  audioEngine?: 'auto' | 'gemini' | 'whisper-small' | 'whisper-large-v3' | 'kotoba-whisper' | 'native-large-v3' | 'native-kotoba' | 'whisper-local';
  onChangeAudioEngine?: (engine: 'auto' | 'gemini' | 'whisper-small' | 'whisper-large-v3' | 'kotoba-whisper' | 'native-large-v3' | 'native-kotoba' | 'whisper-local') => void;
}

export const DocumentsPane: React.FC<DocumentsPaneProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onExportProject,
  onImportProject,
  onAddTextContent,
  documents,
  onUpload,
  onToggleDoc,
  onToggleAllDocs,
  onRemoveDoc,
  onRemoveAllDocs,
  onViewDoc,
  onToggleAuxiliaryBrain,
  onMoveDoc,
  onCopyDoc,
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
  const [transferDoc, setTransferDoc] = useState<DocumentSource | null>(null);
  const [targetProjId, setTargetProjId] = useState<string>('');
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy');
  const [isTransferring, setIsTransferring] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'files' | 'brain'>('files');

  // Web記事 & YouTube インポートモーダル
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlFetchStatus, setUrlFetchStatus] = useState<string>('');
  const [urlFetchError, setUrlFetchError] = useState<string | null>(null);
  const [youtubeFallback, setYoutubeFallback] = useState<{
    videoId: string;
    videoTitle: string;
    url: string;
  } | null>(null);
  const fallbackFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleOpenTransfer = (doc: DocumentSource) => {
    setTransferDoc(doc);
    const otherProjects = projects.filter(p => p.id !== activeProject?.id);
    if (otherProjects.length > 0) {
      setTargetProjId(otherProjects[0].id);
    }
  };

  const handleExecuteTransfer = async () => {
    if (!transferDoc || !targetProjId) return;
    setIsTransferring(true);
    try {
      if (transferMode === 'move') {
        if (onMoveDoc) await onMoveDoc(transferDoc.id, targetProjId);
      } else {
        if (onCopyDoc) await onCopyDoc(transferDoc.id, targetProjId);
      }
      setTransferDoc(null);
    } catch (err) {
      console.error('Transfer failed:', err);
      alert('移動/コピーに失敗しました');
    } finally {
      setIsTransferring(false);
    }
  };

  // 🌐 Web記事 / YouTube URL の自動インポート処理
  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawUrl = urlInput.trim();
    if (!rawUrl || isFetchingUrl || !onAddTextContent) return;

    setIsFetchingUrl(true);
    setUrlFetchError(null);

    try {
      // 1. YouTube URL 判定 (youtube.com / youtu.be)
      const ytMatch = rawUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
      if (ytMatch && ytMatch[1]) {
        const videoId = ytMatch[1];
        let transcriptText = '';
        let videoTitle = `YouTube (${videoId})`;

        // 🎯 方式 1: YouTube 埋め込み公式字幕トラック (ytInitialPlayerResponse) の直接抽出
        try {
          const ytPageUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(ytPageUrl)}`;
          const pageRes = await fetch(proxyUrl);
          if (pageRes.ok) {
            const pageJson = await pageRes.json();
            const html = pageJson.contents || '';

            // タイトル抽出
            const titleMatch = html.match(/<title>(.+?)<\/title>/);
            if (titleMatch && titleMatch[1]) {
              videoTitle = titleMatch[1].replace(' - YouTube', '').trim();
            }

            // ytInitialPlayerResponse から captionTracks を探索
            const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var|<\/script)/);
            if (playerResponseMatch && playerResponseMatch[1]) {
              const playerResponse = JSON.parse(playerResponseMatch[1]);
              const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

              if (Array.isArray(tracks) && tracks.length > 0) {
                // 日本語字幕優先、なければ最初の字幕トラック
                const targetTrack = tracks.find((t: any) => t.languageCode === 'ja') || tracks[0];
                if (targetTrack?.baseUrl) {
                  // 字幕XML取得 (CORSプロキシ経由)
                  const trackProxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetTrack.baseUrl)}`;
                  const subRes = await fetch(trackProxyUrl);
                  if (subRes.ok) {
                    const subJson = await subRes.json();
                    const subXml = subJson.contents || '';

                    // XMLパース (<text>タグの抽出)
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(subXml, 'text/xml');
                    const textNodes = Array.from(xmlDoc.querySelectorAll('text'));
                    
                    if (textNodes.length > 0) {
                      const lines = textNodes.map(node => {
                        const start = parseFloat(node.getAttribute('start') || '0');
                        const m = Math.floor(start / 60);
                        const s = Math.floor(start % 60);
                        const timeStr = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                        const rawContent = node.textContent || '';
                        // HTMLエンティティデコード
                        const clean = rawContent
                          .replace(/&amp;/g, '&')
                          .replace(/&quot;/g, '"')
                          .replace(/&#39;/g, "'")
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/\n/g, ' ')
                          .trim();
                        return `[${timeStr}] ${clean}`;
                      }).filter(l => l.length > 8);

                      if (lines.length > 0) {
                        transcriptText = `### 📝 YouTube公式 タイムスタンプ付き字幕文字起こし\n- **言語:** ${targetTrack.name?.simpleText || targetTrack.languageCode}\n\n${lines.join('\n')}`;
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (ytErr) {
          console.warn('YouTube direct caption extraction error:', ytErr);
        }

        // 🎯 方式 2: Jina Reader API (Clean Reader) フォールバック
        if (!transcriptText || transcriptText.length < 50) {
          try {
            const jinaUrl = `https://r.jina.ai/https://www.youtube.com/watch?v=${videoId}`;
            const res = await fetch(jinaUrl, { headers: { 'Accept': 'text/plain' } });
            if (res.ok) {
              const md = await res.text();
              if (md && md.length > 100 && !md.includes('Sign in to confirm') && !md.includes('Blocked')) {
                const titleMatch = md.match(/Title:\s*(.+)/);
                if (titleMatch && titleMatch[1]) videoTitle = titleMatch[1].trim();
                // 動画の要約や字幕が含まれているか確認
                if (md.includes('Transcript') || md.includes('Captions') || md.length > 300) {
                  transcriptText = md;
                }
              }
            }
          } catch {
            // ignore
          }
        }

        // 🎯 方式 3: 字幕トラックがない場合、音声を自動抽出して内蔵Whisperで文字起こし
        if (!transcriptText || transcriptText.length < 50) {
          try {
            setUrlFetchStatus('📺 字幕なし動画を検出。音声ストリームを自動抽出中...');
            const audioResult = await YoutubeAudioService.fetchAudioBlob(videoId, (status) => {
              setUrlFetchStatus(status);
            });

            // 音声Fileオブジェクトを生成し、アップロードパイプライン（Whisper）に引き渡し
            const dt = new DataTransfer();
            dt.items.add(audioResult.file);
            onUpload(dt.files);

            setUrlInput('');
            setShowUrlModal(false);
            setUrlFetchStatus('');
            setYoutubeFallback(null);
            return;
          } catch (audioErr: any) {
            console.warn('YouTube audio extraction failed:', audioErr);
            // 💡 A・Bハイブリッド: エラーで突き放さず、スマート音声取り込みモード（ワンクリック案内＋D&D）に移行
            setYoutubeFallback({
              videoId,
              videoTitle,
              url: rawUrl
            });
            setIsFetchingUrl(false);
            setUrlFetchStatus('');
            return;
          }
        }

        const formattedDoc = `## 📺 YouTube動画 文字起こしデータ\n- **タイトル:** ${videoTitle}\n- **URL:** ${rawUrl}\n- **取得時刻:** ${new Date().toLocaleString('ja-JP')}\n\n---\n\n${transcriptText}`;
        await onAddTextContent(`📺 ${videoTitle.slice(0, 35)}`, formattedDoc);
        setUrlInput('');
        setShowUrlModal(false);
        setUrlFetchStatus('');
        return;
      }

      // 2. 一般 Web 記事の Clean Reader インポート
      let webTitle = rawUrl;
      let cleanContent = '';

      // Jina Reader API (高速・広告除去・Markdown変換) 経由
      try {
        const jinaUrl = `https://r.jina.ai/${rawUrl}`;
        const res = await fetch(jinaUrl, { headers: { 'Accept': 'text/plain' } });
        if (res.ok) {
          const md = await res.text();
          const titleMatch = md.match(/Title:\s*(.+)/);
          if (titleMatch && titleMatch[1]) webTitle = titleMatch[1].trim();
          cleanContent = md;
        }
      } catch {
        // 次のフォールバックへ
      }

      // フォールバック: allorigins プロキシ + DOMParser
      if (!cleanContent || cleanContent.length < 50) {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rawUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Webページの取得に失敗しました');
        const json = await res.json();
        const html = json.contents;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, noscript, nav, footer, header, svg, iframe').forEach(el => el.remove());
        webTitle = doc.title || rawUrl;
        const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
        cleanContent = bodyText.replace(/\n\s*\n+/g, '\n\n').trim();
      }

      if (!cleanContent || cleanContent.length < 30) {
        throw new Error('Webページから有効な本文を抽出できませんでした。');
      }

      const formattedDoc = `## 🌐 Web記事 インポートデータ\n- **タイトル:** ${webTitle}\n- **URL:** ${rawUrl}\n- **取得時刻:** ${new Date().toLocaleString('ja-JP')}\n\n---\n\n${cleanContent}`;
      await onAddTextContent(`🌐 ${webTitle.slice(0, 35)}`, formattedDoc);
      setUrlInput('');
      setShowUrlModal(false);
    } catch (err: any) {
      console.error('URL Import error:', err);
      setUrlFetchError(err.message || 'インポートに失敗しました');
    } finally {
      setIsFetchingUrl(false);
    }
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

      {/* 📂 / 🧠 フィルタータブ */}
      <div className="flex items-center space-x-1 mb-2.5 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => setFilterTab('files')}
          className={`flex-1 py-1 rounded-lg text-center transition-all ${
            filterTab === 'files'
              ? 'bg-slate-800 text-indigo-300 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          📄 資料 ({documents.filter(d => !d.title.includes('AI補助脳')).length})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab('brain')}
          className={`flex-1 py-1 rounded-lg text-center transition-all flex items-center justify-center space-x-1 ${
            filterTab === 'brain'
              ? 'bg-indigo-600/30 text-indigo-200 shadow-sm border border-indigo-500/40'
              : 'text-indigo-400/70 hover:text-indigo-300'
          }`}
        >
          <Sparkles className="w-3 h-3 text-amber-300 fill-amber-300" />
          <span>🧠 補助脳 ({documents.filter(d => d.title.includes('AI補助脳')).length})</span>
        </button>
        <button
          type="button"
          onClick={() => setFilterTab('all')}
          className={`flex-1 py-1 rounded-lg text-center transition-all ${
            filterTab === 'all'
              ? 'bg-slate-800 text-slate-100 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          すべて ({documents.length})
        </button>
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
          value={audioEngine || 'auto'}
          onChange={(e) => onChangeAudioEngine?.(e.target.value as any)}
          className="w-full bg-slate-900 border border-purple-500/40 rounded-lg px-2.5 py-1.5 text-xs text-purple-200 focus:outline-none focus:border-purple-400 font-medium"
        >
          <option value="auto">🚀 自動最適化 (Native優先 / WebGPU / Gemini)</option>
          <option value="native-kotoba">🔥 Kotoba-Whisper (C++ Native・最高峰日本語)</option>
          <option value="native-large-v3">👑 Whisper Large-v3 (FP16 Native・最高峰多言語)</option>
          <option value="kotoba-whisper">🌐 Kotoba-Whisper (WebGPU/PWA・完全ブラウザ完結)</option>
          <option value="gemini">☁️ Gemini 1.5 Flash (超高速クラウド・10秒解析)</option>
          <option value="whisper-local">⚡ Whisper Tiny (超軽量・英語/多言語)</option>
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
          accept=".pdf,.txt,.md,.mp3,.mp4,.wav,.wma,.m4a,.ogg,.webm,.mov,.png,.jpg,.jpeg,.webp,.bmp"
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
              PDF / 音声 / 動画 / 画像(OCR) / テキスト
            </span>
            <span className="text-[10px] text-slate-500">
              PDF, 音声, 動画, 📷画像OCR(PNG/JPG), TXT
            </span>
          </div>
        )}
      </div>

      {/* 🌐 Web記事 & YouTube 取り込みボタン */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setShowUrlModal(true)}
          className="w-full py-1.5 px-2.5 bg-slate-800/80 hover:bg-slate-750 border border-slate-700/70 hover:border-indigo-500/50 rounded-xl text-xs font-medium text-slate-300 hover:text-indigo-200 flex items-center justify-center space-x-1.5 transition-all shadow-sm"
        >
          <Globe className="w-3.5 h-3.5 text-cyan-400" />
          <span>Web記事 / YouTube URLを取り込む</span>
        </button>
      </div>

      {/* ドキュメント一覧 */}
      <div className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
        {documents.length === 0 ? (
          <div className="h-36 flex flex-col items-center justify-center text-center p-4 text-slate-500 text-xs">
            ドキュメントがありません。<br />
            ファイルをアップロードすると自動保存されます。
          </div>
        ) : (
          documents
            .filter((doc) => {
              const isBrain = doc.title.includes('AI補助脳');
              if (filterTab === 'brain') return isBrain;
              if (filterTab === 'files') return !isBrain;
              return true;
            })
            .map((doc) => (
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
                  doc.title.includes('AI補助脳')
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : doc.type === 'audio' || doc.type === 'video'
                      ? 'bg-purple-500/10 text-purple-400'
                      : 'bg-indigo-500/10 text-indigo-400'
                }`}>
                  {doc.title.includes('AI補助脳') ? (
                    <Sparkles className="w-3.5 h-3.5 fill-amber-300" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
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
                      doc.title.includes('AI補助脳')
                        ? 'bg-indigo-900/60 text-indigo-200 border border-indigo-600/40 font-bold'
                        : doc.type === 'audio'
                          ? 'bg-purple-900/60 text-purple-300 border border-purple-700/50'
                          : 'text-cyan-300'
                    }`}>
                      {doc.title.includes('AI補助脳') ? '🧠 補助脳' : doc.type === 'audio' ? '🎙️ 音声' : doc.type.toUpperCase()}
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
                {onToggleAuxiliaryBrain && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleAuxiliaryBrain(doc);
                    }}
                    className={`p-1.5 rounded-lg transition-all ${
                      doc.title.includes('AI補助脳')
                        ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30'
                        : 'hover:bg-indigo-500/20 text-slate-400 hover:text-amber-300'
                    }`}
                    title={
                      doc.title.includes('AI補助脳')
                        ? '🧠 補助脳から解除（通常の資料に戻す）'
                        : '🧠 補助脳に追加（コア知識として最優先昇格）'
                    }
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${doc.title.includes('AI補助脳') ? 'fill-amber-300' : ''}`} />
                  </button>
                )}

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

                {projects.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenTransfer(doc);
                    }}
                    className="p-1.5 hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-300 rounded-lg transition-all"
                    title="他のプロジェクトへ移動/コピー"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
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

      {/* プロジェクト間 移動 / コピー モーダル */}
      {transferDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200 flex items-center">
                <ArrowRightLeft className="w-4 h-4 mr-2 text-cyan-400" />
                プロジェクト間 移動 / コピー
              </h3>
              <p className="text-xs text-slate-400 mt-1 truncate" title={transferDoc.title}>
                対象: <span className="text-slate-200 font-medium">{transferDoc.title}</span>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  先頭のプロジェクトを選択:
                </label>
                <select
                  value={targetProjId}
                  onChange={(e) => setTargetProjId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-cyan-500"
                >
                  {projects
                    .filter((p) => p.id !== activeProject?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  操作モード:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTransferMode('copy')}
                    className={`flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      transferMode === 'copy'
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>コピー (複製)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTransferMode('move')}
                    className={`flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      transferMode === 'move'
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>移動 (移行)</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {transferMode === 'copy'
                    ? '※ 元のプロジェクトにもデータを残したまま複製します。'
                    : '※ 現在のプロジェクトからは削除され、先頭プロジェクトへ移ります。'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setTransferDoc(null)}
                disabled={isTransferring}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleExecuteTransfer}
                disabled={isTransferring || !targetProjId}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-cyan-900/40 transition-all disabled:opacity-50 flex items-center space-x-1"
              >
                {isTransferring && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                <span>{transferMode === 'copy' ? 'コピー実行' : '移動実行'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🌐 Web記事 & YouTube URL インポートモーダル */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Globe className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-100">Web記事 / YouTube 取り込み</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowUrlModal(false);
                  setUrlFetchError(null);
                }}
                className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {youtubeFallback ? (
              <div className="space-y-3.5">
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1.5">
                  <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>公式字幕が無効な動画を検出しました</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    動画「<strong className="text-white font-medium">{youtubeFallback.videoTitle}</strong>」はYouTube側で字幕が無効化・保護されています。
                  </p>
                  <p className="text-[11px] text-slate-400">
                    アプリ内蔵のWhisper音声認識で100%正確に文字起こしするため、音声ファイル（mp3/m4a等）を下記に投入してください。
                  </p>
                </div>

                {/* 便利なワンクリック外部音声ダウンロード支援 */}
                <div className="flex items-center justify-between p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs">
                  <div className="text-[11px] text-slate-400">
                    💡 まだ音声をお持ちでない場合:
                  </div>
                  <a
                    href={`https://cobalt.tools/#${encodeURIComponent(youtubeFallback.url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[11px] font-medium rounded-lg border border-slate-700 hover:border-cyan-500/50 transition-colors"
                  >
                    <span>音声保存ツールを開く ↗</span>
                  </a>
                </div>

                {/* ドロップゾーン＆ファイル選択 */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      onUpload(e.dataTransfer.files);
                      setShowUrlModal(false);
                      setYoutubeFallback(null);
                    }
                  }}
                  onClick={() => fallbackFileInputRef.current?.click()}
                  className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 bg-cyan-950/20 hover:bg-cyan-950/30 rounded-2xl p-6 text-center cursor-pointer transition-all space-y-2 group"
                >
                  <input
                    ref={fallbackFileInputRef}
                    type="file"
                    accept="audio/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        onUpload(e.target.files);
                        setShowUrlModal(false);
                        setYoutubeFallback(null);
                      }
                    }}
                  />
                  <div className="w-10 h-10 mx-auto rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                    <Mic className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-semibold text-slate-200">
                    ここに音声ファイルをドラッグ＆ドロップ
                  </div>
                  <div className="text-[10px] text-slate-400">
                    またはクリックしてファイル選択（mp3, m4a, wav 等）
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setYoutubeFallback(null);
                      setUrlInput('');
                    }}
                    className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-800"
                  >
                    ← URL入力に戻る
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUrlModal(false);
                      setYoutubeFallback(null);
                      setUrlInput('');
                    }}
                    className="text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-800"
                  >
                    閉じる
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleUrlImport} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    URLを入力:
                  </label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/article または https://youtu.be/..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    disabled={isFetchingUrl}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center space-x-1.5 text-slate-300 font-semibold">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>A/Bハイブリッド自動解析:</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-400 text-[10px]">
                    <li>公式字幕のある動画: 1秒で字幕・タイムスタンプを自動抽出し即時完了。</li>
                    <li>字幕保護・非公開動画: ワンクリックで音声認識パイプライン（Whisper）に直結。</li>
                  </ul>
                </div>

                {urlFetchError && (
                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-300">
                    ⚠️ {urlFetchError}
                  </div>
                )}

                <div className="flex items-center justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUrlModal(false)}
                    disabled={isFetchingUrl}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={isFetchingUrl || !urlInput.trim()}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold rounded-xl shadow-lg shadow-cyan-900/40 transition-all flex items-center space-x-1.5"
                  >
                    {isFetchingUrl ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{urlFetchStatus || '解析＆取り込み中...'}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>ドキュメントに追加</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
