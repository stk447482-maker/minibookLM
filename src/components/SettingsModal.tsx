import React, { useState } from 'react';
import { X, Smartphone, Laptop, Sparkles, Check, Cloud, Key, Folder, RefreshCw, Zap, Download, Database } from 'lucide-react';
import { ModelConfig, ModelMode, ModelTuningProfile } from '../types/index.ts';


import { llmService } from '../services/llmService.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  onChangeConfig: (newConfig: ModelConfig) => void;
}

interface PCRecommendedModel {
  category: string;
  name: string;
  filename: string;
  spec: 'ram16_cpu' | 'ram32_vram8';
  size: string;
  desc: string;
  moe?: boolean;
}

interface PCRecommendedModel {
  category: string;
  name: string;
  filename: string;
  spec: 'ram32_vram8' | 'ram16_cpu';
  size: string;
  desc: string;
  moe?: boolean;
}

const PC_RECOMMENDED_MODELS: PCRecommendedModel[] = [
  // 💻 RAM 32GB + VRAM 8GB 向け (WebGPUブラウザ内・GPUオフロード推奨)
  {
    category: '🔥 RAM 32GB / VRAM 8GB (ブラウザ高速動作・標準8B推奨)',
    name: 'Llama 3.1 8B / Swallow 8B (Q4_K_M)',
    filename: 'Llama-3.1-Swallow-8B-Instruct-v0.5-Q4_K_M.gguf',
    spec: 'ram32_vram8',
    size: '約4.9 GB',
    desc: '【ブラウザ内推奨上限】8GB VRAMに余裕で収まり、ブラウザ単体（Python不要）でもWebGPUで高速推論が可能。日本語QAの精度も最高峰。'
  },
  {
    category: '🔥 RAM 32GB / VRAM 8GB (MoEモデル推奨)',
    name: 'Qwen 1.5 MoE A2.7B (Q4_K_M)',
    filename: 'qwen1.5-moe-a2.7b-chat-q4_k_m.gguf',
    spec: 'ram32_vram8',
    size: '約8.8 GB',
    desc: '【MoE推奨】総パラメータ14.3B中、推論時は2.7Bのみを活性化。ブラウザのVRAM負荷を最小限に抑えつつ高精度を実現。',
    moe: true
  },
  {
    category: '🔥 RAM 32GB / VRAM 8GB (高精度7B)',
    name: 'Qwen 2.5 7B Instruct (Q4_K_M)',
    filename: 'qwen2.5-7b-instruct-q4_k_m.gguf',
    spec: 'ram32_vram8',
    size: '約4.7 GB',
    desc: 'コード生成・長文コンテキスト・RAG要約に非常に強い。WebGPU環境で快適に動作する鉄板モデル。'
  },

  // ⚡ RAM 16GB のみ (CPU/軽量GPU向け)
  {
    category: '⚡ RAM 16GBのみ (軽量MoE / A2B・A3B)',
    name: 'DeepSeek-V2-Lite MoE (Q4_K_M)',
    filename: 'deepseek-v2-lite-chat-q4_k_m.gguf',
    spec: 'ram16_cpu',
    size: '約9.5 GB',
    desc: '【軽量MoE】総16B中、活性化2.4B(A2.4B)。ブラウザのメモリ上限内で安定動作し、高い論理処理を発揮。',
    moe: true
  },
  {
    category: '⚡ RAM 16GBのみ (超高速・小型)',
    name: 'Llama 3.2 3B Instruct (Q4_K_M)',
    filename: 'llama-3.2-3b-instruct-q4_k_m.gguf',
    spec: 'ram16_cpu',
    size: '約2.0 GB',
    desc: 'メモリ消費わずか2GB。ブラウザのタブを開いたままでもメモリ不足にならず、CPUのみで瞬時に応答する超軽量モデル。'
  },
  {
    category: '⚡ RAM 16GBのみ (日本語特化・超軽量)',
    name: 'Qwen 2.5 1.5B Instruct (Q4_K_M)',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    spec: 'ram16_cpu',
    size: '約1.1 GB',
    desc: '1.5Bの極小サイズながら日本語理解に優れ、メモリをほとんど消費せずにサクサク動きます。'
  }
];


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
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B Instruct (推奨・高精度日本語)',
    size: '約950MB',
    vram: 'RAM 2GB以上推奨 (PC / 高性能スマホ対応)',
    desc: '【推奨】日本語の論理的文脈結合・RAGファクト整理に最も優れたベストバランスモデル'
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    name: 'Gemma 2 2B Instruct (Google公式)',
    size: '約1.8GB',
    vram: 'RAM 4GB / VRAM 3GB以上推奨',
    desc: 'Google純正の推論特化モデル。論理的考察や英語混在資料に強み'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B Instruct (Meta公式)',
    size: '約880MB',
    vram: 'RAM 2GB以上推奨',
    desc: 'Meta社の軽量モデル。高速レスポンスと簡潔な回答が得意'
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 0.5B Instruct (超軽量・省電力)',
    size: '約350MB',
    vram: 'RAM 1GB以上推奨 (低スペック端末・スマホ完全対応)',
    desc: '最速レスポンス・ダウンロード容量最小の超軽量モデル'
  }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig
}) => {
  const [selectedSpecTab, setSelectedSpecTab] = useState<'ram32_vram8' | 'ram16_cpu'>('ram32_vram8');

  const [scannedModels, setScannedModels] = useState<LocalModelItem[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);


  // モバイルダウンロード状態管理
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  // PCモデルフォルダのスキャン実行 (Ollama/ローカルAPI接続時のみ)
  const handleScanModels = async (customFolder?: string) => {
    setIsScanning(true);
    setScanError(null);
    const targetFolder = customFolder !== undefined ? customFolder : (config.desktopModelPath || './models');
    const endpoint = config.desktopApiEndpoint || 'http://127.0.0.1:11434';

    try {
      const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/models/scan?folder=${encodeURIComponent(targetFolder)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const allModels: LocalModelItem[] = [
        ...(data.local_gguf_files || []),
        ...(data.ollama_models || [])
      ];
      setScannedModels(prev => {
        const localFiles = prev.filter(m => m.type === 'local-file');
        return [...localFiles, ...allModels.filter(m => !localFiles.some(l => l.name === m.name))];
      });
    } catch {
      // Pythonが起動していなくてもブラウザ完結(File API)で動くためエラー表示は出さない
      setScanError(null);
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

  if (!isOpen) return null;

  const handleModeSelect = (mode: ModelMode) => {
    onChangeConfig({ ...config, mode });
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

            {/* 📁 ローカルGGUFファイル直接選択（Python不要・ブラウザ完結） */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">📂 PC内のGGUFファイルを直接読み込み (Python不要)</span>
              </div>
              <p className="text-[11px] text-slate-400">
                お使いのPCにある <code>.gguf</code> ファイル（例: <code>Llama-3.1-Swallow-8B...gguf</code>）をブラウザで直接選択して推論エンジンに設定します。
              </p>
              
              <div className="flex items-center space-x-2">
                <label className="cursor-pointer flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-cyan-600/20">
                  <Folder className="w-4 h-4" />
                  <span>GGUFファイルを選択する</span>
                  <input
                    type="file"
                    accept=".gguf,.bin"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const sizeMb = Math.round(file.size / (1024 * 1024));
                        const newModel: LocalModelItem = {
                          name: file.name,
                          size_mb: sizeMb,
                          type: 'local-file',
                          profile: {
                            category: file.name.toLowerCase().includes('moe') ? 'MoE (Mixture of Experts)' : 'Dense GGUF (Browser Direct)',
                            context_window: 4096,
                            temperature: 0.3,
                            top_p: 0.85,
                            repeat_penalty: 1.1,
                            n_gpu_layers: 99,
                            rag_top_k: 4,
                            description: 'ブラウザWebGPU直接実行: Pythonサーバー不要・完全オフライン動作'
                          }
                        };
                        setScannedModels(prev => [newModel, ...prev.filter(m => m.name !== file.name)]);
                        applyModelWithAutoTune(file.name, newModel.profile);
                      }
                    }}
                  />
                </label>

                {config.desktopModelName && (
                  <div className="flex items-center space-x-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-xl font-mono">
                    <Check className="w-3.5 h-3.5" />
                    <span>選択中: {config.desktopModelName}</span>
                  </div>
                )}
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

            {/* 📋 PC推奨モデル一覧ガイド（スペック別タブ切り替え） */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-slate-200">💡 PCスペック別・推奨AIモデル / MoEガイド</span>
              </div>

              {/* スペック切り替えタブ */}
              <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-slate-950 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSelectedSpecTab('ram32_vram8')}
                  className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-all ${
                    selectedSpecTab === 'ram32_vram8'
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  🔥 RAM 32GB / VRAM 8GB
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSpecTab('ram16_cpu')}
                  className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition-all ${
                    selectedSpecTab === 'ram16_cpu'
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ⚡ RAM 16GBのみ (CPU)
                </button>
              </div>

              {/* 推奨モデルリスト表示 */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {PC_RECOMMENDED_MODELS.filter(m => m.spec === selectedSpecTab).map((m, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-cyan-300">
                        {m.moe ? '🧩 [MoE] ' : '🤖 '} {m.name}
                      </span>
                      <span className="text-[10px] font-mono bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
                        {m.size}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{m.desc}</p>
                    <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between pt-0.5">
                      <span>ファイル名例: {m.filename}</span>
                    </div>
                  </div>
                ))}
              </div>
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

        {/* 🎙️ 音声文字起こしエンジン設定 */}
        <div className="space-y-2.5 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-purple-400">
              <span>🎙️ 音声・動画の文字起こしエンジン</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              WAV / MP3 / M4A / 動画
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, audioTranscriptionEngine: 'kotoba-whisper' })}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                config.audioTranscriptionEngine === 'kotoba-whisper'
                  ? 'bg-purple-950/40 border-purple-500/80 text-purple-200 shadow-sm shadow-purple-500/20'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">🇯🇵 Kotoba-Whisper v2.2 (日本語特化)</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                【推奨】ReazonSpeech学習済みの最高峰日本語モデル。漢字・専門用語が極めて正確
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, audioTranscriptionEngine: 'gemini' })}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                config.audioTranscriptionEngine === 'gemini'
                  ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-200 shadow-sm shadow-indigo-500/20'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">☁️ Gemini 1.5 Flash (超高速クラウド)</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                120分の長尺音声も約10秒で解析。話者文脈を自動補正するGoogle最新マルチモーダル
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, audioTranscriptionEngine: 'auto' })}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                (!config.audioTranscriptionEngine || config.audioTranscriptionEngine === 'auto')
                  ? 'bg-purple-950/40 border-purple-500/80 text-purple-200 shadow-sm shadow-purple-500/20'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">🚀 自動最適化</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Gemini API設定時はGemini、未設定時はKotoba-Whisperで最善処理
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChangeConfig({ ...config, audioTranscriptionEngine: 'whisper-local' })}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                config.audioTranscriptionEngine === 'whisper-local'
                  ? 'bg-emerald-950/40 border-emerald-500/80 text-emerald-200 shadow-sm shadow-emerald-500/20'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">⚡ Whisper Tiny (超軽量)</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                英語や多言語音声向け・低スペック端末用極小モデル
              </div>
            </button>
          </div>

          {/* APIキー入力 (Gemini利用時) */}
          {(config.mode === 'cloud-gemini' || config.audioTranscriptionEngine === 'gemini' || !config.audioTranscriptionEngine || config.audioTranscriptionEngine === 'auto') && (
            <div className="pt-2 border-t border-slate-800/80">
              <label className="text-[10px] text-slate-400 flex items-center space-x-1 mb-1">
                <Key className="w-3 h-3 text-purple-400" />
                <span>Google AI Studio (Gemini) APIキー</span>
              </label>
              <input
                type="password"
                value={config.cloudApiKey || ''}
                onChange={(e) => onChangeConfig({ ...config, cloudApiKey: e.target.value })}
                placeholder="AIzaSy... (Gemini超高速文字起こしに必要)"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-purple-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 block mt-1">
                ※ 未設定の場合は自動的に完全ローカルWhisperで文字起こしが実行されます。
              </span>
            </div>
          )}
        </div>

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

