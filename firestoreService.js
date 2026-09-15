import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment
} from 'firebase/firestore';
import NodeCache from 'node-cache';
import fs from 'fs';
import path from 'path';

// Read config safely from firebase-applet-config.json
let firebaseConfig = {
  projectId: 'exemplary-asset-k2ts5',
  firestoreDatabaseId: 'ai-studio-mffwhatsappmanag-eb0f63d7-93d3-4144-8df5-fd2de242dbe2',
  apiKey: 'AIzaSyD2_cAEzWI-0qobHNAQ9Otl-QUiNoq9UvE'
};

try {
  const configPath = path.resolve('./firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    firebaseConfig = { ...firebaseConfig, ...raw };
  }
} catch (e) {
  // ignore
}

export const FieldValue = {
  serverTimestamp: () => new Date().toISOString(),
  increment: (n) => increment(n)
};

class CollectionWrapper {
  constructor(firestore, pathSegments) {
    this.fs = firestore;
    this.pathSegments = pathSegments;
  }

  doc(docId) {
    return new DocWrapper(this.fs, [...this.pathSegments, docId]);
  }

  async add(data) {
    const colRef = collection(this.fs, ...this.pathSegments);
    const cleanedData = cleanDataForFirestore(data);
    const res = await addDoc(colRef, cleanedData);
    return { id: res.id };
  }

  where(field, op, value) {
    return new QueryWrapper(this.fs, this.pathSegments, [where(field, op, value)]);
  }

  orderBy(field, dir = 'asc') {
    return new QueryWrapper(this.fs, this.pathSegments, [orderBy(field, dir)]);
  }

  limit(n) {
    return new QueryWrapper(this.fs, this.pathSegments, [limit(n)]);
  }

  async get() {
    try {
      const colRef = collection(this.fs, ...this.pathSegments);
      const snap = await getDocs(colRef);
      return {
        empty: snap.empty,
        size: snap.size,
        docs: snap.docs.map(d => ({
          id: d.id,
          ref: d.ref,
          data: () => d.data(),
          exists: true
        }))
      };
    } catch (err) {
      console.warn(`[Firestore] getDocs error on ${this.pathSegments.join('/')}:`, err.message);
      return { empty: true, size: 0, docs: [] };
    }
  }
}

class QueryWrapper {
  constructor(firestore, pathSegments, constraints = []) {
    this.fs = firestore;
    this.pathSegments = pathSegments;
    this.constraints = constraints;
  }

  where(field, op, value) {
    return new QueryWrapper(this.fs, this.pathSegments, [...this.constraints, where(field, op, value)]);
  }

  orderBy(field, dir = 'asc') {
    return new QueryWrapper(this.fs, this.pathSegments, [...this.constraints, orderBy(field, dir)]);
  }

  limit(n) {
    return new QueryWrapper(this.fs, this.pathSegments, [...this.constraints, limit(n)]);
  }

  async get() {
    try {
      const colRef = collection(this.fs, ...this.pathSegments);
      const q = query(colRef, ...this.constraints);
      const snap = await getDocs(q);
      return {
        empty: snap.empty,
        size: snap.size,
        docs: snap.docs.map(d => ({
          id: d.id,
          ref: d.ref,
          data: () => d.data(),
          exists: true
        }))
      };
    } catch (err) {
      console.warn(`[Firestore] query error on ${this.pathSegments.join('/')}:`, err.message);
      return { empty: true, size: 0, docs: [] };
    }
  }
}

class DocWrapper {
  constructor(firestore, pathSegments) {
    this.fs = firestore;
    this.pathSegments = pathSegments;
    this.ref = doc(this.fs, ...this.pathSegments);
  }

  collection(subColName) {
    return new CollectionWrapper(this.fs, [...this.pathSegments, subColName]);
  }

  async get() {
    try {
      const snap = await getDoc(this.ref);
      return {
        id: snap.id,
        exists: snap.exists(),
        data: () => snap.data()
      };
    } catch (err) {
      console.warn(`[Firestore] getDoc error on ${this.pathSegments.join('/')}:`, err.message);
      return { id: this.pathSegments[this.pathSegments.length - 1], exists: false, data: () => null };
    }
  }

  async set(data, options = {}) {
    const cleanedData = cleanDataForFirestore(data);
    return await setDoc(this.ref, cleanedData, { merge: options.merge ?? false });
  }

