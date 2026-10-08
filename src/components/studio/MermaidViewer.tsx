import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Code, AlertTriangle } from 'lucide-react';
import { DiagramService } from '../../services/diagramService.ts';

interface MermaidViewerProps {
  chart: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'sans-serif'
});

export const MermaidViewer: React.FC<MermaidViewerProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  const cleanMermaidCode = (raw: string): string => {
    if (!raw) return '';

    // マインドマップ判定
    if (raw.includes('mindmap') || raw.includes('branches') || raw.includes('"root"')) {
      return DiagramService.toMermaidMindmap(raw);
    }

    // フローチャート判定
    if (raw.includes('flowchart') || raw.includes('graph') || raw.includes('steps') || raw.includes('"steps"')) {
      return DiagramService.toMermaidFlowchart(raw);
    }

    // 汎用Mermaidコードブロック抽出
    const blockMatch = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
    let code = blockMatch ? blockMatch[1] : raw;
    const keywordIndex = code.search(/\b(flowchart|graph|mindmap|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/);
    if (keywordIndex !== -1) {
      code = code.substring(keywordIndex);
    }
    return code.replace(/```/g, '').trim();
  };

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    let isMounted = true;
    const renderChart = async () => {
      setHasError(false);
      setErrorMessage('');

      const cleanChart = cleanMermaidCode(chart);
      const id = `mermaid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      try {
        const { svg } = await mermaid.render(id, cleanChart);
        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (isMounted) {
          setHasError(true);
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  const cleanCode = cleanMermaidCode(chart);

  return (
    <div className="w-full bg-slate-950/80 p-4 rounded-xl border border-slate-800 flex flex-col space-y-2">
      <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
        <span>📊 ダイアグラム・プレビュー</span>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="flex items-center space-x-1 hover:text-indigo-400 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-800 text-[11px]"
        >
          <Code className="w-3 h-3" />
          <span>{showRaw ? '図を表示' : 'ソースコード表示'}</span>
        </button>
      </div>

      {showRaw ? (
        <pre className="p-3 bg-slate-900 rounded-lg text-xs font-mono text-indigo-300 overflow-x-auto whitespace-pre-wrap">
          {cleanCode}
        </pre>
      ) : hasError ? (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-xs space-y-2">
          <div className="flex items-center space-x-1.5 font-semibold text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Mermaid図の描画に失敗しました</span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono overflow-x-auto">
            {errorMessage}
          </p>
          <pre className="p-2.5 bg-slate-900/90 rounded text-[11px] font-mono text-slate-300 overflow-x-auto">
            {cleanCode}
          </pre>
        </div>
      ) : (
        <div className="w-full overflow-auto flex items-center justify-center min-h-[260px] py-2">
          <div ref={containerRef} className="w-full flex justify-center" />
        </div>
      )}
    </div>
  );
};
