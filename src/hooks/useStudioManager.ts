import { useState, useRef } from 'react';
import { Project, DocumentSource, StudioArtifact, StudioTab, ModelConfig } from '../types';
import { dbService } from '../services/db';
import { ragManager } from '../services/ragManager';
import { llmService } from '../services/llmService';
import { DiagramService } from '../services/diagramService';
import { buildStudioPrompt } from '../services/studioPrompts';

interface UseStudioManagerProps {
  activeProject: Project | null;
  documents: DocumentSource[];
  artifacts: StudioArtifact[];
  setArtifacts: React.Dispatch<React.SetStateAction<StudioArtifact[]>>;
  config: ModelConfig;
  showToast: (
    type: 'success' | 'error' | 'info',
    message: string,
    title?: string,
    action?: { label: string; onClick: () => void }
  ) => void;
  openSettings: () => void;
}

export function useStudioManager({
  activeProject,
  documents,
  artifacts,
  setArtifacts,
  config,
  showToast,
  openSettings
}: UseStudioManagerProps) {
  const [isGeneratingStudio, setIsGeneratingStudio] = useState(false);
  const [streamingStudioArtifact, setStreamingStudioArtifact] = useState<{ type: StudioTab; title: string; content: string } | null>(null);
  const studioAbortControllerRef = useRef<AbortController | null>(null);

  const handleCancelStudio = () => {
    if (studioAbortControllerRef.current) {
      studioAbortControllerRef.current.abort();
      studioAbortControllerRef.current = null;
    }
    setIsGeneratingStudio(false);
    setStreamingStudioArtifact(null);
  };

  // 成果物削除
  const handleDeleteArtifact = async (artifactId: string) => {
    await dbService.deleteArtifact(artifactId);
    setArtifacts(prev => prev.filter(a => a.id !== artifactId));
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

      // 🎯 現在の高性能モデル構成（Gemma 12B QAT / Gemini）に最適化した大容量Studioコンテキスト予算
      let studioContextMaxChars = 16000;
      if (config.mode === 'cloud-gemini') {
        studioContextMaxChars = 80000; // Gemini 1.5/2.0 Flash (100万トークン対応・長尺会議全文一括投入)
      } else if (config.mode === 'desktop-api' || config.mode === 'lmstudio') {
        studioContextMaxChars = 24000; // LM Studio / Gemma-4-12B-QAT (8K-16Kトークン対応・約2.4万文字)
      } else if (config.embeddedModelId?.includes('0.5B')) {
        studioContextMaxChars = 3000;
      }

      const { contextText: fullContext, docTitles } = await ragManager.getStudioOptimizedContext(
        activeProject.id,
        enabledDocIds,
        customPrompt,
        studioContextMaxChars
      );

      // google/gemma-4-12b-qat や Whisper Large-v3 が稼働している場合、ハイエンド推論プロンプトを適用
      const isHighEndModel = config.mode === 'desktop-api' || config.mode === 'lmstudio' || config.mode === 'cloud-gemini';
      const hasAudioTranscript = enabledDocs.some(d => d.type === 'audio' || d.contentPreview?.includes('🎙️'));

      const { title, prompt, systemPrompt: studioSystemPrompt } = buildStudioPrompt({
        type,
        customPrompt,
        fullContext,
        docTitles,
        isHighEndModel,
        hasAudioTranscript
      });

      const controller = new AbortController();
      studioAbortControllerRef.current = controller;

      setStreamingStudioArtifact({
        type,
        title,
        content: ''
      });

      const stream = llmService.streamChat(
        [
          { role: 'system', content: studioSystemPrompt },
          { role: 'user', content: prompt }
        ],
        config,
        undefined,
        controller.signal
      );

      let content = '';
      for await (const chunk of stream) {
        if (controller.signal.aborted) break;
        content += chunk;
        setStreamingStudioArtifact({
          type,
          title,
          content
        });
      }

      if (controller.signal.aborted) {
        return;
      }

      // 図解系（マインドマップ・フローチャート）は決定論的コンバータで100%安全なMermaidへ自動変換
      let finalContent = content;
      if (type === 'mindmap') {
        finalContent = DiagramService.toMermaidMindmap(content);
      } else if (type === 'flowchart') {
        finalContent = DiagramService.toMermaidFlowchart(content);
      }

      const newArtifact: StudioArtifact = {
        id: `art_${Date.now()}`,
        projectId: activeProject.id,
        type,
        title,
        content: finalContent,
        customPrompt,
        createdAt: Date.now()
      };

      setStreamingStudioArtifact(null);
      setArtifacts(prev => [newArtifact, ...prev]);
      await dbService.saveArtifact(newArtifact);
      showToast('success', `「${title}」の生成が完了しました`, 'Studio生成完了');
    } catch (err: unknown) {
      if (studioAbortControllerRef.current?.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `Studio生成エラー: ${msg}`, '生成失敗', {
        label: '設定を確認',
        onClick: openSettings
      });
      setStreamingStudioArtifact(null);
    } finally {
      setIsGeneratingStudio(false);
      setStreamingStudioArtifact(null);
      studioAbortControllerRef.current = null;
    }
  };

  // Studio成果物のインライン編集・保存
  const handleUpdateArtifact = async (id: string, updatedContent: string, updatedTitle?: string) => {
    const target = artifacts.find(a => a.id === id);
    if (!target) return;

    const updated: StudioArtifact = {
      ...target,
      content: updatedContent,
      title: updatedTitle || target.title
    };

    setArtifacts(prev => prev.map(a => a.id === id ? updated : a));
    await dbService.saveArtifact(updated);
    showToast('success', `「${updated.title}」の変更を保存しました`, '保存完了');
  };

  return {
    isGeneratingStudio,
    streamingStudioArtifact,
    handleGenerateStudio,
    handleCancelStudio,
    handleDeleteArtifact,
    handleUpdateArtifact
  };
}
