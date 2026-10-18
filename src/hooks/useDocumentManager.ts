import { useState, useRef } from 'react';
import { Project, DocumentSource, ModelConfig } from '../types';
import { dbService } from '../services/db';
import { ragManager } from '../services/ragManager';

interface UseDocumentManagerProps {
  activeProject: Project | null;
  documents: DocumentSource[];
  setDocuments: React.Dispatch<React.SetStateAction<DocumentSource[]>>;
  config: ModelConfig;
  showToast: (
    type: 'success' | 'error' | 'info',
    message: string,
    title?: string,
    action?: { label: string; onClick: () => void }
  ) => void;
  setSelectedDocForModal: (doc: DocumentSource | null) => void;
}

export function useDocumentManager({
  activeProject,
  documents,
  setDocuments,
  config,
  showToast,
  setSelectedDocForModal
}: UseDocumentManagerProps) {
  const [isProcessingDoc, setIsProcessingDoc] = useState(false);
  const [docProgress, setDocProgress] = useState(0);
  const [docStatusText, setDocStatusText] = useState('');
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  const handleCancelUpload = () => {
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }
    setIsProcessingDoc(false);
    setDocProgress(0);
    setDocStatusText('');
  };

  // ファイルアップロード処理＆IndexedDB永続化
  const handleUpload = async (files: FileList) => {
    if (!activeProject) return;

    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
    }
    const uploadAbort = new AbortController();
    uploadAbortControllerRef.current = uploadAbort;

    setIsProcessingDoc(true);
    setDocProgress(0);
    setDocStatusText('ファイルを解析中...');

    try {
      for (let i = 0; i < files.length; i++) {
        if (uploadAbort.signal.aborted) break;
        const file = files[i];
        try {
          // 同名ドキュメントが既に存在する場合は旧ドキュメント（旧メタデータや古い内容）を自動削除して置換
          const existingSameName = documents.find(d => d.title === file.name && d.projectId === activeProject.id);
          if (existingSameName) {
            await dbService.deleteDocument(existingSameName.id);
            setDocuments(prev => prev.filter(d => d.id !== existingSameName.id));
          }

          const { doc, chunks } = await ragManager.processDocument(
            file,
            activeProject.id,
            (percent, status) => {
              setDocProgress(percent);
              if (status) setDocStatusText(status);
            },
            {
              enginePreference: config.audioTranscriptionEngine,
              cloudApiKey: config.cloudApiKey,
              abortSignal: uploadAbort.signal,
              modelConfig: config
            }
          );

          await dbService.saveDocument(doc);
          await dbService.saveChunks(chunks);

          setDocuments(prev => {
            const exists = prev.some(d => d.id === doc.id);
            return exists ? prev.map(d => d.id === doc.id ? doc : d) : [...prev, doc];
          });
        } catch (err: unknown) {
          if (uploadAbort.signal.aborted) break;
          const msg = err instanceof Error ? err.message : String(err);
          showToast('error', `ドキュメント処理に失敗しました: ${msg}`, 'アップロード失敗');
        }
      }

      // 検索ワーカーのインデックスを最新状態に完全同期
      const updatedChunks = await dbService.getChunksByProject(activeProject.id);
      await ragManager.loadProjectChunks(updatedChunks);
    } finally {
      setIsProcessingDoc(false);
      setDocProgress(0);
      setDocStatusText('');
      uploadAbortControllerRef.current = null;
    }
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
      const updatedChunks = await dbService.getChunksByProject(activeProject.id);
      await ragManager.loadProjectChunks(updatedChunks);
      showToast('success', `「${title}」をソース一覧に追加・保存しました`, 'ソース追加完了');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `ソース追加エラー: ${msg}`, '追加失敗');
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

  // 🧠 通常資料 ⇄ AI補助脳 の相互昇格・切り替え
  const handleToggleAuxiliaryBrain = async (doc: DocumentSource) => {
    if (!activeProject) return;

    const isCurrentlyBrain = doc.title.includes('AI補助脳');
    let newTitle: string;

    if (isCurrentlyBrain) {
      // 補助脳から解除（プレフィックスを除去）
      newTitle = doc.title.replace(/^\[AI補助脳(?::\s*[^\]]+)?\]\s*/, '').trim();
    } else {
      // 補助脳に昇格（プレフィックスを付与）
      newTitle = `[AI補助脳: ${doc.type.toUpperCase()}] ${doc.title}`;
    }

    const updatedDoc: DocumentSource = {
      ...doc,
      title: newTitle
    };

    // 1. Documents状態およびIndexedDBを更新
    setDocuments(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
    await dbService.saveDocument(updatedDoc);

    // 2. チャンク側のdocTitleも更新
    const docChunks = await dbService.getChunksByDocId(doc.id);
    for (const chunk of docChunks) {
      chunk.docTitle = newTitle;
    }
    await dbService.saveChunks(docChunks);

    // 3. 検索ワーカーへ更新済みチャンクを同期
    const allProjectChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(allProjectChunks);

    if (isCurrentlyBrain) {
      showToast('info', `「${newTitle}」を通常の資料に戻しました`, '補助脳解除');
    } else {
      showToast('success', `「${newTitle}」をAI補助脳に昇格・重み付け登録しました！`, '🧠 補助脳登録');
    }
  };

  // ドキュメント削除
  const handleRemoveDoc = async (id: string) => {
    if (!activeProject) return;
    await dbService.deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
    const remainingChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(remainingChunks);
  };

  // ドキュメント全削除＆インデックス完全初期化
  const handleRemoveAllDocs = async () => {
    if (!activeProject || documents.length === 0) return;
    if (!confirm(`プロジェクト「${activeProject.name}」の全ドキュメント（${documents.length}件）を完全に消去しますか？`)) return;
    
    for (const d of documents) {
      await dbService.deleteDocument(d.id);
    }
    setDocuments([]);
    await ragManager.loadProjectChunks([]);
  };

  // ドキュメントのプロジェクト間移動
  const handleMoveDoc = async (docId: string, targetProjectId: string) => {
    if (!activeProject) return;
    await dbService.moveDocument(docId, targetProjectId);
    setDocuments(prev => prev.filter(d => d.id !== docId));
    const remainingChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(remainingChunks);
  };

  // ドキュメントのプロジェクト間コピー
  const handleCopyDoc = async (docId: string, targetProjectId: string) => {
    await dbService.copyDocument(docId, targetProjectId);
  };

  // ドキュメント内容の直接編集・AI校正後の保存＆再インデックス
  const handleSaveDocumentContent = async (doc: DocumentSource, newContent: string) => {
    if (!activeProject) return;

    // 1. 旧ドキュメントのチャンクを削除
    await dbService.deleteDocument(doc.id);

    // 2. 新しい内容で階層チャンク分割＆埋め込みベクトル再計算
    const { doc: updatedDoc, chunks: newChunks } = await ragManager.processTextContent(
      doc.title,
      newContent,
      doc.projectId,
      doc.type,
      undefined,
      doc.id
    );

    // 3. IndexedDBに保存
    await dbService.saveDocument(updatedDoc);
    await dbService.saveChunks(newChunks);

    // 4. ステート同期
    setDocuments(prev => prev.map(d => d.id === doc.id ? updatedDoc : d));
    setSelectedDocForModal(updatedDoc);

    // 5. 検索ワーカーのインデックスを再同期
    const allChunks = await dbService.getChunksByProject(activeProject.id);
    await ragManager.loadProjectChunks(allChunks);

    alert(`「${doc.title}」を正常に更新し、検索インデックスを再構築しました！`);
  };

  return {
    isProcessingDoc,
    docProgress,
    docStatusText,
    handleUpload,
    handleCancelUpload,
    handleAddContentToSource,
    handleToggleDoc,
    handleToggleAllDocs,
    handleToggleAuxiliaryBrain,
    handleRemoveDoc,
    handleRemoveAllDocs,
    handleMoveDoc,
    handleCopyDoc,
    handleSaveDocumentContent
  };
}
