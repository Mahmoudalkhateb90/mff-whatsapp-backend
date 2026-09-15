import { getDb } from './firestoreService.js';
import { 
  enqueueCampaignItems, 
  pauseCampaignInQueue, 
  resumeCampaignInQueue, 
  cancelCampaignInQueue 
} from './messageQueue.js';

// In-memory runtime tracking for active broadcast queues per user
export const activeCampaigns = new Map(); // campaignId -> campaignObject

// Backward-compatibility alias
export const activeCampaignQueues = activeCampaigns;

/**
 * Saves or updates campaign document in Firestore (strictly non-blocking fire-and-forget)
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
      messageTemplate: campaign.messageTemplate || '',
      errorMessage: campaign.errorMessage || null,
      updatedAt: nowIso,
      ...(campaign.createdAt ? {} : { createdAt: nowIso })
    }, { merge: true });
  } catch (error) {
    // Non-blocking warning - never throw
    console.warn(`[Campaign] Firestore sync notice for ${campaign.id}:`, error.message);
  }
}

/**
 * Creates and starts a new campaign for a specific user strictly in-memory.
 * Dispatches items to the Centralized Message Queue to prevent socket locking.
 */
export async function createCampaign({ name, items, delaySeconds, messageTemplate, userId }) {
  if (!userId) {
    throw new Error('User ID is required to create a campaign');
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('At least one recipient is required');
  }

  const campaignId = 'camp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const throttleSec = parseInt(delaySeconds, 10) || 3;
  const templateStr = typeof messageTemplate === 'string' ? messageTemplate.trim() : '';

  // Prepare normalized items list: extract row.message or fallback to messageTemplate
  const normalizedItems = [];
  for (const item of items) {
    const rawPhone = (item.phone || '').replace(/\D/g, '');
    const rowMsg = typeof item.message === 'string' ? item.message.trim() : '';
    const finalMsg = rowMsg || templateStr;

    if (rawPhone.length >= 7 && finalMsg.length > 0) {
      normalizedItems.push({
        phone: rawPhone,
        message: finalMsg
      });
    }
  }

  if (normalizedItems.length === 0) {
    throw new Error('No valid recipients with message content found. Please provide valid phone numbers and message text.');
  }

  const campaign = {
    id: campaignId,
    name: name || `Campaign ${new Date().toLocaleDateString()}`,
    status: 'running',
    totalRecords: normalizedItems.length,
    sentCount: 0,
    failedCount: 0,
    currentIndex: 0,
    delaySeconds: throttleSec,
    messageTemplate: templateStr,
    userId: userId,
    errorMessage: null,
    isPaused: false,
    isCancelled: false,
    items: normalizedItems,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  activeCampaigns.set(campaignId, campaign);

  // Non-blocking fire-and-forget sync to Firestore
  syncCampaignToFirestore(campaign).catch(() => {});

  // Enqueue campaign items into Centralized Thread-Safe Async Message Queue
  enqueueCampaignItems({
    campaignId,
    userId,
    items: normalizedItems,
    throttleDelayMs: throttleSec * 1000,
    onItemProcessed: async ({ success, err }) => {
      if (campaign.isCancelled || campaign.status === 'cancelled') return;

      if (success) {
        campaign.sentCount++;
      } else {
        campaign.failedCount++;
        if (err?.message && err.message.includes('WhatsApp session disconnected')) {
          campaign.status = 'failed';
          campaign.errorMessage = 'FAILED: WhatsApp session disconnected for this user';
        }
      }
      campaign.currentIndex++;
      campaign.updatedAt = new Date().toISOString();

      if (campaign.currentIndex >= campaign.totalRecords) {
        if (campaign.status !== 'failed') {
          campaign.status = 'completed';
        }
        console.log(`[Campaign ${campaignId}] Finished with status ${campaign.status}. Sent: ${campaign.sentCount}, Failed: ${campaign.failedCount}`);
      }

      syncCampaignToFirestore(campaign).catch(() => {});
    }
  });

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    totalRecords: campaign.totalRecords,
    sentCount: campaign.sentCount,
    failedCount: campaign.failedCount,
    delaySeconds: campaign.delaySeconds,
    userId: campaign.userId,
    isPaused: campaign.isPaused,
    isCancelled: campaign.isCancelled
  };
}

/**
 * Pauses a running campaign
 */
export async function pauseCampaign(campaignId, userId = null) {
  let targetId = campaignId;
  let campaign = activeCampaigns.get(targetId);

  // If passed userId instead of campaignId, find their active campaign
  if (!campaign && userId) {
    for (const c of activeCampaigns.values()) {
      if (c.userId === userId && c.status === 'running') {
        campaign = c;
        targetId = c.id;
        break;
      }
    }
  }

  if (campaign) {
    campaign.status = 'paused';
    campaign.isPaused = true;
    campaign.updatedAt = new Date().toISOString();
    pauseCampaignInQueue(targetId);
    syncCampaignToFirestore(campaign).catch(() => {});
    return { success: true, status: 'paused', id: targetId, ...campaign };
  }

  pauseCampaignInQueue(targetId);
  return { success: true, status: 'paused', id: targetId };
}

