import { getDb } from './firestoreService.js';
import { sendWhatsAppMessage } from './whatsappManager.js';
import { FieldValue } from 'firebase-admin/firestore';

// In-memory runtime tracking for active broadcast queues
const activeCampaignQueues = new Map();

/**
 * Saves or updates campaign document in Firestore
 */
async function syncCampaignToFirestore(campaign) {
  try {
    const database = getDb();
    if (!database) return;

    await database.collection('campaigns').doc(campaign.id).set({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalRecords: campaign.totalRecords,
      sentCount: campaign.sentCount,
      failedCount: campaign.failedCount,
      currentIndex: campaign.currentIndex,
      delaySeconds: campaign.delaySeconds,
      userId: campaign.userId,
      messageTemplate: campaign.messageTemplate,
      updatedAt: FieldValue.serverTimestamp(),
      ...(campaign.createdAt ? {} : { createdAt: FieldValue.serverTimestamp() })
    }, { merge: true });
  } catch (error) {
    console.warn(`[Campaign] Firestore sync failed for ${campaign.id}:`, error.message);
  }
}

/**
 * Logs message delivery attempt to Firestore /messages_log
 */
async function logMessageDelivery({ userId, phone, status, campaignId, errorMessage }) {
  try {
    const database = getDb();
    if (!database) return;

    const logEntry = {
      userId: userId || 'system',
      phone: phone || '',
      remoteJid: `${phone}@s.whatsapp.net`,
      status: status || 'sent',
      campaignId: campaignId || null,
      errorMessage: errorMessage || null,
      timestamp: FieldValue.serverTimestamp()
    };

    // Write to /messages_log (and /messageLogs for backward compatibility)
    await database.collection('messages_log').add(logEntry);
    await database.collection('messageLogs').add(logEntry).catch(() => {});
  } catch (err) {
    console.warn('[Campaign] Message log failed:', err.message);
  }
}

/**
 * Executes queue step-by-step with delay and pause/cancel handling
 */
async function processQueue(campaignId) {
  const campaign = activeCampaignQueues.get(campaignId);
  if (!campaign) return;

  if (campaign.status !== 'running') {
    return;
  }

  if (campaign.currentIndex >= campaign.items.length) {
    campaign.status = 'completed';
    console.log(`[Campaign ${campaignId}] Finished. Sent: ${campaign.sentCount}, Failed: ${campaign.failedCount}`);
    await syncCampaignToFirestore(campaign);
    return;
  }

  const currentItem = campaign.items[campaign.currentIndex];
  const phone = (currentItem.phone || '').replace(/\D/g, '');
  const message = currentItem.message || campaign.messageTemplate;

  try {
    if (!phone) {
      throw new Error('Invalid phone number');
    }

    await sendWhatsAppMessage(campaign.userId, phone, message);
    campaign.sentCount++;
    await logMessageDelivery({
      userId: campaign.userId,
      phone,
      status: 'sent',
      campaignId: campaign.id
    });
  } catch (err) {
    console.error(`[Campaign ${campaignId}] Error sending to ${phone}:`, err.message);
    campaign.failedCount++;
    await logMessageDelivery({
      userId: campaign.userId,
      phone,
      status: 'failed',
      campaignId: campaign.id,
      errorMessage: err.message
    });
  }

  campaign.currentIndex++;
  await syncCampaignToFirestore(campaign);

  // Check if finished or paused/cancelled before scheduling next
  if (campaign.currentIndex >= campaign.items.length) {
    campaign.status = 'completed';
    await syncCampaignToFirestore(campaign);
    return;
  }

  if (campaign.status === 'running') {
    const delayMs = (campaign.delaySeconds || 5) * 1000;
    campaign.timer = setTimeout(() => {
      processQueue(campaignId).catch(err => {
        console.error(`[Campaign ${campaignId}] Queue step error:`, err);
      });
    }, delayMs);
  }
}

/**
 * Creates and starts a new campaign
 */
