import React from 'react';
import { X, Smartphone, Laptop, Sparkles, Check, Cloud, Key, Server } from 'lucide-react';
import { ModelConfig, ModelMode } from '../types/index.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  onChangeConfig: (newConfig: ModelConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig
}) => {
  if (!isOpen) return null;

  const handleModeSelect = (mode: ModelMode) => {
    onChangeConfig({ ...config, mode });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-slate-100">モデル＆推論エンジン設定</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 動作モード選択カード */}
        <div className="space-y-2.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            推論エンジン選択（完全実稼働・No Mock）
          </label>

          {/* ☁️ クラウド Gemini API */}
          <div
            onClick={() => handleModeSelect('cloud-gemini')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              config.mode === 'cloud-gemini'
                ? 'bg-indigo-600/10 border-indigo-500 shadow-md shadow-indigo-500/10'
                : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                  <Cloud className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200">☁️ Google Gemini API (最高速・最高精度)</h3>
                  <p className="text-[11px] text-slate-400">
                    Gemini 1.5 Flash / 2.0 Flash を直接ストリーミング（無料枠OK）
                  </p>
                </div>
              </div>
              {config.mode === 'cloud-gemini' && (
                <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          </div>

          {/* 💻 デスクトップ・Ollama API */}
          <div
            onClick={() => handleModeSelect('desktop-api')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              config.mode === 'desktop-api'
                ? 'bg-indigo-600/10 border-indigo-500 shadow-md shadow-indigo-500/10'
                : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Laptop className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200">💻 デスクトップ ローカルAPI (Ollama)</h3>
                  <p className="text-[11px] text-slate-400">
                    PCで起動中の Ollama (Llama 3.1 / Qwen 2.5) とローカル高速通信
                  </p>
                </div>
              </div>
              {config.mode === 'desktop-api' && (
                <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          </div>

          {/* 📱 携帯端末・WebLLM */}
          <div
            onClick={() => handleModeSelect('embedded-mobile')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              config.mode === 'embedded-mobile'
                ? 'bg-indigo-600/10 border-indigo-500 shadow-md shadow-indigo-500/10'
                : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-200">📱 ブラウザ内 WebGPU (WebLLM)</h3>
                  <p className="text-[11px] text-slate-400">
                    端末のGPUで完全オフライン推論 (Qwen2.5-0.5B / 1.5B)
                  </p>
                </div>
              </div>
              {config.mode === 'embedded-mobile' && (
                <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ☁️ Gemini API 詳細設定 */}
        {config.mode === 'cloud-gemini' && (
          <div className="space-y-2.5 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-indigo-400">
              <Key className="w-3.5 h-3.5" />
              <span>Google AI Studio APIキー設定</span>
            </div>
            <div>
              <input
                type="password"
                value={config.cloudApiKey || ''}
                onChange={(e) => onChangeConfig({ ...config, cloudApiKey: e.target.value })}
                placeholder="AIzaSy..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                ※ APIキーはお使いのブラウザ（localStorage）にのみ保存され、外部には送信されません。
              </span>
            </div>
          </div>
        )}

        {/* 💻 デスクトップ Ollama 詳細設定 */}
        {config.mode === 'desktop-api' && (
          <div className="space-y-2.5 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-cyan-400">
              <Server className="w-3.5 h-3.5" />
              <span>Ollama 接続設定</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">エンドポイント</label>
                <input
                  type="text"
                  value={config.desktopApiEndpoint || 'http://127.0.0.1:11434'}
                  onChange={(e) => onChangeConfig({ ...config, desktopApiEndpoint: e.target.value })}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">モデル名</label>
                <input
                  type="text"
                  value={config.desktopModelName || 'llama3.1'}
                  onChange={(e) => onChangeConfig({ ...config, desktopModelName: e.target.value })}
                  placeholder="llama3.1 / qwen2.5"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* 📱 モバイル WebLLM 詳細設定 */}
        {config.mode === 'embedded-mobile' && (
          <div className="space-y-2 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-400">
            <div className="flex justify-between">
              <span>推奨軽量モデル:</span>
              <span className="text-slate-200 font-mono">Qwen2.5-0.5B-Instruct (RAM ~350MB)</span>
            </div>
            <div className="flex justify-between">
              <span>Embeddingモデル:</span>
              <span className="text-slate-200 font-mono">multilingual-e5-small (Int8)</span>
            </div>
            <div className="flex justify-between">
              <span>形態素解析:</span>
              <span className="text-emerald-400 font-mono">Intl.Segmenter (日本語)</span>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
};