/**
 * Resumes a paused campaign
 */
export async function resumeCampaign(campaignId, userId = null) {
  let targetId = campaignId;
  let campaign = activeCampaigns.get(targetId);

  // If passed userId instead of campaignId, find their paused campaign
  if (!campaign && userId) {
    for (const c of activeCampaigns.values()) {
      if (c.userId === userId && c.status === 'paused') {
        campaign = c;
        targetId = c.id;
        break;
      }
    }
  }

  if (campaign) {
    campaign.status = 'running';
    campaign.isPaused = false;
    campaign.updatedAt = new Date().toISOString();
    resumeCampaignInQueue(targetId);
    syncCampaignToFirestore(campaign).catch(() => {});
    return { success: true, status: 'running', id: targetId, ...campaign };
  }

  resumeCampaignInQueue(targetId);
  return { success: true, status: 'running', id: targetId };
}

/**
 * Cancels / Stops a campaign in-memory instantly and purges pending queue items
 */
export async function cancelCampaign(campaignId, userId = null) {
  let targetId = campaignId;
  let campaign = activeCampaigns.get(targetId);

  if (!campaign && userId) {
    for (const c of activeCampaigns.values()) {
      if (c.userId === userId && (c.status === 'running' || c.status === 'paused')) {
        campaign = c;
        targetId = c.id;
        break;
      }
    }
  }

  cancelCampaignInQueue(targetId);

  if (campaign) {
    campaign.status = 'cancelled';
    campaign.isCancelled = true;
    campaign.updatedAt = new Date().toISOString();
    syncCampaignToFirestore(campaign).catch(() => {});
    return { success: true, status: 'cancelled', id: targetId, ...campaign };
  }

  return { success: true, status: 'cancelled', id: targetId };
}

// Alias for stop campaign
export const stopCampaign = cancelCampaign;

/**
 * Gets campaign status strictly from in-memory activeCampaigns map
 */
export async function getBroadcastStatus(userId, campaignId = null) {
  if (campaignId && activeCampaigns.has(campaignId)) {
    const c = activeCampaigns.get(campaignId);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      totalRecords: c.totalRecords,
      sentCount: c.sentCount,
      failedCount: c.failedCount,
      currentIndex: c.currentIndex,
      delaySeconds: c.delaySeconds,
      messageTemplate: c.messageTemplate,
      errorMessage: c.errorMessage || null,
      isPaused: c.isPaused,
      isCancelled: c.isCancelled,
      userId: c.userId
    };
  }

  if (userId) {
    // Look up most recent campaign for this user in memory
    for (const c of Array.from(activeCampaigns.values()).reverse()) {
      if (c.userId === userId) {
        return {
          id: c.id,
          name: c.name,
          status: c.status,
          totalRecords: c.totalRecords,
          sentCount: c.sentCount,
          failedCount: c.failedCount,
          currentIndex: c.currentIndex,
          delaySeconds: c.delaySeconds,
          messageTemplate: c.messageTemplate,
          errorMessage: c.errorMessage || null,
          isPaused: c.isPaused,
          isCancelled: c.isCancelled,
          userId: c.userId
        };
      }
    }
  }

  return { status: 'idle' };
}

/**
 * Gets the most recent active (running or paused) campaign strictly isolated per user.
 * Returns strictly from memory map first to prevent Firestore quota exhaustion.
 */
export async function getActiveCampaign(userId) {
  if (!userId) return null;

  // 1. Check in-memory first for latest runtime status strictly matching userId
  for (const campaign of Array.from(activeCampaigns.values()).reverse()) {
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
        messageTemplate: campaign.messageTemplate,
        errorMessage: campaign.errorMessage || null,
        isPaused: campaign.isPaused,
        isCancelled: campaign.isCancelled,
        userId: campaign.userId
      };
    }
  }

  // 2. Fallback check for last completed/failed campaign for this user
  for (const campaign of Array.from(activeCampaigns.values()).reverse()) {
    if (campaign.userId === userId) {
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        totalRecords: campaign.totalRecords,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        currentIndex: campaign.currentIndex,
        delaySeconds: campaign.delaySeconds,
        messageTemplate: campaign.messageTemplate,
        errorMessage: campaign.errorMessage || null,
        isPaused: campaign.isPaused,
        isCancelled: campaign.isCancelled,
        userId: campaign.userId
      };
    }
  }

  return null;
}
