import React, { useState } from 'react';
import { Smartphone, LogOut, KeyRound } from 'lucide-react';
import { signOut, updatePassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate, Link, useLocation } from 'react-router-dom';

interface NavbarProps {
  userRole: string;
}

export default function Navbar({ userRole }: NavbarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const handleLogout = async () => {
    await signOut(auth);
    navigate('/login');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (!auth.currentUser) return;
    try {
      await updatePassword(auth.currentUser, newPassword);
      setPasswordSuccess('Password updated successfully');
      setTimeout(() => setShowPasswordModal(false), 2000);
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to update password');
    }
  };

  const navLinks = [
    { name: 'WhatsApp Session', path: '/', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { name: 'Single Messaging', path: '/single', roles: ['Super Admin', 'Department Manager', 'Team Leader', 'Agent'] },
    { name: 'Bulk Broadcast', path: '/bulk', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
    { name: 'User Management', path: '/admin/users', roles: ['Super Admin'] },
    { name: 'Reports & Logs', path: '/reports', roles: ['Super Admin', 'Department Manager', 'Team Leader'] },
  ];

  return (
    <>
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity mr-4">
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

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border-l border-slate-800 pl-4 md:pl-6">
                <div className="flex flex-col items-end">
                  <span className="text-sm font-semibold text-slate-200">
                    {auth.currentUser?.displayName || auth.currentUser?.email || 'User'}
                  </span>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {userRole}
                  </span>
                </div>
                
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors border border-transparent hover:border-slate-700"
                  title="Change Password"
                >
                  <KeyRound className="w-5 h-5" />
                </button>

                <button
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg transition-colors border border-transparent hover:border-rose-500/20"
                  title="Logout"
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
            <h2 className="text-xl font-bold text-white mb-4">Change Password</h2>
            {passwordError && <div className="mb-4 text-rose-400 text-sm">{passwordError}</div>}
            {passwordSuccess && <div className="mb-4 text-emerald-400 text-sm">{passwordSuccess}</div>}
            <form onSubmit={handleChangePassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-400 mb-1">New Password</label>
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
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
