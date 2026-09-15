import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { rimraf } from 'rimraf';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import { getDb, queueMessageLog } from './firestoreService.js';

const SESSIONS_DIR = path.resolve('./sessions');
const logger = pino({ level: 'silent' });

// Global in-memory Map of active Baileys sockets isolated by userId
export const activeSockets = new Map();
// Backward compatibility alias
export const activeSessions = activeSockets;

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
 * Custom Per-User Isolated Firestore Auth State for Baileys.
 * Saves credentials and all keys directly into Firestore collection (/whatsapp_sessions/{userId}).
 */
async function useFirestoreAuthState(userId, forceFresh = false) {
  const db = getDb();
  const localDir = getUserSessionDir(userId);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const memoryKeys = new Map();
  let creds = null;

  if (forceFresh) {
    creds = initAuthCreds();
  } else {
    // 1. Try to load credentials from Firestore Remote Store
    if (db) {
      try {
        const doc = await db.collection('whatsapp_sessions').doc(userId).get();
        if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'disconnected' && doc.data()?.status !== 'logged_out') {
          creds = JSON.parse(doc.data().creds, BufferJSON.reviver);
          console.log(`[WhatsApp Auth] Loaded creds for ${userId} from Firestore remote auth store.`);
        }
      } catch (e) {
        console.warn(`[WhatsApp Auth] Firestore creds read notice for ${userId}:`, e.message);
      }
    }

    // 2. Secondary fallback: local disk cache
    if (!creds) {
      const localCredsPath = path.join(localDir, 'creds.json');
      if (fs.existsSync(localCredsPath)) {
        try {
          const data = fs.readFileSync(localCredsPath, 'utf8');
          creds = JSON.parse(data, BufferJSON.reviver);
          console.log(`[WhatsApp Auth] Restored creds for ${userId} from local cache.`);
        } catch (e) {}
      }
    }

    // 3. Fallback to fresh if neither exists
    if (!creds) {
      creds = initAuthCreds();
    }
  }

  const fixKeyName = (cat, id) => `${cat}_${id}`.replace(/\//g, '__').replace(/:/g, '-');

  const writeData = async (cat, id, value) => {
    const keyName = fixKeyName(cat, id);
    memoryKeys.set(keyName, value);

    // Local disk backup
    try {
      fs.writeFileSync(path.join(localDir, `${keyName}.json`), JSON.stringify(value, BufferJSON.replacer));
    } catch (e) {}

    // Firestore remote store
    if (db) {
      try {
        const docRef = db.collection('whatsapp_sessions').doc(userId).collection('keys').doc(keyName);
        if (value) {
          await docRef.set({
            value: JSON.stringify(value, BufferJSON.replacer),
            updatedAt: new Date().toISOString()
          });
        } else {
          await docRef.delete();
        }
      } catch (err) {}
    }
  };

  const readData = async (cat, id) => {
    const keyName = fixKeyName(cat, id);
    if (memoryKeys.has(keyName)) {
      return memoryKeys.get(keyName);
    }

    // Try Firestore remote store
    if (db) {
      try {
        const doc = await db.collection('whatsapp_sessions').doc(userId).collection('keys').doc(keyName).get();
        if (doc.exists && doc.data()?.value) {
          const val = JSON.parse(doc.data().value, BufferJSON.reviver);
          memoryKeys.set(keyName, val);
          return val;
        }
      } catch (err) {}
    }

    // Try local backup
    const localKeyPath = path.join(localDir, `${keyName}.json`);
    if (fs.existsSync(localKeyPath)) {
      try {
        const data = fs.readFileSync(localKeyPath, 'utf8');
        const val = JSON.parse(data, BufferJSON.reviver);
        memoryKeys.set(keyName, val);
        return val;
      } catch (e) {}
    }

    return null;
  };

  const removeData = async (cat, id) => {
    const keyName = fixKeyName(cat, id);
    memoryKeys.delete(keyName);
    try {
      const localKeyPath = path.join(localDir, `${keyName}.json`);
      if (fs.existsSync(localKeyPath)) fs.unlinkSync(localKeyPath);
    } catch (e) {}

    if (db) {
      try {
        await db.collection('whatsapp_sessions').doc(userId).collection('keys').doc(keyName).delete();
      } catch (e) {}
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(type, id);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              tasks.push(value ? writeData(category, id, value) : removeData(category, id));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      try {
        fs.writeFileSync(path.join(localDir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
      } catch (e) {}

      if (db) {
        try {
          await db.collection('whatsapp_sessions').doc(userId).set({
            creds: JSON.stringify(creds, BufferJSON.replacer),
            status: 'active',
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {}
      }
    }
  };
}

/**
 * Periodic background ping / keep-alive heartbeat interval (every 3 minutes)
 * to maintain active connected sessions per user.
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
        console.log(`[WhatsApp Heartbeat] Keep-alive ping sent for user: ${userId}`);
      } catch (err) {
        console.warn(`[WhatsApp Heartbeat] Ping notice for ${userId}:`, err?.message);
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

/**
 * Returns current session status for a specific user without triggering any side effects.
 */
export async function getSessionStatus(userId) {
  if (!userId) {
    return { status: 'disconnected', qr: null, phone: null };
  }

  if (activeSockets.has(userId)) {
    const session = activeSockets.get(userId);
    let phone = session.phone || null;
    if (!phone && session.sock?.user?.id) {
      phone = session.sock.user.id.split(':')[0] || session.sock.user.id;
    }
    return {
      status: session.status || 'disconnected',
      qr: session.qrBase64 || null,
      phone: phone
    };
  }

  return {
    status: 'disconnected',
    qr: null,
    phone: null
  };
}

/**
 * Core WhatsApp Session Starter and Manager (Per-User Isolated)
 * 
 * - If an existing socket exists for this userId, it is closed cleanly first.
 * - Initializes a new Baileys socket strictly for userId.
 * - Listens for 'qr' and immediately provides QR string to frontend.
 * - Handles code 515 (restartRequired) without losing authentication.
 * - Handles code 401 (loggedOut) by cleaning user's auth storage and marking disconnected.
 */
export async function startWhatsAppSession(userId, options = {}) {
  if (!userId) throw new Error('User ID is required to start a WhatsApp session');
  
  ensureSessionsDir();
  const { forceFresh = true, isRestart = false, maxWaitMs = 15000 } = options;

  let sessionEntry = activeSockets.get(userId);

  if (isRestart && sessionEntry) {
    console.log(`[WhatsApp] Clean socket restart (code 515) for user ${userId}...`);
    try {
      sessionEntry.sock?.ws?.close();
    } catch (e) {}
    sessionEntry.sock = null;
    sessionEntry.status = 'connecting';
  } else {
    // Terminate existing socket if any for this user
    if (sessionEntry) {
      try {
        sessionEntry.sock?.ws?.close();
      } catch (e) {}
      activeSockets.delete(userId);
    }

    if (forceFresh) {
      // Clear local auth folder for this user
      const localDir = getUserSessionDir(userId);
      const legacyDir = path.join(SESSIONS_DIR, userId);
      try {
        await rimraf(localDir);
        await rimraf(legacyDir);
        fs.mkdirSync(localDir, { recursive: true });
      } catch (e) {}

      // Clear remote creds in Firestore for this user
      const db = getDb();
      if (db) {
        try {
          await db.collection('whatsapp_sessions').doc(userId).set({
            creds: null,
            status: 'disconnected',
            updatedAt: new Date().toISOString()
          }, { merge: true });

          const keysSnap = await db.collection('whatsapp_sessions').doc(userId).collection('keys').get();
          if (!keysSnap.empty) {
            const batch = db.batch();
            keysSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit().catch(() => {});
          }
        } catch (e) {}
      }
    }

    sessionEntry = {
      userId,
      sock: null,
      status: 'connecting',
      qrBase64: null,
      phone: null
    };
    activeSockets.set(userId, sessionEntry);
  }

  // Load auth state for this user
  const { state, saveCreds } = await useFirestoreAuthState(userId, forceFresh && !isRestart);

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
        resolve({
          status: sessionEntry.status || 'disconnected',
          qr: sessionEntry.qrBase64 || null,
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

        // QR Code generation
        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            sessionEntry.status = 'qr';
            sessionEntry.qrBase64 = qrBase64;
            console.log(`[WhatsApp] QR code generated successfully for user ${userId}`);

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

          const db = getDb();
          if (db) {
            db.collection('whatsapp_sessions').doc(userId).set({
              status: 'connected',
              phone: rawPhone,
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }

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
            console.log(`[WhatsApp] Disconnect code 515 (restartRequired) for user ${userId}. Restarting socket...`);
            sessionEntry.status = 'connecting';
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
            console.log(`[WhatsApp] Logged out (401) for user ${userId}. Wiping session.`);
            const localDir = getUserSessionDir(userId);
            const legacyDir = path.join(SESSIONS_DIR, userId);
            try {
              await rimraf(localDir);
              await rimraf(legacyDir);
            } catch (e) {}

            const db = getDb();
            if (db) {
              try {
                await db.collection('whatsapp_sessions').doc(userId).set({
                  status: 'disconnected',
                  creds: null,
                  phone: null,
                  updatedAt: new Date().toISOString()
                }, { merge: true });
              } catch (e) {}
            }

            sessionEntry.status = 'disconnected';
            sessionEntry.qrBase64 = null;
            sessionEntry.phone = null;
            sessionEntry.sock = null;

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
          }

          if (!resolved) {
            resolved = true;
            clearTimeout(safetyTimeout);
            resolve({
              status: sessionEntry.status || 'disconnected',
              qr: sessionEntry.qrBase64 || null,
              error: `Socket closed (${statusCode})`
            });
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
                status: 'sent'
              });
            }
          }
        }
      });
    } catch (err) {
      clearTimeout(safetyTimeout);
      sessionEntry.status = 'disconnected';
      reject(err);
    }
  });
}

