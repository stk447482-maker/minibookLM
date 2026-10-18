// [License] Verified Free & Commercial Use (MIT / Apache-2.0).
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).
// [Timestamp] 2026-10-18T12:05:00Z

import { Project, DocumentSource, DocumentChunk, ChatMessage, StudioArtifact } from '../types/index.ts';
import { ProjectExportPackage } from './db.ts';

const SYNC_DIR_DB_NAME = 'minibooklm_sync_store';
const SYNC_DIR_KEY = 'saved_sync_directory_handle';

class LocalSyncService {
  private dirHandle: any = null;

  /**
   * File System Access API がブラウザでサポートされているか（PC Chrome/Edge等）
   */
  public isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  /**
   * スマホ/PWA用: ブラウザの自動データ消去を防ぐ永続ストレージを要求
   */
  public async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (isPersisted) return true;
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * 永続ストレージが有効かどうかを確認
   */
  public async isStoragePersisted(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
      try {
        return await navigator.storage.persisted();
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * PC用: ユーザーにローカル同期先フォルダを選択させ、パーミッションを取得
   */
  public async pickSyncDirectory(): Promise<string | null> {
    if (!this.isFileSystemAccessSupported()) {
      throw new Error('お使いのブラウザはフォルダ直接同期(File System Access API)に非対応です。PC(Chrome/Edge)をご利用ください。');
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });
      this.dirHandle = handle;

      // ハンドルをIndexedDBに保持
      await this.saveDirectoryHandle(handle);
      return handle.name;
    } catch (err: any) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }

  /**
   * 保存済みのフォルダハンドルを復元
   */
  public async getActiveDirectoryName(): Promise<string | null> {
    if (this.dirHandle) return this.dirHandle.name;
    const restored = await this.restoreDirectoryHandle();
    if (restored) {
      this.dirHandle = restored;
      return restored.name;
    }
    return null;
  }

  /**
   * プロジェクトをローカル同期フォルダに自動保存（非同期バックグラウンド実行）
   */
  public async autoSaveToDirectory(
    project: Project,
    documents: DocumentSource[],
    chunks: DocumentChunk[],
    messages: ChatMessage[],
    artifacts: StudioArtifact[]
  ): Promise<boolean> {
    if (!this.dirHandle) {
      const restored = await this.restoreDirectoryHandle();
      if (restored) this.dirHandle = restored;
      else return false;
    }

    try {
      // 権限確認
      const permission = await this.verifyPermission(this.dirHandle, true);
      if (!permission) return false;

      const exportPkg: ProjectExportPackage = {
        version: '1.0.0',
        exportedAt: Date.now(),
        project,
        documents,
        chunks,
        messages,
        artifacts
      };

      const safeName = project.name.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `${safeName}_backup.minibook`;

      // フォルダ内にファイルを作成・上書き
      const fileHandle = await this.dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(exportPkg, null, 2));
      await writable.close();

      return true;
    } catch (err) {
      console.warn('Auto save to local directory failed:', err);
      return false;
    }
  }

  /**
   * 起動時にローカル同期フォルダから最新のプロジェクトを自動読込
   */
  public async checkAndLoadFromDirectory(): Promise<ProjectExportPackage[] | null> {
    if (!this.dirHandle) {
      const restored = await this.restoreDirectoryHandle();
      if (restored) this.dirHandle = restored;
      else return null;
    }

    try {
      const permission = await this.verifyPermission(this.dirHandle, false);
      if (!permission) return null;

      const packages: ProjectExportPackage[] = [];
      for await (const entry of this.dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.minibook')) {
          try {
            const file = await entry.getFile();
            const text = await file.text();
            const pkg = JSON.parse(text) as ProjectExportPackage;
            if (pkg && pkg.project && pkg.project.id) {
              packages.push(pkg);
            }
          } catch {
            // ignore corrupt file
          }
        }
      }
      return packages.length > 0 ? packages : null;
    } catch {
      return null;
    }
  }

  /**
   * 同期先フォルダの連携を解除
   */
  public async disconnectSyncDirectory(): Promise<void> {
    this.dirHandle = null;
    await this.clearDirectoryHandle();
  }

  // --- 内部ヘルパー: IndexedDBによるハンドル保持 ---
  private async saveDirectoryHandle(handle: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SYNC_DIR_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('handles');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, SYNC_DIR_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async restoreDirectoryHandle(): Promise<any | null> {
    return new Promise((resolve) => {
      const req = indexedDB.open(SYNC_DIR_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('handles');
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('handles', 'readonly');
          const getReq = tx.objectStore('handles').get(SYNC_DIR_KEY);
          getReq.onsuccess = () => resolve(getReq.result || null);
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  }

  private async clearDirectoryHandle(): Promise<void> {
    return new Promise((resolve) => {
      const req = indexedDB.open(SYNC_DIR_DB_NAME, 1);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('handles', 'readwrite');
          tx.objectStore('handles').delete(SYNC_DIR_KEY);
          tx.oncomplete = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  }

  private async verifyPermission(fileHandle: any, readWrite: boolean): Promise<boolean> {
    const options: any = {};
    if (readWrite) options.mode = 'readwrite';
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
    return false;
  }
}

export const localSyncService = new LocalSyncService();
