import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Loader2, 
  Users, 
  Upload, 
  FileText, 
  Download, 
  Pause, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertCircle, 
  RotateCcw,
  ShieldAlert 
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useLanguage } from '../context/LanguageContext';

const getSessionUser = () => { 
  try { 
    return JSON.parse(localStorage.getItem('user_session') || '{}'); 
  } catch { 
    return {}; 
  } 
};

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
  const user = getSessionUser();
  const userId = user?.id || 'default';
  const isSuper = user?.role === 'Super Admin';
  const hasBulkPermission = isSuper || user?.permissions?.canSendBulk === true;

  // Storage keys strictly scoped per user session to isolate concurrent users
  const getStorageKey = (key: string) => `mff_broadcast_${userId}_${key}`;

  const [campaignName, setCampaignName] = useState(() => localStorage.getItem(getStorageKey('name')) || '');
  const [numbersInput, setNumbersInput] = useState(() => localStorage.getItem(getStorageKey('numbers')) || '');
  const [parsedContacts, setParsedContacts] = useState<ContactItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(getStorageKey('contacts')) || '[]');
    } catch {
      return [];
    }
  });
  const [messageTemplate, setMessageTemplate] = useState(() => localStorage.getItem(getStorageKey('template')) || '');
  const [throttleDelay, setThrottleDelay] = useState('3');
  const [submitting, setSubmitting] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<ActiveCampaignState | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<any>(null);
  const dismissedCampaignIdRef = useRef<string | null>(null);

  // Check if uploaded CSV contains custom message per recipient
  const hasCustomMessages = parsedContacts.length > 0 && parsedContacts.some(c => !!c.message);

  // Persist draft across navigation strictly scoped per user
  useEffect(() => {
    localStorage.setItem(getStorageKey('name'), campaignName);
  }, [campaignName, userId]);

  useEffect(() => {
    localStorage.setItem(getStorageKey('numbers'), numbersInput);
  }, [numbersInput, userId]);

  useEffect(() => {
    localStorage.setItem(getStorageKey('contacts'), JSON.stringify(parsedContacts));
  }, [parsedContacts, userId]);

  useEffect(() => {
    localStorage.setItem(getStorageKey('template'), messageTemplate);
  }, [messageTemplate, userId]);

  // Fetch active campaign from server strictly isolated for this user
  const fetchActiveCampaign = async () => {
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
          // If the user explicitly cleared this campaign from local UI view, do not re-populate the form
          if (dismissedCampaignIdRef.current === data.id) {
            return;
          }
          setActiveCampaign(data);
          if (data.name && !campaignName && !dismissedCampaignIdRef.current) setCampaignName(data.name);
          if (data.messageTemplate && !messageTemplate && !dismissedCampaignIdRef.current) setMessageTemplate(data.messageTemplate);
        } else if (activeCampaign && (activeCampaign.status === 'running' || activeCampaign.status === 'paused')) {
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
  }, [userId]);

  /**
   * Reset local UI view cleanly without canceling or affecting background server jobs.
   * Enables starting a fresh batch upload immediately.
   */
  const handleStartNewCampaign = () => {
    // Remember currently dismissed campaign ID so background polling doesn't overwrite cleared inputs
    if (activeCampaign?.id) {
      dismissedCampaignIdRef.current = activeCampaign.id;
    } else {
      dismissedCampaignIdRef.current = '__cleared__';
    }

    // Reset local form states
    setCampaignName('');
    setNumbersInput('');
    setParsedContacts([]);
    setMessageTemplate('');
    setThrottleDelay('3');
    setActiveCampaign(null);
    setStatusMessage({
      type: 'info',
      text: t('viewResetSuccess') || 'View reset. You can now start a fresh batch upload.'
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Clear saved drafts in localStorage for this user
    try {
      localStorage.removeItem(getStorageKey('name'));
      localStorage.removeItem(getStorageKey('numbers'));
      localStorage.removeItem(getStorageKey('contacts'));
      localStorage.removeItem(getStorageKey('template'));
    } catch (e) {}
  };

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

  // CSV & File Parsing with direct support for Phone and Custom Message & Arabic/UTF-8 BOM
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let text = (event.target?.result as string) || '';
      // Automatically strip UTF-8 Byte Order Mark (\uFEFF)
      text = text.replace(/^\uFEFF/, '');
      
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length === 0) return;

      const PHONE_HEADERS = ['phone', 'mobile', 'number', 'الرقم', 'الهاتف', 'الجوال'];
      const MESSAGE_HEADERS = ['message', 'text', 'content', 'الرسالة', 'نص الرسالة', 'نص_الرسالة'];

      const parseRow = (line: string, delimiter: string): string[] => {
        const cols: string[] = [];
        let cur = '';
        let insideQuote = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (insideQuote && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              insideQuote = !insideQuote;
            }
          } else if (char === delimiter && !insideQuote) {
            cols.push(cur.trim());
            cur = '';
          } else {
            cur += char;
          }
        }
        cols.push(cur.trim());
        return cols;
      };

      // Detect delimiter on first line
      const firstLine = lines[0];
      const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
      
      const headerCols = parseRow(firstLine, delimiter).map(c => c.replace(/^"|"$/g, '').trim());
      
      let phoneColIdx = -1;
      let messageColIdx = -1;
      let startIndex = 0;

      // Check if first row is a header (Arabic or English)
      headerCols.forEach((col, idx) => {
        const colClean = col.toLowerCase();
        if (PHONE_HEADERS.some(h => colClean.includes(h.toLowerCase()))) {
          phoneColIdx = idx;
        }
        if (MESSAGE_HEADERS.some(h => colClean.includes(h.toLowerCase()))) {
          messageColIdx = idx;
        }
      });

      if (phoneColIdx !== -1 || messageColIdx !== -1) {
        startIndex = 1; // Row 0 is header
        if (phoneColIdx === -1) phoneColIdx = 0;
        if (messageColIdx === -1 && headerCols.length > 1) messageColIdx = 1;
      } else {
        phoneColIdx = 0;
        messageColIdx = 1;
        startIndex = 0;
      }

      const items: ContactItem[] = [];
      const rawNumbers: string[] = [];

      for (let i = startIndex; i < lines.length; i++) {
        const row = parseRow(lines[i], delimiter);
        const rawPhone = (row[phoneColIdx] || '').replace(/\D/g, '');
        let customMessage = '';
        if (messageColIdx !== -1 && row[messageColIdx]) {
          customMessage = row[messageColIdx].replace(/^"|"$/g, '').trim();
        }

        if (rawPhone.length >= 7) {
          items.push({ phone: rawPhone, message: customMessage || undefined });
          rawNumbers.push(rawPhone);
        }
      }

      setParsedContacts(items);
      setNumbersInput(rawNumbers.join('\n'));
      const hasCustom = items.some(c => !!c.message);
      setStatusMessage({
        type: 'info',
        text: `${items.length} ${t('contactsLoaded')}${hasCustom ? ' (Individual message column detected)' : ''}`
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

    if (!hasBulkPermission) {
      setStatusMessage({ type: 'error', text: t('noBulkPermission') });
      return;
    }

    if (itemsToBroadcast.length === 0) {
      setStatusMessage({ type: 'error', text: 'Please enter or upload at least one valid phone number.' });
      return;
    }

    // Message template is optional if CSV contains custom messages
    if (!messageTemplate.trim() && !hasCustomMessages) {
      setStatusMessage({ type: 'error', text: 'Please enter a message template or upload a CSV with message column.' });
      return;
    }

    setSubmitting(true);

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
          delaySeconds: parseInt(throttleDelay, 10) || 3,
          messageTemplate
        })
      });

      if (res.ok) { // 202 Accepted or 200 OK
        const campaign = await res.json();
        // Reset dismissed flag so the new campaign progress is tracked
        dismissedCampaignIdRef.current = null;
        setActiveCampaign(campaign);
        setStatusMessage({ type: 'success', text: 'Campaign queued and running sequentially in background!' });
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
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Users className="text-emerald-500 w-6 h-6" />
              <div>
                <h3 className="text-lg font-bold text-white">{t('bulkBroadcast')}</h3>
                <p className="text-xs text-slate-400">{t('campaignEngine')}</p>
              </div>
            </div>
            
            {/* Header Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="btn-clear-start-new"
                onClick={handleStartNewCampaign}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg transition-all shadow-md shadow-emerald-950/20 active:scale-95"
                title="Reset view and prepare a new campaign"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('startNewCampaign') || 'Start New Campaign'}</span>
              </button>

              <button
                type="button"
                id="btn-download-sample-csv"
                onClick={handleDownloadSampleCSV}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg transition-colors shadow-sm"
                title="Download template with Phone and Message columns"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t('downloadSampleCSV')}</span>
              </button>
            </div>
          </div>
          
          <form onSubmit={handleStartBroadcast} className="p-8 space-y-6">
            {!hasBulkPermission && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <span>{t('noBulkPermission')}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                {t('campaignName')}
              </label>
              <input
                type="text"
                id="input-campaign-name"
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
                  id="btn-upload-csv-trigger"
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
                  disabled={activeCampaign?.status === 'running'}
                />
              </div>

              {/* Upload Drop Zone / Preview */}
              {parsedContacts.length > 0 ? (
                <div className="p-4 bg-slate-900/80 border border-emerald-500/30 rounded-xl mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="text-emerald-400 w-5 h-5" />
                    <div>
                      <p className="text-sm font-medium text-white">
                        {parsedContacts.length} {t('contactsLoaded')}
                      </p>
                      <p className="text-xs text-slate-400">
                        {hasCustomMessages ? 'CSV includes individual recipient messages' : 'Using global message template'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="btn-remove-loaded-csv"
                    onClick={() => {
                      setParsedContacts([]);
                      setNumbersInput('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors px-2 py-1 bg-rose-500/10 rounded"
                    disabled={activeCampaign?.status === 'running'}
                  >
                    {t('clearData') || 'Clear'}
                  </button>
                </div>
              ) : (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 mb-3 border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl bg-slate-900/30 text-center cursor-pointer transition-colors"
                >
                  <Upload className="w-6 h-6 mx-auto text-slate-500 mb-1" />
                  <p className="text-xs font-medium text-slate-300">{t('dropCSVHere')}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t('csvSupportedCols')}</p>
                </div>
              )}

              <textarea
                rows={5}
                id="textarea-manual-numbers"
                placeholder={`962790000000\n962791111111\n962792222222`}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 font-mono text-sm"
                value={numbersInput}
                onChange={(e) => {
                  setNumbersInput(e.target.value);
                  if (parsedContacts.length > 0) setParsedContacts([]);
                }}
                disabled={activeCampaign?.status === 'running'}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                {t('messageTemplate')}
              </label>
              <textarea
                rows={4}
                id="textarea-message-template"
                placeholder={t('messageTemplatePlaceholder')}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600"
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
                id="select-delay-seconds"
                value={throttleDelay}
                onChange={(e) => setThrottleDelay(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white"
                disabled={activeCampaign?.status === 'running'}
              >
                <option value="2">2 seconds (High Speed, Throttled)</option>
                <option value="3">3 seconds (Recommended)</option>
                <option value="5">5 seconds (Standard Safe)</option>
                <option value="10">10 seconds (Strict Anti-Spam)</option>
              </select>
            </div>

            {(!activeCampaign || activeCampaign.status !== 'running') && (
              <button
                type="submit"
                id="btn-submit-campaign"
                disabled={submitting || total === 0 || !hasBulkPermission}
                title={!hasBulkPermission ? t('noBulkPermission') : undefined}
                className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t('authenticating')}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    <span>{t('startCampaign')}</span>
                  </>
                )}
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
                      id="btn-pause-campaign"
                      onClick={handlePause}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Pause className="w-4 h-4" />
                      <span>{t('pauseCampaign')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="btn-resume-campaign"
                      onClick={handleResume}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <Play className="w-4 h-4" />
                      <span>{t('resumeCampaign')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    id="btn-cancel-campaign"
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

            {/* Prominent Reset / Start New Campaign Action in Side Panel */}
            <button
              type="button"
              id="btn-side-start-new"
              onClick={handleStartNewCampaign}
              className="w-full mt-6 flex items-center justify-center gap-2 py-3 px-4 bg-slate-700/60 hover:bg-slate-700 text-slate-200 border border-slate-600/70 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-98"
            >
              <RotateCcw className="w-4 h-4 text-emerald-400" />
              <span>{t('startNewCampaign') || 'Start New Campaign / Clear'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
