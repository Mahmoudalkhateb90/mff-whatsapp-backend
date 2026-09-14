import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { rimraf } from 'rimraf';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import { queueMessageLog, incrementCampaignStats } from './firestoreService.js';

// Local storage path for Baileys auth states.
// By storing auth state on the server disk, we avoid thousands of Firestore reads/writes.
const SESSIONS_DIR = path.resolve('./sessions');

// Store active socket instances and connection promises in memory
const activeSessions = new Map();

// Minimal logger to avoid massive console output
const logger = pino({ level: 'silent' });

/**
 * Helper to ensure the sessions directory exists
 */
function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Fetches the connection status of a specific session
 */
export async function getSessionStatus(userId) {
  if (activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    return session.status || 'connected';
  }
  
  // If not in memory, check disk for existing auth files
  const sessionPath = path.join(SESSIONS_DIR, userId);
  if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
    return 'disconnected_but_has_creds';
  }
  
  return 'disconnected';
}

/**
 * Starts a new WhatsApp session or resumes an existing one.
 */
export async function startSession(userId) {
  ensureSessionsDir();
  
  // Return early if already in progress or connected
  if (activeSessions.has(userId)) {
    return { status: 'already_active' };
  }

  const sessionPath = path.join(SESSIONS_DIR, userId);
  
  // useMultiFileAuthState stores creds locally in /sessions/{userId}
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve, reject) => {
    try {
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false // optimize memory
      });

      // Save credentials to local disk automatically
      sock.ev.on('creds.update', saveCreds);

      // Handle Connection Lifecycle
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            activeSessions.set(userId, { sock, status: 'connecting' });
            resolve({ status: 'qr_ready', qr: qrBase64 });
          } catch (err) {
            reject(err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          activeSessions.delete(userId);
          console.log(`[WhatsApp] Connection closed for ${userId}. Reason: ${statusCode}`);
          
          if (shouldReconnect) {
            console.log(`[WhatsApp] Attempting reconnect for ${userId}...`);
            // Add robust connection retry logic
            setTimeout(() => startSession(userId).catch(console.error), 5000); 
          } else {
            console.log(`[WhatsApp] Logged out for ${userId}. Clearing session.`);
            await logoutSession(userId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp] Session securely connected for ${userId}`);
          activeSessions.set(userId, { sock, status: 'connected' });
          
          // If we re-connected without needing a new QR (existing creds)
          if (!qr) {
             resolve({ status: 'connected' });
          }
        }
      });

      // Example of capturing outbound messages for batch logging
      sock.ev.on('messages.upsert', async (m) => {
         if (m.type === 'notify') {
            for (const msg of m.messages) {
                // If it's a message we sent (e.g. from a campaign)
                if (msg.key.fromMe) {
                  queueMessageLog({
                      userId,
                      remoteJid: msg.key.remoteJid,
                      messageId: msg.key.id,
                      status: 'sent',
                  });
                  
                  // Extract campaign ID from msg if applicable, and increment summary
                  // incrementCampaignStats('campaign_123', { messagesSent: 1 });
                }
            }
         }
      });

    } catch (err) {
      console.error(`[WhatsApp] Init error for ${userId}:`, err);
      reject(err);
    }
  });
}

/**
 * Logs out a session, cleanly terminates the socket, and clears disk space.
 */
export async function logoutSession(userId) {
  const sessionData = activeSessions.get(userId);
  if (sessionData && sessionData.sock) {
    try {
      await sessionData.sock.logout();
      sessionData.sock.ws.close();
    } catch (err) {
      console.error(`[WhatsApp] Error closing socket for ${userId}:`, err);
    }
    activeSessions.delete(userId);
  }
  
  // Wipe the local session directory to prevent stale state issues
  const sessionPath = path.join(SESSIONS_DIR, userId);
  await rimraf(sessionPath);
  console.log(`[WhatsApp] Cleared session data for ${userId}`);
  
  return { status: 'logged_out' };
}
