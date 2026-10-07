import React, { useState } from 'react';
import {
  FileText,
  Presentation,
  GitBranch,
  Headphones,
  Sparkles,
  Loader2,
  BookOpen,
  HelpCircle,
  Network,
  GitFork,
  Download,
  Share2,
  Trash2,
  Send,
  Clock,
  PlusCircle
} from 'lucide-react';
import { marked } from 'marked';
import { StudioTab, StudioArtifact } from '../types/index.ts';
import { MermaidViewer } from './studio/MermaidViewer.tsx';
import { SlideViewer } from './studio/SlideViewer.tsx';
import { PodcastPlayer } from './studio/PodcastPlayer.tsx';
import { Graph3DViewer } from './studio/Graph3DViewer.tsx';

interface StudioPaneProps {
  artifacts: StudioArtifact[];
  onGenerate: (type: StudioTab, customPrompt?: string) => void;
  onDeleteArtifact: (id: string) => void;
  onAddToSource: (title: string, content: string) => void;
  isGeneratingStudio: boolean;
}

export const StudioPane: React.FC<StudioPaneProps> = ({
  artifacts,
  onGenerate,
  onDeleteArtifact,
  onAddToSource,
  isGeneratingStudio
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('briefing');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  const tabs: { id: StudioTab; label: string; icon: React.ReactNode }[] = [
    { id: 'briefing', label: '要約', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'minutes', label: '会議議事録・ToDo', icon: <Clock className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'study_report', label: '詳細レポート', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'faq', label: 'FAQ想定問答', icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'learning_guide', label: '学習ガイド', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'slide', label: 'Marpスライド', icon: <Presentation className="w-3.5 h-3.5" /> },
    { id: 'mindmap', label: 'マインドマップ', icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: 'flowchart', label: 'フローチャート', icon: <GitFork className="w-3.5 h-3.5" /> },
    { id: 'graph3d', label: '3Dナレッジグラフ', icon: <Network className="w-3.5 h-3.5" /> },
    { id: 'podcast', label: 'ポッドキャスト', icon: <Headphones className="w-3.5 h-3.5" /> }
  ];


  const tabArtifacts = artifacts
    .filter(a => a.type === activeTab)
    .sort((a, b) => b.createdAt - a.createdAt);

  const currentArtifact =
    tabArtifacts.find(a => a.id === selectedArtifactId) || tabArtifacts[0] || null;

  const handleGenerateClick = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate(activeTab, customPrompt.trim() || undefined);
  };

  const handleExport = (format: 'md' | 'html') => {
    if (!currentArtifact) return;

    let blob: Blob;
    let filename = `${currentArtifact.title}_${Date.now()}`;

    if (format === 'html') {
      const htmlBody = marked.parse(currentArtifact.content);
      const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${currentArtifact.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1e293b; }
    h1, h2, h3 { color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    pre { background: #f1f5f9; padding: 12px; border-radius: 8px; overflow-x: auto; }
    code { font-family: monospace; background: #f1f5f9; padding: 2px 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${currentArtifact.title}</h1>
  ${htmlBody}
</body>
</html>`;
      blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
      filename += '.html';
    } else {
      blob = new Blob([currentArtifact.content], { type: 'text/markdown;charset=utf-8;' });
      filename += '.md';
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/40 border-l border-slate-800/80 p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Studio Pro
          </h2>
        </div>
      </div>

      {/* 9種タブグリッド */}
      <div className="grid grid-cols-3 gap-1 bg-slate-800/60 p-1.5 rounded-xl border border-slate-700/60 mb-3 max-h-24 overflow-y-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedArtifactId(null);
            }}
            className={`flex items-center justify-center space-x-1 py-1.5 px-1 rounded-lg text-[11px] font-medium transition-all truncate ${
              activeTab === tab.id
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title={tab.label}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 💡 自由なカスタム指示入力フォーム */}
      <form onSubmit={handleGenerateClick} className="mb-3 space-y-1.5">
        <div className="relative">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={`💡 「${tabs.find(t => t.id === activeTab)?.label}」への自由な指示（例: 〇〇に絞って / 全3枚で）`}
            disabled={isGeneratingStudio}
            className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-3 pr-24 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            type="submit"
            disabled={isGeneratingStudio}
            className="absolute right-1 top-1 bottom-1 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1 shadow-sm"
          >
            {isGeneratingStudio ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Send className="w-3 h-3" />
                <span>生成</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* 成果物履歴セレクター */}
      {tabArtifacts.length > 1 && (
        <div className="flex items-center space-x-1 mb-2 overflow-x-auto pb-1 text-[10px]">
          <span className="text-slate-500 flex items-center shrink-0">
            <Clock className="w-3 h-3 mr-0.5" /> 履歴 ({tabArtifacts.length}):
          </span>
          {tabArtifacts.map((art, idx) => (
            <button
              key={art.id}
              onClick={() => setSelectedArtifactId(art.id)}
              className={`px-2 py-0.5 rounded-md shrink-0 border transition-all ${
                currentArtifact?.id === art.id
                  ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300 font-bold'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              ver {tabArtifacts.length - idx}
            </button>
          ))}
        </div>
      )}

      {/* 成果物表示＆管理エリア */}
      <div className="flex-1 overflow-y-auto rounded-xl bg-slate-950/60 border border-slate-800/80 p-4 flex flex-col">
        {currentArtifact ? (
          <div className="space-y-3 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="min-w-0 flex-1 mr-2">
                <h3 className="text-xs font-bold text-slate-300 truncate">{currentArtifact.title}</h3>
                {currentArtifact.customPrompt && (
                  <p className="text-[10px] text-indigo-400 truncate">
                    指示: {currentArtifact.customPrompt}
                  </p>
                )}
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                <button
                  onClick={() => onAddToSource(`[Studio] ${currentArtifact.title}`, currentArtifact.content)}
                  className="p-1.5 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                  title="この成果物を新しいソースとして追加・登録します"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>ソース追加</span>
                </button>
                <button
                  onClick={() => handleExport('md')}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                  title="Markdown保存"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.MD</span>
                </button>
                <button
                  onClick={() => handleExport('html')}
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                  title="HTML保存"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>.HTML</span>
                </button>
                <button
                  onClick={() => {
                    if (confirm('この成果物を削除しますか？')) {
                      onDeleteArtifact(currentArtifact.id);
                    }
                  }}
                  className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeTab === 'slide' ? (
                <SlideViewer content={currentArtifact.content} />
              ) : activeTab === 'mindmap' || activeTab === 'flowchart' ? (
                <MermaidViewer chart={currentArtifact.content} />
              ) : activeTab === 'graph3d' ? (
                <Graph3DViewer dataString={currentArtifact.content} />
              ) : activeTab === 'podcast' ? (
                <PodcastPlayer script={currentArtifact.content} />
              ) : (
                <div
                  className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: marked.parse(currentArtifact.content) as string }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs">
            上の入力欄に自由な指示を入力して「生成」をクリックするか、そのまま「生成」を押して
            {tabs.find(t => t.id === activeTab)?.label}を作成してください。
          </div>
        )}
      </div>
    </div>
  );
};
