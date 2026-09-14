import express from 'express';
import cors from 'cors';
import path from 'path';
import { startSession, getSessionStatus, logoutSession, sendWhatsAppMessage } from './whatsappManager.js';
import { getUserRole, getAllUsers, createUser, resetUserPassword, deleteUser } from './firestoreService.js';

const app = express();

// Middleware
app.use(cors({
  origin: ['https://mff-wa.ai.studio', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
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

app.post('/api/users/me/password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    const { resetUserPassword } = await import('./firestoreService.js');
    await resetUserPassword(req.userId, password);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Error updating password:', error);
    res.status(500).json({ error: error.message || 'Failed to update password' });
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
    res.json({ role: req.userRole });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// Session Endpoints
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  // Hardcoded Master Credentials Check
  if (email === 'mahmoud.alkhateeb@money.jo') {
    if (password === 'MFF@money@2021' || password === 'mff123456') { // Allowing existing or strong default
      return res.json({ id: 'super-admin', email, name: 'Mahmoud Alkhateeb', displayName: 'Mahmoud Alkhateeb', role: 'Super Admin' });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Database Credentials Check
  try {
    const { authenticateUser } = await import('./firestoreService.js');
    const user = await authenticateUser(email, password);
    res.json(user);
  } catch (error) {
    console.error('[API] Login error:', error.message);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

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

app.get('/api/session/status', requireAuth, async (req, res) => {
  try {
    const statusData = await getSessionStatus(req.userId);
    res.json(statusData);
  } catch (error) {
    console.error(`[SessionStatus] Error for user ${req.userId}:`, error);
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

app.post('/api/session/reset', requireAuth, async (req, res) => {
  try {
    const result = await logoutSession(req.userId);
    res.json(result);
  } catch (error) {
    console.error(`[LogoutSession] Error for user ${req.userId}:`, error);
    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Backward compatibility or alternative routes
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

app.post('/api/send-message', requireAuth, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: 'Missing to or message' });
    }
    const result = await sendWhatsAppMessage(req.userId, to, message);
    res.json(result);
  } catch (error) {
    console.error(`[SendMessage] Error for user ${req.userId}:`, error.message);
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// Setup Vite for development and static serving for production
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function bootstrap() {
  app.get('/api/health', (req, res) => {
    res.json({ status: 'online', service: 'MFF WhatsApp Backend API' });
  });

  app.get('/firebase-applet-config.json', (req, res) => {
    res.json({});
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      } else {
        res.status(404).json({ error: 'Not found' });
      }
    });
  }

  // Handle any other unknown API endpoints
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Not found' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
