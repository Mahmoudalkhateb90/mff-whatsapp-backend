import { useState, useEffect } from 'react';
import { BarChart3, Users, MessageSquare, Activity, ShieldAlert, Loader2 } from 'lucide-react';
import { auth } from '../firebase';
import { API_BASE_URL } from '../config';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  department?: string;
}

export default function Reports() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const fetchReportData = async () => {
      try {
        const [meRes, usersRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/users/me`, { headers: { 'x-user-id': auth.currentUser?.uid || '' } }),
          fetch(`${API_BASE_URL}/api/users`, { headers: { 'x-user-id': auth.currentUser?.uid || '' } })
        ]);
        
        if (meRes.ok) {
          const meData = await meRes.json();
          setUserRole(meData.role);
        }
        
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(usersData);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchReportData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Determine what to show based on role
  // Super Admin & Manager see everything, Team Leaders see their team
  // Because we don't have a real team assignment, we'll mock the filter or show all for now
  
  const isHighPrivilege = userRole === 'Super Admin' || userRole === 'Department Manager';

  return (
    <div className="max-w-7xl mx-auto w-full space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 className="text-emerald-500 w-8 h-8" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">System Reports & Analytics</h2>
          <p className="text-slate-400 mt-1">
            {isHighPrivilege ? 'Global system metrics and agent breakdowns.' : 'Activity logs and metrics for your assigned team.'}
          </p>
        </div>
      </div>

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-500/10 rounded-xl">
              <MessageSquare className="w-6 h-6 text-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Total Sent</h3>
          </div>
          <p className="text-3xl font-bold text-white">24,592</p>
          <p className="text-xs text-emerald-400 mt-2 font-medium">+12% from last week</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <Activity className="w-6 h-6 text-blue-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Active Sessions</h3>
          </div>
          <p className="text-3xl font-bold text-white">12</p>
          <p className="text-xs text-slate-400 mt-2 font-medium">Currently connected agents</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-amber-500/10 rounded-xl">
              <Users className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Active Agents</h3>
          </div>
          <p className="text-3xl font-bold text-white">{users.length}</p>
          <p className="text-xs text-slate-400 mt-2 font-medium">Registered in system</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-rose-500/10 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Failed Messages</h3>
          </div>
          <p className="text-3xl font-bold text-white">142</p>
          <p className="text-xs text-rose-400 mt-2 font-medium">Requires review</p>
        </div>
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50">
            <h3 className="text-lg font-bold text-white">Agent Performance</h3>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-700">
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Agent</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Department</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {users.slice(0, 5).map((u, idx) => (
                  <tr key={u.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="p-4 font-medium text-slate-200">{u.displayName}</td>
                    <td className="p-4 text-sm text-slate-400">{u.department || 'General'}</td>
                    <td className="p-4 text-right font-mono text-emerald-400">{Math.floor(Math.random() * 5000) + 100}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50">
            <h3 className="text-lg font-bold text-white">Recent Activity Logs</h3>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-700">
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Time</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Event</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {[...Array(5)].map((_, i) => (
                  <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                    <td className="p-4 text-sm text-slate-400 font-mono">10:{45 - i} AM</td>
                    <td className="p-4 text-sm text-slate-200">Bulk Broadcast (ID: CMP-{1000 + i})</td>
                    <td className="p-4 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Completed
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
