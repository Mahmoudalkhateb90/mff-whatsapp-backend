import { getDb } from './firestoreService.js';
import { 
  sendWhatsAppMessageDirect, 
  isWhatsAppConnectingOrInitializing, 
  hasAnyConnectedSession 
} from './whatsappManager.js';

/**
 * Enterprise Anti-Ban & Concurrent Queue Engine for WhatsApp
 * 
 * Features:
 * 1. High-Priority Queue for Single Messages:
 *    - Processed immediately with minimal delay (1-2 seconds), bypassing active bulk campaigns.
 * 2. Fair Round-Robin Interleaved Bulk Queue:
 *    - Multi-user campaigns cycle (User A -> User B -> User C -> User A).
 *    - Real-time concurrent progress for all users.
 * 3. Humanized Jitter & Anti-Ban Safety:
 *    - Safe randomized delay between 2.0 and 4.0 seconds per bulk message.
 *    - 10-second cool-down break after every 30 bulk messages.
 * 4. Resilient Error Handling & Graceful Socket Reconnect:
 *    - Failure on any recipient is logged to Firestore and worker continues immediately.
 *    - If socket is reconnecting, pauses 3s without failing pending messages.
 */

// High Priority Queue for instant 1-to-1 direct messages
const highPriorityQueue = [];

// Bulk campaign queues partitioned by campaignId / userId for Round-Robin interleaving
// Map<campaignId, { userId, campaignId, items: Array, isPaused: boolean, isCancelled: boolean, onItemProcessed: Function }>
const bulkCampaignQueues = new Map();

// Round-robin tracking
let roundRobinKeys = [];
let roundRobinPointer = 0;

// Anti-ban global counters
let isWorkerRunning = false;
let globalBulkMessageCount = 0;

/**
 * Logs message delivery attempt to Firestore /messages_log and /messageLogs
 */
async function logMessageDelivery({ userId, phone, status, campaignId, errorMessage }) {
  try {
    const database = getDb();
    if (!database) return;

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const logEntry = {
      userId: userId || 'system',
      phone: cleanPhone,
      remoteJid: cleanPhone ? `${cleanPhone}@s.whatsapp.net` : '',
      status: status || 'sent',
      campaignId: campaignId || null,
      errorMessage: errorMessage || null,
      timestamp: new Date().toISOString()
    };

    await database.collection('messages_log').add(logEntry).catch(() => {});
    await database.collection('messageLogs').add(logEntry).catch(() => {});
  } catch (err) {
    console.warn('[MessageQueue] Firestore message log warning:', err?.message);
  }
}

/**
 * Re-indexes the list of active campaign keys for Round-Robin scheduling
 */
function refreshRoundRobinKeys() {
  roundRobinKeys = Array.from(bulkCampaignQueues.keys()).filter(key => {
    const q = bulkCampaignQueues.get(key);
    return q && !q.isCancelled && !q.isPaused && q.items.length > 0;
  });
}

/**
 * Retrieves the next message item to dispatch:
 * 1. First priority: High-Priority single direct messages
 * 2. Second priority: Next Round-Robin item from active bulk campaigns
 */
function getNextDispatchItem() {
  // 1. High Priority Queue has absolute precedence
  if (highPriorityQueue.length > 0) {
    const item = highPriorityQueue.shift();
    return { item, type: 'single' };
  }

  // 2. Round-Robin from active bulk campaigns
  refreshRoundRobinKeys();
  if (roundRobinKeys.length === 0) {
    return null;
  }

  // Move pointer within valid range
  if (roundRobinPointer >= roundRobinKeys.length) {
    roundRobinPointer = 0;
  }

  const campaignId = roundRobinKeys[roundRobinPointer];
  const campaignQueue = bulkCampaignQueues.get(campaignId);

  // Advance pointer for fair round-robin interleaving
  roundRobinPointer = (roundRobinPointer + 1) % roundRobinKeys.length;

  if (!campaignQueue || campaignQueue.items.length === 0) {
    if (campaignQueue && campaignQueue.items.length === 0) {
      bulkCampaignQueues.delete(campaignId);
    }
    return getNextDispatchItem();
  }

  const item = campaignQueue.items.shift();

  // If campaign queue is now depleted, clean it up
  if (campaignQueue.items.length === 0) {
    bulkCampaignQueues.delete(campaignId);
    refreshRoundRobinKeys();
  }

  return { item, type: 'bulk', campaignQueue };
}

/**
 * Main Centralized Worker Loop
 */
