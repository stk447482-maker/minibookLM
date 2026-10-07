import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2 } from 'lucide-react';
import { marked } from 'marked';

interface PodcastPlayerProps {
  script: string;
}

export const PodcastPlayer: React.FC<PodcastPlayerProps> = ({ script }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);

  // 会話行に分割
  const lines = script
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && (l.startsWith('**') || l.includes(':') || l.includes('：')));

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const playLine = (index: number) => {
    if (index >= lines.length) {
      setIsPlaying(false);
      setCurrentLineIndex(0);
      return;
    }

    const rawLine = lines[index].replace(/\*\*/g, '');
    const isAlex = rawLine.includes('アレックス') || rawLine.includes('Alex') || rawLine.includes('ホスト');
    const textToSpeak = rawLine.replace(/^[^:：]+[:：]/, '').trim();

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'ja-JP';
    // 話者によってピッチとレートを変える
    utterance.pitch = isAlex ? 1.1 : 0.9;
    utterance.rate = 1.05;

    utterance.onend = () => {
      setCurrentLineIndex(index + 1);
      if (isPlaying) {
        playLine(index + 1);
      }
    };

    utterance.onerror = () => {
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      window.speechSynthesis.pause();
      setIsPlaying(false);
    } else {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else {
        playLine(currentLineIndex);
      }
      setIsPlaying(true);
    }
  };

  const handleReset = () => {
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setCurrentLineIndex(0);
  };

  return (
    <div className="space-y-4">
      {/* プレーヤーコントロール */}
      <div className="bg-gradient-to-r from-indigo-900/50 to-violet-900/50 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <Volume2 className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-100">AI ポッドキャスト オーディオ</h4>
            <p className="text-[10px] text-slate-400">
              {isPlaying ? '再生中（Web Speech AI）' : '停止中'} • {currentLineIndex} / {lines.length} 行
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleReset}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
            title="最初から"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleTogglePlay}
            className="p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-md shadow-indigo-600/30"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
        </div>
      </div>

      {/* スクリプト本文 */}
      <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 text-xs leading-relaxed max-h-72 overflow-y-auto">
        <div
          className="prose prose-invert prose-sm"
          dangerouslySetInnerHTML={{ __html: marked.parse(script) as string }}
        />
      </div>
    </div>
  );
};
