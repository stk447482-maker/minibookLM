import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { marked } from 'marked';

interface SlideViewerProps {
  content: string;
}

export const SlideViewer: React.FC<SlideViewerProps> = ({ content }) => {
  const slides = content.split(/\n---\n/).map(s => s.trim()).filter(Boolean);
  const [currentIndex, setCurrentIndex] = useState(0);

  const prevSlide = () => setCurrentIndex(prev => Math.max(0, prev - 1));
  const nextSlide = () => setCurrentIndex(prev => Math.min(slides.length - 1, prev + 1));

  if (slides.length === 0) {
    return <div className="text-xs text-slate-500 p-4">スライドデータがありません</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* スライド本体 */}
      <div className="flex-1 bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-slate-700/80 rounded-2xl p-6 flex flex-col justify-center items-center shadow-lg relative overflow-hidden min-h-[280px]">
        <div className="absolute top-3 right-3 text-[10px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full border border-slate-700/60">
          {currentIndex + 1} / {slides.length}
        </div>

        <div
          className="prose prose-invert prose-base max-w-none text-center w-full"
          dangerouslySetInnerHTML={{ __html: marked.parse(slides[currentIndex]) as string }}
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
          Slide {currentIndex + 1} of {slides.length}
        </span>

        <button
          onClick={nextSlide}
          disabled={currentIndex === slides.length - 1}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
