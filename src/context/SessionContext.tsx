import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../config';

interface SessionContextType {
  status: string;
  qrBase64: string | null;
  phone: string | null;
  loading: boolean;
  actionLoading: 'start' | 'disconnect' | null;
  startSession: () => Promise<void>;
  disconnectSession: () => Promise<void>;
  resetSession: () => Promise<void>;
  logoutSession: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'disconnect' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = () => {
      try {
        const session = localStorage.getItem('user_session');
        if (session) {
          const user = JSON.parse(session);
          setUserId(user.id);
        } else {
          setUserId(null);
        }
      } catch (err) {
        setUserId(null);
      }
    };
    
    checkSession();
    window.addEventListener('storage', checkSession);
    return () => window.removeEventListener('storage', checkSession);
  }, []);

  const checkStatus = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/session/status`, {
        headers: { 'x-user-id': userId }
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status || 'disconnected');
        if (data.phone) {
          setPhone(data.phone);
        }
        if (data.qr) {
          setQrBase64(data.qr);
        } else if (data.status === 'connected' || data.status === 'disconnected') {
          setQrBase64(null);
        }
      }
    } catch (err) {
      console.warn('Failed to get status', err);
    }
  };

  useEffect(() => {
    if (userId) {
      checkStatus();
      const interval = setInterval(checkStatus, 2500);
      return () => clearInterval(interval);
    }
  }, [userId]);

  /**
   * POST /api/session/start
   * Triggers a fresh Baileys socket initialization strictly for this user and gets a new QR code immediately.
   */
  const startSession = async () => {
    if (!userId) return;
    setLoading(true);
    setActionLoading('start');
    setQrBase64(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/session/start`, {
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
        setStatus('qr');
      } else if (data.status) {
        setStatus(data.status);
      }
      if (data.phone) {
        setPhone(data.phone);
      }
    } catch (err) {
      console.error('[SessionContext] startSession error:', err);
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
    if (!userId) return;
    setLoading(true);
    setActionLoading('disconnect');
    try {
      await fetch(`${API_BASE_URL}/api/session/disconnect`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ userId })
      });
      setStatus('disconnected');
      setQrBase64(null);
      setPhone(null);
    } catch (err) {
      console.error('[SessionContext] disconnectSession error:', err);
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
