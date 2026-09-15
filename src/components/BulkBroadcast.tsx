import React, { useState, useRef } from 'react';
import { Send, Loader2, Users, Upload, FileText } from 'lucide-react';
import { auth } from '../firebase';
import { API_BASE_URL } from '../config';

export default function BulkBroadcast() {
  const [numbersInput, setNumbersInput] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [throttleDelay, setThrottleDelay] = useState('5');
  const [loading, setLoading] = useState(false);
  
  const [progress, setProgress] = useState({ total: 0, sent: 0, failed: 0 });
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      // Extract numbers (assuming simple list of numbers or CSV with first column as number)
      const lines = text.split('\n');
      const extractedNumbers = lines.map(line => line.split(',')[0].replace(/\D/g, '')).filter(Boolean);
      setNumbersInput(extractedNumbers.join('\n'));
    };
    reader.readAsText(file);
  };

  const handleStartBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    const numbersList = numbersInput.split('\n').map(n => n.trim()).filter(Boolean);
    
    if (numbersList.length === 0) {
      setStatus({ type: 'error', text: 'Please enter at least one valid phone number.' });
      return;
    }

    setLoading(true);
    setProgress({ total: numbersList.length, sent: 0, failed: 0 });
    setStatus({ type: 'info', text: 'Broadcast in progress...' });

    const delayMs = parseInt(throttleDelay) * 1000;

    for (let i = 0; i < numbersList.length; i++) {
      const num = numbersList[i];
      const formattedPhone = num.replace(/\D/g, '');
      
      try {
        const res = await fetch(`${API_BASE_URL}/api/send-message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': auth.currentUser?.uid || ''
          },
          body: JSON.stringify({
            userId: auth.currentUser?.uid,
            to: `${formattedPhone}@s.whatsapp.net`,
            message: messageTemplate
          })
        });

        if (res.ok) {
          setProgress(prev => ({ ...prev, sent: prev.sent + 1 }));
        } else {
          setProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      } catch (err) {
        setProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
      }

      // Throttle delay if not the last message
      if (i < numbersList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    setLoading(false);
    setStatus({ type: 'success', text: 'Broadcast completed.' });
  };

  return (
    <div className="max-w-4xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center gap-3">
            <Users className="text-emerald-500 w-6 h-6" />
            <h3 className="text-lg font-bold text-white">Bulk Broadcast Campaign</h3>
          </div>
          
          <form onSubmit={handleStartBroadcast} className="p-8 space-y-6">
            <div>
              <div className="flex justify-between items-end mb-2">
                <label className="block text-sm font-semibold text-slate-400">
                  Recipient Numbers (one per line)
                </label>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Import CSV/TXT
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
                required
                rows={4}
                placeholder="962790000000&#10;962791111111"
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none font-mono text-sm"
                value={numbersInput}
                onChange={(e) => setNumbersInput(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                Message Template
              </label>
              <textarea
                required
                rows={6}
                placeholder="Hello! This is a broadcast message."
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none"
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-400 mb-2">
                Throttle Delay (Seconds)
              </label>
              <select
                className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white"
                value={throttleDelay}
                onChange={(e) => setThrottleDelay(e.target.value)}
                disabled={loading}
              >
                <option value="1">1 second (Fast, High Ban Risk)</option>
                <option value="3">3 seconds (Moderate)</option>
                <option value="5">5 seconds (Recommended)</option>
                <option value="10">10 seconds (Safe)</option>
                <option value="15">15 seconds (Very Safe)</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">Delay between messages to prevent WhatsApp bans.</p>
            </div>

            <button
              type="submit"
              disabled={loading || !numbersInput || !messageTemplate}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {loading ? 'Sending Broadcast...' : 'Start Broadcast'}
            </button>
          </form>
        </div>
      </div>

      <div className="lg:col-span-1">
        <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden sticky top-6">
          <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center gap-3">
            <FileText className="text-emerald-500 w-6 h-6" />
            <h3 className="text-lg font-bold text-white">Progress Status</h3>
          </div>
          
          <div className="p-6">
            {status && (
              <div className={`p-4 rounded-xl text-sm font-medium border mb-6 ${
                status.type === 'success' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : status.type === 'error'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {status.text}
              </div>
            )}

            <div className="space-y-4">
              <div className="p-4 bg-slate-900/50 border border-slate-700 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Contacts</p>
                <p className="text-3xl font-bold text-white mt-1">{progress.total}</p>
              </div>
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">Successfully Sent</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">{progress.sent}</p>
              </div>
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-500">Failed</p>
                <p className="text-3xl font-bold text-rose-400 mt-1">{progress.failed}</p>
              </div>
            </div>

            {loading && progress.total > 0 && (
              <div className="mt-6">
                <div className="flex justify-between text-xs font-medium text-slate-400 mb-2">
                  <span>Progress</span>
                  <span>{Math.round(((progress.sent + progress.failed) / progress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${((progress.sent + progress.failed) / progress.total) * 100}%` }}
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
