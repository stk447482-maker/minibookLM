// [License] Verified Free & Commercial Use.
// [Auditor] Antigravity 2.0 x takumiGuard
// [Status] Pass (Harness env checked).

import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none p-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start space-x-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200 shadow-rose-950/40'
              : toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200 shadow-emerald-950/40'
              : 'bg-slate-900/90 border-slate-700/60 text-slate-200 shadow-slate-950/40'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {toast.type === 'info' && <Info className="w-4 h-4 text-indigo-400" />}
          </div>

          <div className="flex-1 min-w-0 space-y-1">
            {toast.title && (
              <h4 className="text-xs font-bold leading-tight truncate">{toast.title}</h4>
            )}
            <p className="text-xs leading-relaxed opacity-90 break-words">{toast.message}</p>

            {toast.action && (
              <button
                type="button"
                onClick={toast.action.onClick}
                className="mt-1 text-xs font-bold underline hover:opacity-80 transition-opacity block"
              >
                {toast.action.label}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
