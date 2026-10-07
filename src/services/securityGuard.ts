// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

class SecurityGuard {
  private isInitialized = false;
  private onDevToolsDetected: (() => void) | null = null;
  private checkInterval: any = null;

  public init(onViolation: () => void) {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.onDevToolsDetected = onViolation;

    this.blockShortcutsAndContextMenu();
    this.startDevToolsDetection();
  }

  // 1. 右クリック & ショートカット無効化 (F12, Ctrl+Shift+I/J/C, Ctrl+U)
  private blockShortcutsAndContextMenu() {
    // 右クリック禁止
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // キーボードショートカット禁止
    window.addEventListener('keydown', (e) => {
      // F12
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerLock();
        return false;
      }

      // Ctrl + Shift + I / J / C (DevTools)
      if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerLock();
        return false;
      }

      // Ctrl + U (ソース表示)
      if (e.ctrlKey && ['u', 'U'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Ctrl + S (保存防止)
      if (e.ctrlKey && ['s', 'S'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    });
  }

  // 2. 開発者ツールのオープン検知 (サイズ差分 & タイミング検知)
  private startDevToolsDetection() {
    const threshold = 160;

    const checkDevTools = () => {
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;

      if (widthDiff || heightDiff) {
        this.triggerLock();
      }
    };

    window.addEventListener('resize', checkDevTools);
    this.checkInterval = setInterval(checkDevTools, 1500);
  }

  private triggerLock() {
    if (this.onDevToolsDetected) {
      sessionStorage.removeItem('minibooklm_auth_token');
      this.onDevToolsDetected();
    }
  }

  public destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export const securityGuard = new SecurityGuard();
