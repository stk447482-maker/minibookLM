import React, { useEffect, useRef } from 'react';
import ForceGraph3D from '3d-force-graph';
import { GraphData } from '../../types/index.ts';
import { DiagramService } from '../../services/diagramService.ts';

interface Graph3DViewerProps {
  dataString: string;
}

export const Graph3DViewer: React.FC<Graph3DViewerProps> = ({ dataString }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let graphData: GraphData = { nodes: [], links: [] };
    try {
      graphData = DiagramService.parseKnowledgeGraph(dataString);
    } catch (err: unknown) {
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div class="h-full flex flex-col items-center justify-center p-6 text-center space-y-2 text-rose-300">
            <span class="text-xs font-bold">⚠️ 3DグラフJSONのパースに失敗しました</span>
            <p class="text-[11px] text-slate-400 font-mono max-w-xs break-all">${err instanceof Error ? err.message : String(err)}</p>
            <span class="text-[10px] text-slate-500">上の「⚡ 生成」ボタンを押して再生成してください</span>
          </div>`;
      }
      return;
    }

    // 既存グラフのクリア
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    const width = containerRef.current.clientWidth || 400;
    const height = containerRef.current.clientHeight || 350;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ForceGraphFactory = ForceGraph3D as any;
    const Graph = ForceGraphFactory()(containerRef.current)
      .width(width)
      .height(height)
      .backgroundColor('#020617')
      .graphData(graphData)
      .nodeLabel('name')
      .nodeAutoColorBy('val')
      .nodeRelSize(4)
      .linkWidth(1.5)
      .linkOpacity(0.6)
      .linkColor(() => '#64748b')
      .linkDirectionalParticles(2)
      .linkDirectionalParticleSpeed(0.006);

    graphInstanceRef.current = Graph;

    const handleResize = () => {
      if (containerRef.current && graphInstanceRef.current) {
        graphInstanceRef.current.width(containerRef.current.clientWidth);
        graphInstanceRef.current.height(containerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (graphInstanceRef.current) {
        graphInstanceRef.current._destructor?.();
      }
    };
  }, [dataString]);

  return (
    <div className="relative w-full h-[360px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-700/60 text-[10px] text-slate-400 pointer-events-none">
        ドラッグで回転 • スクロールでズーム
      </div>
    </div>
  );
};
