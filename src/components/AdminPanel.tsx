import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { API_BASE_URL } from '../config';
import { 
  Users, 
  UserPlus, 
  Key, 
  Loader2, 
  ShieldCheck, 
  Trash2, 
  Eye, 
  EyeOff, 
  UserCheck, 
  Pencil, 
  CheckCircle2, 
  XCircle,
  Sliders
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';

const getSessionUser = () => { 
  try { 
    return JSON.parse(localStorage.getItem('user_session') || '{}'); 
  } catch { 
    return {}; 
  } 
};

interface UserPermissions {
  canSendSingle: boolean;
  canSendBulk: boolean;
}

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  department?: string;
  teamLeaderId?: string;
  teamLeaderName?: string;
  permissions?: UserPermissions;
  createdAt?: any;
}

export default function AdminPanel() {
  const { t, language } = useLanguage();
  const toast = useToast();
  const isAr = language === 'ar';
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Agent');
  const [newDepartment, setNewDepartment] = useState('');
  const [newTeamLeaderId, setNewTeamLeaderId] = useState('');
  const [newCanSendSingle, setNewCanSendSingle] = useState(true);
  const [newCanSendBulk, setNewCanSendBulk] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Edit User / Permissions Modal State
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editRole, setEditRole] = useState('Agent');
  const [editTeamLeaderId, setEditTeamLeaderId] = useState('');
  const [editCanSendSingle, setEditCanSendSingle] = useState(true);
  const [editCanSendBulk, setEditCanSendBulk] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Reset Password Modal State
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const getAuthHeaders = () => {
    const user = getSessionUser();
    return {
      'x-user-id': user.id || user.email || 'system_super_admin',
      'x-user-email': user.email || 'mahmoud.alkhateeb@money.jo',
      'x-user-role': user.role || 'Super Admin',
      'Authorization': `Bearer ${localStorage.getItem('auth_token') || user.id || ''}`
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
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = (role: string) => {
    setNewRole(role);
    if (role === 'Super Admin') {
      setNewCanSendSingle(true);
      setNewCanSendBulk(true);
    } else if (role === 'Department Manager' || role === 'Team Leader') {
      setNewCanSendSingle(true);
      setNewCanSendBulk(true);
    } else {
      setNewCanSendSingle(true);
      setNewCanSendBulk(false);
    }
  };

  const handleEditRoleChange = (role: string) => {
    setEditRole(role);
    if (role === 'Super Admin') {
      setEditCanSendSingle(true);
      setEditCanSendBulk(true);
    }
  };

  // Filter team leaders for assignment
  const teamLeaders = users.filter(u => u.role === 'Team Leader' || u.role === 'Department Manager');

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setErrorMsg('');
    setSuccessMsg('');

    const assignedLeader = teamLeaders.find(l => l.id === newTeamLeaderId);

    try {
      const res = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          displayName: newName.trim(),
          role: newRole,
          department: newDepartment.trim(),
          teamLeaderId: newRole === 'Agent' ? newTeamLeaderId : undefined,
          teamLeaderName: newRole === 'Agent' && assignedLeader ? assignedLeader.displayName : undefined,
          permissions: {
            canSendSingle: newRole === 'Super Admin' ? true : newCanSendSingle,
            canSendBulk: newRole === 'Super Admin' ? true : newCanSendBulk
          }
        })
      });

      if (res.ok) {
        setNewEmail('');
        setNewPassword('');
        setNewName('');
        setNewRole('Agent');
        setNewDepartment('');
        setNewTeamLeaderId('');
        setNewCanSendSingle(true);
        setNewCanSendBulk(false);
        const createdMsg = t('userCreated') || 'User created successfully';
        setSuccessMsg(createdMsg);
        toast.success(createdMsg);
        fetchUsers();
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to create user' }));
        const errMsg = errData.error || `Server Error: ${res.status}`;
        const fullErr = `[Error: ${res.status}] ${errMsg}`;
        setErrorMsg(fullErr);
        toast.error(fullErr, {
          status: res.status,
          url: `${API_BASE_URL}/api/users`,
          message: errMsg,
          rawError: errData,
          actionName: 'Create User'
        });
      }
    } catch (err: any) {
      const netErr = `[Network Error] ${err.message || 'Error creating user'}`;
      setErrorMsg(netErr);
      toast.error(netErr, {
        status: 0,
        url: `${API_BASE_URL}/api/users`,
        message: err.message,
        rawError: err,
        actionName: 'Create User'
      });
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setEditName(user.displayName || '');
    setEditDepartment(user.department || '');
    setEditRole(user.role || 'Agent');
    setEditTeamLeaderId(user.teamLeaderId || '');
    setEditCanSendSingle(user.permissions?.canSendSingle !== false);
    setEditCanSendBulk(user.permissions?.canSendBulk === true || user.role === 'Super Admin');
    setEditError('');
  };

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser || savingEdit) return;
    setSavingEdit(true);
    setEditError('');

    const assignedLeader = teamLeaders.find(l => l.id === editTeamLeaderId);

    try {
      const isSuper = editRole === 'Super Admin';
      const perms = {
        canSendSingle: isSuper ? true : editCanSendSingle,
        canSendBulk: isSuper ? true : editCanSendBulk
      };

      const res = await fetch(`${API_BASE_URL}/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          displayName: editName.trim(),
          department: editDepartment.trim(),
          role: editRole,
          teamLeaderId: editRole === 'Agent' ? editTeamLeaderId : null,
          teamLeaderName: editRole === 'Agent' && assignedLeader ? assignedLeader.displayName : '',
          permissions: perms
        })
      });

      if (res.ok) {
        // Update local session if currently logged in as this user
        const currentSession = getSessionUser();
        if (currentSession.id === editingUser.id || currentSession.email === editingUser.email) {
          currentSession.name = editName.trim();
          currentSession.role = editRole;
          currentSession.department = editDepartment.trim();
          currentSession.permissions = perms;
          localStorage.setItem('user_session', JSON.stringify(currentSession));
        }

        setEditingUser(null);
        toast.success(t('userUpdated') || 'User updated successfully');
        fetchUsers();
      } else {
        const errData = await res.json().catch(() => ({ error: 'Failed to update user' }));
        const errMsg = errData.error || `Server Error: ${res.status}`;
        const fullErr = `[Error: ${res.status}] ${errMsg}`;
        setEditError(fullErr);
        toast.error(fullErr, {
          status: res.status,
          url: `${API_BASE_URL}/api/users/${editingUser.id}`,
          message: errMsg,
          rawError: errData,
          actionName: 'Update User'
        });
      }
    } catch (err: any) {
      const netErr = `[Network Error] ${err.message || 'Error updating user'}`;
      setEditError(netErr);
      toast.error(netErr, {
        status: 0,
        url: `${API_BASE_URL}/api/users/${editingUser.id}`,
        message: err.message,
        rawError: err,
        actionName: 'Update User'
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resettingUser || resettingPassword) return;
    setResettingPassword(true);
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
        toast.success(t('passwordSuccess') || 'Password updated successfully');
        setResettingUser(null);
        setResetPassword('');
      } else {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.error || t('passwordError') || 'Failed to update password';
        toast.error(`[Error: ${res.status}] ${errMsg}`, {
          status: res.status,
          url: `${API_BASE_URL}/api/users/${resettingUser.id}/reset-password`,
          message: errMsg,
          rawError: err,
          actionName: 'Reset User Password'
        });
      }
    } catch (err: any) {
      toast.error(`[Network Error] ${err.message}`, {
        status: 0,
        message: err.message,
        actionName: 'Reset User Password'
      });
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(t('confirmDelete'))) return;
    setDeletingId(userId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { ...getAuthHeaders() }
      });
      if (res.ok) {
        toast.success(isAr ? 'تم حذف المستخدم بنجاح' : 'User deleted successfully');
        fetchUsers();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(`[Error: ${res.status}] ${err.error || 'Failed to delete user'}`, {
          status: res.status,
          url: `${API_BASE_URL}/api/users/${userId}`,
          message: err.error,
          rawError: err,
          actionName: 'Delete User'
        });
      }
    } catch (err: any) {
      toast.error(`[Network Error] ${err.message || 'Error deleting user'}`, {
        status: 0,
        message: err.message,
        actionName: 'Delete User'
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create User Form */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-700">
            <div className="flex items-center gap-3 mb-6">
              <UserPlus className="text-emerald-500 w-6 h-6" />
              <h3 className="text-lg font-bold text-white">{t('createUser')}</h3>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-400">
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
                {successMsg}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
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
                  onChange={(e) => handleRoleChange(e.target.value)}
                >
                  <option value="Super Admin">{t('superAdmin')}</option>
                  <option value="Department Manager">{t('deptManager')}</option>
                  <option value="Team Leader">{t('teamLeader')}</option>
                  <option value="Agent">{t('agent')}</option>
                </select>
              </div>

              {/* Team Leader Assignment (shown when creating an Agent) */}
              {newRole === 'Agent' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">{t('assignTeamLeader')}</label>
                  <select
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                    value={newTeamLeaderId}
                    onChange={(e) => setNewTeamLeaderId(e.target.value)}
                  >
                    <option value="">{t('selectTeamLeader')}</option>
                    {teamLeaders.map((leader) => (
                      <option key={leader.id} value={leader.id}>
                        {leader.displayName} ({leader.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Feature Permissions Checkboxes */}
              <div className="pt-2 border-t border-slate-700/60">
                <label className="block text-xs font-semibold text-slate-400 mb-2">
                  {t('featurePermissions')}
                </label>
                <div className="space-y-2 bg-slate-900/60 p-3 rounded-xl border border-slate-700/50">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                    <input
                      type="checkbox"
                      id="new-can-send-single"
                      checked={newCanSendSingle}
                      disabled={newRole === 'Super Admin'}
                      onChange={(e) => setNewCanSendSingle(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-950 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-900"
                    />
                    <span>{t('allowSingleMessaging')}</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                    <input
                      type="checkbox"
                      id="new-can-send-bulk"
                      checked={newRole === 'Super Admin' ? true : newCanSendBulk}
                      disabled={newRole === 'Super Admin'}
                      onChange={(e) => setNewCanSendBulk(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600 bg-slate-950 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-900"
                    />
                    <span>{t('allowBulkBroadcast')}</span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
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
                <h3 className="text-lg font-bold text-white">{t('userDirectory')}</h3>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-700 text-slate-300">
                {users.length} Users
              </span>
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
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('displayName')} / {t('email')}</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('department')}</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('role')}</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('permissions')}</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('assignedLeader')}</th>
                      <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-center ltr:text-right rtl:text-left">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {users.map((user) => {
                      const isSuper = user.role === 'Super Admin';
                      const canSingle = isSuper || user.permissions?.canSendSingle !== false;
                      const canBulk = isSuper || user.permissions?.canSendBulk === true;

                      return (
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
                              user.role === 'Team Leader' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                              user.role === 'Agent' ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' : 
                              'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}>
                              {user.role === 'Super Admin' && <ShieldCheck className="w-3.5 h-3.5" />}
                              {user.role === 'Team Leader' && <UserCheck className="w-3.5 h-3.5" />}
                              {user.role}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1.5 items-center">
                              {isSuper ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  Full Access
                                </span>
                              ) : (
                                <>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                    canSingle
                                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                      : 'bg-slate-900 text-slate-500 border-slate-700'
                                  }`}>
                                    {canSingle ? (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    ) : (
                                      <XCircle className="w-3 h-3 text-slate-500" />
                                    )}
                                    {t('singleMsgBadge')}
                                  </span>

                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                    canBulk
                                      ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                                      : 'bg-slate-900 text-slate-500 border-slate-700'
                                  }`}>
                                    {canBulk ? (
                                      <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                                    ) : (
                                      <XCircle className="w-3 h-3 text-slate-500" />
                                    )}
                                    {t('bulkBroadcastBadge')}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            {user.teamLeaderName ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-slate-600/50">
                                {user.teamLeaderName}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                          <td className="p-4 text-right rtl:text-left">
                            <div className="flex justify-end rtl:justify-start gap-1.5">
                              <button
                                onClick={() => openEditModal(user)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
                                title={t('editUser')}
                              >
                                <Pencil className="w-3.5 h-3.5 text-emerald-400" />
                              </button>
                              <button
                                onClick={() => setResettingUser(user)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold transition-colors"
                                title={t('resetPassword')}
                              >
                                <Key className="w-3.5 h-3.5 text-amber-400" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                disabled={deletingId === user.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-semibold transition-colors border border-transparent hover:border-rose-500/20 disabled:opacity-50"
                                title={t('deleteUser')}
                              >
                                {deletingId === user.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit User & Permissions Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-6">
              <div className="flex items-center gap-2.5 mb-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">{t('editUser')}</h3>
              </div>
              <p className="text-xs text-slate-400 mb-5">
                {editingUser.email}
              </p>

              {editError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-400">
                  {editError}
                </div>
              )}

              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">{t('displayName')}</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">{t('department')}</label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">{t('role')}</label>
                  <select
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                    value={editRole}
                    onChange={(e) => handleEditRoleChange(e.target.value)}
                  >
                    <option value="Super Admin">{t('superAdmin')}</option>
                    <option value="Department Manager">{t('deptManager')}</option>
                    <option value="Team Leader">{t('teamLeader')}</option>
                    <option value="Agent">{t('agent')}</option>
                  </select>
                </div>

                {editRole === 'Agent' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">{t('assignTeamLeader')}</label>
                    <select
                      className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white text-sm"
                      value={editTeamLeaderId}
                      onChange={(e) => setEditTeamLeaderId(e.target.value)}
                    >
                      <option value="">{t('selectTeamLeader')}</option>
                      {teamLeaders
                        .filter(l => l.id !== editingUser.id)
                        .map((leader) => (
                          <option key={leader.id} value={leader.id}>
                            {leader.displayName} ({leader.role})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Feature Permissions Section */}
                <div className="pt-2 border-t border-slate-700/60">
                  <label className="block text-xs font-semibold text-slate-400 mb-2">
                    {t('featurePermissions')}
                  </label>
                  <div className="space-y-2.5 bg-slate-900/60 p-3.5 rounded-xl border border-slate-700/50">
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                      <input
                        type="checkbox"
                        checked={editRole === 'Super Admin' ? true : editCanSendSingle}
                        disabled={editRole === 'Super Admin'}
                        onChange={(e) => setEditCanSendSingle(e.target.checked)}
                        className="w-4 h-4 rounded text-emerald-600 bg-slate-950 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-900"
                      />
                      <span>{t('allowSingleMessaging')}</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-200">
                      <input
                        type="checkbox"
                        checked={editRole === 'Super Admin' ? true : editCanSendBulk}
                        disabled={editRole === 'Super Admin'}
                        onChange={(e) => setEditCanSendBulk(e.target.checked)}
                        className="w-4 h-4 rounded text-emerald-600 bg-slate-950 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-900"
                      />
                      <span>{t('allowBulkBroadcast')}</span>
                    </label>
                    {editRole === 'Super Admin' && (
                      <p className="text-[11px] text-amber-400/80 italic mt-1">
                        Super Admin automatically has full access to all features.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setEditingUser(null); setEditError(''); }}
                    className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition-colors"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
                  >
                    {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : t('saveChanges')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl">
            <div className="p-6">
              <h3 className="text-lg font-bold text-white mb-2">{t('changePassword')}</h3>
              <p className="text-sm text-slate-400 mb-6">
                Enter a new password for <span className="font-semibold text-slate-200">{resettingUser.email}</span>
              </p>
              
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
                    disabled={resettingPassword}
                    className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-semibold transition-colors shadow-lg shadow-rose-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {resettingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : t('confirmReset')}
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
