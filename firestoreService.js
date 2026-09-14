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
    const docRef = database.collection('messageLogs').doc();
    batch.set(docRef, log);
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
  const cachedRole = rbacCache.get(userId);
  if (cachedRole) return cachedRole;

  const database = getDb();
  if (!database) return 'Agent'; // Default to lowest privilege

  try {
    const auth = getAuthAdmin();
    const userRecord = await auth.getUser(userId);

    const docRef = database.collection('users').doc(userId);
    const doc = await docRef.get();
    
    let role = doc.exists ? doc.data().role : 'Agent';
    
    // Hardcoded Super Admin enforcement
    if (userRecord.email === 'mahmoud.alkhateeb@money.jo') {
      role = 'Super Admin';
      if (!doc.exists || doc.data().role !== 'Super Admin') {
         await docRef.set({
           email: userRecord.email,
           displayName: userRecord.displayName || 'Mahmoud Alkhateeb',
           role: 'Super Admin',
           createdAt: FieldValue.serverTimestamp(),
           status: 'active'
         }, { merge: true });
      }
    }
    
    rbacCache.set(userId, role);
    return role;
  } catch (error) {
    console.error(`[Firestore] Error fetching user role for ${userId}:`, error);
    return 'Agent';
  }
}

export async function getAllUsers() {
  const database = getDb();
  if (!database) return [];
  const snapshot = await database.collection('users').orderBy('createdAt', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function authenticateUser(email, password) {
  const database = getDb();
  if (!database) throw new Error('Database not initialized');
  const snapshot = await database.collection('users')
    .where('email', '==', email)
    .where('password', '==', password)
    .where('status', '==', 'active')
    .limit(1)
    .get();
    
  if (snapshot.empty) {
    throw new Error('Invalid credentials');
  }
  
  const userDoc = snapshot.docs[0];
  return { id: userDoc.id, ...userDoc.data() };
}

export async function createUser(data) {
  const database = getDb();
  
  let uid = `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  
  // Create in Auth just in case, but rely on DB for our custom auth
  try {
    const auth = getAuthAdmin();
    const userRecord = await auth.createUser({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
    });
    uid = userRecord.uid;
  } catch (err) {
    console.warn('[Firebase Auth] Could not create user in Auth, proceeding with DB only', err.message);
  }

  await database.collection('users').doc(uid).set({
    email: data.email,
    password: data.password, // Store in DB for direct login check
    displayName: data.displayName,
    role: data.role || 'Agent',
    department: data.department || '',
    createdAt: FieldValue.serverTimestamp(),
    status: 'active'
  });

  return { id: uid, email: data.email, role: data.role, department: data.department };
}

export async function resetUserPassword(uid, newPassword) {
  const database = getDb();
  
  try {
    const auth = getAuthAdmin();
    await auth.updateUser(uid, { password: newPassword });
  } catch (err) {
    console.warn('[Firebase Auth] Could not update password in Auth, proceeding with DB only', err.message);
  }
  
  await database.collection('users').doc(uid).set({ password: newPassword }, { merge: true });
  return { success: true };
}

export async function deleteUser(uid) {
  const auth = getAuthAdmin();
  const database = getDb();
  await auth.deleteUser(uid);
  await database.collection('users').doc(uid).delete();
  return { success: true };
}
