import { getDb } from './firestoreService.js';
import { 
  enqueueCampaignItems, 
  pauseCampaignInQueue, 
  resumeCampaignInQueue, 
  cancelCampaignInQueue 
} from './messageQueue.js';

// In-memory runtime tracking for active broadcast queues per user
const activeCampaignQueues = new Map();

/**
 * Saves or updates campaign document in Firestore
 */
async function syncCampaignToFirestore(campaign) {
  try {
    const database = getDb();
    if (!database) return;

    const nowIso = new Date().toISOString();
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
      updatedAt: nowIso,
      ...(campaign.createdAt ? {} : { createdAt: nowIso })
    }, { merge: true });
  } catch (error) {
    console.warn(`[Campaign] Firestore sync failed for ${campaign.id}:`, error.message);
  }
}

/**
 * Creates and starts a new campaign for a specific user.
 * Dispatches items to the Centralized Message Queue to prevent socket locking.
 */
export async function createCampaign({ name, items, delaySeconds, messageTemplate, userId }) {
  if (!items || items.length === 0) {
    throw new Error('At least one recipient is required');
  }

  const campaignId = 'camp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const throttleSec = parseInt(delaySeconds, 10) || 3;

  // Prepare normalized items list
  const normalizedItems = items.map(item => ({
    phone: item.phone,
    message: item.message || messageTemplate
  }));

  const campaign = {
    id: campaignId,
    name: name || `Campaign ${new Date().toLocaleDateString()}`,
    status: 'running',
    totalRecords: normalizedItems.length,
    sentCount: 0,
    failedCount: 0,
    currentIndex: 0,
    delaySeconds: throttleSec,
    messageTemplate: messageTemplate || '',
    userId: userId || 'system',
    items: normalizedItems,
    createdAt: new Date().toISOString()
  };

  activeCampaignQueues.set(campaignId, campaign);
  await syncCampaignToFirestore(campaign);

  // Enqueue campaign items into Centralized Thread-Safe Async Message Queue
  enqueueCampaignItems({
    campaignId,
    userId,
    items: normalizedItems,
    throttleDelayMs: throttleSec * 1000,
    onItemProcessed: async ({ success, err }) => {
      if (campaign.status === 'cancelled') return;

      if (success) {
        campaign.sentCount++;
      } else {
        campaign.failedCount++;
      }
      campaign.currentIndex++;

      if (campaign.currentIndex >= campaign.totalRecords) {
        campaign.status = 'completed';
        console.log(`[Campaign ${campaignId}] Completed. Sent: ${campaign.sentCount}, Failed: ${campaign.failedCount}`);
      }

      await syncCampaignToFirestore(campaign);
    }
  });

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

  pauseCampaignInQueue(campaignId);

  if (!campaign) {
    const database = getDb();
    if (database) {
      const doc = await database.collection('campaigns').doc(campaignId).get();
      if (doc.exists) {
        await database.collection('campaigns').doc(campaignId).update({
          status: 'paused',
          updatedAt: new Date().toISOString()
        });
        return { success: true, status: 'paused', id: campaignId };
      }
    }
    throw new Error('Campaign not found');
  }

  campaign.status = 'paused';
  await syncCampaignToFirestore(campaign);
  return { success: true, status: 'paused', id: campaignId };
}

/**
 * Resumes a paused campaign
 */
export async function resumeCampaign(campaignId) {
  let campaign = activeCampaignQueues.get(campaignId);

  resumeCampaignInQueue(campaignId);

  if (!campaign) {
    const database = getDb();
    if (database) {
      const doc = await database.collection('campaigns').doc(campaignId).get();
      if (doc.exists) {
        await database.collection('campaigns').doc(campaignId).update({
          status: 'running',
          updatedAt: new Date().toISOString()
        });
        return { success: true, status: 'running', id: campaignId };
      }
    }
    throw new Error('Campaign not found');
  }

  campaign.status = 'running';
  await syncCampaignToFirestore(campaign);
  return { success: true, status: 'running', id: campaignId };
}

/**
 * Cancels a campaign and purges pending queue items
 */
export async function cancelCampaign(campaignId) {
  cancelCampaignInQueue(campaignId);

  let campaign = activeCampaignQueues.get(campaignId);
  if (campaign) {
    campaign.status = 'cancelled';
    await syncCampaignToFirestore(campaign);
    activeCampaignQueues.delete(campaignId);
    return { success: true, status: 'cancelled', id: campaignId };
  }

  const database = getDb();
  if (database) {
    await database.collection('campaigns').doc(campaignId).update({
      status: 'cancelled',
      updatedAt: new Date().toISOString()
    }).catch(() => {});
  }

  return { success: true, status: 'cancelled', id: campaignId };
}

/**
 * Gets the most recent active (running or paused) campaign strictly isolated per user.
 * Decouples sessions so User A does not overwrite or view User B's campaign state.
 */
export async function getActiveCampaign(userId) {
  if (!userId) return null;

  // 1. Check in-memory first for latest runtime status strictly matching userId
  for (const campaign of activeCampaignQueues.values()) {
    if (campaign.userId === userId && (campaign.status === 'running' || campaign.status === 'paused')) {
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

  // 2. Check Firestore fallback strictly filtered by userId
  try {
    const database = getDb();
    if (!database) return null;

    const snap = await database.collection('campaigns')
      .where('userId', '==', userId)
      .where('status', 'in', ['running', 'paused'])
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ...doc.data() };
    }
  } catch (error) {
    console.warn(`[Campaign] Firestore active query warning for user ${userId}:`, error.message);
  }

  return null;
}
