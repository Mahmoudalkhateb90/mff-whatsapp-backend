/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { API_BASE_URL } from './config';
import { Loader2 } from 'lucide-react';

import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import Navbar from './components/Navbar';

function PrivateRoute({ children, roleRequired }: { children: ReactNode, roleRequired?: string }) {
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    if (auth.currentUser) {
      fetch(`${API_BASE_URL}/api/users/me`, {
        headers: { 'x-user-id': auth.currentUser.uid }
      })
      .then(res => res.json())
      .then(data => {
        setUserRole(data.role);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!auth.currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (roleRequired && userRole !== roleRequired) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans">
      <Navbar userRole={userRole || 'Agent'} />
      <main className="flex-grow p-6 lg:p-10 flex flex-col">
        {children}
      </main>
      <footer className="py-6 text-center text-slate-500 text-sm border-t border-slate-800 bg-slate-900/50">
        Copyright © 2026 Developed by Mahmoud Alkhateeb.
      </footer>
    </div>
  );
}

export default function App() {
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/" 
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/admin/users" 
          element={
            <PrivateRoute roleRequired="Super Admin">
              <AdminPanel />
            </PrivateRoute>
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}
