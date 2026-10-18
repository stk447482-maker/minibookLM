import React, { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { marked } from 'marked';

interface SlideViewerProps {
  content: string;
}

export const SlideViewer: React.FC<SlideViewerProps> = ({ content }) => {
  // Frontmatter (--- marp: true ... ---) をスキップして実際のスライドページのみを抽出
  const rawSections = content.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  const slides = rawSections.filter(s => !s.startsWith('marp: true') && !s.includes('theme: gaia'));
  const activeSlides = slides.length > 0 ? slides : rawSections;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevSlide = () => setCurrentIndex(prev => Math.max(0, prev - 1));
  const nextSlide = () => setCurrentIndex(prev => Math.min(activeSlides.length - 1, prev + 1));

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (activeSlides.length === 0) {
    return <div className="text-xs text-slate-500 p-4">スライドデータがありません</div>;
  }

  // スライド内のMarpディレクティブ (<!-- _header: ... -->) を表示用にサニタイズ
  const currentSlideHtml = marked.parse(activeSlides[currentIndex].replace(/<!--[\s\S]*?-->/g, '')) as string;

  return (
    <div ref={containerRef} className={`flex flex-col h-full space-y-3 ${isFullscreen ? 'p-8 bg-slate-950 justify-center' : ''}`}>
      {/* スライド本体 */}
      <div className={`flex-1 bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-slate-700/80 rounded-2xl p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden ${isFullscreen ? 'min-h-[500px] border-indigo-500/50 shadow-2xl' : 'min-h-[280px]'}`}>
        <div className="absolute top-3 right-3 flex items-center space-x-2">
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
            {currentIndex + 1} / {activeSlides.length}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition-colors"
            title={isFullscreen ? "全画面終了 (Esc)" : "全画面プレゼンモード"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div
          className={`prose prose-invert max-w-none text-center w-full ${isFullscreen ? 'prose-xl' : 'prose-base'}`}
          dangerouslySetInnerHTML={{ __html: currentSlideHtml }}
        />
      </div>

      {/* コントロールバー */}
      <div className="flex items-center justify-between px-2">
        <button
          onClick={prevSlide}
          disabled={currentIndex === 0}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <span className="text-xs text-slate-400 font-medium">
          Slide {currentIndex + 1} of {activeSlides.length}
        </span>

        <button
          onClick={nextSlide}
          disabled={currentIndex === activeSlides.length - 1}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
