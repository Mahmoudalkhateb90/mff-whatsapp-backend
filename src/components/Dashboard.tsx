import { useState, useEffect } from 'react';
import { Shield, Smartphone, LogOut, CheckCircle2, RefreshCw } from 'lucide-react';
import { auth } from '../firebase';
import { API_BASE_URL } from '../config';

export default function Dashboard() {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const userId = auth.currentUser?.uid;

  const checkStatus = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/status/${userId}`, {
        headers: { 'x-user-id': userId }
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch (err) {
      console.error('Failed to get status', err);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  const startSession = async () => {
    if (!userId) return;
    setLoading(true);
    setQrBase64(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.qr) {
        setQrBase64(data.qr);
        setStatus('qr_ready');
      } else if (data.status) {
        setStatus(data.status);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const logoutSession = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE_URL}/api/sessions/logout`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ userId }),
      });
      setStatus('disconnected');
      setQrBase64(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        <div className="bg-emerald-600/10 p-6 text-center border-b border-emerald-600/20">
          <Smartphone className="w-12 h-12 mx-auto mb-4 text-emerald-500" />
          <h2 className="text-2xl font-bold tracking-tight text-white">Your Session</h2>
          <p className="text-emerald-400 mt-2 font-medium">Manage your isolated WhatsApp connection</p>
        </div>

        <div className="p-8">
          <div className="mb-8 p-6 rounded-xl flex items-center gap-4 border border-slate-700 bg-slate-900/50">
            <div className="p-3 bg-slate-800 rounded-full">
              {status === 'connected' ? (
                <CheckCircle2 className="text-emerald-500 w-8 h-8" />
              ) : status === 'qr_ready' ? (
                <RefreshCw className="text-amber-500 w-8 h-8 animate-spin-slow" />
              ) : (
                <Shield className="text-slate-500 w-8 h-8" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Connection Status</p>
              <p className="text-lg font-semibold text-white capitalize flex items-center gap-2 mt-1">
                {status.replace(/_/g, ' ')}
                {status === 'connected' && <span className="flex w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>}
              </p>
            </div>
          </div>

          {qrBase64 && status === 'qr_ready' && (
            <div className="mb-8 flex flex-col items-center animate-in fade-in zoom-in duration-300">
              <div className="p-4 bg-white border-4 border-slate-700 rounded-2xl shadow-2xl">
                <img src={qrBase64} alt="WhatsApp QR Code" className="w-56 h-56" />
              </div>
              <p className="mt-6 text-sm text-slate-400 font-medium text-center bg-slate-900/50 py-2 px-4 rounded-full border border-slate-800">
                Scan with WhatsApp to link your isolated session.
              </p>
            </div>
          )}

          <div className="flex gap-4">
            {status !== 'connected' && status !== 'qr_ready' && (
              <button
                onClick={startSession}
                disabled={loading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 px-4 rounded-xl transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/20 text-lg"
              >
                {loading ? 'Initializing...' : 'Start Session'}
              </button>
            )}

            {(status === 'connected' || status === 'qr_ready' || status.includes('disconnected_but_has_creds')) && (
              <button
                onClick={logoutSession}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-semibold py-4 px-4 rounded-xl transition-colors disabled:opacity-50 text-lg"
              >
                <LogOut className="w-5 h-5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
