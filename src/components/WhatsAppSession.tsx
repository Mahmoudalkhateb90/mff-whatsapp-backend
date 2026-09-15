import React from 'react';
import { 
  Shield, 
  LogOut, 
  CheckCircle2, 
  RefreshCw, 
  MessageCircle, 
  QrCode, 
  Smartphone,
  Info,
  Lock,
  Phone
} from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useLanguage } from '../context/LanguageContext';

export default function WhatsAppSession() {
  const { 
    status, 
    qrBase64, 
    phone,
    actionLoading, 
    startSession, 
    disconnectSession 
  } = useSession();
  const { t } = useLanguage();

  const isDisconnected = status === 'disconnected' || status === 'idle';
  const isConnected = status === 'connected';
  const isQR = status === 'qr' && !!qrBase64;
  const isConnecting = status === 'connecting';

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="bg-emerald-600/10 p-6 text-center border-b border-emerald-600/20">
          <MessageCircle className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
          <h2 className="text-2xl font-bold tracking-tight text-white">{t('yourSession', 'WhatsApp Session')}</h2>
          <p className="text-emerald-400/90 mt-1.5 text-sm font-medium flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>{t('sessionIsolatedDesc', 'Your WhatsApp session is completely private and isolated to your account.')}</span>
          </p>
        </div>

        <div className="p-6 sm:p-8">
          {/* Status Card */}
          <div className="mb-6 p-5 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-700 bg-slate-900/60">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-800 rounded-full border border-slate-700 shrink-0">
                {isConnected ? (
                  <CheckCircle2 className="text-emerald-500 w-8 h-8" />
                ) : isQR ? (
                  <QrCode className="text-amber-500 w-8 h-8 animate-pulse" />
                ) : isConnecting ? (
                  <RefreshCw className="text-sky-500 w-8 h-8 animate-spin" />
                ) : (
                  <Shield className="text-slate-400 w-8 h-8" />
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {t('connectionStatus', 'Connection Status')}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-lg font-semibold text-white capitalize">
                    {isConnected ? (
                      phone ? `${t('connectedAs', 'Connected as')} +${phone}` : t('connected', 'Connected')
                    ) : isQR ? (
                      t('scanQR', 'Ready to Scan')
                    ) : isConnecting ? (
                      t('initializing', 'Connecting...')
                    ) : (
                      t('disconnected', 'Disconnected')
                    )}
                  </span>
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Online
                    </span>
                  )}
                  {isConnecting && (
                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping"></span>
                      Initializing...
                    </span>
                  )}
                </div>
                {isConnected && phone && (
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                    <Phone className="w-3 h-3 text-emerald-400" />
                    <span>+{phone}</span>
                  </p>
                )}
              </div>
            </div>

            {/* If Connected or in QR mode, show quick Disconnect button in header card */}
            {(isConnected || isQR) && (
              <button
                id="btn-quick-disconnect-session"
                onClick={disconnectSession}
                disabled={actionLoading === 'disconnect'}
                className="self-end sm:self-auto text-xs font-medium text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 bg-slate-800/80 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                title="Disconnect your session"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{actionLoading === 'disconnect' ? 'Disconnecting...' : t('disconnect', 'Disconnect')}</span>
              </button>
            )}
          </div>

          {/* QR Code Presentation */}
          {isQR && qrBase64 && (
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
            {/* 1. DISCONNECTED State: Display single clear button "Generate My QR Code" */}
            {(isDisconnected || (isConnecting && !qrBase64)) && (
              <div className="flex flex-col gap-3">
                <button
                  id="btn-generate-my-qr"
                  onClick={startSession}
                  disabled={actionLoading === 'start'}
                  className="w-full flex items-center justify-center gap-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg shadow-emerald-900/20 disabled:opacity-60 text-base"
                >
                  <QrCode className={`w-5 h-5 ${actionLoading === 'start' ? 'animate-pulse' : ''}`} />
                  <span>
                    {actionLoading === 'start' 
                      ? (t('generatingQR', 'Generating QR Code...')) 
                      : (t('generateMyQR', 'Generate My QR Code'))}
                  </span>
                </button>
              </div>
            )}

            {/* 2. QR Code Active State Actions */}
            {isQR && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  id="btn-regenerate-qr"
                  onClick={startSession}
                  disabled={actionLoading === 'start'}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${actionLoading === 'start' ? 'animate-spin' : ''}`} />
                  <span>{actionLoading === 'start' ? 'Refreshing...' : t('scanNewQR', 'Regenerate QR Code')}</span>
                </button>
                <button
                  id="btn-cancel-qr"
                  onClick={disconnectSession}
                  disabled={actionLoading === 'disconnect'}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 text-sm"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{actionLoading === 'disconnect' ? 'Canceling...' : t('cancel', 'Cancel & Reset')}</span>
                </button>
              </div>
            )}

            {/* 3. CONNECTED State: Display "Disconnect My Session" and switch device options */}
            {isConnected && (
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  id="btn-disconnect-my-session"
                  onClick={disconnectSession}
                  disabled={actionLoading === 'disconnect'}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 text-base"
                >
                  <LogOut className="w-5 h-5" />
                  <span>
                    {actionLoading === 'disconnect' 
                      ? 'Disconnecting...' 
                      : (t('disconnectMySession', 'Disconnect My Session'))}
                  </span>
                </button>
                <button
                  id="btn-switch-device-qr"
                  onClick={startSession}
                  disabled={actionLoading === 'start'}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 text-base"
                >
                  <QrCode className="w-5 h-5 text-emerald-400" />
                  <span>{t('scanNewQR', 'Switch Device / New QR')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Informational Guidance Footer */}
          <div className="mt-6 pt-5 border-t border-slate-700/60 flex items-start gap-2.5 text-xs text-slate-400">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <p>
              {isDisconnected 
                ? (t('sessionIdleDesc', 'No active session. Click "Generate My QR Code" to link your WhatsApp account.'))
                : (t('sessionIsolatedDesc', 'Your WhatsApp session is completely private and isolated to your account. Messages dispatched from your user account will only use this connection.'))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
