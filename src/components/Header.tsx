import React from 'react';
import { Laptop, Settings, Sparkles, Sun, Moon, Zap } from 'lucide-react';
import { ModelConfig } from '../types/index.ts';

interface HeaderProps {
  config: ModelConfig;
  onOpenSettings: () => void;
  activeMobileTab: 'docs' | 'chat' | 'studio';
  setActiveMobileTab: (tab: 'docs' | 'chat' | 'studio') => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  onOpenSettings,
  activeMobileTab,
  setActiveMobileTab,
  isDarkMode,
  onToggleTheme
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 flex items-center justify-between select-none">
      <div className="flex items-center space-x-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-100 flex items-center gap-2">
            MiniBookLM <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">PWA Ultra</span>
          </h1>
          <p className="text-xs text-slate-400 hidden sm:block">
            In-Browser Hybrid RAG & AI Studio
          </p>
        </div>
      </div>

      {/* モバイル用タブスイッチャー */}
      <div className="flex md:hidden bg-slate-800/80 rounded-lg p-1 border border-slate-700/50">
        <button
          onClick={() => setActiveMobileTab('docs')}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
            activeMobileTab === 'docs' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          ソース
        </button>
        <button
          onClick={() => setActiveMobileTab('chat')}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
            activeMobileTab === 'chat' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          チャット
        </button>
        <button
          onClick={() => setActiveMobileTab('studio')}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
            activeMobileTab === 'studio' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Studio
        </button>
      </div>

      <div className="flex items-center space-x-2">
        {/* ☀️ / 🌙 テーマ切り替えボタン */}
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/70 text-slate-300 hover:text-amber-400 transition-colors shadow-sm"
          title={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors shadow-sm"
        >
          {config.mode === 'cloud-gemini' || config.cloudApiKey ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>☁️ Gemini API</span>
            </>
          ) : config.mode === 'desktop-api' ? (
            <>
              <Laptop className="w-3.5 h-3.5 text-cyan-400" />
              <span>💻 ローカルAPI</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
              <span>⚡ WebGPU (0.5B+RAG)</span>
            </>
          )}
          <Settings className="w-3.5 h-3.5 text-slate-400 ml-1" />
        </button>
      </div>
    </header>
  );
};

