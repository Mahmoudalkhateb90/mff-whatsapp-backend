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

function PrivateRoute({ children, allowedRoles }: { children: ReactNode, allowedRoles?: string[] }) {
  const sessionStr = localStorage.getItem('user_session');
  const currentUser = sessionStr ? JSON.parse(sessionStr) : null;
  const userRole = currentUser?.role || null;

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
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
        
        {/* Single Messaging - All Roles */}
        <Route 
          path="/single" 
          element={
            <PrivateRoute allowedRoles={['Super Admin', 'Department Manager', 'Team Leader', 'Agent']}>
              <SingleMessage />
            </PrivateRoute>
          } 
        />
        
        {/* Bulk Broadcast Campaign - Super Admin, Manager, Team Leader */}
        <Route 
          path="/bulk" 
          element={
            <PrivateRoute allowedRoles={['Super Admin', 'Department Manager', 'Team Leader']}>
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
        
        {/* Team Reports & Audit Logs - Super Admin, Manager, Team Leader */}
        <Route 
          path="/reports" 
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