async function runWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    while (true) {
      const next = getNextDispatchItem();
      if (!next) {
        // No messages pending across any queue
        break;
      }

      const { item, type, campaignQueue } = next;

      // Skip cancelled items
      if (item.isCancelled || (campaignQueue && campaignQueue.isCancelled)) {
        continue;
      }

      // If campaign is paused, skip
      if (campaignQueue && campaignQueue.isPaused) {
        continue;
      }

      // Graceful Queue Session Handling: If WhatsApp socket is temporarily reconnecting or initializing,
      // pause queue worker for 3 seconds instead of failing messages.
      if (isWhatsAppConnectingOrInitializing() && !hasAnyConnectedSession()) {
        console.log(`[MessageQueue] WhatsApp socket is temporarily reconnecting/initializing. Pausing queue worker for 3 seconds...`);
        if (type === 'single') {
          highPriorityQueue.unshift(item);
        } else if (campaignQueue) {
          campaignQueue.items.unshift(item);
          refreshRoundRobinKeys();
        }
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      item.status = 'sending';
      const cleanPhone = (item.to || '').replace(/\D/g, '');

      try {
        if (!cleanPhone || cleanPhone.length < 7) {
          throw new Error(`Invalid recipient phone number (${item.to})`);
        }

        console.log(`[MessageQueue] Dispatching [${type.toUpperCase()}] message to ${cleanPhone} (User: ${item.userId}, Campaign: ${item.campaignId || 'Direct'})...`);
        
        const result = await sendWhatsAppMessageDirect(item.userId, cleanPhone, item.message);

        item.status = 'sent';
        item.messageId = result?.messageId || `msg_${Date.now()}`;

        // Asynchronous Firestore delivery log (non-blocking)
        logMessageDelivery({
          userId: item.userId,
          phone: cleanPhone,
          status: 'sent',
          campaignId: item.campaignId
        }).catch(() => {});

        if (item.onSuccess) {
          try { item.onSuccess(item, result); } catch (e) {}
        }
        if (item.resolve) {
          try { item.resolve({ success: true, messageId: item.messageId, status: 'sent' }); } catch (e) {}
        }
      } catch (err) {
        // If error occurred because socket was reconnecting, put item back and pause 3s
        if (isWhatsAppConnectingOrInitializing() || err?.message?.includes('WhatsApp session is not connected')) {
          if (isWhatsAppConnectingOrInitializing()) {
            console.log(`[MessageQueue] Socket is reconnecting. Re-queuing ${item.to} and pausing for 3 seconds...`);
            item.status = 'queued';
            if (type === 'single') {
              highPriorityQueue.unshift(item);
            } else if (campaignQueue) {
              campaignQueue.items.unshift(item);
              refreshRoundRobinKeys();
            }
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
        }

        console.error(`[MessageQueue] Delivery failure to ${item.to}:`, err?.message || err);
        item.status = 'failed';
        item.error = err?.message || 'Send failed';

        // Log error to Firestore
        logMessageDelivery({
          userId: item.userId,
          phone: item.to,
          status: 'failed',
          campaignId: item.campaignId,
          errorMessage: item.error
        }).catch(() => {});

        if (item.onFailure) {
          try { item.onFailure(item, err); } catch (e) {}
        }
        if (item.reject) {
          try { item.reject(err); } catch (e) {}
        }
      }

      // Apply Anti-Ban Delays & Cooldown Logic
      if (type === 'single') {
        // Single messages process FAST with minimal 1-2s delay
        const singleDelayMs = Math.floor(Math.random() * 1000) + 1000; // 1000ms - 2000ms
        await new Promise(r => setTimeout(r, singleDelayMs));
      } else {
        // Bulk messages: increment anti-ban counter
        globalBulkMessageCount++;

        // Every 30 bulk messages across all queues -> take a 10-second cool-down break
        if (globalBulkMessageCount % 30 === 0) {
          console.log(`[MessageQueue] Anti-Ban Protection: Dispatched 30 bulk messages. Pausing for 10-second cool-down break...`);
          await new Promise(r => setTimeout(r, 10000));
        } else {
          // Fast & safe humanized randomized jitter between 2.0 and 4.0 seconds
          const jitterDelayMs = Math.floor(Math.random() * 2000) + 2000; // 2000ms - 4000ms
          await new Promise(r => setTimeout(r, jitterDelayMs));
        }
      }
    }
  } catch (loopError) {
    console.error('[MessageQueue] Unexpected worker loop error:', loopError);
  } finally {
    isWorkerRunning = false;
    // If new items arrived while shutting down, re-trigger
    if (highPriorityQueue.length > 0 || Array.from(bulkCampaignQueues.values()).some(q => q.items.length > 0 && !q.isPaused && !q.isCancelled)) {
      setTimeout(() => { runWorker().catch(() => {}); }, 50);
    }
  }
}

/**
 * Enqueue a single message for High-Priority immediate dispatch.
 * Bypasses all active bulk campaigns and dispatches with 1-2s minimal delay.
 */
