import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { rimraf } from 'rimraf';
import path from 'path';
import pino from 'pino';
import fs from 'fs';
import { getDb, queueMessageLog } from './firestoreService.js';

const SESSIONS_DIR = path.resolve('./sessions');
const activeSessions = new Map();
const logger = pino({ level: 'silent' });

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/**
 * Custom Firestore Remote Auth Store for Baileys.
 * Saves credentials and all keys directly into Firestore collection (/whatsapp_sessions).
 */
async function useFirestoreAuthState(userId, forceFresh = false) {
  const db = getDb();
  const localDir = path.join(SESSIONS_DIR, userId);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const memoryKeys = new Map();
  let creds = null;

  if (forceFresh) {
    // Brand new credentials
    creds = initAuthCreds();
  } else {
    // 1. Try to load credentials from Firestore Remote Store
    if (db) {
      try {
        const doc = await db.collection('whatsapp_sessions').doc(userId).get();
        if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'logged_out' && doc.data()?.status !== 'idle') {
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

    // Local backup
    try {
      fs.writeFileSync(path.join(localDir, `${keyName}.json`), JSON.stringify(value, BufferJSON.replacer));
    } catch (e) {}

    // Firestore Remote Store persistence
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
      } catch (err) {
        // quiet log
      }
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
 * Passive check on server startup.
 * Explicitly avoids endless auto-reconnect loops on boot.
 */
export async function autoRestoreSessions() {
  ensureSessionsDir();
  console.log('[WhatsApp] Server booted. Infinite auto-reconnect loops stopped. Waiting for explicit user session commands.');
}

/**
 * Periodic background ping / keep-alive heartbeat interval (every 3 minutes)
 * to maintain active connected sessions and prevent Render idle timeouts.
 */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;
setInterval(async () => {
  for (const [userId, session] of activeSessions.entries()) {
    if (session && session.status === 'connected' && session.sock) {
      try {
        await session.sock.sendPresenceUpdate('available');
        if (session.sock.ws && typeof session.sock.ws.ping === 'function') {
          session.sock.ws.ping();
        }
        console.log(`[WhatsApp Heartbeat] Keep-alive ping sent for user: ${userId}`);
      } catch (err) {
        console.warn(`[WhatsApp Heartbeat] Ping notice for ${userId}:`, err.message);
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

/**
 * Returns current session status without triggering background auto-connect.
 */
export async function getSessionStatus(userId) {
  if (activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    return {
      status: session.status || 'disconnected',
      qr: session.qrBase64 || null,
      phone: session.sock && session.sock.user ? session.sock.user.id : null,
      hasSavedSession: true
    };
  }

  // Check if saved credentials exist in Firestore or local
  const db = getDb();
  let hasCreds = false;
  if (db) {
    try {
      const doc = await db.collection('whatsapp_sessions').doc(userId).get();
      if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'logged_out' && doc.data()?.status !== 'idle') {
        hasCreds = true;
      }
    } catch (e) {}
  }

  if (!hasCreds) {
    const sessionPath = path.join(SESSIONS_DIR, userId);
    if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
      hasCreds = true;
    }
  }

  return {
    status: 'disconnected',
    qr: null,
    phone: null,
    hasSavedSession: hasCreds
  };
}

/**
 * POST /api/session/start
 * Purely triggers a fresh Baileys socket initialization and returns a new QR Code immediately.
 */
export async function startFreshSession(userId) {
  ensureSessionsDir();

  // 1. Terminate existing socket and active session cleanly
  const existing = activeSessions.get(userId);
  if (existing) {
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    if (existing.stuckTimer) clearTimeout(existing.stuckTimer);
    try {
      existing.sock?.ws?.close();
    } catch (e) {}
    activeSessions.delete(userId);
  }

  // 2. Clear local auth files for this user so a new QR is guaranteed
  const localDir = path.join(SESSIONS_DIR, userId);
  try {
    await rimraf(localDir);
    fs.mkdirSync(localDir, { recursive: true });
  } catch (e) {}

  // 3. Clear remote creds in Firestore so Baileys does not auto-resume old session
  const db = getDb();
  if (db) {
    try {
      await db.collection('whatsapp_sessions').doc(userId).set({
        creds: null,
        status: 'disconnected',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {}
  }

  const { state, saveCreds } = await useFirestoreAuthState(userId, true);
  const { version } = await fetchLatestBaileysVersion();

  const sessionEntry = {
    sock: null,
    status: 'connecting',
    qrBase64: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 1,
    stuckTimer: null,
    reconnectTimer: null
  };
  activeSessions.set(userId, sessionEntry);

  return new Promise((resolve, reject) => {
    let resolved = false;

    // Safety timeout: if no QR or connection within 15 seconds, resolve with status
    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({
          status: sessionEntry.status || 'disconnected',
          qr: sessionEntry.qrBase64 || null
        });
      }
    }, 15000);

    try {
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false,
        connectTimeoutMs: 15000,
        keepAliveIntervalMs: 20000,
        defaultQueryTimeoutMs: 15000
      });

      sessionEntry.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            sessionEntry.status = 'qr';
            sessionEntry.qrBase64 = qrBase64;
            console.log(`[WhatsApp Start] Fresh QR code generated successfully for ${userId}`);

            if (!resolved) {
              resolved = true;
              clearTimeout(safetyTimeout);
              resolve({ status: 'qr', qr: qrBase64 });
            }
          } catch (err) {
            console.error('[WhatsApp Start] QR Code Generation Error:', err);
          }
        }

        if (connection === 'open') {
          console.log(`[WhatsApp Start] Connected successfully for ${userId}`);
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          sessionEntry.reconnectAttempts = 0;

          if (db) {
            db.collection('whatsapp_sessions').doc(userId).set({
              status: 'active',
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }

          if (!resolved) {
            resolved = true;
            clearTimeout(safetyTimeout);
            resolve({ status: 'connected' });
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[WhatsApp Start] Socket closed for ${userId}. Code: ${statusCode}`);
          sessionEntry.status = 'disconnected';
          sessionEntry.sock = null;

          if (!resolved) {
            resolved = true;
            clearTimeout(safetyTimeout);
            resolve({ status: 'disconnected', error: 'Connection closed' });
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
 * POST /api/session/reconnect
 * Manually attempts ONE-TIME reconnection using previously saved auth files.
 * If it fails or gets stuck for > 5 seconds, fallback to DISCONNECTED immediately and output a fresh QR Code.
 */
export async function manualReconnectSession(userId) {
  ensureSessionsDir();

  // 1. Check if saved credentials exist
  let hasSaved = false;
  const db = getDb();
  if (db) {
    try {
      const doc = await db.collection('whatsapp_sessions').doc(userId).get();
      if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'logged_out' && doc.data()?.status !== 'idle') {
        hasSaved = true;
      }
    } catch (e) {}
  }

  const localCredsPath = path.join(SESSIONS_DIR, userId, 'creds.json');
  if (!hasSaved && fs.existsSync(localCredsPath)) {
    hasSaved = true;
  }

  // If no saved session exists, generate a fresh QR code immediately
  if (!hasSaved) {
    console.log(`[WhatsApp Reconnect] No saved auth found for ${userId}. Falling back to fresh QR immediately.`);
    const fresh = await startFreshSession(userId);
    return {
      status: fresh.status || 'qr',
      qr: fresh.qr || null,
      fallback: true,
      message: 'No saved session found. Fresh QR code generated.'
    };
  }

  // 2. Terminate existing session before attempting one-time reconnect
  const existing = activeSessions.get(userId);
  if (existing) {
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    if (existing.stuckTimer) clearTimeout(existing.stuckTimer);
    try {
      existing.sock?.ws?.close();
    } catch (e) {}
    activeSessions.delete(userId);
  }

  const sessionEntry = {
    sock: null,
    status: 'reconnecting',
    qrBase64: null,
    reconnectAttempts: 1, // Strict max reconnect attempts = 1
    maxReconnectAttempts: 1,
    stuckTimer: null,
    reconnectTimer: null
  };
  activeSessions.set(userId, sessionEntry);

  const { state, saveCreds } = await useFirestoreAuthState(userId, false);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve) => {
    let resolved = false;

    // Strict 5-second timeout for reconnect attempt
    const fallbackToFreshQR = async (reason) => {
      if (resolved) return;
      resolved = true;

      if (sessionEntry.stuckTimer) {
        clearTimeout(sessionEntry.stuckTimer);
        sessionEntry.stuckTimer = null;
      }

      console.log(`[WhatsApp Reconnect] Reconnect attempt failed for ${userId} (${reason}). Forcing DISCONNECTED & generating fresh QR.`);
      try {
        sessionEntry.sock?.ws?.close();
      } catch (e) {}
      sessionEntry.sock = null;
      sessionEntry.status = 'disconnected';

      // Fallback to fresh QR code
      try {
        const freshRes = await startFreshSession(userId);
        resolve({
          status: freshRes.status || 'qr',
          qr: freshRes.qr || null,
          fallback: true,
          message: 'Saved session reconnection failed. Fresh QR code generated.'
        });
      } catch (err) {
        resolve({
          status: 'disconnected',
          qr: null,
          fallback: true,
          message: 'Reconnection failed and QR generation encountered an issue.'
        });
      }
    };

    sessionEntry.stuckTimer = setTimeout(() => {
      fallbackToFreshQR('stuck in reconnecting for >5 seconds');
    }, 5000);

    try {
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        syncFullHistory: false,
        connectTimeoutMs: 5000,
        keepAliveIntervalMs: 20000,
        defaultQueryTimeoutMs: 5000
      });

      sessionEntry.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrBase64 = await QRCode.toDataURL(qr);
            sessionEntry.status = 'qr';
            sessionEntry.qrBase64 = qrBase64;
            if (!resolved) {
              resolved = true;
              if (sessionEntry.stuckTimer) clearTimeout(sessionEntry.stuckTimer);
              resolve({ status: 'qr', qr: qrBase64 });
            }
          } catch (e) {}
        }

        if (connection === 'open') {
          console.log(`[WhatsApp Reconnect] Successfully reconnected saved session for ${userId}`);
          if (sessionEntry.stuckTimer) {
            clearTimeout(sessionEntry.stuckTimer);
            sessionEntry.stuckTimer = null;
          }
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          sessionEntry.reconnectAttempts = 0;

          if (db) {
            db.collection('whatsapp_sessions').doc(userId).set({
              status: 'active',
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }

          if (!resolved) {
            resolved = true;
            resolve({ status: 'connected' });
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          fallbackToFreshQR(`socket closed with status ${statusCode}`);
        }
      });
    } catch (err) {
      fallbackToFreshQR(`socket init error: ${err?.message}`);
    }
  });
}

/**
 * POST /api/session/reset
 * Completely deletes local auth folders and resets socket state to IDLE.
 */
export async function resetSession(userId) {
  const sessionData = activeSessions.get(userId);
  if (sessionData) {
    if (sessionData.reconnectTimer) clearTimeout(sessionData.reconnectTimer);
    if (sessionData.stuckTimer) clearTimeout(sessionData.stuckTimer);
    if (sessionData.sock) {
      try {
        await sessionData.sock.logout().catch(() => {});
      } catch (err) {}
      try {
        sessionData.sock.ws?.close();
      } catch (err) {}
    }
    activeSessions.delete(userId);
  }

  // 1. Mark status idle in Firestore and wipe remote session keys
  const db = getDb();
  if (db) {
    try {
      await db.collection('whatsapp_sessions').doc(userId).set({
        status: 'idle',
        creds: null,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const keysSnap = await db.collection('whatsapp_sessions').doc(userId).collection('keys').get();
      if (!keysSnap.empty) {
        const batch = db.batch();
        keysSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit().catch(() => {});
      }
    } catch (err) {
      console.warn(`[WhatsApp] Error resetting Firestore session for ${userId}:`, err?.message);
    }
  }

  // 2. Delete local auth folders completely
  const sessionPath = path.join(SESSIONS_DIR, userId);
  try {
    await rimraf(sessionPath);
    console.log(`[WhatsApp] Completely deleted local auth folder for ${userId}`);
  } catch (err) {
    console.error(`[WhatsApp] Error deleting session dir for ${userId}:`, err?.message);
  }

  return { status: 'idle', message: 'Local auth folders deleted and socket state reset to IDLE.' };
}

// Alias for logout
export const logoutSession = resetSession;

// Alias for startSession
export const startSession = startFreshSession;

export async function sendWhatsAppMessage(userId, to, message) {
  const session = activeSessions.get(userId);
  if (!session || !session.sock || session.status !== 'connected') {
    throw new Error('WhatsApp session is not connected');
  }

  try {
    const sock = session.sock;
    const formattedPhone = to.replace(/[^0-9]/g, '');
    const jid = `${formattedPhone}@s.whatsapp.net`;

    const result = await sock.sendMessage(jid, { text: message });
    return { success: true, messageId: result.key?.id };
  } catch (err) {
    console.error(`[WhatsApp] Send message error for ${userId}:`, err?.message || err);
    throw new Error('Failed to send WhatsApp message: ' + (err?.message || 'Unknown error'));
  }
}
