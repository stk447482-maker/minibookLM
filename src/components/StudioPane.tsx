import React, { useState, lazy, Suspense } from 'react';
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
  Zap,
  Info,
  RotateCcw,
  Edit3,
  Check,
  X,
  LayoutGrid
} from 'lucide-react';
import { marked } from 'marked';
import { StudioTab, StudioArtifact, ModelConfig } from '../types/index.ts';

const MermaidViewer = lazy(() => import('./studio/MermaidViewer.tsx').then(m => ({ default: m.MermaidViewer })));
const SlideViewer = lazy(() => import('./studio/SlideViewer.tsx').then(m => ({ default: m.SlideViewer })));
const PodcastPlayer = lazy(() => import('./studio/PodcastPlayer.tsx').then(m => ({ default: m.PodcastPlayer })));
const Graph3DViewer = lazy(() => import('./studio/Graph3DViewer.tsx').then(m => ({ default: m.Graph3DViewer })));
const FaqViewer = lazy(() => import('./studio/FaqViewer.tsx').then(m => ({ default: m.FaqViewer })));
const QuizFlashcardViewer = lazy(() => import('./studio/QuizFlashcardViewer.tsx').then(m => ({ default: m.QuizFlashcardViewer })));

interface StudioPaneProps {
  config?: ModelConfig;
  artifacts: StudioArtifact[];
  streamingArtifact?: { type: StudioTab; title: string; content: string } | null;
  enabledDocsCount: number;
  onGenerate: (type: StudioTab, customPrompt?: string) => void;
  onCancel?: () => void;
  onDeleteArtifact: (id: string) => void;
  onAddToSource: (title: string, content: string) => void;
  onUpdateArtifact?: (id: string, updatedContent: string, updatedTitle?: string) => void;
  onSelectGraphNode?: (nodeName: string) => void;
  isGeneratingStudio: boolean;
}

