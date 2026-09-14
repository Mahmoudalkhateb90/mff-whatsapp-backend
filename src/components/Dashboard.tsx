import { Shield, Smartphone, LogOut, CheckCircle2, RefreshCw, AlertTriangle, MessageCircle } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { useLanguage } from '../context/LanguageContext';

export default function Dashboard() {
  const { status, qrBase64, loading, startSession, logoutSession, resetSession } = useSession();
  const { t } = useLanguage();

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        <div className="bg-emerald-600/10 p-6 text-center border-b border-emerald-600/20">
          <MessageCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
          <h2 className="text-2xl font-bold tracking-tight text-white">{t('yourSession', 'Your Session')}</h2>
          <p className="text-emerald-400 mt-2 font-medium">{t('manageSession', 'Manage your isolated WhatsApp connection')}</p>
        </div>
        <div className="p-8">
          <div className="mb-8 p-6 rounded-xl flex items-center gap-4 border border-slate-700 bg-slate-900/50">
            <div className="p-3 bg-slate-800 rounded-full">
              {status === 'connected' ? (
                <CheckCircle2 className="text-emerald-500 w-8 h-8" />
              ) : status === 'qr' ? (
                <RefreshCw className="text-amber-500 w-8 h-8 animate-spin-slow" />
              ) : (
                <Shield className="text-slate-500 w-8 h-8" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{t('connectionStatus')}</p>
              <p className="text-lg font-semibold text-white capitalize flex items-center gap-2 mt-1">
                {status.replace(/_/g, ' ')}
                {status === 'connected' && <span className="flex w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}
              </p>
            </div>
          </div>
          {qrBase64 && status === 'qr' && (
            <div className="mb-8 flex flex-col items-center animate-in fade-in zoom-in duration-300">
              <div className="p-4 bg-white border-4 border-slate-700 rounded-2xl shadow-2xl">
                <img src={qrBase64} alt="WhatsApp QR Code" className="w-56 h-56" />
              </div>
              <p className="mt-6 text-sm text-slate-400 font-medium text-center bg-slate-900/50 py-2 px-4 rounded-full border border-slate-800">
                {t('scanQR')}
              </p>
            </div>
          )}
          <div className="flex gap-4">
            {status !== 'connected' && status !== 'qr' && !status.includes('already_active') && (
              <button
                onClick={startSession}
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 px-4 rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/20 text-lg"
              >
                {loading ? t('initializing') : t('startSession')}
              </button>
            )}
            {(status === 'connected' || status === 'qr' || status.includes('disconnected_but_has_creds') || status === 'already_active' || status === 'connecting') && (
              <>
                <button
                  onClick={resetSession}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/20 font-semibold py-4 px-4 rounded-xl transition-colors disabled:opacity-50 text-lg"
                >
                  <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                  <span>{t('resetSession')}</span>
                </button>
                <button
                  onClick={logoutSession}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-semibold py-4 px-4 rounded-xl transition-colors disabled:opacity-50 text-lg"
                >
                  <LogOut className="w-5 h-5" />
                  <span>{t('disconnect')}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
