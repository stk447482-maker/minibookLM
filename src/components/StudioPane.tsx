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
  Clock,
  PlusCircle,
  Zap,
  Info
} from 'lucide-react';
import { marked } from 'marked';
import { StudioTab, StudioArtifact } from '../types/index.ts';
import { MermaidViewer } from './studio/MermaidViewer.tsx';
import { SlideViewer } from './studio/SlideViewer.tsx';
import { PodcastPlayer } from './studio/PodcastPlayer.tsx';
import { Graph3DViewer } from './studio/Graph3DViewer.tsx';

interface StudioPaneProps {
  artifacts: StudioArtifact[];
  streamingArtifact?: { type: StudioTab; title: string; content: string } | null;
  enabledDocsCount: number;
  onGenerate: (type: StudioTab, customPrompt?: string) => void;
  onDeleteArtifact: (id: string) => void;
  onAddToSource: (title: string, content: string) => void;
  isGeneratingStudio: boolean;
}

export const StudioPane: React.FC<StudioPaneProps> = ({
  artifacts,
  streamingArtifact,
  enabledDocsCount,
  onGenerate,
  onDeleteArtifact,
  onAddToSource,
  isGeneratingStudio
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('briefing');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  const tabs: { id: StudioTab; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'briefing', label: '要約', desc: '主要な論点・決定事項をまとめたエグゼクティブサマリ', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'minutes', label: '会議議事録・ToDo', desc: '決定事項とタスク表を含む実践的議事録', icon: <Clock className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'study_report', label: '詳細レポート', desc: '数値分析・課題・解決策を網羅した調査書', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'faq', label: 'FAQ想定問答', desc: '具体的仕様・例外規定を突いた実践的Q&A', icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'learning_guide', label: '学習ガイド', desc: '概念用語集・ロードマップ・理解度クイズ', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'slide', label: 'Marpスライド', desc: 'プレゼン用スライド（ページ送り対応）', icon: <Presentation className="w-3.5 h-3.5" /> },
    { id: 'mindmap', label: 'マインドマップ', desc: '階層概念図（Mermaidダイアグラム）', icon: <GitBranch className="w-3.5 h-3.5" /> },
    { id: 'flowchart', label: 'フローチャート', desc: '業務・判断プロセスのフロー図', icon: <GitFork className="w-3.5 h-3.5" /> },
    { id: 'graph3d', label: '3Dナレッジグラフ', desc: '3次元インタラクティブネットワーク', icon: <Network className="w-3.5 h-3.5" /> },
    { id: 'podcast', label: 'ポッドキャスト', desc: '2名のAIによる音声自動再生対話', icon: <Headphones className="w-3.5 h-3.5" /> }
  ];

  const currentTabObj = tabs.find(t => t.id === activeTab) || tabs[0];

  const tabArtifacts = artifacts
    .filter(a => a.type === activeTab)
    .sort((a, b) => b.createdAt - a.createdAt);

  const currentArtifact =
    tabArtifacts.find(a => a.id === selectedArtifactId) || tabArtifacts[0] || null;

  const handleGenerateClick = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGeneratingStudio || enabledDocsCount === 0) return;
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

  const isStreamingThisTab = streamingArtifact && streamingArtifact.type === activeTab;

  return (
    <div className="flex flex-col h-full bg-slate-900/40 border-l border-slate-800/80 p-3 md:p-4 space-y-3 min-w-0 overflow-hidden">
      {/* ヘッダー＆対象ドキュメントステータス */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
            Studio Pro
          </h2>
        </div>

        <div>
          {enabledDocsCount > 0 ? (
            <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full flex items-center space-x-1 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              <span>対象資料: {enabledDocsCount} 件</span>
            </span>
          ) : (
            <span className="text-[10px] bg-rose-500/10 border border-rose-500/30 text-rose-300 px-2 py-0.5 rounded-full font-medium">
              ⚠️ 左で資料を選択
            </span>
          )}
        </div>
      </div>

      {/* 10種タブグリッド */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 bg-slate-800/60 p-1.5 rounded-xl border border-slate-700/60 shrink-0 max-h-28 overflow-y-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedArtifactId(null);
            }}
            className={`flex items-center justify-start space-x-1.5 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all truncate ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
            title={`${tab.label}: ${tab.desc}`}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ⚡ 生成アクションエリア */}
      <div className="space-y-2 shrink-0 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
        {/* メイン生成ボタン */}
        <button
          type="button"
          onClick={() => handleGenerateClick()}
          disabled={isGeneratingStudio || enabledDocsCount === 0}
          className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-slate-800 disabled:to-slate-800 text-white disabled:text-slate-500 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-md hover:shadow-indigo-500/20 active:scale-[0.99]"
        >
          {isGeneratingStudio ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
              <span>✨ {currentTabObj.label} を解析・生成中...</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
              <span>⚡ 「{currentTabObj.label}」を今すぐ生成</span>
            </>
          )}
        </button>

        {/* 💡 自由な追加指示入力欄 */}
        <form onSubmit={handleGenerateClick} className="relative">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={`💡 「${currentTabObj.label}」への追加指示（例: 〇〇に絞って / 3枚で）`}
            disabled={isGeneratingStudio}
            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </form>
      </div>

      {/* 成果物履歴セレクター */}
      {tabArtifacts.length > 1 && !isStreamingThisTab && (
        <div className="flex items-center space-x-1 shrink-0 overflow-x-auto pb-1 text-[10px]">
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
      <div className="flex-1 overflow-y-auto min-w-0 rounded-xl bg-slate-950/80 border border-slate-800/80 p-3 flex flex-col">
        {/* 1. リアルタイムストリーミング中 */}
        {isStreamingThisTab ? (
          <div className="space-y-3 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold text-indigo-300">
                  {streamingArtifact?.title || `${currentTabObj.label} 生成中...`}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 animate-pulse">リアルタイム出力中</span>
            </div>

            <div className="flex-1 overflow-y-auto prose prose-invert prose-sm max-w-none text-xs leading-relaxed">
              {activeTab === 'slide' || activeTab === 'mindmap' || activeTab === 'flowchart' || activeTab === 'graph3d' ? (
                <pre className="p-3 bg-slate-900 rounded-lg text-xs font-mono text-indigo-300 overflow-x-auto whitespace-pre-wrap">
                  {streamingArtifact?.content || '解析中...'}
                </pre>
              ) : (
                <div
                  dangerouslySetInnerHTML={{
                    __html: marked.parse(streamingArtifact?.content || '生成中...') as string
                  }}
                />
              )}
            </div>
          </div>
        ) : currentArtifact ? (
          /* 2. 完了した成果物の表示 */
          <div className="space-y-3 flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 shrink-0">
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
                  className="p-1 hover:bg-slate-800 text-indigo-400 hover:text-indigo-300 rounded transition-colors text-[10px] flex items-center space-x-0.5 border border-indigo-500/20"
                  title="この成果物を新しいソースとして追加・登録します"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">ソース追加</span>
                </button>
                <button
                  onClick={() => handleExport('md')}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                  title="Markdown保存"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.MD</span>
                </button>
                <button
                  onClick={() => handleExport('html')}
                  className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[10px] flex items-center space-x-0.5"
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
                  className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-w-0">
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
          /* 3. 未生成時のガイド */
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-3 text-slate-400">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Info className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-slate-200">
                {currentTabObj.label} の作成準備完了
              </h4>
              <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
                {currentTabObj.desc}
              </p>
            </div>
            <p className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">
              上の「⚡ 生成」ボタンをクリックして作成を開始してください
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