/**
 * POST /api/session/start
 * Initializes a new Baileys socket strictly for userId and generates a new QR code.
 */
export async function startFreshSession(userId) {
  return await startWhatsAppSession(userId, { forceFresh: true });
}

export const startSession = startFreshSession;

/**
 * POST /api/session/disconnect
 * Closes socket for userId, clears auth_info_${userId}, and marks user as DISCONNECTED.
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

  // 1. Wipe remote session in Firestore
  const db = getDb();
  if (db) {
    try {
      await db.collection('whatsapp_sessions').doc(userId).set({
        status: 'disconnected',
        creds: null,
        phone: null,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const keysSnap = await db.collection('whatsapp_sessions').doc(userId).collection('keys').get();
      if (!keysSnap.empty) {
        const batch = db.batch();
        keysSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit().catch(() => {});
      }
    } catch (err) {
      console.warn(`[WhatsApp] Error clearing Firestore session for ${userId}:`, err?.message);
    }
  }

  // 2. Delete local auth folders
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
 * Check if the given user is currently in connecting state
 */
export function isUserConnecting(userId) {
  const session = activeSockets.get(userId);
  return session && (session.status === 'connecting');
}

/**
 * Check if any user is currently in connecting state
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

  try {
    const formattedPhone = to.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const result = await session.sock.sendMessage(jid, { text: message });
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
  console.log('[WhatsApp] Server booted. User sessions will initialize when users log in.');
}