export async function createCampaign({ name, items, delaySeconds, messageTemplate, userId }) {
  if (!items || items.length === 0) {
    throw new Error('At least one recipient is required');
  }

  const campaignId = 'camp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const campaign = {
    id: campaignId,
    name: name || `Campaign ${new Date().toLocaleDateString()}`,
    status: 'running',
    totalRecords: items.length,
    sentCount: 0,
    failedCount: 0,
    currentIndex: 0,
    delaySeconds: parseInt(delaySeconds, 10) || 5,
    messageTemplate: messageTemplate || '',
    userId,
    items, // Array of { phone, message }
    timer: null,
    createdAt: new Date().toISOString()
  };

  activeCampaignQueues.set(campaignId, campaign);
  await syncCampaignToFirestore(campaign);

  // Kick off asynchronous queue processing
  setTimeout(() => {
    processQueue(campaignId).catch(err => console.error('[Campaign] Startup error:', err));
  }, 500);

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    totalRecords: campaign.totalRecords,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    delaySeconds: campaign.delaySeconds
  };
}

/**
 * Pauses a running campaign
 */
export async function pauseCampaign(campaignId) {
  let campaign = activeCampaignQueues.get(campaignId);

  if (!campaign) {
    const database = getDb();
    if (database) {
      const doc = await database.collection('campaigns').doc(campaignId).get();
      if (doc.exists) {
        await database.collection('campaigns').doc(campaignId).update({
          status: 'paused',
          updatedAt: FieldValue.serverTimestamp()
        });
        return { success: true, status: 'paused' };
      }
    }
    throw new Error('Campaign not found');
  }

  if (campaign.timer) {
    clearTimeout(campaign.timer);
    campaign.timer = null;
  }

  campaign.status = 'paused';
  await syncCampaignToFirestore(campaign);
  return { success: true, status: 'paused', id: campaignId };
}

/**
 * Resumes a paused campaign
 */
export async function resumeCampaign(campaignId) {
  const campaign = activeCampaignQueues.get(campaignId);

  if (!campaign) {
    const database = getDb();
    if (database) {
      const doc = await database.collection('campaigns').doc(campaignId).get();
      if (doc.exists && doc.data().status === 'paused') {
        throw new Error('In-memory queue for this session was cleared. Please re-start campaign with remaining contacts.');
      }
    }
    throw new Error('Campaign not found or not in memory');
  }

  if (campaign.status === 'running') {
    return { success: true, status: 'running', id: campaignId };
  }

  campaign.status = 'running';
  await syncCampaignToFirestore(campaign);

  // Resume queue immediately
  processQueue(campaignId).catch(err => console.error('[Campaign] Resume error:', err));
  return { success: true, status: 'running', id: campaignId };
}

/**
 * Cancels a campaign
 */
export async function cancelCampaign(campaignId) {
  const campaign = activeCampaignQueues.get(campaignId);

  if (campaign) {
    if (campaign.timer) {
      clearTimeout(campaign.timer);
      campaign.timer = null;
    }
    campaign.status = 'cancelled';
    await syncCampaignToFirestore(campaign);
    activeCampaignQueues.delete(campaignId);
    return { success: true, status: 'cancelled', id: campaignId };
  }

  const database = getDb();
  if (database) {
    await database.collection('campaigns').doc(campaignId).update({
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp()
    }).catch(() => {});
  }

  return { success: true, status: 'cancelled', id: campaignId };
}

/**
 * Gets the most recent active (running or paused) campaign for a user
 */
export async function getActiveCampaign(userId) {
  // Check in-memory first for latest status
  for (const campaign of activeCampaignQueues.values()) {
    if ((!userId || campaign.userId === userId) && (campaign.status === 'running' || campaign.status === 'paused')) {
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalRecords: campaign.totalRecords,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        currentIndex: campaign.currentIndex,
        delaySeconds: campaign.delaySeconds,
        messageTemplate: campaign.messageTemplate
      };
    }
  }

  // Check Firestore fallback
  try {
    const database = getDb();
    if (!database) return null;

    let query = database.collection('campaigns')
      .where('status', 'in', ['running', 'paused'])
      .orderBy('updatedAt', 'desc')
      .limit(1);

    const snap = await query.get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    }
  } catch (error) {
    console.warn('[Campaign] Firestore active query error:', error.message);
  }

  return null;
}
