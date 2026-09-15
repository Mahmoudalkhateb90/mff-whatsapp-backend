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
 * Never loses sessions on Render restarts or ephemeral filesystem wipes.
 */
async function useFirestoreAuthState(userId) {
  const db = getDb();
  const localDir = path.join(SESSIONS_DIR, userId);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const memoryKeys = new Map();
  let creds = null;

  // 1. Try to load credentials from Firestore Remote Store
  if (db) {
    try {
      const doc = await db.collection('whatsapp_sessions').doc(userId).get();
      if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'logged_out') {
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
        // Sync to Firestore immediately
        if (db && creds) {
          db.collection('whatsapp_sessions').doc(userId).set({
            creds: JSON.stringify(creds, BufferJSON.replacer),
            status: 'active',
            updatedAt: new Date().toISOString()
          }, { merge: true }).catch(() => {});
        }
      } catch (e) {}
    }
  }

  // 3. Brand new session initialization if neither exists
  if (!creds) {
    creds = initAuthCreds();
  }

  const fixKeyName = (cat, id) => `${cat}_${id}`.replace(/\//g, '__').replace(/:/g, '-');

  const writeData = async (cat, id, value) => {
    const keyName = fixKeyName(cat, id);
    memoryKeys.set(keyName, value);

    // Fast local backup
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
        console.warn(`[WhatsApp Auth] Key write notice for ${keyName}:`, err.message);
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
      } catch (err) {
        // quiet warning
      }
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
      // Local backup write
      try {
        fs.writeFileSync(path.join(localDir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
      } catch (e) {}

      // Firestore Remote Store write
      if (db) {
        try {
          await db.collection('whatsapp_sessions').doc(userId).set({
            creds: JSON.stringify(creds, BufferJSON.replacer),
            status: 'active',
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.warn(`[WhatsApp Auth] Notice saving creds to Firestore for ${userId}:`, err.message);
        }
      }
    }
  };
}

/**
 * On backend startup/restart, automatically loads session tokens from Firestore
 * so the WhatsApp client restores its connection automatically WITHOUT requiring a QR Code rescan.
 */
export async function autoRestoreSessions() {
  ensureSessionsDir();
  const restoredUsers = new Set();

  // 1. Restore from Firestore Remote Auth Store first
  try {
    const db = getDb();
    if (db) {
      const snap = await db.collection('whatsapp_sessions').where('status', '==', 'active').get();
      for (const doc of snap.docs) {
        const userId = doc.id;
        const data = doc.data();
        if (data && data.creds) {
          console.log(`[WhatsApp] Auto-restoring session from Firestore Remote Auth Store for ${userId}...`);
          restoredUsers.add(userId);
          startSession(userId).catch(err => {
            console.warn(`[WhatsApp] Auto-restore attempt for ${userId} will retry:`, err?.message);
          });
        }
      }
    }
  } catch (err) {
    console.warn('[WhatsApp] Notice checking Firestore sessions for auto-restore:', err?.message);
  }

  // 2. Also check local disk as secondary fallback
  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const userId = entry.name;
        if (!restoredUsers.has(userId)) {
          const credsPath = path.join(SESSIONS_DIR, userId, 'creds.json');
          if (fs.existsSync(credsPath)) {
            console.log(`[WhatsApp] Auto-restoring session from local cache for ${userId}...`);
            startSession(userId).catch(err => {
              console.warn(`[WhatsApp] Local auto-restore notice for ${userId}:`, err?.message);
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[WhatsApp] Error reading sessions dir:', err?.message);
  }
}

/**
 * Periodic background ping / keep-alive heartbeat interval (every 3 minutes)
 * to maintain the active WebSocket connection with WhatsApp and prevent Render idle timeouts.
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

export async function getSessionStatus(userId) {
  if (activeSessions.has(userId)) {
    const session = activeSessions.get(userId);
    return {
      status: session.status || 'connecting',
      qr: session.qrBase64 || null,
      phone: session.sock && session.sock.user ? session.sock.user.id : null
    };
  }

  // Check if saved credentials exist in Firestore or local
  const db = getDb();
  let hasCreds = false;
  if (db) {
    try {
      const doc = await db.collection('whatsapp_sessions').doc(userId).get();
      if (doc.exists && doc.data()?.creds && doc.data()?.status !== 'logged_out') {
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

  if (hasCreds) {
    startSession(userId).catch(err => console.warn(`[WhatsApp] Auto-connect on status check notice:`, err?.message));
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
        sessionData.sock.ws?.close();
      } catch (err) {
        console.error(`[WhatsApp] Error closing socket for ${userId}:`, err?.message);
      }
    }
    activeSessions.delete(userId);
  }

  // Mark logged_out in Firestore and clear remote keys
  const db = getDb();
  if (db) {
    try {
      await db.collection('whatsapp_sessions').doc(userId).set({
        status: 'logged_out',
        creds: null,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const keysSnap = await db.collection('whatsapp_sessions').doc(userId).collection('keys').get();
      const batch = db.batch();
      keysSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit().catch(() => {});
    } catch (err) {
      console.warn(`[WhatsApp] Error clearing Firestore session for ${userId}:`, err?.message);
    }
  }

  // Clear local dir
  const sessionPath = path.join(SESSIONS_DIR, userId);
  try {
    await rimraf(sessionPath);
    console.log(`[WhatsApp] Cleared local session data for ${userId}`);
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
      } catch (e) {}
    }
  }

  // Use the Firestore Remote Auth State
  const { state, saveCreds } = await useFirestoreAuthState(userId);
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
        keepAliveIntervalMs: 20000,
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
            console.log(`[WhatsApp] Network drop/reset detected for ${userId}. Auto-reconnecting using Firestore session in 4s...`);

            if (sessionEntry.reconnectTimer) {
              clearTimeout(sessionEntry.reconnectTimer);
            }
            sessionEntry.reconnectTimer = setTimeout(() => {
              startSession(userId).catch(err => {
                console.error(`[WhatsApp] Auto-reconnect retry error for ${userId}:`, err?.message);
              });
            }, 4000);
          } else {
            console.log(`[WhatsApp] Session explicitly logged out for ${userId}. Clearing remote Firestore store.`);
            await logoutSession(userId);
          }
        } else if (connection === 'open') {
          console.log(`[WhatsApp] Session securely connected for ${userId} with Firestore persistence`);
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null;
          if (sessionEntry.reconnectTimer) {
            clearTimeout(sessionEntry.reconnectTimer);
            sessionEntry.reconnectTimer = null;
          }

          // Mark session active in Firestore
          const db = getDb();
          if (db) {
            db.collection('whatsapp_sessions').doc(userId).set({
              status: 'active',
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
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
