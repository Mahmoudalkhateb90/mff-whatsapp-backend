import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone, Lock, User, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();
  const toast = useToast();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorText = errorData.error || (response.status === 401 ? 'Invalid email or password' : `Server Error: ${response.status}`);
        const fullMessage = `[Error: ${response.status}] ${errorText}`;
        toast.error(
          fullMessage,
          {
            status: response.status,
            url: `${API_BASE_URL}/api/login`,
            message: errorText,
            rawError: errorData,
            actionName: 'Enterprise Login'
          }
        );
        throw new Error(errorText);
      }

      const data = await response.json();
      
      if (data.success && data.user) {
        // Synchronously store user session and keys BEFORE routing
        const sessionPayload = {
          ...data.user,
          token: data.token || `session_token_${data.user.id}_${Date.now()}`
        };
        localStorage.setItem('user_session', JSON.stringify(sessionPayload));
        localStorage.setItem('user_id', data.user.id);
        localStorage.setItem('auth_token', sessionPayload.token);
        
        // Dispatch storage and custom auth-change events to immediately hydrate active context listeners
        window.dispatchEvent(new CustomEvent('auth-change', { detail: sessionPayload }));
        window.dispatchEvent(new Event('storage'));

        toast.success(t('loginSuccess') || 'Logged in successfully!');
        navigate('/');
      } else {
        const invalidMsg = '[Error: 400] Invalid response structure from server';
        toast.error(invalidMsg, {
          status: 400,
          url: `${API_BASE_URL}/api/login`,
          message: 'Invalid response from server',
          rawError: data,
          actionName: 'Enterprise Login'
        });
        throw new Error('Invalid response from server');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-slate-100">
      <div className="w-full max-w-md bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 overflow-hidden">
        <div className="bg-emerald-600/10 p-8 text-center border-b border-emerald-600/20">
          <Smartphone className="w-16 h-16 mx-auto mb-4 text-emerald-500" />
          <h1 className="text-3xl font-bold tracking-tight text-white">{t('loginHeader')}</h1>
          <p className="text-emerald-400 mt-2 font-medium">{t('loginSub')}</p>
        </div>

        <form onSubmit={handleLogin} className="p-8 space-y-6">
          {error && (
            <div className="bg-rose-500/10 text-rose-400 p-4 rounded-xl text-sm border border-rose-500/20">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-400">{t('email')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="email"
                required
                className="w-full ps-11 pe-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-500 transition-all"
                placeholder="admin@mff.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-400">{t('password')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-500" />
              </div>
              <input
                type="password"
                required
                className="w-full ps-11 pe-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-500 transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button
            type="submit"
            id="btn-login-submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('loggingIn') || 'جاري تسجيل الدخول...'}</span>
              </>
            ) : (
              <span>{t('signIn') || 'Sign In'}</span>
            )}
          </button>
        </form>
      </div>
      
      <p className="text-slate-500 text-sm mt-8 max-w-sm text-center">
        Copyright © 2026 Developed by Mahmoud Alkhateeb.
      </p>
    </div>
  );
}
