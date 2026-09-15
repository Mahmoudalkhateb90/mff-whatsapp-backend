import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../config';

interface SessionContextType {
  status: string;
  qrBase64: string | null;
  loading: boolean;
  actionLoading: 'start' | 'reconnect' | 'reset' | null;
  hasSavedSession: boolean;
  startSession: () => Promise<void>;
  reconnectSession: () => Promise<void>;
  logoutSession: () => Promise<void>;
  resetSession: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'reconnect' | 'reset' | null>(null);
  const [hasSavedSession, setHasSavedSession] = useState<boolean>(false);
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
        setHasSavedSession(!!data.hasSavedSession);
        if (data.qr) {
          setQrBase64(data.qr);
        } else if (data.status === 'connected' || data.status === 'disconnected' || data.status === 'idle') {
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
      const interval = setInterval(checkStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [userId]);

  /**
   * POST /api/session/start
   * Triggers a fresh Baileys socket initialization and gets a new QR code immediately.
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
    } catch (err) {
      console.error('[SessionContext] startSession error:', err);
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  /**
   * POST /api/session/reconnect
   * Manually attempts ONE-TIME reconnection using saved auth files.
   * If it fails, falls back to disconnected and outputs a fresh QR code.
   */
  const reconnectSession = async () => {
    if (!userId) return;
    setLoading(true);
    setActionLoading('reconnect');
    try {
      const res = await fetch(`${API_BASE_URL}/api/session/reconnect`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (data.status === 'connected') {
        setStatus('connected');
        setQrBase64(null);
      } else if (data.qr) {
        setStatus('qr');
        setQrBase64(data.qr);
      } else if (data.status) {
        setStatus(data.status);
      }
    } catch (err) {
      console.error('[SessionContext] reconnectSession error:', err);
      setStatus('disconnected');
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  /**
   * POST /api/session/reset
   * Completely deletes local auth folders and resets socket state to IDLE.
   */
  const resetSession = async () => {
    if (!userId) return;
    setLoading(true);
    setActionLoading('reset');
    try {
      await fetch(`${API_BASE_URL}/api/session/reset`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({ userId })
      });
      setStatus('idle');
      setQrBase64(null);
      setHasSavedSession(false);
    } catch (err) {
      console.error('[SessionContext] resetSession error:', err);
    } finally {
      setLoading(false);
      setActionLoading(null);
    }
  };

  const logoutSession = resetSession;

  return (
    <SessionContext.Provider value={{ 
      status, 
      qrBase64, 
      loading, 
      actionLoading,
      hasSavedSession, 
      startSession, 
      reconnectSession, 
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
