import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { startSession, getSessionStatus, logoutSession } from './whatsappManager.js';
import { getUserRole, getAllUsers, createUser, resetUserPassword } from './firestoreService.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

export async function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Missing x-user-id header' });
  }
  const role = await getUserRole(userId);
  req.userRole = role;
  req.userId = userId;
  next();
}

export async function requireSuperAdmin(req, res, next) {
  const userId = req.headers['x-user-id'];
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

app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    res.json({ role: req.userRole });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Session Endpoints
app.post('/api/sessions/start', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId || userId !== req.userId) {
    return res.status(403).json({ error: 'You can only start your own session' });
  }

  try {
    const result = await startSession(userId);
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
    res.json({ status });
  } catch (error) {
    console.error(`[SessionStatus] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

app.post('/api/sessions/logout', requireAuth, async (req, res) => {
  const { userId } = req.body;
  if (!userId || userId !== req.userId) {
    return res.status(403).json({ error: 'You can only logout your own session' });
  }

  try {
    const result = await logoutSession(userId);
    res.json(result);
  } catch (error) {
    console.error(`[LogoutSession] Error for user ${userId}:`, error);
    res.status(500).json({ error: 'Failed to logout session' });
  }
});

// Setup Vite for development and static serving for production
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function bootstrap() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('./dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve('./dist/index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