export const StudioPane: React.FC<StudioPaneProps> = ({
  config,
  artifacts,
  streamingArtifact,
  enabledDocsCount,
  onGenerate,
  onCancel,
  onDeleteArtifact,
  onAddToSource,
  onUpdateArtifact,
  onSelectGraphNode,
  isGeneratingStudio
}) => {
  const [activeTab, setActiveTab] = useState<StudioTab>('briefing');
  const [customPrompt, setCustomPrompt] = useState('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');

  const tabs: { id: StudioTab; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'briefing', label: '要約', desc: '主要な論点・決定事項をまとめたエグゼクティブサマリ', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'minutes', label: '会議議事録・ToDo', desc: '決定事項とタスク表を含む実践的議事録', icon: <Clock className="w-3.5 h-3.5 text-amber-400" /> },
    { id: 'study_report', label: '詳細レポート', desc: '数値分析・課題・解決策を網羅した調査書', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'faq', label: 'FAQ想定問答', desc: '具体的仕様・例外規定を突いた実践的Q&A', icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'learning_guide', label: '学習ガイド', desc: '概念用語集・ロードマップ・理解度クイズ', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'quiz', label: '復習クイズ＆単語帳', desc: '4択理解度テスト＆暗記フラッシュカード', icon: <HelpCircle className="w-3.5 h-3.5 text-emerald-400" /> },
    { id: 'matrix', label: '差分・比較マトリクス', desc: '資料間の相違点・改定点・数値の差異を対照表で抽出', icon: <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" /> },
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

  const handleExport = (format: 'md' | 'html' | 'csv') => {
    if (!currentArtifact) return;

    let blob: Blob;
    let filename = `${currentArtifact.title}_${Date.now()}`;

    if (format === 'csv') {
      // 🎯 Markdown テーブルから CSV 形式へパース変換
      const lines = currentArtifact.content.split('\n');
      const csvRows: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          // 区切り線 (| :--- | :--- | 等) を除外
          if (trimmed.includes('---')) continue;
          const cells = trimmed
            .slice(1, -1)
            .split('|')
            .map(c => `"${c.trim().replace(/"/g, '""')}"`);
          csvRows.push(cells.join(','));
        }
      }

      const csvData = '\uFEFF' + (csvRows.length > 0 ? csvRows.join('\r\n') : currentArtifact.content);
      blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      filename += '.csv';
    } else if (format === 'html') {
      let fullHtml = '';

      if (currentArtifact.type === 'mindmap' || currentArtifact.type === 'flowchart') {
        // 🎯 自立動作可能な Mermaid ビューワー HTML
        fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${currentArtifact.title}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
    h1 { color: #818cf8; font-size: 20px; border-bottom: 1px solid #334155; padding-bottom: 12px; width: 100%; max-width: 1000px; }
    .mermaid { width: 100%; max-width: 1100px; background: #1e293b; padding: 24px; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); overflow-x: auto; text-align: center; }
  </style>
</head>
<body>
  <h1>📊 ${currentArtifact.title}</h1>
  <div class="mermaid">
${currentArtifact.content}
  </div>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'dark', securityLevel: 'loose' });
  </script>
</body>
</html>`;
      } else if (currentArtifact.type === 'graph3d') {
        // 🎯 自立動作可能な 3D ナレッジグラフ HTML (3d-force-graph CDN)
        fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${currentArtifact.title}</title>
  <script src="https://unpkg.com/3d-force-graph"></script>
  <style>
    body { margin: 0; background: #020617; color: #f8fafc; font-family: sans-serif; overflow: hidden; }
    #header { position: absolute; top: 16px; left: 16px; z-index: 10; background: rgba(15,23,42,0.85); padding: 12px 18px; border-radius: 12px; border: 1px solid #334155; backdrop-filter: blur(8px); }
    h1 { margin: 0; font-size: 16px; color: #818cf8; }
    p { margin: 4px 0 0 0; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div id="header">
    <h1>🌐 ${currentArtifact.title}</h1>
    <p>マウスドラッグで3D回転・ホイールでズーム・ノードクリックでフォーカス</p>
  </div>
  <div id="3d-graph"></div>
  <script>
    try {
      let rawData = ${JSON.stringify(currentArtifact.content)};
      let gData = typeof rawData === 'string' ? JSON.parse(rawData.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()) : rawData;
      
      const Graph = ForceGraph3D()(document.getElementById('3d-graph'))
        .graphData(gData)
        .nodeLabel(node => node.name || node.id)
        .nodeColor(node => node.color || '#6366f1')
        .nodeVal(node => node.val || 10)
        .linkLabel(link => link.label || '')
        .linkDirectionalParticles(2)
        .linkDirectionalParticleSpeed(0.006)
        .backgroundColor('#020617');
    } catch(e) {
      document.body.innerHTML = '<p style="color:red;padding:20px;">3Dグラフデータの読み込みに失敗しました: ' + e.message + '</p>';
    }
  </script>
</body>
</html>`;
      } else if (currentArtifact.type === 'slide') {
        // 🎯 自立動作可能な フルスクリーン プレゼンテーション HTML
        const rawSlides = currentArtifact.content.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
        const actualSlides = rawSlides.filter(s => !s.startsWith('marp: true') && !s.includes('theme: gaia'));
        const slidesToRender = actualSlides.length > 0 ? actualSlides : rawSlides;

        fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>${currentArtifact.title}</title>
  <style>
    body { margin: 0; background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    #slide-viewport { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px; }
    .slide-card { background: #0f172a; border: 1px solid #334155; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); max-width: 900px; width: 100%; aspect-ratio: 16/9; padding: 48px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; position: relative; }
    h1 { color: #818cf8; margin-top: 0; font-size: 2.2rem; }
    h2 { color: #94a3b8; font-size: 1.4rem; font-weight: normal; }
    p, li { font-size: 1.25rem; line-height: 1.8; color: #e2e8f0; }
    strong { color: #38bdf8; }
    .counter { position: absolute; bottom: 20px; right: 28px; font-size: 0.9rem; color: #64748b; font-family: monospace; }
    #nav { background: #0f172a; border-top: 1px solid #1e293b; padding: 12px 24px; display: flex; justify-content: space-between; align-items: center; }
    button { background: #4f46e5; color: white; border: none; padding: 8px 18px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
    button:hover { background: #4338ca; }
    button:disabled { opacity: 0.3; cursor: not-allowed; }
  </style>
</head>
<body>
  <div id="slide-viewport">
    <div class="slide-card" id="slide-container"></div>
  </div>
  <div id="nav">
    <button id="prevBtn" onclick="prev()">◀ 前へ (←)</button>
    <span id="pageInfo" style="font-size: 13px; color: #94a3b8;"></span>
    <button id="nextBtn" onclick="next()">次へ (→) ▶</button>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const slides = ${JSON.stringify(slidesToRender.map(s => s.replace(/<!--[\s\S]*?-->/g, '')))};
    let cur = 0;
    function render() {
      document.getElementById('slide-container').innerHTML = marked.parse(slides[cur]) + '<div class="counter">' + (cur + 1) + ' / ' + slides.length + '</div>';
      document.getElementById('pageInfo').innerText = 'Slide ' + (cur + 1) + ' of ' + slides.length;
      document.getElementById('prevBtn').disabled = cur === 0;
      document.getElementById('nextBtn').disabled = cur === slides.length - 1;
    }
    function prev() { if (cur > 0) { cur--; render(); } }
    function next() { if (cur < slides.length - 1) { cur++; render(); } }
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === ' ') next();
      if (e.key === 'ArrowLeft') prev();
    });
    render();
  </script>
</body>
</html>`;
      } else {
        // 通常MarkdownのHTML出力
        const htmlBody = marked.parse(currentArtifact.content);
        fullHtml = `<!DOCTYPE html>
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
      }

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
      <div className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-between">
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

        {/* 🎛️ 現在適用中のモデル構成＆最適化バッジ */}
        {config && (
          <div className="flex items-center flex-wrap gap-1 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/40 text-purple-300 font-mono truncate max-w-[200px]" title="推論エンジン">
              {config.mode === 'lmstudio' ? (
                `🎛️ LM Studio: ${config.desktopModelName ? config.desktopModelName.split('/').pop() : 'gemma-4-12b-qat'}`
              ) : config.mode === 'desktop-api' ? (
                `💻 ローカルAPI: ${config.desktopModelName ? config.desktopModelName.split('/').pop() : 'Gemma-12B'}`
              ) : config.mode === 'cloud-gemini' ? (
                '☁️ Gemini 1.5 Flash'
              ) : (
                `⚡ WebGPU: ${(config.embeddedModelId || '').split('/').pop()}`
              )}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/40 text-indigo-300 font-mono" title="文字起こし連携">
              {config.audioTranscriptionEngine === 'native-large-v3' ? (
                '🎙️ Large-v3 連携'
              ) : config.audioTranscriptionEngine === 'native-kotoba' ? (
                '🎙️ Kotoba 連携'
              ) : config.audioTranscriptionEngine === 'gemini' ? (
                '☁️ Gemini STT'
              ) : (
                '🎙️ STT 連携'
              )}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-sans">
              ✨ 12B/大容量最適化済
            </span>
          </div>
        )}
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
        {enabledDocsCount === 0 && (
          <div className="bg-gradient-to-r from-amber-950/90 via-slate-900 to-amber-950/90 border border-amber-500/80 rounded-xl px-3 py-2 text-xs flex items-center justify-between shadow-md shadow-amber-950/40">
            <span className="font-bold text-amber-50 flex items-center space-x-1.5">
              <span className="text-base">👈</span>
              <span>左の資料一覧でチェックを入れてください</span>
            </span>
            <span className="font-mono text-[11px] font-black bg-amber-400 text-slate-950 px-2.5 py-0.5 rounded-full shadow-sm">
              0件選択中
            </span>
          </div>
        )}

        {/* メイン生成ボタン & 中止ボタン */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={() => handleGenerateClick()}
            disabled={isGeneratingStudio || enabledDocsCount === 0}
            title={enabledDocsCount === 0 ? '左側の資料一覧から対象ドキュメントにチェックを入れてください' : undefined}
            className="flex-1 py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-slate-800 disabled:to-slate-800 text-white disabled:text-slate-500 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-md hover:shadow-indigo-500/20 active:scale-[0.99] disabled:cursor-not-allowed"
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
          {isGeneratingStudio && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 shrink-0"
              title="生成を途中で中止します"
            >
              <span>⛔ 中止</span>
            </button>
          )}
        </div>

        {/* 🎙️ ポッドキャスト専用: 会話スタイル・ペルソナ選択ピル */}
        {activeTab === 'podcast' && (
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-slate-400 font-bold shrink-0 text-[10px]">🎙️ スタイル:</span>
            {[
              { id: 'standard', label: '標準解説', desc: '丁寧な掛け合い・NotebookLMスタイル' },
              { id: 'lecture', label: '熱血講義', desc: '情熱的な指導役 × 好奇心旺盛な学習者' },
              { id: 'radio', label: '深夜ラジオ', desc: '落ち着いたトーン、本音トーク' },
              { id: 'comedy', label: '漫才風', desc: 'テンポ良いボケ＆ツッコミで理解' }
            ].map(p => {
              const isSelected = (!customPrompt && p.id === 'standard') || customPrompt.includes(`[スタイル: ${p.label}]`);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const cleanPrompt = customPrompt.replace(/\[スタイル: [^\]]+\]\s*/g, '').trim();
                    setCustomPrompt(`[スタイル: ${p.label}] ${cleanPrompt}`.trim());
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold shrink-0 transition-all ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                  title={p.desc}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}

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
                {isEditing ? (
                  <>
                    <button
                      onClick={() => {
                        if (onUpdateArtifact && currentArtifact) {
                          onUpdateArtifact(currentArtifact.id, editContent, editTitle.trim() || currentArtifact.title);
                        }
                        setIsEditing(false);
                      }}
                      className="p-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded transition-colors text-[10px] flex items-center space-x-0.5 border border-emerald-500/40"
                      title="変更を保存"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>保存</span>
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                      title="編集をキャンセル"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>取消</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setEditContent(currentArtifact.content);
                        setEditTitle(currentArtifact.title);
                        setIsEditing(true);
                      }}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-300 rounded transition-colors text-[10px] flex items-center space-x-0.5 border border-slate-700/60"
                      title="この成果物を直接編集します"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">編集</span>
                    </button>
                    <button
                      onClick={() => onGenerate(activeTab, currentArtifact.customPrompt)}
                      disabled={isGeneratingStudio}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-amber-300 rounded transition-colors text-[10px] flex items-center space-x-0.5 border border-slate-700/60"
                      title="この成果物を再生成します"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">再生成</span>
                    </button>
                    <button
                      onClick={() => onAddToSource(`[AI補助脳: ${currentArtifact.type.toUpperCase()}] ${currentArtifact.title}`, currentArtifact.content)}
                      className="p-1 px-1.5 hover:bg-indigo-600/30 text-indigo-300 hover:text-white rounded transition-colors text-[10px] flex items-center space-x-1 border border-indigo-500/40 bg-indigo-950/40 shadow-sm"
                      title="この生成物を知識ベース（ベクトルDB）に登録し、次回以降のAI回答の精度向上に活かします"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                      <span className="font-semibold">🧠 補助脳に登録</span>
                    </button>
                    <button
                      onClick={() => handleExport('md')}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                      title="Markdown保存"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.MD</span>
                    </button>
                    {(activeTab === 'matrix' || currentArtifact.content.includes('| :---')) && (
                      <button
                        onClick={() => handleExport('csv')}
                        className="p-1 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded transition-colors text-[10px] flex items-center space-x-0.5"
                        title="Excelやスプレッドシートで開けるCSV形式で保存"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.CSV</span>
                      </button>
                    )}
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
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-w-0">
              {isEditing ? (
                <div className="h-full flex flex-col space-y-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-bold focus:outline-none focus:border-indigo-500"
                    placeholder="タイトル"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                    placeholder="Markdown / ダイアグラム定義を直接編集..."
                  />
                </div>
              ) : (
                <Suspense fallback={
                  <div className="h-48 flex flex-col items-center justify-center space-y-2 text-slate-400">
                    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    <span className="text-xs">ビューワー読込中...</span>
                  </div>
                }>
                  {activeTab === 'slide' ? (
                    <SlideViewer content={currentArtifact.content} />
                  ) : activeTab === 'mindmap' || activeTab === 'flowchart' ? (
                    <MermaidViewer chart={currentArtifact.content} />
                  ) : activeTab === 'graph3d' ? (
                    <Graph3DViewer dataString={currentArtifact.content} onNodeClick={onSelectGraphNode} />
                  ) : activeTab === 'podcast' ? (
                    <PodcastPlayer script={currentArtifact.content} config={config} />
                  ) : activeTab === 'faq' ? (
                    <FaqViewer content={currentArtifact.content} />
                  ) : activeTab === 'quiz' ? (
                    <QuizFlashcardViewer content={currentArtifact.content} />
                  ) : (
                    <div
                      className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: marked.parse(currentArtifact.content) as string }}
                    />
                  )}
                </Suspense>
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
