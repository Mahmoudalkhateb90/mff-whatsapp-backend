import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from '../config';

interface SessionContextType {
  status: string;
  qrBase64: string | null;
  loading: boolean;
  startSession: () => Promise<void>;
  logoutSession: () => Promise<void>;
  resetSession: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<string>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    // Optional: listen to storage events to sync across tabs
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
        setStatus(data.status);
        if (data.qr) {
          setQrBase64(data.qr);
        } else {
          setQrBase64(null);
        }
      }
    } catch (err) {
      console.error('Failed to get status', err);
    }
  };

  useEffect(() => {
    if (userId) {
      checkStatus();
      const interval = setInterval(checkStatus, 3000);
      return () => clearInterval(interval);
    }
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
        setStatus('qr');
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
      await fetch(`${API_BASE_URL}/api/session/reset`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId
        }
      });
      setStatus('disconnected');
      setQrBase64(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = async () => {
    if (!userId) return;
    await logoutSession();
    await startSession();
  };

  return (
    <SessionContext.Provider value={{ status, qrBase64, loading, startSession, logoutSession, resetSession, checkStatus }}>
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
