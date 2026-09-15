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
 * Core WhatsApp Session Starter and Manager
 * Handles:
 * 1. Disconnect Code 515 (Restart Required) - Automatically reconnects using updated creds without destroying session.
 * 2. Disconnect Code 401 (Logged Out) - Wipes local auth files and sets state to DISCONNECTED.
 * 3. Browser User-Agent and Version Emulation - Uses ['MFF WhatsApp', 'Chrome', '120.0.0'] and fetchLatestBaileysVersion().
 * 4. QR Code Lifecycle - Keeps QR code valid until connection reaches 'open' or unrecoverable 401.
 */
export async function startWhatsAppSession(userId, options = {}) {
  ensureSessionsDir();
  const { forceFresh = false, isRestart = false, maxWaitMs = 15000 } = options;

  let sessionEntry = activeSessions.get(userId);

  if (isRestart && sessionEntry) {
    // Reconnecting after code 515 restartRequired
    console.log(`[WhatsApp] Executing clean socket restart (code 515) for ${userId}...`);
    try {
      sessionEntry.sock?.ws?.close();
    } catch (e) {}
    sessionEntry.sock = null;
    sessionEntry.status = 'connecting';
    // Preserve existing qrBase64 during 515 restart so UI doesn't flicker
  } else {
    // Terminate existing socket if any
    if (sessionEntry) {
      if (sessionEntry.reconnectTimer) clearTimeout(sessionEntry.reconnectTimer);
      if (sessionEntry.stuckTimer) clearTimeout(sessionEntry.stuckTimer);
      try {
        sessionEntry.sock?.ws?.close();
      } catch (e) {}
      activeSessions.delete(userId);
    }

    if (forceFresh) {
      // Clear local auth folder so a fresh QR is generated
      const localDir = path.join(SESSIONS_DIR, userId);
      try {
        await rimraf(localDir);
        fs.mkdirSync(localDir, { recursive: true });
      } catch (e) {}

      // Clear remote creds in Firestore
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
    }

    sessionEntry = {
      sock: null,
      status: 'connecting',
      qrBase64: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 1,
      stuckTimer: null,
      reconnectTimer: null
    };
    activeSessions.set(userId, sessionEntry);
  }

  // Load auth state: fresh if forceFresh, else latest saved from memory/disk/Firestore
  const { state, saveCreds } = await useFirestoreAuthState(userId, forceFresh);

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
          qr: sessionEntry.qrBase64 || null
        });
      }
    }, maxWaitMs);

    try {
      // Browser User-Agent & Version Emulation
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

        // 3. QR Code Lifecycle: Keep QR active until 'open' or unrecoverable 401
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
            console.error('[WhatsApp] QR Code Generation Error:', err);
          }
        }

        // Connection reaches 'open' status
        if (connection === 'open') {
          console.log(`[WhatsApp] Connected successfully for user ${userId}`);
          sessionEntry.status = 'connected';
          sessionEntry.qrBase64 = null; // Clear QR only once connection explicitly reaches 'open'
          sessionEntry.reconnectAttempts = 0;

          if (sessionEntry.stuckTimer) {
            clearTimeout(sessionEntry.stuckTimer);
            sessionEntry.stuckTimer = null;
          }

          const db = getDb();
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

        // Connection closes
        if (connection === 'close') {
          const error = lastDisconnect?.error;
          const statusCode = error?.output?.statusCode || error?.output?.payload?.statusCode;
          console.log(`[WhatsApp] Socket connection closed for user ${userId}. StatusCode: ${statusCode}`);

          // 1. Handle Disconnect Code 515 (Restart Required)
          if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
            console.log(`[WhatsApp] Disconnect code 515 (restartRequired) encountered for ${userId}. Triggering clean socket reconnection...`);
            // DO NOT destroy the session or mark as failed
            // Automatically trigger a clean socket reconnection using newly generated auth credentials in memory/disk:
            sessionEntry.status = 'connecting';
            startWhatsAppSession(userId, { isRestart: true }).then((res) => {
              if (!resolved && res?.status === 'connected') {
                resolved = true;
                clearTimeout(safetyTimeout);
                resolve(res);
              }
            }).catch((err) => {
              console.error(`[WhatsApp] Error during 515 restart reconnection for ${userId}:`, err);
            });
            return;
          }

          // 2. Handle Disconnect Reason Logged Out (401)
          if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
            console.log(`[WhatsApp] Logged out (code 401) for ${userId}. Clearing session auth directory and setting state to DISCONNECTED.`);
            
            // Clear the session auth directory
            const localDir = path.join(SESSIONS_DIR, userId);
            try {
              await rimraf(localDir);
            } catch (e) {}

            const db = getDb();
            if (db) {
              try {
                await db.collection('whatsapp_sessions').doc(userId).set({
                  status: 'disconnected',
                  creds: null,
                  updatedAt: new Date().toISOString()
                }, { merge: true });
              } catch (e) {}
            }

            sessionEntry.status = 'disconnected';
            sessionEntry.qrBase64 = null;
            sessionEntry.sock = null;

            if (!resolved) {
              resolved = true;
              clearTimeout(safetyTimeout);
              resolve({ status: 'disconnected', error: 'Logged out (401)' });
            }
            return;
          }

          // Other closures
          sessionEntry.sock = null;
          // Keep QR code if it was active and not logged out
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
 * Purely triggers a fresh Baileys socket initialization and returns a new QR Code immediately.
 */
export async function startFreshSession(userId) {
  return await startWhatsAppSession(userId, { forceFresh: true });
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
    const fresh = await startWhatsAppSession(userId, { forceFresh: true });
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

  let version;
  try {
    const versionData = await fetchLatestBaileysVersion();
    version = versionData.version;
  } catch (e) {
    version = [2, 3000, 1015901307];
  }

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
        const freshRes = await startWhatsAppSession(userId, { forceFresh: true });
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
        browser: ['MFF WhatsApp', 'Chrome', '120.0.0'],
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

          const db = getDb();
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
          const error = lastDisconnect?.error;
          const statusCode = error?.output?.statusCode || error?.output?.payload?.statusCode;

          // Handle 515 in reconnect flow as well
          if (statusCode === 515 || statusCode === DisconnectReason.restartRequired) {
            console.log(`[WhatsApp Reconnect] Code 515 restartRequired encountered for ${userId}. Reconnecting cleanly...`);
            sessionEntry.status = 'connecting';
            startWhatsAppSession(userId, { isRestart: true }).then((res) => {
              if (!resolved && res?.status === 'connected') {
                resolved = true;
                if (sessionEntry.stuckTimer) clearTimeout(sessionEntry.stuckTimer);
                resolve(res);
              }
            }).catch(() => {});
            return;
          }

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

/**
 * Direct synchronous socket transmission helper used by Centralized Message Queue.
 * Checks the agent's session, or falls back to any active connected session
 * in the system so all 20-30 concurrent agents share the connection seamlessly.
 */
export async function sendWhatsAppMessageDirect(userId, to, message) {
  let session = activeSessions.get(userId);

  // Check shared pool if current userId does not own the active connection
  if (!session || !session.sock || session.status !== 'connected') {
    for (const [sUserId, s] of activeSessions.entries()) {
      if (s && s.sock && s.status === 'connected') {
        session = s;
        console.log(`[WhatsApp] Multi-user router: Using shared active WhatsApp session (${sUserId}) for user (${userId})`);
        break;
      }
    }
  }

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

export async function sendWhatsAppMessage(userId, to, message) {
  return await sendWhatsAppMessageDirect(userId, to, message);
}

