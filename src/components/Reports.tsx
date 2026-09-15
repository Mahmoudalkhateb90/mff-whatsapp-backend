import { useState, useEffect } from 'react';
import { BarChart3, MessageSquare, Activity, ShieldAlert, CheckCircle2, Loader2, Filter, Calendar } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useLanguage } from '../context/LanguageContext';

const getSessionUser = () => { try { return JSON.parse(localStorage.getItem('user_session') || '{}'); } catch { return {}; } };

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  department?: string;
  teamLeaderName?: string;
}

interface MessageLog {
  id?: string;
  phone?: string;
  to?: string;
  recipient?: string;
  status?: string;
  campaignId?: string;
  campaignName?: string;
  timestamp?: any;
  createdAt?: any;
  error?: string;
}

interface AnalyticsData {
  totalSent: number;
  totalFailed: number;
  deliveryRate: string;
  totalActiveSessions: number;
  recentLogs?: MessageLog[];
}

export default function Reports() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [metrics, setMetrics] = useState<AnalyticsData>({
    totalSent: 0,
    totalFailed: 0,
    deliveryRate: '100%',
    totalActiveSessions: 0,
    recentLogs: []
  });

  const [dateRange, setDateRange] = useState<'today' | '7days' | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');

  const getAuthHeaders = () => {
    const user = getSessionUser();
    return {
      'x-user-id': user.id || user.email || '',
      'x-user-email': user.email || '',
      'x-user-role': user.role || ''
    };
  };

  const fetchAnalytics = async () => {
    try {
      const [metricsRes, usersRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/analytics/metrics?range=${dateRange}&status=${statusFilter}`, {
          headers: { ...getAuthHeaders() }
        }),
        fetch(`${API_BASE_URL}/api/users`, {
          headers: { ...getAuthHeaders() }
        })
      ]);

      if (metricsRes.ok) {
        const mData = await metricsRes.json();
        setMetrics(mData);
      }

      if (usersRes.ok) {
        const uData = await usersRes.json();
        setUsers(uData);
      }
    } catch (err) {
      console.error('Failed to load analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange, statusFilter]);

  const formatLogTime = (log: MessageLog) => {
    const ts = log.timestamp || log.createdAt;
    if (!ts) return 'Just now';
    try {
      if (typeof ts === 'object' && ts._seconds) {
        return new Date(ts._seconds * 1000).toLocaleString();
      }
      return new Date(ts).toLocaleString();
    } catch {
      return 'Recent';
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full space-y-8">
      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/20">
            <BarChart3 className="text-emerald-400 w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white">{t('analyticsTitle')}</h2>
            <p className="text-slate-400 text-sm">{t('manageSession')}</p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date Range Filter */}
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1">
            <Calendar className="w-4 h-4 text-slate-400 mx-2" />
            <button
              onClick={() => setDateRange('today')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                dateRange === 'today' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('today')}
            </button>
            <button
              onClick={() => setDateRange('7days')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                dateRange === '7days' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('last7Days')}
            </button>
            <button
              onClick={() => setDateRange('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                dateRange === 'all' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('allTime')}
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-1">
            <Filter className="w-4 h-4 text-slate-400 mx-2" />
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-300 py-1.5 px-2 focus:outline-none"
            >
              <option value="all" className="bg-slate-800 text-white">{t('allStatuses')}</option>
              <option value="sent" className="bg-slate-800 text-emerald-400">{t('sent')}</option>
              <option value="failed" className="bg-slate-800 text-rose-400">{t('failed')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Real Aggregate Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <MessageSquare className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('totalSent')}</h3>
          </div>
          <p className="text-3xl font-bold text-white">{metrics.totalSent.toLocaleString()}</p>
          <p className="text-xs text-emerald-400 mt-2 font-medium">Real-time Firestore verified</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            </div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('totalFailed')}</h3>
          </div>
          <p className="text-3xl font-bold text-rose-400">{metrics.totalFailed.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-2 font-medium">Failed delivery count</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <CheckCircle2 className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('deliveryRate')}</h3>
          </div>
          <p className="text-3xl font-bold text-white">{metrics.deliveryRate}</p>
          <p className="text-xs text-blue-400 mt-2 font-medium">Success conversion ratio</p>
        </div>

        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-lg">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
              <Activity className="w-6 h-6 text-indigo-400" />
            </div>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('activeConnections')}</h3>
          </div>
          <p className="text-3xl font-bold text-white">{metrics.totalActiveSessions}</p>
          <p className="text-xs text-slate-400 mt-2 font-medium">Isolated Baileys sessions</p>
        </div>
      </div>

      {/* Breakdown Tables: Agent Performance & Real Message Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Agent Directory & Role Hierarchy */}
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{t('agentBreakdown')}</h3>
            <span className="text-xs text-slate-400 font-medium">{users.length} registered</span>
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left rtl:text-right border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-700">
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('displayName')}</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('department')}</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('role')}</th>
                  <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('assignedLeader')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-500 text-sm">
                      No agents registered yet.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="p-4 font-medium text-slate-200">
                        <div>{u.displayName}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="p-4 text-sm text-slate-400">{u.department || 'General'}</td>
                      <td className="p-4 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                          u.role === 'Super Admin' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          u.role === 'Team Leader' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' :
                          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {u.teamLeaderName || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Real Audit Logs */}
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{t('auditLogs')}</h3>
            <span className="text-xs text-slate-400 font-medium">{metrics.recentLogs?.length || 0} entries</span>
          </div>
          <div className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            ) : (
              <table className="w-full text-left rtl:text-right border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-slate-700">
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('phone')}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('timestamp')}</th>
                    <th className="p-4 text-xs font-semibold text-slate-400 uppercase tracking-wider text-right rtl:text-left">{t('status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {(!metrics.recentLogs || metrics.recentLogs.length === 0) ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-slate-500 text-sm">
                        {t('noLogsFound')}
                      </td>
                    </tr>
                  ) : (
                    metrics.recentLogs.map((log, idx) => (
                      <tr key={log.id || idx} className="hover:bg-slate-700/30 transition-colors">
                        <td className="p-4 text-sm font-mono text-slate-300">
                          {log.phone || log.to || log.recipient || 'N/A'}
                        </td>
                        <td className="p-4 text-xs text-slate-400 font-mono">
                          {formatLogTime(log)}
                        </td>
                        <td className="p-4 text-right rtl:text-left">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${
                            log.status === 'sent' || log.status === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}>
                            {log.status === 'sent' || log.status === 'success' ? t('sent') : t('failed')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
