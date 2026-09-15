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

export async function autoRestoreSessions() {
  ensureSessionsDir();
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const userId = entry.name;
        const credsPath = path.join(SESSIONS_DIR, userId, 'creds.json');
        if (fs.existsSync(credsPath)) {
          console.log(`[WhatsApp] Auto-restoring persistent session for ${userId}...`);
          startSession(userId).catch(err => {
            console.warn(`[WhatsApp] Auto-restore attempt for ${userId} will retry:`, err?.message);
          });
        }
      }
    }
  } catch (err) {
    console.warn('[WhatsApp] Error in autoRestoreSessions:', err?.message);
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
    // Automatically trigger background reconnection if saved credentials exist
    startSession(userId).catch(err => console.warn(`[WhatsApp] Auto-connect on status check failed:`, err?.message));
    return { status: 'reconnecting' };
  }
  
  return { status: 'disconnected' };
}

export async function logoutSession(userId) {
  const sessionData = activeSessions.get(userId);
  if (sessionData) {
    if (sessionData.reconnectTimer) {
      clearTimeout(sessionData.reconnectTimer);
    }
    if (sessionData.sock) {
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
    return { success: true, messageId: result.key?.id };
  } catch (err) {
    console.error(`[WhatsApp] Send message error for ${userId}:`, err?.message || err);
    throw new Error('Failed to send WhatsApp message: ' + (err?.message || 'Unknown error'));
  }
}

export async function startSession(userId) {
  ensureSessionsDir();

  // If already active and connected, return immediately
  if (activeSessions.has(userId)) {
    const currentSession = activeSessions.get(userId);
    if (currentSession.status === 'connected') {
      return { status: 'already_active' };
    }
    if (currentSession.reconnectTimer) {
      clearTimeout(currentSession.reconnectTimer);
      currentSession.reconnectTimer = null;
    }
    if (currentSession.sock && currentSession.status !== 'connecting') {
      try {
        currentSession.sock.ws?.close();
      } catch (e) {
        // ignore
      }
    }
  }

  const sessionPath = path.join(SESSIONS_DIR, userId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  let sessionEntry = activeSessions.get(userId);
  if (!sessionEntry) {
    sessionEntry = { sock: null, status: 'connecting', qrBase64: null, resolveInit: null, reconnectTimer: null };
    activeSessions.set(userId, sessionEntry);
  } else {
    sessionEntry.status = 'connecting';
  }

  return new Promise((resolve, reject) => {
    try {
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 60000
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
          const isExplicitLogout = statusCode === DisconnectReason.loggedOut;
          
          console.log(`[WhatsApp] Connection closed for ${userId}. StatusCode: ${statusCode}, isLoggedOut: ${isExplicitLogout}`);
          
          if (!isExplicitLogout) {
            sessionEntry.status = 'reconnecting';
            sessionEntry.qrBase64 = null;
            console.log(`[WhatsApp] Network drop/reset detected for ${userId}. Auto-reconnecting in 4s...`);
            
            if (sessionEntry.reconnectTimer) {
              clearTimeout(sessionEntry.reconnectTimer);
            }
            sessionEntry.reconnectTimer = setTimeout(() => {
              startSession(userId).catch(err => {
                console.error(`[WhatsApp] Auto-reconnect retry error for ${userId}:`, err?.message);
              });
            }, 4000);
          } else {
            console.log(`[WhatsApp] Session explicitly logged out for ${userId}. Clearing session.`);
            await logoutSession(userId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp] Session securely connected for ${userId}`);
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          if (sessionEntry.reconnectTimer) {
            clearTimeout(sessionEntry.reconnectTimer);
            sessionEntry.reconnectTimer = null;
          }
          
          if (sessionEntry.resolveInit) {
             sessionEntry.resolveInit({ status: 'connected' });
             sessionEntry.resolveInit = null;
          }
        }
      });

      sock.ev.on('messages.upsert', async (m) => { 
         if (m.type === 'notify') {
            for (const msg of m.messages) {
                if (msg.key?.fromMe) {
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
      sessionEntry.status = 'disconnected';
      if (sessionEntry.resolveInit) {
        sessionEntry.resolveInit = null;
      }
      reject(err);
    }
  });
}
