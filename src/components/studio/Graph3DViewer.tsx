import React, { useEffect, useRef } from 'react';
import ForceGraph3D from '3d-force-graph';
import { GraphData } from '../../types/index.ts';

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
      // JSON形式のトリプルデータをパース
      const cleanJson = dataString.replace(/```json/g, '').replace(/```/g, '').trim();
      graphData = JSON.parse(cleanJson);
    } catch {
      // パース失敗時のフォールバック（シンプルなデモグラフ）
      graphData = {
        nodes: [
          { id: '1', name: '主要テーマ', val: 15, color: '#6366f1' },
          { id: '2', name: '概念A', val: 10, color: '#8b5cf6' },
          { id: '3', name: '概念B', val: 10, color: '#ec4899' },
          { id: '4', name: '詳細要素1', val: 6, color: '#10b981' },
          { id: '5', name: '詳細要素2', val: 6, color: '#06b6d4' }
        ],
        links: [
          { source: '1', target: '2', label: '関連' },
          { source: '1', target: '3', label: '包含' },
          { source: '2', target: '4', label: '詳細' },
          { source: '3', target: '5', label: '具体例' }
        ]
      };
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
