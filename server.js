import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { 
  startWhatsAppSession,
  startFreshSession, 
  disconnectWhatsAppSession,
  resetSession, 
  startSession, 
  getSessionStatus, 
  logoutSession, 
  sendWhatsAppMessage, 
  autoRestoreSessions 
} from './whatsappManager.js';
import { 
  getUserRole, 
  getUserPermissions, 
  getAllUsers, 
  createUser, 
  updateUser, 
  resetUserPassword, 
  deleteUser, 
  getDb, 
  getAnalyticsMetrics 
} from './firestoreService.js';
import { createCampaign, pauseCampaign, resumeCampaign, cancelCampaign, getActiveCampaign } from './campaignManager.js';
import { enqueueMessage, getQueueStats } from './messageQueue.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Root & Health Routes
app.get('/api', (req, res) => {
  res.json({ status: 'online', service: 'MFF WhatsApp Backend API' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Internal System Authentication Endpoints
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = email?.trim().toLowerCase();
    const cleanPassword = password?.trim();

    if (cleanEmail === 'mahmoud.alkhateeb@money.jo' && cleanPassword === 'MFF@money@2021') {
      return res.json({
        success: true,
        user: {
          id: 'super-admin',
          email: 'mahmoud.alkhateeb@money.jo',
          name: 'Mahmoud Alkhateeb',
          role: 'Super Admin',
          permissions: {
            canSendSingle: true,
            canSendBulk: true
          }
        }
      });
    }

    try {
      const db = getDb();
      if (db) {
        const snapshot = await db.collection('users').where('email', '==', cleanEmail).limit(1).get();

        if (!snapshot.empty) {
          const userDoc = snapshot.docs[0];
          const userData = userDoc.data();

          if (!userData.password || userData.password?.trim() === cleanPassword) {
            const isSuper = userData.role === 'Super Admin';
            const defaultBulk = isSuper || userData.role === 'Department Manager' || userData.role === 'Team Leader';
            const permissions = isSuper
              ? { canSendSingle: true, canSendBulk: true }
              : {
                  canSendSingle: userData.permissions?.canSendSingle !== false,
                  canSendBulk: typeof userData.permissions?.canSendBulk === 'boolean'
                    ? userData.permissions.canSendBulk
                    : defaultBulk
                };

            return res.json({
              success: true,
              user: {
                id: userDoc.id,
                email: userData.email,
                name: userData.displayName || '',
                role: userData.role || 'Agent',
                department: userData.department || '',
                teamLeaderId: userData.teamLeaderId || null,
                teamLeaderName: userData.teamLeaderName || '',
                permissions
              }
            });
          }
        }
      }
    } catch (dbError) {
      console.warn('[API] Firestore user lookup notice:', dbError.message);
    }

    return res.status(401).json({ error: 'Invalid email or password' });
  } catch (error) {
    console.error('[API] Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export async function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userEmail = req.headers['x-user-email'];

  if (!userId && !userEmail) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  if (userId === 'super-admin' || userEmail === 'mahmoud.alkhateeb@money.jo') {
    req.userRole = 'Super Admin';
    req.userId = userId || 'super-admin';
    return next();
  }

  const role = await getUserRole(userId);
  req.userRole = role;
  req.userId = userId;
  next();
}

export async function requireSuperAdmin(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userEmail = req.headers['x-user-email'];

  if (userId === 'super-admin' || userEmail === 'mahmoud.alkhateeb@money.jo') {
    req.userRole = 'Super Admin';
    req.userId = userId || 'super-admin';
    return next();
  }

  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }

  const role = await getUserRole(userId);
  if (role !== 'Super Admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  req.userRole = role;
  req.userId = userId;
  next();
}

/**
 * Middleware: Verify user has single messaging permission
 * Super Admin bypasses with true.
 */
export async function requireSinglePermission(req, res, next) {
  if (req.userRole === 'Super Admin' || req.userId === 'super-admin') {
    return next();
  }

  const userEmail = req.headers['x-user-email'];
  const perms = await getUserPermissions(req.userId, userEmail);

  if (!perms.canSendSingle) {
    return res.status(403).json({ 
      error: 'Access Denied: You do not have permission to send single messages',
      permission: 'canSendSingle'
    });
  }

  next();
}

/**
 * Middleware: Verify user has bulk broadcast permission
 * Super Admin bypasses with true.
 */
export async function requireBulkPermission(req, res, next) {
  if (req.userRole === 'Super Admin' || req.userId === 'super-admin') {
    return next();
  }

  const userEmail = req.headers['x-user-email'];
  const perms = await getUserPermissions(req.userId, userEmail);

  if (!perms.canSendBulk) {
    return res.status(403).json({ 
      error: 'Access Denied: You do not have permission to run bulk broadcasts',
      permission: 'canSendBulk'
    });
  }

  next();
}

// User Management Routes
app.get('/api/users', requireSuperAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('[API] Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/users', requireSuperAdmin, async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.json(user);
  } catch (error) {
    console.error('[API] Error creating user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

app.put('/api/users/:uid', requireSuperAdmin, async (req, res) => {
  try {
    const updated = await updateUser(req.params.uid, req.body);
    res.json({ success: true, user: updated });
  } catch (error) {
    console.error('[API] Error updating user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

app.post('/api/users/:uid/reset-password', requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    await resetUserPassword(req.params.uid, password);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error resetting password:', error);
    res.status(500).json({ error: error.message || 'Failed to reset password' });
  }
});

app.delete('/api/users/:uid', requireSuperAdmin, async (req, res) => {
  try {
    await deleteUser(req.params.uid);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error deleting user:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    const userEmail = req.headers['x-user-email'];
    const permissions = await getUserPermissions(req.userId, userEmail);
    res.json({ role: req.userRole, permissions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Explicit Per-User WhatsApp Session Control Endpoints
app.post('/api/session/start', requireAuth, async (req, res) => {
  const userId = req.body?.userId || req.userId;
  if (!userId || (userId !== req.userId && req.userRole !== 'Super Admin')) {
    return res.status(403).json({ error: 'You can only start your own session' });
  }

  try {
    const result = await startFreshSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[StartFreshSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to start fresh WhatsApp session', message: error.message });
  }
});

app.post('/api/session/disconnect', requireAuth, async (req, res) => {
  const userId = req.body?.userId || req.userId;
  if (!userId || (userId !== req.userId && req.userRole !== 'Super Admin')) {
    return res.status(403).json({ error: 'You can only disconnect your own session' });
  }

  try {
    const result = await disconnectWhatsAppSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[DisconnectSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to disconnect session', message: error.message });
  }
});

app.post('/api/session/reset', requireAuth, async (req, res) => {
  const userId = req.body?.userId || req.userId;
  if (!userId || (userId !== req.userId && req.userRole !== 'Super Admin')) {
    return res.status(403).json({ error: 'You can only reset your own session' });
  }

  try {
    const result = await disconnectWhatsAppSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[ResetSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to reset session', message: error.message });
  }
});

app.get('/api/session/status', requireAuth, async (req, res) => {
  try {
    const statusData = await getSessionStatus(req.userId);
    res.json(statusData);
  } catch (error) {
    console.error(`[SessionStatus] Error for user ${req.userId}:`, error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// Backward compatibility routes
app.post('/api/sessions/start', requireAuth, async (req, res) => {
  const userId = req.body?.userId || req.userId;
  if (!userId || (userId !== req.userId && req.userRole !== 'Super Admin')) {
    return res.status(403).json({ error: 'You can only start your own session' });
  }

  try {
    const result = await startFreshSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[StartSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to start WhatsApp session' });
  }
});

app.get('/api/sessions/status/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.userId && req.userRole !== 'Super Admin') {
    return res.status(403).json({ error: 'You can only view your own session' });
  }
  
  try {
    const status = await getSessionStatus(userId);
    res.json(status);
  } catch (error) {
    console.error(`[SessionStatus] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

app.post('/api/sessions/logout', requireAuth, async (req, res) => {
  const userId = req.body?.userId || req.userId;
  if (!userId || (userId !== req.userId && req.userRole !== 'Super Admin')) {
    return res.status(403).json({ error: 'You can only logout your own session' });
  }

  try {
    const result = await disconnectWhatsAppSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[LogoutSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to logout session' });
  }
});

// Async Message Queue Endpoints (Immediate 202 Accepted for 20-30 concurrent users)
const handleSendMessage = async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing to or message' });
    }
    const result = enqueueMessage({
      userId: req.userId,
      to,
      message,
      priority: 'high'
    });
    res.status(202).json(result);
  } catch (error) {
    console.error(`[SendMessage] Error for user ${req.userId}:`, error.message);
    res.status(500).json({ error: error.message || 'Failed to enqueue message' });
  }
};

app.post('/api/send-message', requireAuth, requireSinglePermission, handleSendMessage);
app.post('/api/messages/send', requireAuth, requireSinglePermission, handleSendMessage);
app.post('/api/messages/single', requireAuth, requireSinglePermission, handleSendMessage);

app.get('/api/queue/stats', requireAuth, (req, res) => {
  res.json(getQueueStats());
});

// Campaign Engine Endpoints
const handleCreateCampaign = async (req, res) => {
  try {
    const { name, items, delaySeconds, messageTemplate } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one contact item is required' });
    }
    const campaign = await createCampaign({
      name,
      items,
      delaySeconds,
      messageTemplate,
      userId: req.userId
    });
    // Immediately respond with 202 Accepted to prevent UI lag or freeze
    res.status(202).json({
      success: true,
      message: 'Campaign accepted and running sequentially in background',
      ...campaign
    });
  } catch (error) {
    console.error('[API] Create campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to create campaign' });
  }
};

app.post('/api/campaigns/create', requireAuth, requireBulkPermission, handleCreateCampaign);
app.post('/api/broadcast/start', requireAuth, requireBulkPermission, handleCreateCampaign);

app.post('/api/campaigns/:id/pause', requireAuth, async (req, res) => {
  try {
    const result = await pauseCampaign(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[API] Pause campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to pause campaign' });
  }
});

app.post('/api/campaigns/:id/resume', requireAuth, async (req, res) => {
  try {
    const result = await resumeCampaign(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[API] Resume campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to resume campaign' });
  }
});

app.post('/api/campaigns/:id/cancel', requireAuth, async (req, res) => {
  try {
    const result = await cancelCampaign(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('[API] Cancel campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel campaign' });
  }
});

app.get('/api/campaigns/active', requireAuth, async (req, res) => {
  try {
    const active = await getActiveCampaign(req.userId);
    res.json(active || { status: 'idle' });
  } catch (error) {
    console.error('[API] Get active campaign error:', error);
    res.status(500).json({ error: error.message || 'Failed to get active campaign' });
  }
});

// Analytics Endpoints with Agent/User filtering
app.get('/api/analytics/metrics', requireAuth, async (req, res) => {
  try {
    const { range, startDate, endDate, status, agentId } = req.query;
    const metrics = await getAnalyticsMetrics({
      range: range || 'all',
      startDate,
      endDate,
      status: status || 'all',
      userId: req.userId,
      userRole: req.userRole,
      agentId: agentId || 'all'
    });
    res.json(metrics);
  } catch (error) {
    console.error('[API] Analytics metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics metrics' });
  }
});

// Setup Vite for development and safe static serving for production
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function bootstrap() {
  // Automatically restore active Baileys WhatsApp sessions from stored credentials
  autoRestoreSessions().catch(err => {
    console.warn('[Server] autoRestoreSessions notice:', err.message);
  });

  const distPath = path.resolve('./dist');
  const indexPath = path.join(distPath, 'index.html');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(indexPath);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (hasDist) {
    app.use(express.static(distPath));
  }

  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    if (hasDist) {
      return res.sendFile(indexPath);
    }

    if (isProd) {
      return res.status(200).json({
        status: 'online',
        service: 'MFF WhatsApp Backend API',
        message: 'Backend running on Render. Dist frontend not found.'
      });
    }

    next();
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
