import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import NodeCache from 'node-cache';

// Initialize Firebase Admin lazily
let db = null;
let authAdmin = null;
let app = null;

export function getDb() {
  if (!db) {
    initFirebaseAdmin();
  }
  return db;
}

export function getAuthAdmin() {
  if (!authAdmin) {
    initFirebaseAdmin();
  }
  return authAdmin;
}

function initFirebaseAdmin() {
  try {
    if (getApps().length === 0) {
      app = initializeApp({
        projectId: 'mff-whatsapp',
        storageBucket: 'mff-whatsapp.firebasestorage.app'
      });
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);
    authAdmin = getAuth(app);
    console.log('[Firebase Admin] Successfully initialized');
    initializeDefaultSuperAdmin();
  } catch (error) {
    console.warn('[Firebase Admin] Initialization failed:', error.message);
  }
}

async function initializeDefaultSuperAdmin() {
  const email = 'mahmoud.alkhateeb@money.jo';
  const password = 'MFF@money@2021';
  try {
    const auth = getAuthAdmin();
    const database = getDb();
    
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log('[Firebase Admin] Default Super Admin already exists.');
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email,
          password,
          displayName: 'Mahmoud Alkhateeb',
        });
        console.log('[Firebase Admin] Created default Super Admin account.');
      } else {
        throw err;
      }
    }

    // Ensure role is set in Firestore
    const userDocRef = database.collection('users').doc(userRecord.uid);
    const doc = await userDocRef.get();
    if (!doc.exists || doc.data().role !== 'Super Admin') {
      await userDocRef.set({
        email,
        displayName: 'Mahmoud Alkhateeb',
        role: 'Super Admin',
        createdAt: FieldValue.serverTimestamp(),
        status: 'active'
      }, { merge: true });
      console.log('[Firebase Admin] Default Super Admin role set in Firestore.');
    }
  } catch (error) {
    console.error('[Firebase Admin] Error initializing default Super Admin:', error);
  }
}

// Memory cache for RBAC to minimize Firestore queries (TTL 1 hour)
const rbacCache = new NodeCache({ stdTTL: 3600 });

// In-memory queue for batching Firestore writes
let messageLogQueue = [];
const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Flushes pending message logs into Firestore using a Batch write.
 */
function flushLogs() {
  if (messageLogQueue.length === 0) return;
  const database = getDb();
  if (!database) {
    messageLogQueue = [];
    return;
  }

  const batch = database.batch();
  const logsToProcess = messageLogQueue.splice(0, BATCH_SIZE);

  logsToProcess.forEach(log => {
    const docRef1 = database.collection('messages_log').doc();
    batch.set(docRef1, log);
    const docRef2 = database.collection('messageLogs').doc();
    batch.set(docRef2, log);
  });

  batch.commit()
    .then(() => console.log(`[Firestore] Flushed ${logsToProcess.length} logs in batch`))
    .catch(err => console.error('[Firestore] Batch commit failed:', err));
}

// Set up periodic flushing every 30 seconds
setInterval(flushLogs, FLUSH_INTERVAL_MS);

export function queueMessageLog(logData) {
  messageLogQueue.push({
    ...logData,
    timestamp: FieldValue.serverTimestamp()
  });

  if (messageLogQueue.length >= BATCH_SIZE) {
    flushLogs();
  }
}

export async function incrementCampaignStats(campaignId, fieldsToIncrement = { messagesSent: 1 }) {
  const database = getDb();
  if (!database) return;

  const ref = database.collection('campaigns').doc(campaignId);
  const updateData = {};
  
  for (const [key, value] of Object.entries(fieldsToIncrement)) {
    updateData[key] = FieldValue.increment(value);
  }

  await ref.set(updateData, { merge: true }).catch(err => {
    console.error(`[Firestore] Failed to update campaign ${campaignId}:`, err);
  });
}

export async function getUserRole(userId) {
  if (!userId) return 'Agent';
  if (userId === 'super-admin' || userId === 'mahmoud.alkhateeb@money.jo') {
    return 'Super Admin';
  }

  const cachedRole = rbacCache.get(userId);
  if (cachedRole) return cachedRole;

  const database = getDb();
  if (!database) return 'Agent'; // Default to lowest privilege

  try {
    // Check Firestore collection 'users' directly first
    const docRef = database.collection('users').doc(userId);
    const doc = await docRef.get();
    
    if (doc.exists && doc.data().role) {
      const role = doc.data().role;
      rbacCache.set(userId, role);
      return role;
    }

    // Check by email query
    const emailSnapshot = await database.collection('users').where('email', '==', userId).limit(1).get();
    if (!emailSnapshot.empty) {
      const role = emailSnapshot.docs[0].data().role || 'Agent';
      rbacCache.set(userId, role);
      return role;
    }

    // Check Firebase Auth if available
    try {
      const auth = getAuthAdmin();
      if (auth) {
        const userRecord = await auth.getUser(userId);
        if (userRecord.email === 'mahmoud.alkhateeb@money.jo') {
          return 'Super Admin';
        }
      }
    } catch (e) {
      // ignore
    }

    return 'Agent';
  } catch (error) {
    console.warn(`[Firestore] Role lookup error for ${userId}:`, error.message);
    return 'Agent';
  }
}

