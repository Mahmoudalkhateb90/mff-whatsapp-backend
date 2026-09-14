import React, { useState } from 'react';
import { LogOut, KeyRound, Eye, EyeOff, MessageCircle, Globe } from 'lucide-react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { API_BASE_URL } from '../config';

interface NavbarProps {
  userRole: string;
}

export default function Navbar({ userRole }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, t } = useLanguage();
  
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const sessionStr = localStorage.getItem('user_session');
  const currentUser = sessionStr ? JSON.parse(sessionStr) : null;

  const handleLogout = () => {
    localStorage.removeItem('user_session');
    navigate('/login');
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    
    if (!currentUser) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/me/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({ password: newPassword })
      });
      
      if (!res.ok) {
        throw new Error('Failed to update password');
      }

      setPasswordSuccess(t('passwordUpdated', 'Password updated successfully'));
      setTimeout(() => setShowPasswordModal(false), 2000);
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to update password');
    }
  };

  const navLinks = [
    { name: t('whatsappSession', 'WhatsApp Session'), path: '/', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { name: t('singleMessaging', 'Single Messaging'), path: '/single', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { name: t('bulkBroadcast', 'Bulk Broadcast'), path: '/bulk', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
    { name: t('userManagement', 'User Management'), path: '/admin/users', roles: ['Super Admin'] },
    { name: t('reportsAndLogs', 'Reports & Logs'), path: '/reports', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
  ];

  return (
    <>
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity ltr:mr-4 rtl:ml-4">
                <div className="bg-emerald-500/10 p-1.5 rounded-lg border border-emerald-500/20">
                  <MessageCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <span className="text-xl font-bold tracking-tight text-white hidden md:block">MFF WhatsApp</span>
              </Link>
              <div className="hidden lg:flex items-center gap-1">
                {navLinks.map((link) => {
                  if (!link.roles.includes(userRole)) return null;
                  const isActive = location.pathname === link.path;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive 
                          ? 'bg-slate-800 text-white border border-slate-700' 
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      {link.name}
                    </Link>
                  );
                })}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border-slate-800 ltr:border-l ltr:pl-4 md:ltr:pl-6 rtl:border-r rtl:pr-4 md:rtl:pr-6">
                
                <button
                  onClick={toggleLanguage}
                  className="p-2 flex items-center gap-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors border border-transparent hover:border-slate-700"
                  title="Switch Language"
                >
                  <Globe className="w-5 h-5" />
                  <span className="text-sm font-medium hidden sm:block uppercase">{language === 'en' ? 'العربية' : 'EN'}</span>
                </button>

                <div className="flex flex-col items-end">
                  <span className="text-sm font-semibold text-slate-200">
                    {currentUser?.displayName || currentUser?.email || 'User'}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {userRole}
                  </span>
                </div>
                
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors border border-transparent hover:border-slate-700"
                  title={t('changePassword', 'Change Password')}
                >
                  <KeyRound className="w-5 h-5" />
                </button>
                <button
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                  title={t('logout', 'Logout')}
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile nav links */}
      <div className="lg:hidden bg-slate-900 border-b border-slate-800 overflow-x-auto">
        <div className="flex p-2 gap-2 max-w-7xl mx-auto">
          {navLinks.map((link) => {
            if (!link.roles.includes(userRole)) return null;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-slate-800 text-white border border-slate-700' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                {link.name}
              </Link>
            );
          })}
        </div>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-white mb-4">{t('changePassword', 'Change Password')}</h2>
            
            {passwordError && <div className="mb-4 text-rose-400 text-sm">{passwordError}</div>}
            {passwordSuccess && <div className="mb-4 text-emerald-400 text-sm">{passwordSuccess}</div>}
            
            <form onSubmit={handleChangePassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('currentPassword', 'Current Password')}</label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500 ltr:pr-10 rtl:pl-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute inset-y-0 end-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 ltr:right-0 rtl:left-0 ltr:pr-3 rtl:pl-3"
                  >
                    {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('newPassword', 'New Password')}</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500 ltr:pr-10 rtl:pl-10"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute inset-y-0 end-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 ltr:right-0 rtl:left-0 ltr:pr-3 rtl:pl-3"
                  >
                    {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                >
                  {t('cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  {t('updatePassword', 'Update Password')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
