import React, { useState } from 'react';
import { Send, Loader2, MessageSquare } from 'lucide-react';
import { auth } from '../firebase';
import { API_BASE_URL } from '../config';

export default function SingleMessage() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const formattedPhone = phoneNumber.replace(/\D/g, '');
      const res = await fetch(`${API_BASE_URL}/api/send-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': auth.currentUser?.uid || ''
        },
        body: JSON.stringify({
          userId: auth.currentUser?.uid,
          to: `${formattedPhone}@s.whatsapp.net`,
          message
        })
      });

      if (res.ok) {
        setStatus({ type: 'success', text: 'Message sent successfully!' });
        setPhoneNumber('');
        setMessage('');
      } else {
        let errorMessage = 'Failed to send message';
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server Error: ${res.status}`;
        }
        setStatus({ type: 'error', text: errorMessage });
      }
    } catch (err: any) {
      setStatus({ type: 'error', text: err.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-slate-800 rounded-2xl shadow-xl border border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex items-center gap-3">
          <MessageSquare className="text-emerald-500 w-6 h-6" />
          <h3 className="text-lg font-bold text-white">Send Single Message</h3>
        </div>
        
        <form onSubmit={handleSendMessage} className="p-8 space-y-6">
          {status && (
            <div className={`p-4 rounded-xl text-sm font-medium border ${
              status.type === 'success' 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              {status.text}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-2">
              Recipient Phone Number (with Country Code)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">+</span>
              <input
                type="text"
                required
                placeholder="962790000000"
                className="w-full pl-8 pr-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-2">
              Message Content
            </label>
            <textarea
              required
              rows={5}
              placeholder="Type your message here..."
              className="w-full px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-600 resize-none"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !phoneNumber || !message}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {loading ? 'Sending...' : 'Send Message'}
          </button>
        </form>
      </div>
    </div>
  );
}
