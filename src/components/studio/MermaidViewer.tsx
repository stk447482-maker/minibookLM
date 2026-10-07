import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

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

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    const renderChart = async () => {
      try {
        const cleanChart = chart.replace(/```mermaid/g, '').replace(/```/g, '').trim();
        const id = `mermaid_${Date.now()}`;
        const { svg } = await mermaid.render(id, cleanChart);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<div class="text-xs text-rose-400 p-2">Mermaid構文エラー: ${String(err)}</div>`;
        }
      }
    };

    renderChart();
  }, [chart]);

  return (
    <div className="w-full overflow-auto bg-slate-950/80 p-4 rounded-xl border border-slate-800 flex items-center justify-center min-h-[250px]">
      <div ref={containerRef} className="w-full flex justify-center" />
    </div>
  );
};
