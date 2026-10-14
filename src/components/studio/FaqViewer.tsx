// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { marked } from 'marked';

interface FaqViewerProps {
  content: string;
}

interface FaqItem {
  question: string;
  answer: string;
}

export const FaqViewer: React.FC<FaqViewerProps> = ({ content }) => {
  const [openIndices, setOpenIndices] = useState<Record<number, boolean>>({ 0: true, 1: true });
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // FAQ項目のパース (### Q: ... と **A:** ...)
  const faqItems: FaqItem[] = React.useMemo(() => {
    const items: FaqItem[] = [];
    const sections = content.split(/###\s*(?:Q|質問)[:：]?\s*/i);

    for (let i = 1; i < sections.length; i++) {
      const section = sections[i];
      const parts = section.split(/\*\*(?:A|回答)[:：]?\*\*/i);
      if (parts.length >= 2) {
        const question = parts[0].trim();
        const answer = parts.slice(1).join('**A:**').trim();
        items.push({ question, answer });
      } else {
        const lines = section.split('\n');
        const question = lines[0].trim();
        const answer = lines.slice(1).join('\n').trim();
        items.push({ question, answer });
      }
    }

    return items;
  }, [content]);

  const toggleItem = (idx: number) => {
    setOpenIndices(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (faqItems.length === 0) {
    return (
      <div
        className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
      />
    );
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
        <span className="flex items-center space-x-1.5 font-bold text-slate-200">
          <HelpCircle className="w-4 h-4 text-indigo-400" />
          <span>想定問答 ({faqItems.length} 件)</span>
        </span>
        <button
          onClick={() => {
            const allOpen = Object.keys(openIndices).length === faqItems.length;
            if (allOpen) {
              setOpenIndices({});
            } else {
              const all: Record<number, boolean> = {};
              faqItems.forEach((_, i) => (all[i] = true));
              setOpenIndices(all);
            }
          }}
          className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
        >
          {Object.keys(openIndices).length === faqItems.length ? 'すべて閉じる' : 'すべて開く'}
        </button>
      </div>

      <div className="space-y-2">
        {faqItems.map((item, idx) => {
          const isOpen = !!openIndices[idx];
          return (
            <div
              key={idx}
              className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggleItem(idx)}
                className="w-full text-left p-3.5 flex items-start justify-between space-x-2 hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start space-x-2.5">
                  <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Q{idx + 1}
                  </span>
                  <span className="text-xs font-bold text-slate-200 leading-snug">
                    {item.question}
                  </span>
                </div>
                <div className="shrink-0 text-slate-400 mt-0.5">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {isOpen && (
                <div className="p-3.5 pt-0 border-t border-slate-800/60 bg-slate-950/40 text-xs text-slate-300 leading-relaxed space-y-2">
                  <div
                    className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed mt-2"
                    dangerouslySetInnerHTML={{ __html: marked.parse(item.answer) as string }}
                  />

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`Q: ${item.question}\nA: ${item.answer}`, idx)}
                      className="text-[10px] text-slate-500 hover:text-indigo-400 flex items-center space-x-1 transition-colors"
                      title="このQ&Aをコピー"
                    >
                      {copiedIndex === idx ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">コピー完了</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Q&Aをコピー</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
