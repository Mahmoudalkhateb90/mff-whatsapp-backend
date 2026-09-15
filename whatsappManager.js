import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { rimraf } from 'rimraf';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import { queueMessageLog } from './firestoreService.js';

const SESSIONS_DIR = path.resolve('./sessions');
const logger = pino({ level: 'silent' });

// Global strictly In-Memory Maps to eliminate ephemeral Firestore write quota exhaustion
export const activeSockets = new Map(); // userId -> { userId, sock, status, phone, qrBase64 }
export const activeQRCodes = new Map(); // userId -> qrCodeBase64 string
export const activeUserStatuses = new Map(); // userId -> { status, phone, qr }

// Backward compatibility alias
export const activeSessions = activeSockets;
export { activeCampaigns } from './campaignManager.js';

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function getUserSessionDir(userId) {
  ensureSessionsDir();
  return path.join(SESSIONS_DIR, `auth_info_${userId}`);
}

/**
 * Periodic background ping / keep-alive heartbeat interval (every 3 minutes)
 * to maintain active connected sockets in Node.js memory. Zero DB writes.
 */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;
setInterval(async () => {
  for (const [userId, session] of activeSockets.entries()) {
    if (session && session.status === 'connected' && session.sock) {
      try {
        await session.sock.sendPresenceUpdate('available');
        if (session.sock.ws && typeof session.sock.ws.ping === 'function') {
          session.sock.ws.ping();
        }
      } catch (err) {
        // quiet in-memory notice
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

/**
 * Returns current session status for a specific user strictly from memory.
 * Zero Firestore reads/writes.
 */
export async function getSessionStatus(userId) {
  if (!userId) {
    return { status: 'disconnected', qr: null, phone: null };
  }

  const qr = activeQRCodes.get(userId) || null;
  const memStatus = activeUserStatuses.get(userId);
  const session = activeSockets.get(userId);

  let status = memStatus?.status || session?.status || 'disconnected';
  let phone = memStatus?.phone || session?.phone || null;

  if (!phone && session?.sock?.user?.id) {
    phone = session.sock.user.id.split(':')[0] || session.sock.user.id;
  }

  // If QR code is present and status is not connected, reflect 'qr'
  if (qr && status !== 'connected') {
    status = 'qr';
  }

  return {
    status,
    qr: status === 'connected' ? null : qr,
    phone
  };
}

/**
 * Core WhatsApp Session Starter and Manager (Per-User Isolated, In-Memory Ephemeral Data)
 * 
 * - Multi-file auth state stored strictly on local container disk (`./sessions/auth_info_${userId}`).
 * - QR codes and connection statuses stored purely in server RAM (`activeQRCodes`, `activeUserStatuses`).
 * - Zero ephemeral document writes to Firestore.
 */
export async function startWhatsAppSession(userId, options = {}) {
  if (!userId) throw new Error('User ID is required to start a WhatsApp session');
  
  ensureSessionsDir();
  const { forceFresh = true, isRestart = false, maxWaitMs = 15000 } = options;

  let sessionEntry = activeSockets.get(userId);

  if (isRestart && sessionEntry) {
    console.log(`[WhatsApp] In-memory socket restart (code 515) for user ${userId}...`);
    try {
      sessionEntry.sock?.ws?.close();
    } catch (e) {}
    sessionEntry.sock = null;
    sessionEntry.status = 'connecting';
    activeUserStatuses.set(userId, { status: 'connecting', phone: sessionEntry.phone || null, qr: null });
  } else {
    // Terminate existing socket if any for this user
    if (sessionEntry) {
      try {
        sessionEntry.sock?.ws?.close();
      } catch (e) {}
      activeSockets.delete(userId);
    }

    activeQRCodes.delete(userId);

    if (forceFresh) {
      // Clear local auth folder on disk for this user
      const localDir = getUserSessionDir(userId);
      const legacyDir = path.join(SESSIONS_DIR, userId);
      try {
        await rimraf(localDir);
        await rimraf(legacyDir);
        fs.mkdirSync(localDir, { recursive: true });
      } catch (e) {}
    }

    sessionEntry = {
      userId,
      sock: null,
      status: 'connecting',
      qrBase64: null,
      phone: null
    };
    activeSockets.set(userId, sessionEntry);
    activeUserStatuses.set(userId, { status: 'connecting', phone: null, qr: null });
  }

  // Local filesystem multi-file auth state (zero Firestore writes)
  const localDir = getUserSessionDir(userId);
  const { state, saveCreds } = await useMultiFileAuthState(localDir);

  // Fetch latest WhatsApp Web version with safe fallback
  let version;
  try {
    const versionData = await fetchLatestBaileysVersion();
    version = versionData.version;
  } catch (e) {
    version = [2, 3000, 1015901307];
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const currentQR = activeQRCodes.get(userId) || sessionEntry.qrBase64 || null;
        resolve({
          status: sessionEntry.status || (currentQR ? 'qr' : 'disconnected'),
          qr: currentQR,
          phone: sessionEntry.phone || null
        });
      }
    }, maxWaitMs);

    try {
      const sock = makeWASocket({
        version,
        browser: ['MFF WhatsApp', 'Chrome', '120.0.0'],
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false,
        connectTimeoutMs: 20000,
        keepAliveIntervalMs: 20000,
        defaultQueryTimeoutMs: 20000
      });

      sessionEntry.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // In-Memory QR Code generation
        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            sessionEntry.status = 'qr';
            sessionEntry.qrBase64 = qrBase64;
            
            // Store purely in RAM
            activeQRCodes.set(userId, qrBase64);
            activeUserStatuses.set(userId, { status: 'qr', phone: null, qr: qrBase64 });
            console.log(`[WhatsApp] In-memory QR code ready for user ${userId}`);

            if (!resolved) {
              resolved = true;
              clearTimeout(safetyTimeout);
              resolve({ status: 'qr', qr: qrBase64 });
            }
          } catch (err) {
            console.error(`[WhatsApp] QR generation error for ${userId}:`, err);
          }
        }

        // Connection open
        if (connection === 'open') {
          const rawPhone = sock.user?.id ? (sock.user.id.split(':')[0] || sock.user.id) : null;
          console.log(`[WhatsApp] Connected successfully for user ${userId} (Phone: ${rawPhone})`);
          
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          sessionEntry.phone = rawPhone;

          // Clear QR and mark connected in memory
          activeQRCodes.delete(userId);
          activeUserStatuses.set(userId, { status: 'connected', phone: rawPhone, qr: null });

          if (!resolved) {
            resolved = true;
            clearTimeout(safetyTimeout);
            resolve({ status: 'connected', phone: rawPhone });
          }
        }

        // Connection close
        if (connection === 'close') {
          const error = lastDisconnect?.error;
          const statusCode = error?.output?.statusCode || error?.output?.payload?.statusCode;
          console.log(`[WhatsApp] Connection closed for user ${userId}. StatusCode: ${statusCode}`);

          // Handle Code 515 (Restart Required)
          if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
            console.log(`[WhatsApp] Disconnect code 515 for user ${userId}. Restarting in memory...`);
            sessionEntry.status = 'connecting';
            activeUserStatuses.set(userId, { status: 'connecting', phone: sessionEntry.phone || null, qr: null });
            
            startWhatsAppSession(userId, { isRestart: true }).then((res) => {
              if (!resolved && res?.status === 'connected') {
                resolved = true;
                clearTimeout(safetyTimeout);
                resolve(res);
              }
            }).catch((err) => {
              console.error(`[WhatsApp] Restart error for ${userId}:`, err);
            });
            return;
          }

          // Handle Logged Out (401)
          if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
            console.log(`[WhatsApp] Logged out (401) for user ${userId}. Wiping local auth files.`);
            const localDir = getUserSessionDir(userId);
            const legacyDir = path.join(SESSIONS_DIR, userId);
            try {
              await rimraf(localDir);
              await rimraf(legacyDir);
            } catch (e) {}

            sessionEntry.status = 'disconnected';
            sessionEntry.qrBase64 = null;
            sessionEntry.phone = null;
            sessionEntry.sock = null;

            activeQRCodes.delete(userId);
            activeUserStatuses.set(userId, { status: 'disconnected', phone: null, qr: null });

            if (!resolved) {
              resolved = true;
              clearTimeout(safetyTimeout);
              resolve({ status: 'disconnected', error: 'Logged out (401)' });
            }
            return;
          }

          sessionEntry.sock = null;
          if (sessionEntry.status !== 'qr') {
            sessionEntry.status = 'disconnected';
            activeUserStatuses.set(userId, { status: 'disconnected', phone: null, qr: null });
          }

          if (!resolved) {
            resolved = true;
            clearTimeout(safetyTimeout);
            resolve({
              status: sessionEntry.status || 'disconnected',
              qr: activeQRCodes.get(userId) || sessionEntry.qrBase64 || null,
              error: `Socket closed (${statusCode})`
            });
          }
        }
      });

      // Sent messages delivery log (persistent business data queued to Firestore)
      sock.ev.on('messages.upsert', async (m) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (msg.key?.fromMe) {
              queueMessageLog({
                userId,
                remoteJid: msg.key.remoteJid,
                messageId: msg.key.id,
                status: 'sent'
              });
            }
          }
        }
      });
    } catch (err) {
      clearTimeout(safetyTimeout);
      sessionEntry.status = 'disconnected';
      activeUserStatuses.set(userId, { status: 'disconnected', phone: null, qr: null });
      reject(err);
    }
  });
}

