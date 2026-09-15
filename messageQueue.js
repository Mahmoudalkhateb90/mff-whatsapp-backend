import { getDb } from './firestoreService.js';
import { sendWhatsAppMessageDirect } from './whatsappManager.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Centralized Async Message Queue for WhatsApp
 * Designed to scale for 20-30 concurrent users:
 * - Immediate 202 Accepted response to avoid client lag or UI freeze.
 * - Sequential background processing via a single active WhatsApp connection.
 * - Controlled throttle delay (1.5 - 3.0s) between messages to prevent socket locking.
 * - Priority queuing: Single direct messages ('high') are prioritized ahead of bulk campaigns ('normal').
 * - Thread-safe worker with campaign cancellation and pause support.
 */

// In-memory FIFO queue
const queue = [];
let isWorkerRunning = false;

// Default throttle delay between messages (2 seconds = safe & responsive)
const DEFAULT_THROTTLE_DELAY_MS = 2000;

/**
 * Logs message delivery attempt to Firestore /messages_log and /messageLogs
 */
async function logMessageDelivery({ userId, phone, status, campaignId, errorMessage }) {
  try {
    const database = getDb();
    if (!database) return;

    const logEntry = {
      userId: userId || 'system',
      phone: phone || '',
      remoteJid: `${phone.replace(/\D/g, '')}@s.whatsapp.net`,
      status: status || 'sent',
      campaignId: campaignId || null,
      errorMessage: errorMessage || null,
      timestamp: FieldValue.serverTimestamp()
    };

    await database.collection('messages_log').add(logEntry);
    await database.collection('messageLogs').add(logEntry).catch(() => {});
  } catch (err) {
    console.warn('[MessageQueue] Firestore message log warning:', err?.message);
  }
}

/**
 * Sequential background worker loop
 */
async function runWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  while (queue.length > 0) {
    const item = queue.shift();

    // Check if this item belongs to a paused or cancelled campaign
    if (item.isCancelled) {
      continue;
    }

    if (item.isPaused) {
      // Re-queue at the back if paused
      queue.push(item);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    item.status = 'sending';
    const startTime = Date.now();

    try {
      const cleanPhone = (item.to || '').replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 7) {
        throw new Error('Invalid recipient phone number');
      }

      console.log(`[MessageQueue] Dispatching message to ${cleanPhone} (user: ${item.userId}, priority: ${item.priority})...`);
      const result = await sendWhatsAppMessageDirect(item.userId, cleanPhone, item.message);

      item.status = 'sent';
      item.messageId = result?.messageId || `msg_${Date.now()}`;

      // Log success to Firestore
      await logMessageDelivery({
        userId: item.userId,
        phone: cleanPhone,
        status: 'sent',
        campaignId: item.campaignId
      });

      if (item.onSuccess) {
        try {
          item.onSuccess(item, result);
        } catch (e) {}
      }

      if (item.resolve) {
        item.resolve({ success: true, messageId: item.messageId, status: 'sent' });
      }
    } catch (err) {
      console.error(`[MessageQueue] Delivery failed for ${item.to}:`, err?.message || err);
      item.status = 'failed';
      item.error = err?.message || 'Unknown send error';

      // Log failure to Firestore
      await logMessageDelivery({
        userId: item.userId,
        phone: item.to,
        status: 'failed',
        campaignId: item.campaignId,
        errorMessage: item.error
      });

      if (item.onFailure) {
        try {
          item.onFailure(item, err);
        } catch (e) {}
      }

      if (item.reject) {
        item.reject(err);
      }
    }

    // Controlled throttle delay (e.g. 1.5 - 3.0s) to guarantee WhatsApp socket stability
    const throttleMs = item.throttleDelayMs || DEFAULT_THROTTLE_DELAY_MS;
    const elapsed = Date.now() - startTime;
    const waitTime = Math.max(1500, throttleMs - elapsed);

    await new Promise((r) => setTimeout(r, waitTime));
  }

  isWorkerRunning = false;
}

/**
 * Enqueue a single message for asynchronous background delivery.
 * High-priority messages (e.g., direct 1-to-1 agent replies) jump ahead of bulk campaigns.
 */
export function enqueueMessage({
  userId,
  to,
  message,
  campaignId = null,
  priority = 'high',
  throttleDelayMs = DEFAULT_THROTTLE_DELAY_MS,
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
    priority,
    status: 'queued',
    throttleDelayMs,
    isPaused: false,
    isCancelled: false,
    createdAt: Date.now(),
    onSuccess,
    onFailure
  };

  if (priority === 'high') {
    // Find first non-high priority item index to insert before bulk messages
    const firstLowIndex = queue.findIndex(q => q.priority !== 'high');
    if (firstLowIndex === -1) {
      queue.push(queueItem);
    } else {
      queue.splice(firstLowIndex, 0, queueItem);
    }
  } else {
    queue.push(queueItem);
  }

  const queuePosition = queue.findIndex(q => q.id === id) + 1;

  // Trigger background worker safely
  setTimeout(() => {
    runWorker().catch(err => console.error('[MessageQueue] Worker execution error:', err));
  }, 10);

  return {
    success: true,
    status: 'queued',
    messageId: id,
    queuePosition,
    estimatedDelaySeconds: Math.round((queuePosition * throttleDelayMs) / 1000),
    message: 'Message accepted and queued for sequential background delivery'
  };
}

/**
 * Batch enqueue for campaign recipients
 */
export function enqueueCampaignItems({
  campaignId,
  userId,
  items,
  throttleDelayMs = DEFAULT_THROTTLE_DELAY_MS,
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
      throttleDelayMs: Math.max(1500, throttleDelayMs),
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

    queue.push(queueItem);
    queuedItems.push(queueItem);
  }

  // Trigger worker
  setTimeout(() => {
    runWorker().catch(err => console.error('[MessageQueue] Worker error on campaign:', err));
  }, 10);

  return queuedItems.length;
}

/**
 * Pause all pending queue items for a campaign
 */
export function pauseCampaignInQueue(campaignId) {
  let count = 0;
  for (const item of queue) {
    if (item.campaignId === campaignId) {
      item.isPaused = true;
      count++;
    }
  }
  return count;
}

/**
 * Resume all pending queue items for a campaign
 */
export function resumeCampaignInQueue(campaignId) {
  let count = 0;
  for (const item of queue) {
    if (item.campaignId === campaignId) {
      item.isPaused = false;
      count++;
    }
  }
  // Ensure worker runs
  if (count > 0) {
    setTimeout(() => {
      runWorker().catch(() => {});
    }, 10);
  }
  return count;
}

/**
 * Cancel and purge all pending items for a campaign
 */
export function cancelCampaignInQueue(campaignId) {
  let removedCount = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].campaignId === campaignId) {
      queue[i].isCancelled = true;
      queue.splice(i, 1);
      removedCount++;
    }
  }
  return removedCount;
}

/**
 * Returns current queue metrics
 */
export function getQueueStats() {
  return {
    totalQueued: queue.length,
    isProcessing: isWorkerRunning
  };
}
