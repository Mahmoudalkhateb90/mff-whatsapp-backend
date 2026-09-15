import { useState, useEffect } from 'react';
import { 
  Shield, 
  LogOut, 
  CheckCircle2, 
  RefreshCw, 
  AlertCircle, 
  MessageCircle, 
  QrCode, 
  Smartphone,
  Info
} from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useLanguage } from '../context/LanguageContext';

export default function WhatsAppSession() {
  const { 
    status, 
    qrBase64, 
    actionLoading, 
    hasSavedSession, 
    startSession, 
    reconnectSession, 
    resetSession 
  } = useSession();
  const { t } = useLanguage();

  // Track if reconnecting or connecting has been active for more than 5 seconds
  const [stuckOver5s, setStuckOver5s] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (status === 'reconnecting' || status === 'connecting') {
      timer = setTimeout(() => {
        setStuckOver5s(true);
      }, 5000);
    } else {
      setStuckOver5s(false);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [status]);

  // Determine if options should be prominently shown
  const isDisconnectedOrIdle = status === 'disconnected' || status === 'idle';
  const showManualControlOptions = isDisconnectedOrIdle || stuckOver5s;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600/10 p-6 text-center border-b border-emerald-600/20">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
          <h2 className="text-2xl font-bold tracking-tight text-white">{t('yourSession', 'WhatsApp Session')}</h2>
          <p className="text-emerald-400 mt-2 font-medium">
            {t('manageSession', 'Manage your isolated WhatsApp connection with explicit session controls')}
          </p>
        </div>

        <div className="p-6 sm:p-8">
          {/* Status Card */}
          <div className="mb-6 p-5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-700 bg-slate-900/60">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-800 rounded-full border border-slate-700 shrink-0">
                {status === 'connected' ? (
                  <CheckCircle2 className="text-emerald-500 w-8 h-8" />
                ) : status === 'qr' ? (
                  <QrCode className="text-amber-500 w-8 h-8 animate-pulse" />
                ) : status === 'reconnecting' || status === 'connecting' ? (
                  <RefreshCw className="text-sky-500 w-8 h-8 animate-spin" />
                ) : (
                  <Shield className="text-slate-400 w-8 h-8" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('connectionStatus', 'Connection Status')}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg font-semibold text-white capitalize">
                    {status === 'qr' ? 'Ready to Scan' : status.replace(/_/g, ' ')}
                  </span>
                  {status === 'connected' && (
                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Online
                    </span>
                  )}
                  {(status === 'reconnecting' || status === 'connecting') && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping"></span>
                      {status === 'reconnecting' ? 'Single Attempt...' : 'Connecting...'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Reset button if connected or has saved credentials */}
            {(status === 'connected' || hasSavedSession || status === 'qr') && (
              <button
                onClick={resetSession}
                disabled={actionLoading === 'reset'}
                className="self-end sm:self-auto text-xs font-medium text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 bg-slate-800/80 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                title="Wipe auth files and reset socket to idle"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{actionLoading === 'reset' ? 'Resetting...' : t('resetSessionState', 'Reset Session to Idle')}</span>
              </button>
            )}
          </div>

          {/* If stuck in connecting/reconnecting for > 5s */}
          {stuckOver5s && (status === 'reconnecting' || status === 'connecting') && (
            <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
              <div className="text-sm">
                <p className="font-semibold text-amber-200">Reconnection timeout limit reached (5s)</p>
                <p className="text-amber-300/80 mt-1">
                  Background auto-reconnect loops have been stopped to prevent infinite socket hang. You can scan a fresh QR code or trigger a manual reconnect below.
                </p>
              </div>
            </div>
          )}

          {/* QR Code Presentation */}
          {qrBase64 && status === 'qr' && (
            <div className="mb-8 flex flex-col items-center animate-in fade-in zoom-in duration-200">
              <div className="p-4 bg-white border-4 border-slate-700 rounded-2xl shadow-2xl">
                <img src={qrBase64} alt="WhatsApp QR Code" className="w-60 h-60" />
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-300 bg-slate-900/60 py-2 px-4 rounded-full border border-slate-700">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span>{t('scanQR', 'Scan with WhatsApp to link your isolated session')}</span>
              </div>
            </div>
          )}

          {/* Primary Action Buttons */}
          <div className="space-y-4">
            {showManualControlOptions && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. "Scan New QR Code" button -> calls POST /api/session/start */}
                <button
                  onClick={startSession}
                  disabled={actionLoading === 'start'}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-3.5 px-4 rounded-xl transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-60 text-base"
                >
                  <QrCode className={`w-5 h-5 ${actionLoading === 'start' ? 'animate-pulse' : ''}`} />
                  <span>
                    {actionLoading === 'start' ? 'Generating QR...' : t('scanNewQR', 'Scan New QR Code')}
                  </span>
                </button>

                {/* 2. "Try Reconnect Saved Session" button -> calls POST /api/session/reconnect */}
                <button
                  onClick={reconnectSession}
                  disabled={actionLoading === 'reconnect'}
                  className="w-full flex items-center justify-center gap-2 bg-sky-600/20 hover:bg-sky-600/30 text-sky-400 border border-sky-500/30 active:bg-sky-600/40 font-semibold py-3.5 px-4 rounded-xl transition-all disabled:opacity-60 text-base"
                >
                  <RefreshCw className={`w-5 h-5 ${actionLoading === 'reconnect' ? 'animate-spin' : ''}`} />
                  <span>
                    {actionLoading === 'reconnect' ? 'Attempting...' : t('reconnectSaved', 'Try Reconnect Saved Session')}
                  </span>
                </button>
              </div>
            )}

            {/* Connected State Actions */}
            {status === 'connected' && (
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={resetSession}
                  disabled={actionLoading === 'reset'}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 text-base"
                >
                  <LogOut className="w-5 h-5" />
                  <span>{actionLoading === 'reset' ? 'Disconnecting...' : t('disconnect', 'Disconnect & Reset')}</span>
                </button>
                <button
                  onClick={startSession}
                  disabled={actionLoading === 'start'}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 text-base"
                >
                  <QrCode className="w-5 h-5 text-emerald-400" />
                  <span>{t('scanNewQR', 'Switch Device / New QR')}</span>
                </button>
              </div>
            )}

            {/* QR State Secondary Actions */}
            {status === 'qr' && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={reconnectSession}
                  disabled={actionLoading === 'reconnect'}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-700/60 hover:bg-slate-700 text-slate-300 border border-slate-600 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors"
                >
                  <RefreshCw className="w-4 h-4 text-sky-400" />
                  <span>{t('reconnectSaved', 'Try Reconnect Saved Session')}</span>
                </button>
                <button
                  onClick={resetSession}
                  disabled={actionLoading === 'reset'}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-2.5 px-4 rounded-xl text-sm font-medium transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{t('cancel', 'Cancel')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Informational Guidance Footer */}
          <div className="mt-6 pt-5 border-t border-slate-700/60 flex items-start gap-2.5 text-xs text-slate-400">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <p>
              {t('sessionIdleDesc', 'Infinite background loops are disabled. Click "Scan New QR Code" for a fresh link or "Try Reconnect Saved Session" to restore an existing link.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