export function enqueueMessage({
  userId,
  to,
  message,
  campaignId = null,
  priority = 'high',
  throttleDelayMs = 1500,
  onSuccess = null,
  onFailure = null
}) {
  const cleanPhone = (to || '').replace(/\D/g, '');
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const queueItem = {
    id,
    userId,
    to: cleanPhone,
    message,
    campaignId,
    priority: 'high',
    status: 'queued',
    throttleDelayMs,
    isPaused: false,
    isCancelled: false,
    createdAt: Date.now(),
    onSuccess,
    onFailure
  };

  highPriorityQueue.push(queueItem);

  // Trigger worker immediately
  setTimeout(() => {
    runWorker().catch(err => console.error('[MessageQueue] Worker trigger error:', err));
  }, 10);

  return {
    success: true,
    status: 'queued',
    messageId: id,
    queuePosition: highPriorityQueue.length,
    estimatedDelaySeconds: Math.round(highPriorityQueue.length * 1.5),
    message: 'High priority single message queued and processing immediately'
  };
}

/**
 * Batch enqueue for bulk campaigns with Fair Round-Robin Interleaving
 */
export function enqueueCampaignItems({
  campaignId,
  userId,
  items,
  throttleDelayMs = 2500,
  onItemProcessed = null
}) {
  const queuedItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const cleanPhone = (item.phone || '').replace(/\D/g, '');
    const id = `cmp_${campaignId}_${i}_${Date.now()}`;

    const queueItem = {
      id,
      userId,
      to: cleanPhone,
      message: item.message,
      campaignId,
      priority: 'normal',
      status: 'queued',
      throttleDelayMs,
      isPaused: false,
      isCancelled: false,
      createdAt: Date.now(),
      onSuccess: (it, res) => {
        if (onItemProcessed) onItemProcessed({ item: it, success: true, res });
      },
      onFailure: (it, err) => {
        if (onItemProcessed) onItemProcessed({ item: it, success: false, err });
      }
    };

    queuedItems.push(queueItem);
  }

  // Register or append to campaign queue
  const existingQueue = bulkCampaignQueues.get(campaignId);
  if (existingQueue) {
    existingQueue.items.push(...queuedItems);
  } else {
    bulkCampaignQueues.set(campaignId, {
      campaignId,
      userId,
      items: queuedItems,
      isPaused: false,
      isCancelled: false,
      onItemProcessed
    });
  }

  refreshRoundRobinKeys();

  // Trigger worker
  setTimeout(() => {
    runWorker().catch(err => console.error('[MessageQueue] Worker error on bulk campaign:', err));
  }, 10);

  return queuedItems.length;
}

/**
 * Pause all pending queue items for a campaign
 */
export function pauseCampaignInQueue(campaignId) {
  const campaignQueue = bulkCampaignQueues.get(campaignId);
  if (campaignQueue) {
    campaignQueue.isPaused = true;
    refreshRoundRobinKeys();
    return campaignQueue.items.length;
  }
  return 0;
}

/**
 * Resume all pending queue items for a campaign
 */
export function resumeCampaignInQueue(campaignId) {
  const campaignQueue = bulkCampaignQueues.get(campaignId);
  if (campaignQueue) {
    campaignQueue.isPaused = false;
    refreshRoundRobinKeys();
    setTimeout(() => {
      runWorker().catch(() => {});
    }, 10);
    return campaignQueue.items.length;
  }
  return 0;
}

/**
 * Cancel and purge all pending items for a campaign
 */
export function cancelCampaignInQueue(campaignId) {
  const campaignQueue = bulkCampaignQueues.get(campaignId);
  if (campaignQueue) {
    campaignQueue.isCancelled = true;
    const removedCount = campaignQueue.items.length;
    campaignQueue.items = [];
    bulkCampaignQueues.delete(campaignId);
    refreshRoundRobinKeys();
    return removedCount;
  }
  return 0;
}

/**
 * Returns current queue metrics across single and bulk queues
 */
export function getQueueStats() {
  let totalBulkQueued = 0;
  let activeCampaignsCount = 0;

  for (const q of bulkCampaignQueues.values()) {
    if (!q.isCancelled && !q.isPaused) {
      totalBulkQueued += q.items.length;
      if (q.items.length > 0) activeCampaignsCount++;
    }
  }

  return {
    highPriorityQueued: highPriorityQueue.length,
    bulkQueued: totalBulkQueued,
    totalQueued: highPriorityQueue.length + totalBulkQueued,
    activeCampaigns: activeCampaignsCount,
    globalBulkCount: globalBulkMessageCount,
    isProcessing: isWorkerRunning
  };
}