  async update(data) {
    const cleanedData = cleanDataForFirestore(data);
    return await updateDoc(this.ref, cleanedData);
  }

  async delete() {
    return await deleteDoc(this.ref);
  }
}

class FirestoreWrapper {
  constructor(rawDb) {
    this.fs = rawDb;
  }

  collection(colName) {
    return new CollectionWrapper(this.fs, [colName]);
  }

  batch() {
    // Simple batch mock executing sequentially
    const operations = [];
    return {
      set: (docRef, data, options = {}) => {
        operations.push(() => docRef.set ? docRef.set(data, options) : setDoc(docRef, cleanDataForFirestore(data), { merge: options.merge ?? false }));
      },
      delete: (docRef) => {
        operations.push(() => docRef.delete ? docRef.delete() : deleteDoc(docRef));
      },
      commit: async () => {
        for (const op of operations) {
          try {
            await op();
          } catch (e) {
            // ignore individual batch errors
          }
        }
      }
    };
  }
}

function cleanDataForFirestore(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = { ...obj };
  for (const [k, v] of Object.entries(copy)) {
    if (v === undefined) {
      delete copy[k];
    }
  }
  return copy;
}

let firestoreInstance = null;
let rawFirestore = null;

export function getDb() {
  if (!firestoreInstance) {
    initFirestore();
  }
  return firestoreInstance;
}

function initFirestore() {
  try {
    let app;
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }

    const dbId = process.env.FIRESTORE_DATABASE_ID || firebaseConfig.firestoreDatabaseId;
    if (dbId && dbId !== '(default)') {
      rawFirestore = getFirestore(app, dbId);
    } else {
      rawFirestore = getFirestore(app);
    }

    firestoreInstance = new FirestoreWrapper(rawFirestore);
    console.log('[Firestore] Successfully initialized via client SDK with zero ADC dependencies');
    initializeDefaultSuperAdmin();
  } catch (error) {
    console.warn('[Firestore] Initialization warning:', error.message);
  }
}

/**
 * Initializes default Super Admin directly into Firestore /users collection
 * WITHOUT calling unconfigured GCP auth services or google-auth-library.
 */
async function initializeDefaultSuperAdmin() {
  const email = 'mahmoud.alkhateeb@money.jo';
  const password = 'MFF@money@2021';
  try {
    const database = getDb();
    if (!database) return;

    const userDoc = database.collection('users').doc('super-admin');
    const docSnap = await userDoc.get();

    if (!docSnap.exists) {
      await userDoc.set({
        email,
        displayName: 'Mahmoud Alkhateeb',
        role: 'Super Admin',
        password,
        department: 'Management',
        createdAt: new Date().toISOString(),
        status: 'active'
      }, { merge: true });
      console.log('[Firestore] Default Super Admin ensured in Firestore /users.');
    } else {
      if (docSnap.data()?.role !== 'Super Admin' || !docSnap.data()?.password) {
        await userDoc.set({
          role: 'Super Admin',
          password: docSnap.data()?.password || password
        }, { merge: true });
      }
    }
  } catch (error) {
    console.warn('[Firestore] Super Admin check notice:', error.message);
  }
}

const rbacCache = new NodeCache({ stdTTL: 3600 });
let messageLogQueue = [];
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 15 * 1000;

async function flushLogs() {
  if (messageLogQueue.length === 0) return;
  const database = getDb();
  if (!database) {
    messageLogQueue = [];
    return;
  }

  const logsToProcess = messageLogQueue.splice(0, BATCH_SIZE);
  for (const log of logsToProcess) {
    try {
      await database.collection('messages_log').add(log);
      await database.collection('messageLogs').add(log).catch(() => {});
    } catch (err) {
      // quiet log
    }
  }
}

setInterval(flushLogs, FLUSH_INTERVAL_MS);

export function queueMessageLog(logData) {
  messageLogQueue.push({
    ...logData,
    timestamp: new Date().toISOString()
  });

  if (messageLogQueue.length >= BATCH_SIZE) {
    flushLogs().catch(() => {});
  }
}

