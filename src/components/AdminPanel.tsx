import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { auth } from '../firebase';
import { API_BASE_URL } from '../config';
import { Users, UserPlus, Key, Loader2, ShieldCheck, Trash2, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  department?: string;
  createdAt?: any;
}

export default function AdminPanel() {
  const { t } = useLanguage();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Agent');
  const [newDepartment, setNewDepartment] = useState('');
  const [creating, setCreating] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Reset Password Modal
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const getAuthHeaders = () => {
    return {
      'x-user-id': auth.currentUser?.uid || auth.currentUser?.email || '',
      'x-user-email': auth.currentUser?.email || '',
      'x-user-role': auth.currentUser?.email === 'mahmoud.alkhateeb@money.jo' ? 'Super Admin' : ''
    };
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/users`, {
        headers: { ...getAuthHeaders() }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ email: newEmail, password: newPassword, displayName: newName, role: newRole, department: newDepartment })
      });
      if (res.ok) {
        setNewEmail('');
        setNewPassword('');
        setNewName('');
        setNewRole('Agent');
        setNewDepartment('');
        fetchUsers();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resettingUser) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${resettingUser.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password: resetPassword })
      });
      if (res.ok) {
        alert('Password reset successfully');
        setResettingUser(null);
        setResetPassword('');
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to deactivate/delete this user?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() }
      });
      if (res.ok) {
        fetchUsers();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Create User Form */}
      <div className="lg:col-span-1">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden sticky top-6">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center gap-3">
            <UserPlus className="text-emerald-500 w-6 h-6" />
            <h3 className="text-lg font-bold text-white">{t('createUser')}</h3>
          </div>
          <form onSubmit={handleCreateUser} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('displayName')}</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('email')}</label>
              <input
                type="email"
                required
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('password')}</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  className="w-full px-3 py-2 rtl:pl-10 ltr:pr-10 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute rtl:left-2 ltr:right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-300 transition-colors"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('department')}</label>
              <input
                type="text"
                required
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('role')}</label>
              <select
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="Super Admin">Super Admin</option>
                <option value="Department Manager">Department Manager</option>
                <option value="Team Leader">Team Leader</option>
                <option value="Agent">Agent</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : t('addUser')}
            </button>
          </form>
        </div>
      </div>

      {/* Users List */}
      <div className="lg:col-span-2">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="text-emerald-500 w-6 h-6" />
              <h3 className="text-lg font-bold text-white">User Directory</h3>
            </div>
          </div>
          
          <div className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
              </div>
            ) : (
              <table className="w-full text-left rtl:text-right border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-slate-700">
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('email')}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('department')}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('role')}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center ltr:text-right rtl:text-left">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-200">{user.displayName}</span>
                          <span className="text-sm text-slate-500">{user.email}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="text-sm text-slate-300">{user.department || 'N/A'}</span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          user.role === 'Super Admin' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                          user.role === 'Agent' ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' : 
                          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {user.role === 'Super Admin' && <ShieldCheck className="w-3.5 h-3.5" />}
                          {user.role}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setResettingUser(user)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
                            title="Reset Password"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-semibold transition-colors border border-transparent hover:border-rose-500/20"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Reset Password Modal */}
      {resettingUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6">
              <h3 className="text-lg font-bold text-white mb-2">{t('changePassword')}</h3>
              <p className="text-sm text-slate-400 mb-6">Enter a new password for <span className="font-semibold text-slate-200">{resettingUser.email}</span></p>
              
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    required
                    placeholder={t('newPassword')}
                    className="w-full px-4 py-2.5 rtl:pl-12 ltr:pr-12 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    className="absolute rtl:left-3 ltr:right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    {showResetPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => { setResettingUser(null); setResetPassword(''); setShowResetPassword(false); }}
                    className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-semibold transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-rose-900/20"
                  >
                    {t('confirmReset')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
