import React, { useState, useEffect } from 'react';
import { X, Smartphone, Laptop, Sparkles, Check, Cloud, Key, Folder, RefreshCw, Zap, Download, Database } from 'lucide-react';
import { ModelConfig, ModelMode, ModelTuningProfile } from '../types/index.ts';

import { llmService } from '../services/llmService.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  onChangeConfig: (newConfig: ModelConfig) => void;
}

interface LocalModelItem {
  name: string;
  rel_path?: string;
  full_path?: string;
  size_mb: number;
  type?: string;
  profile: ModelTuningProfile;
}

const MOBILE_RECOMMENDED_MODELS = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (超軽量)',
    size: '約350MB',
    vram: 'RAM 1GB以上推奨 (スマホ・タブレット完全対応)',
    desc: '超高速レスポンス・日本語対応・端末負荷が最も少ない推奨モデル'
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B Instruct (高精度)',
    size: '約950MB',
    vram: 'RAM 3GB以上推奨 (最新iPhone / Androidフラッグシップ)',
    desc: '0.5Bより要約力とRAG精度が格段に向上したバランス型'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct (Meta公式)',
    size: '約880MB',
    vram: 'RAM 2.5GB以上推奨',
    desc: 'Meta社の最新軽量モデル。論理的思考と正確な抜粋が得意'
  }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig
}) => {
  const [folderPath, setFolderPath] = useState<string>(config.desktopModelPath || './models');
  const [scannedModels, setScannedModels] = useState<LocalModelItem[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // モバイルダウンロード状態管理
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && config.mode === 'desktop-api') {
      handleScanModels();
    }
  }, [isOpen, config.mode]);

  if (!isOpen) return null;

  const handleModeSelect = (mode: ModelMode) => {
    onChangeConfig({ ...config, mode });
  };

  // PCモデルフォルダのスキャン実行
  const handleScanModels = async (customFolder?: string) => {
    setIsScanning(true);
    setScanError(null);
    const targetFolder = customFolder !== undefined ? customFolder : folderPath;
    const endpoint = config.desktopApiEndpoint || 'http://127.0.0.1:11434';

    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/models/scan?folder=${encodeURIComponent(targetFolder)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: サーバー応答エラー`);
      const data = await res.json();
      
      const allModels: LocalModelItem[] = [
        ...(data.local_gguf_files || []),
        ...(data.ollama_models || [])
      ];
      setScannedModels(allModels);

      // もし現在選択されているモデルが空、かつ見つかったモデルがあれば自動設定
      if (allModels.length > 0 && !config.desktopModelName) {
        applyModelWithAutoTune(allModels[0].name, allModels[0].profile);
      }
    } catch (err: any) {
      setScanError(`モデルスキャン失敗: ${err.message || 'server.pyが起動していません'}`);
    } finally {
      setIsScanning(false);
    }
  };

  // モデル選択時、自動チューニングプロファイルを適用
  const applyModelWithAutoTune = (modelName: string, profile?: ModelTuningProfile) => {
    let targetProfile = profile;
    if (!targetProfile) {
      const found = scannedModels.find(m => m.name === modelName);
      targetProfile = found?.profile;
    }

    const autoTune = config.autoTuningEnabled !== false; // デフォルトtrue
    onChangeConfig({
      ...config,
      desktopModelName: modelName,
      desktopModelPath: folderPath,
      tuningProfile: targetProfile,
      temperature: autoTune && targetProfile ? targetProfile.temperature : config.temperature
    });
  };

  // モバイルWebLLMモデルのダウンロード＆初期化
  const handleDownloadAndInitWebLLM = async (modelId: string) => {
    setIsDownloading(true);
    setDownloadProgress('初期化準備中...');
    try {
      onChangeConfig({ ...config, embeddedModelId: modelId });
      await llmService.initWebLLM(modelId, (report) => {
        setDownloadProgress(report.text);
      });
      setDownloadProgress('✅ ダウンロード＆キャッシュ完了！');
      setTimeout(() => setDownloadProgress(null), 3000);
    } catch (e: any) {
      setDownloadProgress(`❌ エラー: ${e.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
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
            推論エンジン選択（完全実稼働）
          </label>

          {/* 💻 デスクトップ ローカル (GGUF / Ollama / llama.cpp) */}
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
                  <h3 className="text-xs font-bold text-slate-200">💻 デスクトップ ローカル (GGUF / llama-cpp / Ollama)</h3>
                  <p className="text-[11px] text-slate-400">
                    指定フォルダーのGGUFやMoE/A2B/A3Bモデルを自動認識・最適化
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

          {/* 📱 携帯端末・WebGPU (WebLLM) */}
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
                  <h3 className="text-xs font-bold text-slate-200">📱 携帯端末・ブラウザ内 WebGPU (WebLLM)</h3>
                  <p className="text-[11px] text-slate-400">
                    ワンタップで端末にダウンロード＆完全オフライン実行 (Qwen2.5 / Llama3.2)
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
                  <h3 className="text-xs font-bold text-slate-200">☁️ Google Gemini API (クラウド高速連携)</h3>
                  <p className="text-[11px] text-slate-400">
                    Gemini 1.5 Flash / 2.0 Flash を直接ストリーミング（無料枠利用可）
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
        </div>

        {/* 💻 デスクトップ・詳細設定（フォルダー指定＆プルダウン＆自動微調整） */}
        {config.mode === 'desktop-api' && (
          <div className="space-y-4 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-cyan-400">
                <Folder className="w-4 h-4" />
                <span>モデルフォルダー＆プルダウン選択</span>
              </div>
              <button
                onClick={() => handleScanModels()}
                disabled={isScanning}
                className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-[11px] font-medium transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                <span>再スキャン</span>
              </button>
            </div>

            {/* フォルダーパス指定 */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">モデル格納フォルダーパス (GGUF / Bin)</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="./models または C:\LLM_Models"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                />
                <button
                  onClick={() => handleScanModels(folderPath)}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold"
                >
                  検出
                </button>
              </div>
            </div>

            {/* モデル選択プルダウン */}
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">
                利用モデル選択 ({scannedModels.length}件 検出)
              </label>
              <select
                value={config.desktopModelName || ''}
                onChange={(e) => applyModelWithAutoTune(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
              >
                {scannedModels.length === 0 ? (
                  <option value="">(検出されたGGUFモデルがありません - パスを確認してください)</option>
                ) : (
                  scannedModels.map((m, idx) => (
                    <option key={idx} value={m.name}>
                      {m.type === 'ollama' ? '🦙 [Ollama] ' : '📦 [GGUF] '} {m.name} ({m.size_mb} MB)
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* ⚡ MoE / A2B / A3B 自動微調整プロファイル設定 */}
            <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-slate-200">AIモデル自動微調整 (Auto-Tuning)</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.autoTuningEnabled !== false}
                    onChange={(e) => onChangeConfig({ ...config, autoTuningEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
                </label>
              </div>

              {config.tuningProfile ? (
                <div className="text-[11px] text-slate-300 space-y-1 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                  <div className="flex justify-between font-semibold text-cyan-300">
                    <span>モデル種別:</span>
                    <span>{config.tuningProfile.category}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>コンテキスト長 / GPUレイヤー:</span>
                    <span className="font-mono text-slate-200">{config.tuningProfile.context_window} tokens / {config.tuningProfile.n_gpu_layers} layers</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Temperature / Top_P:</span>
                    <span className="font-mono text-slate-200">{config.tuningProfile.temperature} / {config.tuningProfile.top_p}</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 pt-1">
                    💡 {config.tuningProfile.description}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  モデルを選択すると、アーキテクチャ（Dense / MoE / 小型 / 大規模）に応じた最適設定が自動適用されます。
                </p>
              )}
            </div>

            {scanError && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 p-2 rounded-lg">
                ⚠️ {scanError}
              </p>
            )}
          </div>
        )}

        {/* 📱 携帯端末・WebLLM 詳細設定（ワンタップダウンロード＆自動設定） */}
        {config.mode === 'embedded-mobile' && (
          <div className="space-y-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-emerald-400">
                <Database className="w-4 h-4" />
                <span>推奨モデル・ワンタップダウンロード＆自動設定</span>
              </div>
            </div>

            <div className="space-y-2.5">
              {MOBILE_RECOMMENDED_MODELS.map((item) => {
                const isSelected = config.embeddedModelId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-emerald-500/10 border-emerald-500/60'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-slate-200">{item.name}</span>
                      <span className="text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded text-emerald-300">
                        {item.size}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-2">{item.desc}</p>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/50">
                      <span className="text-[10px] text-slate-500">{item.vram}</span>
                      <button
                        onClick={() => handleDownloadAndInitWebLLM(item.id)}
                        disabled={isDownloading}
                        className={`flex items-center space-x-1 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-200'
                        }`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{isSelected ? 'セットアップ済み' : 'ダウンロード＆適用'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ダウンロード進捗インジケーター */}
            {downloadProgress && (
              <div className="bg-slate-900 border border-emerald-500/40 p-3 rounded-xl text-xs text-emerald-300 space-y-1.5 animate-pulse">
                <div className="flex items-center space-x-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span className="font-semibold">ダウンロード・キャッシュ進捗:</span>
                </div>
                <p className="text-[11px] font-mono text-slate-200 pl-5">{downloadProgress}</p>
              </div>
            )}
          </div>
        )}

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

