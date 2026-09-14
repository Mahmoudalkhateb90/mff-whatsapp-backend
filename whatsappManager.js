import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { rimraf } from 'rimraf';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import { queueMessageLog, incrementCampaignStats } from './firestoreService.js';

const SESSIONS_DIR = path.resolve('./sessions');
const activeSessions = new Map();
const logger = pino({ level: 'silent' });

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export async function getSessionStatus(userId) {
  if (activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    return {
      status: session.status || 'connecting',
      qr: session.qrBase64 || null,
      phone: session.sock && session.sock.user ? session.sock.user.id : null
    };
  }
  
  const sessionPath = path.join(SESSIONS_DIR, userId);
  if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
    return { status: 'disconnected_but_has_creds' };
  }
  
  return { status: 'disconnected' };
}

export async function logoutSession(userId) {
  const sessionData = activeSessions.get(userId);
  if (sessionData && sessionData.sock) {
    try {
      await sessionData.sock.logout();
    } catch (err) {
      console.error(`[WhatsApp] Error logging out socket for ${userId}:`, err?.message);
    }
    try {
      sessionData.sock.ws.close();
    } catch (err) {
      console.error(`[WhatsApp] Error closing socket for ${userId}:`, err?.message);
    }
    activeSessions.delete(userId);
  }
  
  const sessionPath = path.join(SESSIONS_DIR, userId);
  try {
    await rimraf(sessionPath);
    console.log(`[WhatsApp] Cleared session data for ${userId}`);
  } catch (err) {
    console.error(`[WhatsApp] Error deleting session dir for ${userId}:`, err?.message);
  }
  
  return { status: 'logged_out' };
}

export async function sendWhatsAppMessage(userId, to, message) {
  const session = activeSessions.get(userId);
  if (!session || !session.sock || session.status !== 'connected') {
    throw new Error('WhatsApp session is not connected');
  }

  try {
    const sock = session.sock;
    // Basic sanitization
    const formattedPhone = to.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const result = await sock.sendMessage(jid, { text: message });
    return { success: true, messageId: result.key.id };
  } catch (err) {
    console.error(`[WhatsApp] Send message error for ${userId}:`, err);
    throw new Error('Failed to send WhatsApp message');
  }
}
export async function startSession(userId) {
  ensureSessionsDir();

  // If already active but NOT fully connected, kill the stuck session and reset
  if (activeSessions.has(userId)) {
    const currentSession = activeSessions.get(userId);
    if (currentSession.status !== 'connected') {
      console.log(`[WhatsApp] Session for ${userId} is stuck in ${currentSession.status}. Forcing reset...`);
      await logoutSession(userId);
    } else {
      return { status: 'already_active' };
    }
  }

  const sessionPath = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  // We create a fresh entry immediately
  const sessionEntry = { sock: null, status: 'connecting', qrBase64: null, resolveInit: null };
  activeSessions.set(userId, sessionEntry);

  return new Promise((resolve, reject) => {
    try {
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false
      });
      sessionEntry.sock = sock;
      sessionEntry.resolveInit = resolve;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            sessionEntry.status = 'qr';
            sessionEntry.qrBase64 = qrBase64;
            
            // Resolve the initial promise if it hasn't been resolved yet
            if (sessionEntry.resolveInit) {
              sessionEntry.resolveInit({ status: 'qr_ready', qr: qrBase64 });
              sessionEntry.resolveInit = null;
            }
          } catch (err) {
            console.error('[WhatsApp] QR Code Generation Error:', err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          activeSessions.delete(userId);
          console.log(`[WhatsApp] Connection closed for ${userId}. Reason: ${statusCode}`);
          
          if (shouldReconnect) {
            console.log(`[WhatsApp] Attempting reconnect for ${userId}...`);
            setTimeout(() => startSession(userId).catch(console.error), 5000); 
          } else {
            console.log(`[WhatsApp] Logged out for ${userId}. Clearing session.`);
            await logoutSession(userId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp] Session securely connected for ${userId}`);
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          
          if (sessionEntry.resolveInit) {
             sessionEntry.resolveInit({ status: 'connected' });
             sessionEntry.resolveInit = null;
          }
        }
      });

      sock.ev.on('messages.upsert', async (m) => { 
         if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (msg.key.fromMe) {
                  queueMessageLog({
                      userId,
                      remoteJid: msg.key.remoteJid,
                      messageId: msg.key.id,
                      status: 'sent',
                  });
                }
            }
         }
      });
    } catch (err) {
      console.error(`[WhatsApp] Init error for ${userId}:`, err);
      activeSessions.delete(userId);
      if (sessionEntry.resolveInit) {
        sessionEntry.resolveInit = null;
      }
      reject(err);
    }
  });
}