/**
 * POST /api/session/start
 * Initializes a new Baileys socket strictly for userId and returns QR code in memory.
 */
export async function startFreshSession(userId) {
  return await startWhatsAppSession(userId, { forceFresh: true });
}

export const startSession = startFreshSession;

/**
 * POST /api/session/disconnect
 * Closes socket for userId, clears memory state & local auth_info_${userId}, and marks user as DISCONNECTED.
 */
export async function disconnectWhatsAppSession(userId) {
  if (!userId) return { status: 'disconnected', message: 'No user ID specified' };

  const session = activeSockets.get(userId);
  if (session) {
    if (session.sock) {
      try {
        await session.sock.logout().catch(() => {});
      } catch (err) {}
      try {
        session.sock.ws?.close();
      } catch (err) {}
    }
    activeSockets.delete(userId);
  }

  // Clear in-memory maps
  activeQRCodes.delete(userId);
  activeUserStatuses.set(userId, { status: 'disconnected', phone: null, qr: null });

  // Delete local auth folder
  const localDir = getUserSessionDir(userId);
  const legacyDir = path.join(SESSIONS_DIR, userId);
  try {
    await rimraf(localDir);
    await rimraf(legacyDir);
    console.log(`[WhatsApp] Deleted local auth directory for user: ${userId}`);
  } catch (err) {
    console.error(`[WhatsApp] Error deleting auth folder for ${userId}:`, err?.message);
  }

  return { status: 'disconnected', message: 'Session disconnected and auth cleared' };
}

