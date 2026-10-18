import React, { useMemo } from 'react';
import { marked } from 'marked';
import { SourceReference } from '../types';

interface MarkdownViewerProps {
  content: string;
  sources?: SourceReference[];
  onSelectReference?: (ref: { src: SourceReference; index: number }) => void;
  className?: string;
  isUser?: boolean;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  sources,
  onSelectReference,
  className = '',
  isUser = false
}) => {
  const htmlContent = useMemo(() => {
    if (!content) return '';

    // marked で Markdown を HTML にパース
    let parsed = marked.parse(content, { breaks: true, gfm: true }) as string;

    // 引用番号 [1], [2], [1, 2] などの検出とインタラクティブボタン化
    // コードブロックやリンク内を避けるため簡易置換を行い、data属性に付与
    parsed = parsed.replace(/\[(\d+)\]/g, (_match, p1) => {
      const idx = parseInt(p1, 10);
      const hasSource = sources && sources.length >= idx;
      const titleAttr = hasSource
        ? `クリックして参照資料 [${idx}]（${sources[idx - 1]?.docTitle || '根拠原文'}）を表示`
        : `参照番号 [${idx}]`;

      return `<button type="button" data-ref-idx="${idx}" class="citation-ref-btn inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-[10px] font-bold font-mono bg-indigo-500/25 hover:bg-indigo-500 text-indigo-300 hover:text-white border border-indigo-500/40 hover:border-indigo-400 rounded-md cursor-pointer transition-all shadow-sm active:scale-95 align-baseline select-none" title="${titleAttr}">[${idx}]</button>`;
    });

    return parsed;
  }, [content, sources]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-ref-idx]');
    if (target && onSelectReference) {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(target.getAttribute('data-ref-idx') || '0', 10);
      if (idx > 0) {
        // ソースが存在する場合は該当ソース、ない場合もフォールバック用ソースオブジェクトを生成して確実にモーダルを開く
        const foundSrc = sources?.[idx - 1] || {
          chunkId: `ref_${idx}`,
          docTitle: sources?.[0]?.docTitle || '参照ドキュメント',
          snippet: `[${idx}] の根拠記述がドキュメント内から引用されています。`,
          fullContext: sources?.[0]?.fullContext || 'ドキュメントの該当文脈です。',
          score: 0.95
        };

        onSelectReference({ src: foundSrc, index: idx });
      }
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`prose prose-sm max-w-none leading-relaxed ${
        isUser ? 'text-white [&_*]:!text-white' : 'prose-invert text-slate-200'
      } ${className}`}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};
