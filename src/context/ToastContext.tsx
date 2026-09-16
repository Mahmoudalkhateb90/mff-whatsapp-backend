import React, { createContext, useContext, useState, ReactNode } from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Info, 
  X, 
  ChevronRight, 
  Copy, 
  Check, 
  Terminal,
  Bug
} from 'lucide-react';
import { useLanguage } from './LanguageContext';

export interface ErrorDetails {
  status?: number | string;
  url?: string;
  message?: string;
  rawError?: any;
  timestamp?: string;
  actionName?: string;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  details?: ErrorDetails;
  timestamp: string;
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id' | 'timestamp'>) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, details?: ErrorDetails, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  removeToast: (id: string) => void;
  openErrorDetails: (details: ErrorDetails, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeModalDetails, setActiveModalDetails] = useState<{ details: ErrorDetails; title?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { language } = useLanguage();

  const isAr = language === 'ar';

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const addToast = (toast: Omit<ToastItem, 'id' | 'timestamp'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newToast: ToastItem = {
      ...toast,
      id,
      timestamp: new Date().toLocaleTimeString()
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto-dismiss non-error toasts after 5 seconds
    if (toast.type !== 'error') {
      setTimeout(() => {
        removeToast(id);
      }, 5000);
    } else {
      // Auto-dismiss errors after 9 seconds if not interacted
      setTimeout(() => {
        removeToast(id);
      }, 9000);
    }
  };

  const success = (message: string, title?: string) => {
    addToast({ type: 'success', message, title });
  };

  const error = (message: string, details?: ErrorDetails, title?: string) => {
    addToast({ 
      type: 'error', 
      message, 
      title, 
      details: details ? { ...details, timestamp: details.timestamp || new Date().toISOString() } : undefined 
    });
  };

  const warning = (message: string, title?: string) => {
    addToast({ type: 'warning', message, title });
  };

  const info = (message: string, title?: string) => {
    addToast({ type: 'info', message, title });
  };

  const openErrorDetails = (details: ErrorDetails, title?: string) => {
    setActiveModalDetails({ details, title });
  };

  const handleCopyLogs = () => {
    if (!activeModalDetails) return;
    const logData = JSON.stringify(activeModalDetails, null, 2);
    navigator.clipboard.writeText(logData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ToastContext.Provider
      value={{
        toasts,
        addToast,
        success,
        error,
        warning,
        info,
        removeToast,
        openErrorDetails
      }}
    >
      {children}

      {/* Floating Global Toasts Container */}
      <div 
        id="toast-notifications-container" 
        className="fixed top-5 z-50 flex flex-col gap-3 max-w-md w-full px-4 pointer-events-none"
        style={{
          [isAr ? 'left' : 'right']: '1.25rem'
        }}
      >
        {toasts.map((toast) => {
          const isError = toast.type === 'error';
          const isSuccess = toast.type === 'success';
          const isWarning = toast.type === 'warning';

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto w-full p-4 rounded-xl shadow-2xl border transition-all duration-300 animate-in slide-in-from-top-3 flex flex-col gap-2 backdrop-blur-md ${
                isError
                  ? 'bg-slate-900/95 border-rose-500/50 text-rose-200 shadow-rose-950/40'
                  : isSuccess
                  ? 'bg-slate-900/95 border-emerald-500/50 text-emerald-200 shadow-emerald-950/40'
                  : isWarning
                  ? 'bg-slate-900/95 border-amber-500/50 text-amber-200 shadow-amber-950/40'
                  : 'bg-slate-900/95 border-sky-500/50 text-sky-200 shadow-sky-950/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {isError && <XCircle className="w-5 h-5 text-rose-400 animate-pulse" />}
                    {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                    {isWarning && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                    {toast.type === 'info' && <Info className="w-5 h-5 text-sky-400" />}
                  </div>
                  <div className="flex-1">
                    {toast.title && (
                      <h4 className="text-sm font-bold text-white mb-0.5">
                        {toast.title}
                      </h4>
                    )}
                    <p className="text-xs sm:text-sm font-medium leading-snug break-words">
                      {toast.message}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="shrink-0 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                  title={isAr ? 'إغلاق' : 'Close'}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Expandable Log Details button on Error */}
              {isError && toast.details && (
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                    <Terminal className="w-3 h-3 text-slate-500" />
                    {toast.details.status ? `Status ${toast.details.status}` : 'Client Exception'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openErrorDetails(toast.details!, toast.title || toast.message)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 rounded-md transition-colors border border-rose-500/20"
                  >
                    <span>{isAr ? 'عرض تفاصيل الخطأ' : 'View Log Details'}</span>
                    <ChevronRight className="w-3 h-3 rtl:rotate-180" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Global Error Log Details Modal */}
      {activeModalDetails && (
        <div 
          id="modal-error-log-details"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400">
                  <Bug className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {isAr ? 'تفاصيل سجلات الخطأ (Error Logs)' : 'Error Log Details'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {activeModalDetails.details.actionName || activeModalDetails.title || 'System Execution Trace'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveModalDetails(null)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1 font-sans text-sm">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <p className="text-[11px] font-bold uppercase text-slate-500">{isAr ? 'رمز الاستجابة' : 'HTTP Status'}</p>
                  <p className="text-base font-mono font-bold text-rose-400 mt-0.5">
                    {activeModalDetails.details.status || '500 / Exception'}
                  </p>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <p className="text-[11px] font-bold uppercase text-slate-500">{isAr ? 'وقت الحدوث' : 'Timestamp'}</p>
                  <p className="text-xs font-mono text-slate-300 mt-1">
                    {activeModalDetails.details.timestamp || new Date().toLocaleTimeString()}
                  </p>
                </div>
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl col-span-2 sm:col-span-1">
                  <p className="text-[11px] font-bold uppercase text-slate-500">{isAr ? 'نقطة النهاية' : 'Endpoint'}</p>
                  <p className="text-xs font-mono text-slate-300 mt-1 truncate" title={activeModalDetails.details.url || '/api'}>
                    {activeModalDetails.details.url || '/api'}
                  </p>
                </div>
              </div>

              {/* Error Message Text */}
              {activeModalDetails.details.message && (
                <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs sm:text-sm font-medium">
                  {activeModalDetails.details.message}
                </div>
              )}

              {/* Raw JSON Trace Container */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    {isAr ? 'الاستجابة البرمجية الكاملة (Raw Response)' : 'Raw Response JSON'}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg transition-colors border border-slate-700"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'نسخ السجل' : 'Copy Logs')}</span>
                  </button>
                </div>

                <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 font-mono text-xs overflow-x-auto max-h-60 leading-relaxed scrollbar-thin">
                  {JSON.stringify(
                    activeModalDetails.details.rawError || activeModalDetails.details,
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveModalDetails(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
