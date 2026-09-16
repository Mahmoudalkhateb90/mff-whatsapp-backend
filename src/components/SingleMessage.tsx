import React, { useState } from 'react';
import { Send, Loader2, MessageSquare, ShieldAlert } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';

const getSessionUser = () => { try { return JSON.parse(localStorage.getItem('user_session') || '{}'); } catch { return {}; } };

export default function SingleMessage() {
  const { t } = useLanguage();
  const toast = useToast();
  const user = getSessionUser();
  const isSuper = user.role === 'Super Admin';
  const hasPermission = isSuper || user.permissions?.canSendSingle !== false;

  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!hasPermission) {
      const permMsg = t('noSinglePermission') || 'Access denied: No single messaging permission';
      setStatus({ type: 'error', text: permMsg });
      toast.error(`[Error: 403] ${permMsg}`, {
        status: 403,
        url: `${API_BASE_URL}/api/messages/single`,
        message: permMsg,
        actionName: 'Single Message Dispatch'
      });
      return;
    }
    setLoading(true);
    setStatus(null);

    try {
      const formattedPhone = phoneNumber.replace(/\D/g, '');
      const user = getSessionUser();
      const res = await fetch(`${API_BASE_URL}/api/messages/single`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id || localStorage.getItem('user_id') || '',
          'x-user-email': user.email || '',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || user.id || ''}`
        },
        body: JSON.stringify({
          userId: user.id || localStorage.getItem('user_id'),
          to: `${formattedPhone}@s.whatsapp.net`,
          message
        })
      });

      if (res.ok || res.status === 202) {
        const successText = t('messageSentSuccess') || 'Message sent successfully!';
        setStatus({ type: 'success', text: successText });
        toast.success(successText);
        setPhoneNumber('');
        setMessage('');
      } else {
        let errorMessage = 'Failed to send message';
        let rawError: any = {};
        try {
          rawError = await res.json();
          errorMessage = rawError.error || errorMessage;
        } catch {
          errorMessage = `Server Error: ${res.status}`;
        }
        const fullErr = `[Error: ${res.status}] ${errorMessage}`;
        setStatus({ type: 'error', text: fullErr });
        toast.error(fullErr, {
          status: res.status,
          url: `${API_BASE_URL}/api/messages/single`,
          message: errorMessage,
          rawError,
          actionName: 'Single Message Dispatch'
        });
      }
    } catch (err: any) {
      const errText = err.message || 'An error occurred';
      setStatus({ type: 'error', text: `[Network Error] ${errText}` });
      toast.error(`[Network Error] ${errText}`, {
        status: 0,
        url: `${API_BASE_URL}/api/messages/single`,
        message: errText,
        rawError: err,
        actionName: 'Single Message Dispatch'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center gap-3">
          <MessageSquare className="text-emerald-500 w-6 h-6" />
          <h3 className="text-lg font-bold text-white">{t('sendSingleMessage')}</h3>
        </div>
        
        <form onSubmit={handleSendMessage} className="p-8 space-y-6">
          {!hasPermission && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
              <span>{t('noSinglePermission')}</span>
            </div>
          )}

          {status && (
            <div className={`p-4 rounded-xl text-sm font-medium border ${
              status.type === 'success' 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              {status.text}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-2">
              {t('recipientPhone')}
            </label>
            <div className="relative">
              <span className="absolute rtl:right-4 ltr:left-4 top-1/2 -translate-y-1/2 text-slate-500">+</span>
              <input
                type="text"
                required
                disabled={loading}
                placeholder="962790000000"
                className="w-full rtl:pr-8 rtl:pl-4 ltr:pl-8 ltr:pr-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 disabled:opacity-50"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-2">
              {t('messageContent')}
            </label>
            <textarea
              required
              rows={5}
              disabled={loading}
              placeholder={t('typeMessagePlaceholder')}
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none disabled:opacity-50"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <button
            type="submit"
            id="btn-send-single-message"
            disabled={loading || !phoneNumber || !message || !hasPermission}
            title={!hasPermission ? t('noSinglePermission') : undefined}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            <span>{loading ? (t('sendingSingleMessage') || 'جاري إرسال الرسالة...') : t('sendMessage')}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