export async function getAllUsers() {
  const database = getDb();
  if (!database) return [];
  try {
    const snapshot = await database.collection('users').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn('[Firestore] Error getting all users:', err.message);
    const snapshot = await database.collection('users').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
}

export async function createUser(data) {
  const database = getDb();
  let uid = null;

  try {
    const auth = getAuthAdmin();
    if (auth && data.password) {
      const userRecord = await auth.createUser({
        email: data.email,
        password: data.password,
        displayName: data.displayName || data.name,
      });
      uid = userRecord.uid;
    }
  } catch (authError) {
    console.warn('[Firebase Auth] User Auth creation skipped/failed:', authError.message);
  }

  if (!uid) {
    uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  }

  const role = data.role || 'Agent';
  const userData = {
    email: data.email,
    displayName: data.displayName || data.name || '',
    role,
    department: data.department || '',
    teamLeaderId: role === 'Agent' ? (data.teamLeaderId || null) : null,
    teamLeaderName: role === 'Agent' ? (data.teamLeaderName || '') : '',
    createdAt: FieldValue.serverTimestamp(),
    status: 'active',
    password: data.password || ''
  };

  if (database) {
    await database.collection('users').doc(uid).set(userData, { merge: true });
  }

  return {
    id: uid,
    email: data.email,
    displayName: userData.displayName,
    role: userData.role,
    department: userData.department,
    teamLeaderId: userData.teamLeaderId,
    teamLeaderName: userData.teamLeaderName
  };
}

export async function getAnalyticsMetrics({ range = 'all', startDate, endDate, status = 'all', userId, userRole } = {}) {
  const database = getDb();
  if (!database) {
    return {
      totalSent: 0,
      totalFailed: 0,
      deliveryRate: 100,
      recentLogs: [],
      agentBreakdown: []
    };
  }

  try {
    let snapshot;
    try {
      snapshot = await database.collection('messages_log').get();
    } catch (e) {
      snapshot = await database.collection('messageLogs').get();
    }

    let allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const now = new Date();
    let startFilterTime = null;
    let endFilterTime = null;

    if (range === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startFilterTime = todayStart.getTime();
    } else if (range === 'last7days') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startFilterTime = sevenDaysAgo.getTime();
    } else if (range === 'custom') {
      if (startDate) startFilterTime = new Date(startDate).getTime();
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        endFilterTime = end.getTime();
      }
    }

    let filteredLogs = allDocs.filter(log => {
      let logTime = 0;
      if (log.timestamp) {
        if (typeof log.timestamp.toDate === 'function') {
          logTime = log.timestamp.toDate().getTime();
        } else if (typeof log.timestamp === 'string' || typeof log.timestamp === 'number') {
          logTime = new Date(log.timestamp).getTime();
        }
      }

      if (startFilterTime && logTime < startFilterTime) return false;
      if (endFilterTime && logTime > endFilterTime) return false;

      if (status !== 'all' && status && log.status) {
        if (log.status.toLowerCase() !== status.toLowerCase()) return false;
      }

      if (userRole === 'Agent' && userId) {
        if (log.userId && log.userId !== userId) return false;
      }

      return true;
    });

    let totalSent = 0;
    let totalFailed = 0;
    const agentStatsMap = {};

    filteredLogs.forEach(log => {
      const isSent = log.status === 'sent';
      const isFailed = log.status === 'failed';
      if (isSent) totalSent++;
      if (isFailed) totalFailed++;

      const agentKey = log.userId || 'System';
      if (!agentStatsMap[agentKey]) {
        agentStatsMap[agentKey] = { userId: agentKey, sent: 0, failed: 0 };
      }
      if (isSent) agentStatsMap[agentKey].sent++;
      if (isFailed) agentStatsMap[agentKey].failed++;
    });

    const totalProcessed = totalSent + totalFailed;
    const deliveryRate = totalProcessed > 0 ? Math.round((totalSent / totalProcessed) * 100) : 100;

    filteredLogs.sort((a, b) => {
      const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || 0).getTime();
      const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    });

    return {
      totalSent,
      totalFailed,
      deliveryRate,
      recentLogs: filteredLogs.slice(0, 50),
      agentBreakdown: Object.values(agentStatsMap)
    };
  } catch (error) {
    console.error('[Firestore] Error calculating analytics:', error);
    return {
      totalSent: 0,
      totalFailed: 0,
      deliveryRate: 100,
      recentLogs: [],
      agentBreakdown: []
    };
  }
}

export async function resetUserPassword(uid, newPassword) {
  const auth = getAuthAdmin();
  await auth.updateUser(uid, { password: newPassword });
  return { success: true };
}

export async function deleteUser(uid) {
  const auth = getAuthAdmin();
  const database = getDb();
  await auth.deleteUser(uid);
  await database.collection('users').doc(uid).delete();
  return { success: true };
}
