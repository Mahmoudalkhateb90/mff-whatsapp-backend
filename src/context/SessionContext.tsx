import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';

interface SessionContextType {
  status: string;
  qrBase64: string | null;
  phone: string | null;
  loading: boolean;
  actionLoading: 'start' | 'disconnect' | null;
  startSession: (explicitUserId?: string) => Promise<void>;
  disconnectSession: () => Promise<void>;
  resetSession: () => Promise<void>;
  logoutSession: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

const getStoredUserId = (): string | null => {
  try {
    const session = localStorage.getItem('user_session');
    if (session) {
      const user = JSON.parse(session);
      if (user?.id) return String(user.id);
    }
    const direct = localStorage.getItem('user_id');
    if (direct) return String(direct);
  } catch {
    return null;
  }
  return null;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'disconnect' | null>(null);
  const [userId, setUserId] = useState<string | null>(() => getStoredUserId());
  
  const toast = useToast();
  const { language, t } = useLanguage();
  const isAr = language === 'ar';

  const syncUserId = useCallback(() => {
    const currentId = getStoredUserId();
    if (currentId) {
      setUserId(currentId);
    }
    return currentId;
  }, []);

  useEffect(() => {
    const handleAuthEvent = () => {
      const activeId = syncUserId();
      if (activeId) {
        checkStatus();
      }
    };

    syncUserId();
    window.addEventListener('storage', handleAuthEvent);
    window.addEventListener('auth-change', handleAuthEvent);
    return () => {
      window.removeEventListener('storage', handleAuthEvent);
      window.removeEventListener('auth-change', handleAuthEvent);
    };
  }, [syncUserId]);

  const checkStatus = async () => {
    const activeId = userId || syncUserId() || getStoredUserId();
    if (!activeId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/session/status`, {
        headers: { 
          'x-user-id': activeId,
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || activeId}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        // If actively starting a session and server is still initializing, don't wipe pending state
        if (actionLoading === 'start' && data.status === 'disconnected' && !data.qr) {
          return;
        }

        setStatus(data.status || 'disconnected');
        if (data.phone) {
          setPhone(data.phone);
        }
        if (data.qr) {
          setQrBase64(data.qr);
        } else if (data.status === 'connected' || (data.status === 'disconnected' && actionLoading !== 'start')) {
          setQrBase64(null);
        }
      }
    } catch (err) {
      console.warn('[SessionContext] Failed to get status', err);
    }
  };

  useEffect(() => {
    const activeId = userId || getStoredUserId();
    if (activeId) {
      checkStatus();
      const interval = setInterval(checkStatus, 2500);
      return () => clearInterval(interval);
    }
  }, [userId]);

  /**
   * POST /api/session/start
   * Triggers Baileys socket initialization. Guaranteed 1st-click instant execution with localStorage fallback.
   */
  const startSession = async (explicitUserId?: string) => {
    const targetUserId = explicitUserId || userId || syncUserId() || getStoredUserId();
    
    if (!targetUserId) {
      const errorMsg = isAr 
        ? '[Error: 400] لم يتم العثور على المعرف - يرجى إعادة تسجيل الدخول'
        : '[Error: 400] User identity not found. Please log in again.';
      toast.error(errorMsg, {
        status: 400,
        url: `${API_BASE_URL}/api/session/start`,
        message: 'No valid user ID available in localStorage or state. Re-login required.',
        actionName: 'WhatsApp QR Initialization'
      });
      return;
    }

    setUserId(targetUserId);
    setLoading(true);
    setActionLoading('start');
    setQrBase64(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/session/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': targetUserId,
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || targetUserId}`
        },
        body: JSON.stringify({ userId: targetUserId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server Error: ${res.status}`;
        toast.error(`[Error: ${res.status}] ${errorMsg}`, {
          status: res.status,
          url: `${API_BASE_URL}/api/session/start`,
          message: errorMsg,
          rawError: errorData,
          actionName: 'WhatsApp QR Generation'
        });
        return;
      }

      const data = await res.json();
      if (data.qr) {
        setQrBase64(data.qr);
        setStatus('qr');
        toast.info(
          isAr 
            ? 'تم إنشاء رمز الـ QR بنجاح. يرجى مسحه باستخدام واتساب.'
            : 'QR code generated successfully. Please scan with WhatsApp.'
        );
      } else if (data.status) {
        setStatus(data.status);
      }
      if (data.phone) {
        setPhone(data.phone);
      }
    } catch (err: any) {
      console.error('[SessionContext] startSession error:', err);
      toast.error(
        `[Network Error] ${err.message || 'Failed to connect to server'}`,
        {
          status: 0,
          url: `${API_BASE_URL}/api/session/start`,
          message: err.message || 'Network connection failure',
          rawError: err,
          actionName: 'WhatsApp QR Generation'
        }
      );
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  /**
   * POST /api/session/disconnect
   * Closes user's socket, wipes their auth storage, and sets status to disconnected.
   */
  const disconnectSession = async () => {
    const targetUserId = userId || syncUserId() || getStoredUserId();
    if (!targetUserId) return;
    
    setLoading(true);
    setActionLoading('disconnect');

    try {
      const res = await fetch(`${API_BASE_URL}/api/session/disconnect`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': targetUserId,
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || targetUserId}`
        },
        body: JSON.stringify({ userId: targetUserId })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        toast.error(`[Error: ${res.status}] ${errorData.error || 'Failed to disconnect session'}`, {
          status: res.status,
          url: `${API_BASE_URL}/api/session/disconnect`,
          message: errorData.error || 'Disconnection failed',
          rawError: errorData,
          actionName: 'WhatsApp Session Disconnect'
        });
      } else {
        toast.info(isAr ? 'تم قطع اتصال جلسة واتساب بنجاح' : 'WhatsApp session disconnected.');
      }

      setStatus('disconnected');
      setQrBase64(null);
      setPhone(null);
    } catch (err: any) {
      console.error('[SessionContext] disconnectSession error:', err);
      toast.error(`[Network Error] ${err.message || 'Disconnection failed'}`, {
        status: 0,
        url: `${API_BASE_URL}/api/session/disconnect`,
        message: err.message,
        rawError: err,
        actionName: 'WhatsApp Session Disconnect'
      });
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  const resetSession = disconnectSession;
  const logoutSession = disconnectSession;

  return (
    <SessionContext.Provider value={{ 
      status, 
      qrBase64, 
      phone,
      loading, 
      actionLoading,
      startSession, 
      disconnectSession,
      logoutSession, 
      resetSession, 
      checkStatus 
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
