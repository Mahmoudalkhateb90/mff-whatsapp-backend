/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { API_BASE_URL } from './config';
import { Loader2 } from 'lucide-react';
import { SessionProvider } from './context/SessionContext';
import { LanguageProvider } from './context/LanguageContext';

import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import Navbar from './components/Navbar';
import SingleMessage from './components/SingleMessage';
import BulkBroadcast from './components/BulkBroadcast';
import Reports from './components/Reports';

const getSessionUser = () => {
  try {
    const session = localStorage.getItem('user_session');
    return session ? JSON.parse(session) : null;
  } catch {
    return null;
  }
};

function PrivateRoute({ 
  children, 
  allowedRoles,
  requiredPermission
}: { 
  children: ReactNode; 
  allowedRoles?: string[];
  requiredPermission?: 'canSendSingle' | 'canSendBulk';
}) {
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<{ canSendSingle?: boolean; canSendBulk?: boolean } | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const sessionUser = getSessionUser();
    setUser(sessionUser);
    if (sessionUser) {
      setUserRole(sessionUser.role);
      setPermissions(sessionUser.permissions || {
        canSendSingle: sessionUser.role === 'Super Admin' ? true : true,
        canSendBulk: sessionUser.role === 'Super Admin'
      });
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isSuper = userRole === 'Super Admin';

  if (!isSuper) {
    if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
      return <Navigate to="/" replace />;
    }

    if (requiredPermission === 'canSendSingle' && permissions?.canSendSingle === false) {
      return <Navigate to="/" replace />;
    }

    if (requiredPermission === 'canSendBulk' && !permissions?.canSendBulk) {
      return <Navigate to="/" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col font-sans">
      <Navbar userRole={userRole || 'Agent'} permissions={permissions || undefined} />
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
  return (
    <LanguageProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            {/* WhatsApp Session (QR Code) - All Roles */}
            <Route 
              path="/" 
              element={
                <PrivateRoute allowedRoles={['Super Admin', 'Department Manager', 'Team Leader', 'Agent']}>
                  <Dashboard />
                </PrivateRoute>
              } 
            />
          
            {/* Single Messaging - Enforces canSendSingle Permission */}
            <Route 
              path="/single" 
              element={
                <PrivateRoute 
                  allowedRoles={['Super Admin', 'Department Manager', 'Team Leader', 'Agent']}
                  requiredPermission="canSendSingle"
                >
                  <SingleMessage />
                </PrivateRoute>
              } 
            />
            
            {/* Bulk Broadcast Campaign - Enforces canSendBulk Permission */}
            <Route 
              path="/bulk" 
              element={
                <PrivateRoute 
                  allowedRoles={['Super Admin', 'Department Manager', 'Team Leader', 'Agent']}
                  requiredPermission="canSendBulk"
                >
                  <BulkBroadcast />
                </PrivateRoute>
              } 
            />
          
          {/* User Management - Super Admin Only */}
          <Route 
            path="/admin/users" 
            element={
              <PrivateRoute allowedRoles={['Super Admin']}>
                <AdminPanel />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/users" 
            element={
              <PrivateRoute allowedRoles={['Super Admin']}>
                <AdminPanel />
              </PrivateRoute>
            } 
          />
          
          {/* Team Reports & Audit Logs - Super Admin, Manager, Team Leader */}
          <Route 
            path="/reports" 
            element={
              <PrivateRoute allowedRoles={['Super Admin', 'Department Manager', 'Team Leader']}>
                <Reports />
              </PrivateRoute>
            } 
          />
          <Route 
            path="/analytics" 
            element={
              <PrivateRoute allowedRoles={['Super Admin', 'Department Manager', 'Team Leader']}>
                <Reports />
              </PrivateRoute>
            } 
          />
        </Routes>
      </BrowserRouter>
      </SessionProvider>
    </LanguageProvider>
  );
}
