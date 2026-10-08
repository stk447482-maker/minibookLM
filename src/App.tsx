import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { DocumentsPane } from './components/DocumentsPane.tsx';
import { ChatPane } from './components/ChatPane.tsx';
import { StudioPane } from './components/StudioPane.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DocumentSource, ChatMessage, StudioArtifact, StudioTab, ModelConfig, Project } from './types/index.ts';
import { ragManager } from './services/ragManager.ts';
import { llmService } from './services/llmService.ts';
import { dbService } from './services/db.ts';
import { securityGuard } from './services/securityGuard.ts';

const EXPECTED_HASH = '3c796256ccc298e53eb6c451fcff012416c8aabb41da6583c6192eecd1cae1fb';

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('minibooklm_auth_token') === EXPECTED_HASH;
  });

  useEffect(() => {
    // セキュリティガード起動 (F12・右クリック禁止 & 開発者ツール検知即時ロック)
    securityGuard.init(() => {
      setIsAuthenticated(false);
    });
  }, []);

  const [config, setConfig] = useState<ModelConfig>(() => {
    const saved = localStorage.getItem('minibooklm_model_config');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      mode: 'embedded-mobile', // デフォルトで完全ブラウザ完結WebGPUモード
      embeddedModelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      desktopApiEndpoint: 'http://127.0.0.1:11434',
      desktopModelName: 'llama3.1',
      temperature: 0.3
    };
  });

  const handleUpdateConfig = (newConfig: ModelConfig) => {
    setConfig(newConfig);
    localStorage.setItem('minibooklm_model_config', JSON.stringify(newConfig));
  };

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'docs' | 'chat' | 'studio'>('chat');

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const [documents, setDocuments] = useState<DocumentSource[]>([]);
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [docProgress, setDocProgress] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const [artifacts, setArtifacts] = useState<StudioArtifact[]>([]);
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);

  // 1. 初回マウント時: IndexedDBからプロジェクト復元
  useEffect(() => {
    const initApp = async () => {
      try {
        const savedProjects = await dbService.getAllProjects();
        if (savedProjects.length === 0) {
          const defaultProj: Project = {
            id: `proj_${Date.now()}`,
            name: 'デフォルト プロジェクト',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await dbService.saveProject(defaultProj);
          setProjects([defaultProj]);
          setActiveProject(defaultProj);
        } else {
          setProjects(savedProjects);
          setActiveProject(savedProjects[0]);
        }
      } catch (err) {
        console.error('IndexedDB初期化エラー:', err);
      }
    };
    initApp();
  }, []);

  // 2. アクティブプロジェクト変更時: ドキュメント・チャンク・メッセージを復元
  useEffect(() => {
    if (!activeProject) return;

    const loadProjectData = async () => {
      try {
        const [docs, chunks, msgs, arts] = await Promise.all([
          dbService.getDocumentsByProject(activeProject.id),
          dbService.getChunksByProject(activeProject.id),
          dbService.getMessagesByProject(activeProject.id),
          dbService.getArtifactsByProject(activeProject.id)
        ]);

        setDocuments(docs);
        setMessages(msgs);
        setArtifacts(arts);

        await ragManager.loadProjectChunks(chunks);
      } catch (err) {
        console.error('プロジェクトデータ読み込みエラー:', err);
      }
    };

    loadProjectData();
  }, [activeProject]);

  // プロジェクト作成
  const handleCreateProject = async (name: string) => {
    const newProj: Project = {
      id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await dbService.saveProject(newProj);
    setProjects(prev => [...prev, newProj]);
    setActiveProject(newProj);
  };

  // プロジェクト削除
  const handleDeleteProject = async (projectId: string) => {
    await dbService.deleteProject(projectId);
    const remaining = projects.filter(p => p.id !== projectId);
    setProjects(remaining);
    setActiveProject(remaining[0] || null);
  };

  // 📤 プロジェクト丸ごとエクスポート (.minibook JSON)
  const handleExportProject = async (projectId: string) => {
    try {
      const jsonStr = await dbService.exportProjectPackage(projectId);
      const proj = projects.find(p => p.id === projectId);
      const filename = `${proj?.name || 'project'}_${Date.now()}.minibook`;

      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`エクスポートエラー: ${err.message}`);
    }
  };

  // 📥 プロジェクト丸ごとインポート (.minibook JSON)
  const handleImportProject = async (file: File) => {
    try {
      const text = await file.text();
      const imported = await dbService.importProjectPackage(text);
      setProjects(prev => [...prev, imported]);
      setActiveProject(imported);
      alert(`プロジェクト「${imported.name}」を正常にインポートしました！`);
    } catch (err: any) {
      alert(`インポート失敗: ${err.message}`);
    }
  };

  // ファイルアップロード処理＆IndexedDB永続化
  const handleUpload = async (files: FileList) => {
    if (!activeProject) return;

    setIsProcessingDoc(true);
    setDocProgress(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { doc, chunks } = await ragManager.processDocument(file, activeProject.id, (percent) => {
          setDocProgress(percent);
        });

        await dbService.saveDocument(doc);
        await dbService.saveChunks(chunks);

        setDocuments(prev => [...prev, doc]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert(`ドキュメント処理に失敗しました: ${msg}`);
      }
    }

    setIsProcessingDoc(false);
    setDocProgress(0);
  };

  // 生成物やチャット回答を新しいソースとして追加
  const handleAddContentToSource = async (title: string, content: string) => {
    if (!activeProject) return;

    setIsProcessingDoc(true);
    try {
      const { doc, chunks } = await ragManager.processTextContent(title, content, activeProject.id, 'markdown');
      await dbService.saveDocument(doc);
      await dbService.saveChunks(chunks);

      setDocuments(prev => [...prev, doc]);
      alert(`「${title}」をソース一覧に追加しました！`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`ソース追加エラー: ${msg}`);
    } finally {
      setIsProcessingDoc(false);
    }
  };

  // ドキュメント有効/無効トグル
  const handleToggleDoc = async (id: string) => {
    const updated = documents.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d);
    setDocuments(updated);
    const target = updated.find(d => d.id === id);
    if (target) {
      await dbService.saveDocument(target);
    }
  };

  // 全ドキュメント一括選択/解除
  const handleToggleAllDocs = async (selectAll: boolean) => {
    const updated = documents.map(d => ({ ...d, enabled: selectAll }));
    setDocuments(updated);
    for (const d of updated) {
      await dbService.saveDocument(d);
    }
  };

  // ドキュメント削除
  const handleRemoveDoc = async (id: string) => {
    await dbService.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
  };

  // チャットメッセージ個別削除
  const handleDeleteMessage = async (msgId: string) => {
    await dbService.deleteMessage(msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  // チャット履歴全クリア
  const handleClearMessages = async () => {
    if (!activeProject) return;
    await dbService.clearMessagesByProject(activeProject.id);
    setMessages([]);
  };

  // 成果物削除
  const handleDeleteArtifact = async (artifactId: string) => {
    await dbService.deleteArtifact(artifactId);
    setArtifacts(prev => prev.filter(a => a.id !== artifactId));
  };

  // チャット質問送信＆RAGストリーミング
  const handleSendMessage = async (query: string, isDirectRAG: boolean = false) => {
    if (!activeProject) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      projectId: activeProject.id,
      role: 'user',
      content: query,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    await dbService.saveMessage(userMsg);

    setIsGenerating(true);
    setStatusMessage('選択されたソースからハイブリッド検索中...');

    try {
      const enabledDocIds = documents.filter(d => d.enabled).map(d => d.id);
      let searchResults: any[] = [];
      let graphSummary = '';
      let fullDocsContext = '';
      let totalContextChars = 0;
      let activeDocTitles: string[] = [];

      // モデル種別に応じた安全なトークン枠（WebGPUブラウザ: 2,000文字, Gemini: 60,000文字）
      let maxContextChars = 2000;
      if (config.mode === 'cloud-gemini' || config.cloudApiKey) {
        maxContextChars = 60000;
      }

      if (enabledDocIds.length > 0) {
        // 1. 選択された全ドキュメントの包括的コンテキストをモデルの許容文字数内で動的抽出
        const comp = await ragManager.getComprehensiveContext(activeProject.id, enabledDocIds, maxContextChars, query);
        fullDocsContext = comp.contextText;
        totalContextChars = comp.totalChars;
        activeDocTitles = comp.docTitles;
        searchResults = comp.sources;

        // 2. クエリ特化のハイブリッド検索（特定箇所フォーカス用）
        const focusedHits = await ragManager.search(query, enabledDocIds, 4);
        if (focusedHits.length > 0) {
          graphSummary = ragManager.extractGraphRAGTriples(focusedHits);
        }
      }

      // 🎯 厳密RAG直接抽出モードの場合 (質問ピンポイント構造化ファクトシート生成)
      if (isDirectRAG) {
        if (enabledDocIds.length === 0) {
          throw new Error('厳密RAG直接抽出を行うには、左側のドキュメント一覧で対象の資料にチェックを入れてください。');
        }
        if (searchResults.length === 0) {
          throw new Error('選択されたドキュメント内に関連する該当箇所が見つかりませんでした。');
        }

        // 1. 質問に直結する近傍共起ファクト（最優先ダイレクト回答）
        const allTargetedFacts: { target: string; value: string; sentence: string; docTitle: string }[] = [];
        const allMetrics: { doc: string; value: string }[] = [];
        const allFacts: { doc: string; fact: string }[] = [];

        searchResults.forEach(r => {
          if (r.targetedFacts) {
            r.targetedFacts.forEach((tf: { target: string; value: string; sentence: string; docTitle: string }) => {
              if (!allTargetedFacts.some((item: { target: string; value: string; sentence: string; docTitle: string }) => item.sentence === tf.sentence)) {
                allTargetedFacts.push(tf);
              }
            });
          }
          if (r.metrics) {
            r.metrics.forEach((m: string) => {
              if (!allMetrics.some((item: { doc: string; value: string }) => item.value === m)) {
                allMetrics.push({ doc: r.docTitle, value: m });
              }
            });
          }
          if (r.keyFacts) {
            r.keyFacts.forEach((f: string) => {
              if (!allFacts.some((item: { doc: string; fact: string }) => item.fact === f)) {
                allFacts.push({ doc: r.docTitle, fact: f });
              }
            });
          }
        });

        let directContent = `### 🎯 厳密RAG 構造化ファクトシート (選択資料: ${activeDocTitles.join(', ')})\n\n`;

        // 質問に直結するダイレクト回答ファクト
        if (allTargetedFacts.length > 0) {
          directContent += `#### 🏆 【質問に対するピンポイント特定ファクト】\n`;
          directContent += `| 質問対象 | 特定された数値・要件 | 根拠センテンス (原文抜粋) | 出典資料 |\n`;
          directContent += `| :--- | :--- | :--- | :--- |\n`;
          allTargetedFacts.slice(0, 6).forEach((tf: { target: string; value: string; sentence: string; docTitle: string }) => {
            directContent += `| **${tf.target}** | \`${tf.value}\` | ${tf.sentence} | ${tf.docTitle} |\n`;
          });
          directContent += `\n`;
        }

        if (allMetrics.length > 0) {
          directContent += `#### 📊 【関連する重要数値・仕様・規定値一覧】\n`;
          directContent += `| 出典ドキュメント | 抽出された数値・仕様・規定値 |\n`;
          directContent += `| :--- | :--- |\n`;
          allMetrics.slice(0, 10).forEach(m => {
            directContent += `| **${m.doc}** | \`${m.value}\` |\n`;
          });
          directContent += `\n`;
        }

        if (allFacts.length > 0) {
          directContent += `#### 📌 【該当する重要規定・決定事項・根拠センテンス】\n`;
          allFacts.slice(0, 6).forEach(f => {
            directContent += `- 💡 **[${f.doc}]**: ${f.fact}\n`;
          });
          directContent += `\n`;
        }

        directContent += `#### 📄 【抽出コンテキスト詳細】\n`;
        searchResults.forEach((r, idx) => {
          directContent += `##### [${idx + 1}] ${r.docTitle} (適合度: ${(r.score * 100).toFixed(0)}%)\n`;
          directContent += `> ${r.snippet}\n\n`;
          directContent += `<details><summary>ドキュメント前後文脈を展開</summary>\n\n${r.fullContext}\n\n</details>\n\n---\n\n`;
        });

        if (graphSummary) {
          directContent += `\n${graphSummary}\n`;
        }

        const directMsg: ChatMessage = {
          id: `asst_${Date.now()}`,
          projectId: activeProject.id,
          role: 'assistant',
          content: directContent,
          timestamp: Date.now(),
          sources: searchResults,
          isStreaming: false
        };

        setMessages(prev => [...prev, directMsg]);
        await dbService.saveMessage(directMsg);
        return;
      }

      // 🤖 通常AI回答モード (深層ファクトグラウンディング & 的確な論理回答)
      const allTargetedFacts: { target: string; value: string; sentence: string; docTitle: string }[] = [];
      searchResults.forEach(r => {
        if (r.targetedFacts) {
          r.targetedFacts.forEach((tf: { target: string; value: string; sentence: string; docTitle: string }) => {
            if (!allTargetedFacts.some((item: { target: string; value: string; sentence: string; docTitle: string }) => item.sentence === tf.sentence)) {
              allTargetedFacts.push(tf);
            }
          });
        }
      });

      let directFactsInstruction = '';
      if (allTargetedFacts.length > 0) {
        directFactsInstruction = `\n\n【🎯 質問に直結する確定データ（最優先で回答に使用すること）】\n` +
          allTargetedFacts.slice(0, 4).map((tf: { target: string; value: string; sentence: string; docTitle: string }) => `- **[${tf.target}]**: \`${tf.value}\`\n  (根拠原文: 「${tf.sentence}」 出典: ${tf.docTitle})`).join('\n') +
          `\n\n【必須命令】上記の確定データを第一声として明確に提示し、浅い一般論を一切述べず、このドキュメントの記述のみを根拠として的確に論理的説明を行ってください。\n`;
      }

      let systemPrompt = '';
      if (fullDocsContext) {
        systemPrompt = `あなたは最高峰の分析力と洞察力を持つ専任リサーチアシスタントです。
ユーザーの質問に対して、以下の【参照ドキュメント】に記載された具体的な数値（〇〇m、〇〇円、〇〇%など）、固有名詞、条項、条件を漏れなく引用し、的確かつ深い論理構成で回答してください。浅い要約や一般論だけで終わらせることは厳禁です。
${directFactsInstruction}
【回答の絶対遵守ルール】
1. **【結論・核心の数値】を冒頭で明示**: 質問で問われている具体的数値（例: 〇〇m、〇〇kg、〇〇円、条文番号等）や核心の結論を最初にズバリ答えてください。
2. **【ドキュメント根拠の詳細解説】**: 資料名【ドキュメント名】を明記し、なぜその結論・仕様になるのか、背景や文脈を含めて詳しく説明してください。
3. **【条件・制約・留意事項の網羅】**: 上限/下限、前提条件、例外規定、担当者、期日などがドキュメントにあれば、それらも漏れなく箇条書き等で補足してください。
4. ドキュメントに一切記載のない事柄は「提供資料内に該当する記述はありません」と明記してください。

【参照ドキュメント (選択中: ${activeDocTitles.join(', ')} / 計 ${totalContextChars.toLocaleString()} 文字)】
${fullDocsContext}

${graphSummary ? `【ナレッジネットワーク関係性】\n${graphSummary}` : ''}`;
      } else {
        systemPrompt = `あなたは親切で博識なAIアシスタントです。ユーザーの質問に対して論理的かつ分かりやすい日本語で丁寧に回答してください。`;
      }

      const assistantMsgId = `asst_${Date.now()}`;

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        projectId: activeProject.id,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        sources: searchResults,
        isStreaming: true
      };

      setMessages(prev => [...prev, assistantMsg]);
      setStatusMessage(`ドキュメント (${activeDocTitles.length}件) を解析して回答生成中...`);

      const recentMessages = config.mode === 'embedded-mobile' ? messages.slice(-4) : messages.slice(-10);
      const chatHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        ...recentMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: query }
      ];

      const stream = llmService.streamChat(chatHistory, config, (prog) => {
        setStatusMessage(prog);
      });

      let accumulatedText = '';
      for await (const chunk of stream) {
        accumulatedText += chunk;
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, content: accumulatedText } : m))
        );
      }

      if (graphSummary && !accumulatedText.includes('GraphRAG')) {
        accumulatedText += `\n\n${graphSummary}`;
      }

      const finalAssistantMsg: ChatMessage = {
        ...assistantMsg,
        content: accumulatedText,
        isStreaming: false
      };

      setMessages(prev =>
        prev.map(m => (m.id === assistantMsgId ? finalAssistantMsg : m))
      );

      await dbService.saveMessage(finalAssistantMsg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        projectId: activeProject.id,
        role: 'assistant',
        content: `⚠️ ${msg}`,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
      await dbService.saveMessage(errorMsg);
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
    }
  };

  // Studio生成処理
  const handleGenerateStudio = async (type: StudioTab, customPrompt?: string) => {
    if (!activeProject) return;

    const enabledDocs = documents.filter(d => d.enabled);
    if (enabledDocs.length === 0) {
      alert('Studio生成を行うには、左側のドキュメント一覧で対象資料のチェックボックスを1つ以上選択してください。');
      return;
    }

    setIsGeneratingStudio(true);
    try {
      const enabledDocIds = enabledDocs.map(d => d.id);
      const { contextText: fullContext, docTitles } = await ragManager.getStudioOptimizedContext(
        activeProject.id,
        enabledDocIds,
        customPrompt
      );

      let prompt = '';
      let title = '';

      const userRequirement = customPrompt ? `\n【ユーザーからの特別指示・こだわり条件】\n${customPrompt}\n` : '';

      const studioSystemPrompt = `あなたは最高峰の分析力と洞察力を持つエグゼクティブ・アナリストです。
提供された【参照ドキュメント】に記載された具体的な数値（〇〇m、〇〇円、〇〇%など）、固有名詞、条項、条件を漏れなく引用し、的確かつ実用性の極めて高いコンテンツを作成してください。
【絶対遵守ルール】
1. 浅い一般論（「〇〇の推進が重要である」など）や、どの文書にも当てはまるフワッとした文章は絶対に書かないこと。
2. 必ずドキュメント内に記載された確定数値、仕様、担当者、期日、ルールを根拠として記述すること。
3. ドキュメントに存在しない事実は捏造せず、記載されている情報のみを最大限深掘りして構造化すること。`;

      if (type === 'briefing') {
        title = customPrompt ? `要約: ${customPrompt.slice(0, 15)}...` : 'エグゼクティブ要約ブリーフィング';
        prompt = `以下の資料群から、経営層や実務責任者が即座に判断・把握できる【高密度エグゼクティブ要約ブリーフィング】を作成してください。
【必須構成】
# 📑 エグゼクティブ・ブリーフィング
## 1. 核心サマリー（本質を端的に要約）
## 2. 確定仕様・主要数値データ（〇〇m、〇〇円、〇〇%などの重要数値を網羅した一覧表）
## 3. 重要決定事項と背景
## 4. 制約条件・リスク・留意事項
## 5. 今後の推進ロードマップ / ネクストアクション
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'minutes') {
        title = customPrompt ? `議事録: ${customPrompt.slice(0, 15)}...` : '会議議事録・決定事項・ToDo一覧';
        prompt = `以下の資料（会議記録・文字起こし・メモ）から、ビジネス基準の高品質な【会議議事録】を作成してください。
【必須構成】
# 📝 会議議事録
- **対象資料**: ${docTitles.join(', ')}
## 1. 議題および目的
## 2. 決定事項 (Decisions) - 確定した方針・数値を箇条書き
## 3. 議論詳細・論点分析
## 4. 保留事項・次回検討課題
## 5. アクションプラン / ToDo一覧（Markdown表形式: | No | タスク内容 | 担当者 | 期日 | 成功基準/数値 |）
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'study_report') {
        title = customPrompt ? `レポート: ${customPrompt.slice(0, 15)}...` : '詳細研究・調査分析レポート';
        prompt = `以下の資料群を多角的に分析し、具体的な数値データと論理的洞察に満ちた【詳細研究・調査分析レポート】を作成してください。
【必須構成】
# 📊 詳細調査分析レポート
## 1. 調査背景と目的
## 2. 定量データ分析・重要指標（資料内の数値を整理）
## 3. 主要な発見（Key Findings）と本質的論点
## 4. 課題・ボトルネックと具体的解決策
## 5. 総合結論・提言
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'faq') {
        title = customPrompt ? `FAQ: ${customPrompt.slice(0, 15)}...` : '実践的想定問答集 (FAQ)';
        prompt = `以下の資料内容から、実務や利用者が直面する疑問やクリティカルな論点を突いた【実践的想定問答集 (FAQ)】を5〜8問作成してください。
一般的な質問ではなく、「資料内の具体的数値、条件、手続き、例外ケース、禁止事項」に基づいた深い質問と正確な回答を作成してください。
【構成】各項目は「### Q: ...」「**A:** ...」「*（根拠: 資料内の〇〇規定/数値）*」の形式。
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'learning_guide') {
        title = customPrompt ? `学習ガイド: ${customPrompt.slice(0, 15)}...` : '体系的マスター学習ガイド';
        prompt = `以下の資料内容から、初学者が最短で専門知識を習得できる【体系的マスター学習ガイド】を作成してください。
【必須構成】
# 🎓 体系的マスター学習ガイド
## 1. 全体像とコアコンセプト
## 2. 重要キーワード＆必須数値・仕様用語集（表形式）
## 3. ステップ別実践ワークフロー / 学習ロードマップ
## 4. 理解度チェック（選択式クイズ3問 ＋ 解答と資料に基づく解説）
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'slide') {
        title = customPrompt ? `スライド: ${customPrompt.slice(0, 15)}...` : 'Marp プレゼンテーションスライド';
        prompt = `以下の資料内容を分析し、プレゼンテーション用スライド（Marp Markdown形式）を作成してください。
【ルール】
- 冒頭に <!-- theme: default --> を付与
- 各スライドは --- で区切る
- スライド1: タイトル・サブタイトル
- スライド2: アジェンダ
- スライド3以降: 課題背景、主要数値・確定仕様（表または箇条書き）、重要施策、結論
- スライドの1ページあたり文字数は適度に絞り、箇条書きと太字を活用
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'mindmap') {
        title = customPrompt ? `マインドマップ: ${customPrompt.slice(0, 15)}...` : 'Mermaid マインドマップ';
        prompt = `以下の資料の構造を分析し、階層的なマインドマップを必ずMermaid記法（\`\`\`mermaid\\nmindmap\\n  root((中心テーマ))\\n    ...\\n\`\`\`）のコードブロックのみで出力してください。
【ルール】
- 資料内の具体的な専門用語や確定数値（〇〇m、〇〇円など）をノードに含めること。
- 余計な解説文は一切出力せず、\`\`\`mermaid\`\`\` コードブロックのみを出力すること。
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'flowchart') {
        title = customPrompt ? `フローチャート: ${customPrompt.slice(0, 15)}...` : 'Mermaid 業務処理フローチャート';
        prompt = `以下の資料に記載されたプロセス、手続き、判断分岐、運用手順を抽出し、必ずMermaid記法（\`\`\`mermaid\\nflowchart TD\\n  ...\\n\`\`\`）のコードブロックのみで出力してください。
【ルール】
- 条件分岐（ひし形 {条件}）や各工程の具体的なアクションを資料に基づいて明確に記述すること。
- 余計な解説文は一切出力せず、\`\`\`mermaid\`\`\` コードブロックのみを出力すること。
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'graph3d') {
        title = customPrompt ? `3Dグラフ: ${customPrompt.slice(0, 15)}...` : '3D ナレッジグラフデータ';
        prompt = `以下の資料から主要な概念（ノード）と関係性（リンク）を抽出し、必ず以下のJSONフォーマットのみで出力してください（解説不要、\`\`\`json\`\`\`ブロックのみ）:
\`\`\`json
{
  "nodes": [
    {"id": "1", "name": "主要概念名1", "val": 15, "color": "#6366f1"},
    {"id": "2", "name": "主要概念名2", "val": 10, "color": "#10b981"}
  ],
  "links": [
    {"source": "1", "target": "2", "label": "関係性の説明"}
  ]
}
\`\`\`
${userRequirement}

【参照資料】
${fullContext}`;
      } else if (type === 'podcast') {
        title = customPrompt ? `ポッドキャスト: ${customPrompt.slice(0, 15)}...` : 'ポッドキャスト対話スクリプト';
        prompt = `以下の資料を題材に、ホスト（アレックス: 親しみやすく鋭い質問役）と専門家（サクラ: 資料の数値や仕様を熟知した解説役）による、知的好奇心を刺激する【ポッドキャスト対話スクリプト】を作成してください。
【ルール】
- 一般論でお茶を濁さず、資料に書かれた具体的な数値（〇〇m、〇〇%など）、背景、裏話、注意点にフォーカスすること。
- 対話フォーマット: **アレックス:** ... / **サクラ:** ...
${userRequirement}

【参照資料】
${fullContext}`;
      }

      const stream = llmService.streamChat(
        [
          { role: 'system', content: studioSystemPrompt },
          { role: 'user', content: prompt }
        ],
        config
      );

      let content = '';
      for await (const chunk of stream) {
        content += chunk;
      }

      const newArtifact: StudioArtifact = {
        id: `art_${Date.now()}`,
        projectId: activeProject.id,
        type,
        title,
        content,
        customPrompt,
        createdAt: Date.now()
      };

      setArtifacts(prev => [newArtifact, ...prev]);
      await dbService.saveArtifact(newArtifact);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Studio生成エラー: ${msg}`);
    } finally {
      setIsGeneratingStudio(false);
    }
  };

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('minibooklm_theme');
    return saved !== null ? saved === 'dark' : true;
  });

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const next = !prev;
      localStorage.setItem('minibooklm_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  if (!isAuthenticated) {
    return <AuthGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden font-sans transition-colors duration-200 ${
      isDarkMode ? 'bg-slate-950 text-slate-100' : 'light-mode bg-slate-50 text-slate-900'
    }`}>
      <Header
        config={config}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeMobileTab={activeMobileTab}
        setActiveMobileTab={setActiveMobileTab}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
      />


      <main className="flex-1 flex overflow-hidden">
        {/* 左ペイン: ソース＆プロジェクト管理 */}
        <div
          className={`h-full md:w-80 lg:w-96 shrink-0 md:block ${
            activeMobileTab === 'docs' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <DocumentsPane
            projects={projects}
            activeProject={activeProject}
            onSelectProject={(id) => {
              const p = projects.find(proj => proj.id === id);
              if (p) setActiveProject(p);
            }}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            onExportProject={handleExportProject}
            onImportProject={handleImportProject}
            documents={documents}
            onUpload={handleUpload}
            onToggleDoc={handleToggleDoc}
            onToggleAllDocs={handleToggleAllDocs}
            onRemoveDoc={handleRemoveDoc}
            isProcessing={isProcessingDoc}
            processProgress={docProgress}
          />
        </div>

        {/* 中央ペイン: チャット画面 */}
        <div
          className={`h-full flex-1 min-w-0 overflow-hidden md:block ${
            activeMobileTab === 'chat' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <ChatPane
            messages={messages}
            onSendMessage={handleSendMessage}
            onClearMessages={handleClearMessages}
            onDeleteMessage={handleDeleteMessage}
            onAddToSource={handleAddContentToSource}
            isGenerating={isGenerating}
            statusMessage={statusMessage}
          />
        </div>

        {/* 右ペイン: Studio生成物 */}
        <div
          className={`h-full md:w-80 lg:w-96 shrink-0 md:block ${
            activeMobileTab === 'studio' ? 'w-full block' : 'hidden md:block'
          }`}
        >
          <StudioPane
            artifacts={artifacts}
            onGenerate={handleGenerateStudio}
            onDeleteArtifact={handleDeleteArtifact}
            onAddToSource={handleAddContentToSource}
            isGeneratingStudio={isGeneratingStudio}
          />
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onChangeConfig={handleUpdateConfig}
      />
    </div>
  );
};

export default App;