// Aliases for reset/logout
export const resetSession = disconnectWhatsAppSession;
export const logoutSession = disconnectWhatsAppSession;

/**
 * Check if the given user is currently in connecting state in memory
 */
export function isUserConnecting(userId) {
  const session = activeSockets.get(userId);
  const userStatus = activeUserStatuses.get(userId);
  return (session?.status === 'connecting') || (userStatus?.status === 'connecting');
}

/**
 * Check if any user is currently in connecting state in memory
 */
export function isWhatsAppConnectingOrInitializing() {
  for (const s of activeSockets.values()) {
    if (s && s.status === 'connecting') {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a specific user has an active connected socket
 */
export function isUserConnected(userId) {
  const session = activeSockets.get(userId);
  return !!(session && session.sock && session.status === 'connected');
}

/**
 * Direct synchronous socket transmission helper.
 * STRICT ISOLATION: Retrieves ONLY the socket corresponding to the provided userId.
 * Zero fallback to super-admin or any other connected socket.
 */
export async function sendWhatsAppMessageDirect(userId, to, message) {
  if (!userId) {
    throw new Error('User ID is required to send WhatsApp messages');
  }

  const session = activeSockets.get(userId);

  if (!session || !session.sock || session.status !== 'connected') {
    throw new Error(`WhatsApp session not connected for this user (${userId})`);
  }

  if (message === undefined || message === null || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message text cannot be empty or undefined');
  }

  try {
    const formattedPhone = to.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;
    const textToSend = message.trim();

    const result = await session.sock.sendMessage(jid, { text: textToSend });
    return { success: true, messageId: result.key?.id };
  } catch (err) {
    console.error(`[WhatsApp] Send message error for user ${userId} to ${to}:`, err?.message || err);
    throw new Error('Failed to send WhatsApp message: ' + (err?.message || 'Unknown error'));
  }
}

export async function sendWhatsAppMessage(userId, to, message) {
  return await sendWhatsAppMessageDirect(userId, to, message);
}

export async function autoRestoreSessions() {
  ensureSessionsDir();
  console.log('[WhatsApp] Server booted. Ephemeral session data stored in memory.');
}
