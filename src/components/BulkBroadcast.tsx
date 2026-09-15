import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Users, Upload, FileText, Download, Pause, Play, Square, CheckCircle2, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useLanguage } from '../context/LanguageContext';

const getSessionUser = () => { try { return JSON.parse(localStorage.getItem('user_session') || '{}'); } catch { return {}; } };

interface ContactItem {
  phone: string;
  message?: string;
}

interface ActiveCampaignState {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'idle';
  totalRecords: number;
  sentCount: number;
  failedCount: number;
  currentIndex?: number;
  delaySeconds?: number;
  messageTemplate?: string;
}

export default function BulkBroadcast() {
  const { t } = useLanguage();
  const [campaignName, setCampaignName] = useState('');
  const [numbersInput, setNumbersInput] = useState('');
  const [parsedContacts, setParsedContacts] = useState<ContactItem[]>([]);
  const [messageTemplate, setMessageTemplate] = useState('');
  const [throttleDelay, setThrottleDelay] = useState('5');
  const [submitting, setSubmitting] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<ActiveCampaignState | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<any>(null);

  // Fetch active campaign from server
  const fetchActiveCampaign = async () => {
    const user = getSessionUser();
    if (!user.id) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/active`, {
        headers: {
          'x-user-id': user.id || '',
          'x-user-email': user.email || ''
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.status && data.status !== 'idle') {
          setActiveCampaign(data);
        } else if (activeCampaign && (activeCampaign.status === 'running' || activeCampaign.status === 'paused')) {
          // If server reports completed or none, update local state
          setActiveCampaign(prev => prev ? { ...prev, status: 'completed' } : null);
        }
      }
    } catch (err) {
      console.warn('Error fetching active campaign:', err);
    }
  };

  // Poll while active campaign is running or paused
  useEffect(() => {
    fetchActiveCampaign();

    pollTimerRef.current = setInterval(() => {
      fetchActiveCampaign();
    }, 2500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // CSV Template download
  const handleDownloadSampleCSV = () => {
    const csvContent = '\uFEFFPhone,Message\n962790000000,"Hello Mahmoud, your invoice is ready."\n962791111111,"Greetings from MFF! Thank you for your partnership."\n962792222222,""\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_mff_broadcast.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // CSV & File Parsing with direct support for Phone and Custom Message
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      
      const items: ContactItem[] = [];
      const rawNumbers: string[] = [];

      lines.forEach((line, index) => {
        // Skip header if matches Phone/Number
        if (index === 0 && (line.toLowerCase().includes('phone') || line.toLowerCase().includes('mobile') || line.toLowerCase().includes('رقم'))) {
          return;
        }

        // Parse CSV row with potential quoted values
        const delimiter = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ',';
        const cols: string[] = [];
        let cur = '';
        let insideQuote = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            insideQuote = !insideQuote;
          } else if (char === delimiter && !insideQuote) {
            cols.push(cur.trim());
            cur = '';
          } else {
            cur += char;
          }
        }
        cols.push(cur.trim());

        const rawPhone = (cols[0] || '').replace(/\D/g, '');
        const customMessage = cols[1] ? cols[1].replace(/^"|"$/g, '').trim() : '';

        if (rawPhone.length >= 7) {
          items.push({ phone: rawPhone, message: customMessage || undefined });
          rawNumbers.push(rawPhone);
        }
      });

      setParsedContacts(items);
      setNumbersInput(rawNumbers.join('\n'));
      setStatusMessage({
        type: 'info',
        text: `${items.length} ${t('contactsLoaded')}`
      });
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleStartBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    // Build contacts list
    let itemsToBroadcast: ContactItem[] = [];
    if (parsedContacts.length > 0) {
      itemsToBroadcast = parsedContacts;
    } else {
      const lines = numbersInput.split('\n').map(n => n.trim().replace(/\D/g, '')).filter(n => n.length >= 7);
      itemsToBroadcast = lines.map(phone => ({ phone }));
    }

    if (itemsToBroadcast.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please enter or upload at least one valid phone number.' });
      return;
    }

    if (!messageTemplate.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter a message template.' });
      return;
    }

    setSubmitting(true);
    const user = getSessionUser();

    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.id || '',
          'x-user-email': user.email || ''
        },
        body: JSON.stringify({
          name: campaignName.trim() || `Campaign ${new Date().toLocaleDateString()}`,
          items: itemsToBroadcast,
          delaySeconds: parseInt(throttleDelay, 10) || 5,
          messageTemplate
        })
      });

      if (res.ok) {
        const campaign = await res.json();
        setActiveCampaign(campaign);
        setStatusMessage({ type: 'success', text: 'Campaign started successfully!' });
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed to start campaign' }));
        setStatusMessage({ type: 'error', text: err.error || 'Failed to start campaign' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Network error occurred' });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async () => {
    if (!activeCampaign?.id) return;
    const user = getSessionUser();
    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${activeCampaign.id}/pause`, {
        method: 'POST',
        headers: { 'x-user-id': user.id || '', 'x-user-email': user.email || '' }
      });
      if (res.ok) {
        setActiveCampaign(prev => prev ? { ...prev, status: 'paused' } : null);
      }
    } catch (e) {
      console.error('Pause failed', e);
    }
  };

  const handleResume = async () => {
    if (!activeCampaign?.id) return;
    const user = getSessionUser();
    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${activeCampaign.id}/resume`, {
        method: 'POST',
        headers: { 'x-user-id': user.id || '', 'x-user-email': user.email || '' }
      });
      if (res.ok) {
        setActiveCampaign(prev => prev ? { ...prev, status: 'running' } : null);
      }
    } catch (e) {
      console.error('Resume failed', e);
    }
  };

  const handleCancel = async () => {
    if (!activeCampaign?.id) return;
    const user = getSessionUser();
    try {
      const res = await fetch(`${API_BASE_URL}/api/campaigns/${activeCampaign.id}/cancel`, {
        method: 'POST',
        headers: { 'x-user-id': user.id || '', 'x-user-email': user.email || '' }
      });
      if (res.ok) {
        setActiveCampaign(prev => prev ? { ...prev, status: 'cancelled' } : null);
      }
    } catch (e) {
      console.error('Cancel failed', e);
    }
  };

  const total = activeCampaign ? activeCampaign.totalRecords : parsedContacts.length || numbersInput.split('\n').filter(Boolean).length;
  const sent = activeCampaign ? activeCampaign.sentCount : 0;
  const failed = activeCampaign ? activeCampaign.failedCount : 0;
  const processed = sent + failed;
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div className="max-w-5xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Campaign Form Section */}
      <div className="lg:col-span-2">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="text-emerald-500 w-6 h-6" />
              <div>
                <h3 className="text-lg font-bold text-white">{t('bulkBroadcast')}</h3>
                <p className="text-xs text-slate-400">{t('campaignEngine')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDownloadSampleCSV}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg transition-colors shadow-sm"
              title="Download template with Phone and Message columns"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('downloadSampleCSV')}</span>
            </button>
          </div>
          
          <form onSubmit={handleStartBroadcast} className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                {t('campaignName')}
              </label>
              <input
                type="text"
                placeholder={t('campaignNamePlaceholder')}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                disabled={activeCampaign?.status === 'running'}
              />
            </div>

            <div>
              <div className="flex justify-between items-end mb-2">
                <label className="block text-sm font-semibold text-slate-400">
                  {t('uploadCSV')} / {t('recipientPhone')}
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                  disabled={activeCampaign?.status === 'running'}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('uploadCSV')}</span>
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              <textarea
                required={parsedContacts.length === 0}
                rows={4}
                placeholder="962790000000&#10;962791111111"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none font-mono text-sm"
                value={numbersInput}
                onChange={(e) => {
                  setNumbersInput(e.target.value);
                  setParsedContacts([]);
                }}
                disabled={activeCampaign?.status === 'running'}
              />
              <p className="text-xs text-slate-500 mt-1">{t('csvSupportedCols')}</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                {t('messageTemplate')}
              </label>
              <textarea
                required
                rows={5}
                placeholder={t('messageTemplatePlaceholder')}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none"
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                disabled={activeCampaign?.status === 'running'}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                {t('delaySeconds')}
              </label>
              <select
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white"
                value={throttleDelay}
                onChange={(e) => setThrottleDelay(e.target.value)}
                disabled={activeCampaign?.status === 'running'}
              >
                <option value="1">1 second (Fast)</option>
                <option value="3">3 seconds (Moderate)</option>
                <option value="5">5 seconds (Recommended)</option>
                <option value="10">10 seconds (Safe)</option>
                <option value="15">15 seconds (High Safety)</option>
              </select>
            </div>

            {(!activeCampaign || activeCampaign.status === 'completed' || activeCampaign.status === 'cancelled') && (
              <button
                type="submit"
                disabled={submitting || (!numbersInput && parsedContacts.length === 0) || !messageTemplate}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                <span>{submitting ? t('sending') : t('startCampaign')}</span>
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Progress & Live Controls Card */}
      <div className="lg:col-span-1">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden sticky top-6">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="text-emerald-500 w-6 h-6" />
              <h3 className="text-lg font-bold text-white">{t('campaignStatus')}</h3>
            </div>
            {activeCampaign && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase tracking-wider border ${
                activeCampaign.status === 'running'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 animate-pulse'
                  : activeCampaign.status === 'paused'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : activeCampaign.status === 'completed'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}>
                {t(activeCampaign.status)}
              </span>
            )}
          </div>
          
          <div className="p-6">
            {statusMessage && (
              <div className={`p-4 rounded-xl text-sm font-medium border mb-6 flex items-center gap-2 ${
                statusMessage.type === 'success' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : statusMessage.type === 'error'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Campaign Controls */}
            {activeCampaign && (activeCampaign.status === 'running' || activeCampaign.status === 'paused') && (
              <div className="mb-6 p-4 bg-slate-900/60 rounded-xl border border-slate-700/80">
                <p className="text-xs font-bold text-slate-400 mb-3">{activeCampaign.name}</p>
                <div className="flex gap-2">
                  {activeCampaign.status === 'running' ? (
                    <button
                      type="button"
                      onClick={handlePause}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Pause className="w-4 h-4" />
                      <span>{t('pauseCampaign')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResume}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      <span>{t('resumeCampaign')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-lg text-sm font-semibold transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    <span>{t('cancelCampaign')}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="p-4 bg-slate-900/50 border border-slate-700 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('totalContacts')}</p>
                <p className="text-3xl font-bold text-white mt-1">{total}</p>
              </div>
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">{t('sent')}</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">{sent}</p>
              </div>
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-500">{t('failed')}</p>
                <p className="text-3xl font-bold text-rose-400 mt-1">{failed}</p>
              </div>
            </div>

            {total > 0 && (
              <div className="mt-6">
                <div className="flex justify-between text-xs font-medium text-slate-400 mb-2">
                  <span>{t('progress')}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