export async function incrementCampaignStats(campaignId, fieldsToIncrement = { sentCount: 1 }) {
  const database = getDb();
  if (!database) return;

  try {
    const ref = database.collection('campaigns').doc(campaignId);
    await ref.set({
      ...fieldsToIncrement,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    console.warn(`[Firestore] Failed to update campaign ${campaignId}:`, err.message);
  }
}

export async function getUserRole(userId) {
  if (!userId) return 'Agent';
  if (userId === 'super-admin' || userId === 'mahmoud.alkhateeb@money.jo') {
    return 'Super Admin';
  }

  const cachedRole = rbacCache.get(userId);
  if (cachedRole) return cachedRole;

  const database = getDb();
  if (!database) return 'Agent';

  try {
    const docRef = database.collection('users').doc(userId);
    const docSnap = await docRef.get();
    
    if (docSnap.exists && docSnap.data().role) {
      const role = docSnap.data().role;
      rbacCache.set(userId, role);
      return role;
    }

    const emailSnapshot = await database.collection('users').where('email', '==', userId).limit(1).get();
    if (!emailSnapshot.empty) {
      const role = emailSnapshot.docs[0].data().role || 'Agent';
      rbacCache.set(userId, role);
      return role;
    }

    return 'Agent';
  } catch (error) {
    console.warn(`[Firestore] Role lookup notice for ${userId}:`, error.message);
    return 'Agent';
  }
}

export async function getAllUsers() {
  const database = getDb();
  if (!database) return [];
  try {
    const snapshot = await database.collection('users').get();
    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        email: data.email,
        displayName: data.displayName || data.name || '',
        role: data.role || 'Agent',
        department: data.department || '',
        teamLeaderId: data.teamLeaderId || null,
        teamLeaderName: data.teamLeaderName || '',
        createdAt: data.createdAt
      };
    });
  } catch (err) {
    console.warn('[Firestore] Error getting all users:', err.message);
    return [];
  }
}

/**
 * Stores user credentials and details directly into Firestore /users
 * without calling unconfigured GCP auth services.
 */
export async function createUser(data) {
  const database = getDb();
  const uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  const role = data.role || 'Agent';
  const userData = {
    email: data.email?.trim().toLowerCase(),
    displayName: data.displayName?.trim() || data.name?.trim() || '',
    role,
    department: data.department?.trim() || '',
    teamLeaderId: role === 'Agent' ? (data.teamLeaderId || null) : null,
    teamLeaderName: role === 'Agent' ? (data.teamLeaderName || '') : '',
    createdAt: new Date().toISOString(),
    status: 'active',
    password: data.password || ''
  };

  if (database) {
    await database.collection('users').doc(uid).set(userData, { merge: true });
  }

  return {
    id: uid,
    email: userData.email,
    displayName: userData.displayName,
    role: userData.role,
    department: userData.department,
    teamLeaderId: userData.teamLeaderId,
    teamLeaderName: userData.teamLeaderName
  };
}

export async function resetUserPassword(uid, newPassword) {
  const database = getDb();
  if (database) {
    await database.collection('users').doc(uid).set({
      password: newPassword,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }
  return { success: true };
}

export async function deleteUser(uid) {
  const database = getDb();
  if (database) {
    await database.collection('users').doc(uid).delete();
  }
  return { success: true };
}

export async function getAnalyticsMetrics({ range = 'all', startDate, endDate, status = 'all', userId, userRole, agentId } = {}) {
  const database = getDb();
  if (!database) {
    return {
      totalSent: 0,
      totalFailed: 0,
      deliveryRate: '100%',
      recentLogs: [],
      agentBreakdown: []
    };
  }

  try {
    let snapshot = await database.collection('messages_log').get();
    if (snapshot.empty) {
      snapshot = await database.collection('messageLogs').get();
    }

    let allDocs = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

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

      if (agentId && agentId !== 'all') {
        if (log.userId !== agentId) return false;
      }

      return true;
    });

    let totalSent = 0;
    let totalFailed = 0;
    const agentStatsMap = {};

    filteredLogs.forEach(log => {
      const isSent = log.status === 'sent' || log.status === 'success';
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
    const deliveryRate = totalProcessed > 0 ? `${Math.round((totalSent / totalProcessed) * 100)}%` : '100%';

    filteredLogs.sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
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
    console.warn('[Firestore] Error calculating analytics:', error.message);
    return {
      totalSent: 0,
      totalFailed: 0,
      deliveryRate: '100%',
      recentLogs: [],
      agentBreakdown: []
    };
  }
}
