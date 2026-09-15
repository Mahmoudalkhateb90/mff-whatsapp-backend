import React, { useState } from 'react';
import { Smartphone, LogOut, KeyRound } from 'lucide-react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

const getSessionUser = () => { try { return JSON.parse(localStorage.getItem('user_session') || '{}'); } catch { return {}; } };

interface NavbarProps {
  userRole: string;
}

export default function Navbar({ userRole }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { language, setLanguage, t } = useLanguage();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleLogout = async () => {
    localStorage.removeItem('user_session');
    window.location.href = '/login';
    navigate('/login');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (!getSessionUser().id) return;
    try {
      alert('Password update not supported in direct API mode yet');
      setPasswordSuccess(t('passwordSuccess'));
      setTimeout(() => setShowPasswordModal(false), 2000);
    } catch (error: any) {
      setPasswordError(error.message || t('passwordError'));
    }
  };

  const navLinks = [
    { key: 'navSession', name: t('navSession'), path: '/', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { key: 'navSingleMessage', name: t('navSingleMessage'), path: '/single', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { key: 'navBulkBroadcast', name: t('navBulkBroadcast'), path: '/bulk', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
    { key: 'navUserManagement', name: t('navUserManagement'), path: '/admin/users', roles: ['Super Admin'] },
    { key: 'navReports', name: t('navReports'), path: '/reports', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
  ];

  return (
    <>
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-4 rtl:ml-4 rtl:mr-0">
                <div className="bg-emerald-500/10 p-1.5 rounded-lg border border-emerald-500/20">
                  <Smartphone className="w-6 h-6 text-emerald-400" />
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

            <div className="flex items-center gap-3">
              {/* Language Switcher Toggle */}
              <div className="flex items-center bg-slate-800/80 rounded-lg p-1 border border-slate-700">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                    language === 'en'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="English"
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('ar')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                    language === 'ar'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="العربية"
                >
                  AR
                </button>
              </div>

              <div className="flex items-center gap-3 border-l border-slate-800 pl-3 md:pl-4 rtl:border-r rtl:border-l-0 rtl:pr-3 rtl:pl-0">
                <div className="flex flex-col items-end rtl:items-start">
                  <span className="text-sm font-semibold text-slate-200">
                    {getSessionUser().name || getSessionUser().email || 'User'}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {userRole}
                  </span>
                </div>
                
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors border border-transparent hover:border-slate-700"
                  title={t('changePassword')}
                >
                  <KeyRound className="w-5 h-5" />
                </button>

                <button
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                  title={t('logout')}
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
            <h2 className="text-xl font-bold text-white mb-4">{t('changePassword')}</h2>
            {passwordError && <div className="mb-4 text-rose-400 text-sm">{passwordError}</div>}
            {passwordSuccess && <div className="mb-4 text-emerald-400 text-sm">{passwordSuccess}</div>}
            <form onSubmit={handleChangePassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-1">{t('newPassword')}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-emerald-500"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  {t('confirmReset')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
