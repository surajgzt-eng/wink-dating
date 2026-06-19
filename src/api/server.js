// Telegram Dating Bot Server
// Main Express.js backend for Telegram Mini App

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const db = require('../db_adapter');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'dating-bot-jwt-secret-key';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function generateToken(userId) {
  return jwt.sign({ userId, iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

async function query(text, params = []) {
  return db.query(text, params);
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(403).json({ error: 'Invalid or expired token' });
  req.userId = decoded.userId;
  next();
}

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Health ───────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1 as status');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: db.isPostgres() ? 'postgresql' : 'sqlite',
      features: { profile: true, matching: true, chat: true, media: true, referral: true }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/test', (req, res) => {
  res.json({ message: '🚀 WINK Dating Bot API', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// ─── Auth / Register ─────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { chatId, firstName, lastName, username } = req.body;
    if (!chatId || !firstName) return res.status(400).json({ error: 'Missing required fields' });

    const referralCode = 'REF' + chatId + Math.random().toString(36).substring(2, 8).toUpperCase();

    await query(
      `INSERT INTO users (chat_id, first_name, last_name, username, referral_code, is_verified, is_premium, texts_remaining, matches_used, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 5, 0, datetime('now'))
       ON CONFLICT (chat_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, username = excluded.username`,
      [chatId, firstName, lastName || '', username || '', referralCode]
    );

    const token = generateToken(chatId);
    res.status(201).json({ success: true, chatId, token, referralCode, isPremium: false, textsRemaining: 5, matchesUsed: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Profile ─────────────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('tma ')) return res.status(401).json({ error: 'Missing TMA auth' });
    const initData = auth.slice(4);
    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    if (!userRaw) return res.status(401).json({ error: 'No user in initData' });
    const userData = JSON.parse(userRaw);
    const chatId = userData.id;
    if (!chatId) return res.status(401).json({ error: 'No user ID' });

    const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    res.json({
      chatId: user.chat_id,
      firstName: user.first_name,
      lastName: user.last_name,
      username: user.username,
      photoUrl: user.photo_url,
      selfieUrl: user.selfie_url,
      gender: user.gender,
      seeking: user.seeking,
      age: user.age,
      city: user.city,
      country: user.country,
      bio: user.bio,
      isVerified: Boolean(user.is_verified),
      isPremium: Boolean(user.is_premium),
      premiumExpires: user.premium_expires,
      textsRemaining: user.texts_remaining,
      matchesUsed: user.matches_used,
      referralCode: user.referral_code,
      referredBy: user.referred_by
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/profile/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];
    res.json({
      chatId: user.chat_id,
      firstName: user.first_name,
      lastName: user.last_name,
      photoUrl: user.photo_url,
      selfieUrl: user.selfie_url,
      gender: user.gender,
      seeking: user.seeking,
      age: user.age,
      city: user.city,
      country: user.country,
      bio: user.bio,
      isVerified: Boolean(user.is_verified),
      isPremium: Boolean(user.is_premium),
      textsRemaining: user.texts_remaining,
      matchesUsed: user.matches_used,
      referralCode: user.referral_code
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/profile/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { firstName, lastName, gender, seeking, age, city, country, bio } = req.body;

    await query(
      `UPDATE users SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        gender = COALESCE($3, gender),
        seeking = COALESCE($4, seeking),
        age = COALESCE($5, age),
        city = COALESCE($6, city),
        country = COALESCE($7, country),
        bio = COALESCE($8, bio),
        updated_at = datetime('now')
       WHERE chat_id = $9`,
      [firstName, lastName, gender, seeking, age, city, country, bio, chatId]
    );

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profile/:chatId/photo', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { photoUrl } = req.body;
    if (!photoUrl) return res.status(400).json({ error: 'Missing photoUrl' });
    await query('UPDATE users SET photo_url = $1, updated_at = datetime(\'now\') WHERE chat_id = $2', [photoUrl, chatId]);
    res.json({ success: true, photoUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Matching ────────────────────────────────────────────────────
app.post('/api/matching/find', async (req, res) => {
  try {
    const { chatId } = req.body;
    const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = users[0];

    // Check match limit (20 for free, unlimited for premium)
    if (!user.is_premium && user.matches_used >= 20) {
      return res.status(403).json({ error: 'Match limit reached', needsPremium: true });
    }

    if (!user.gender || !user.seeking) {
      return res.status(400).json({ error: 'Profile incomplete', needsProfileSetup: true });
    }

    let matchQuery, params;
    if (user.seeking === 'female') {
      matchQuery = `
        SELECT * FROM users WHERE gender = 'female' AND chat_id != $1 AND is_verified = 1 AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
        ORDER BY CASE WHEN age < $2 THEN 0 ELSE 1 END, ABS(age - $2) ASC LIMIT 1`;
      params = [chatId, user.age || 25];
    } else if (user.seeking === 'male') {
      matchQuery = `
        SELECT * FROM users WHERE gender = 'male' AND chat_id != $1 AND is_verified = 1 AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
        ORDER BY CASE WHEN age > $2 THEN 0 ELSE 1 END, ABS(age - $2) ASC LIMIT 1`;
      params = [chatId, user.age || 25];
    } else {
      matchQuery = `
        SELECT * FROM users WHERE chat_id != $1 AND is_verified = 1 AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
        ORDER BY ABS(age - $2) ASC LIMIT 1`;
      params = [chatId, user.age || 25];
    }

    const matches = await query(matchQuery, params);

    if (matches.length === 0) {
      return res.json({ success: false, message: 'No matches found', match: null });
    }

    const match = matches[0];

    await query(
      `INSERT INTO matches (user1_id, user2_id, status, messages_used, created_at) VALUES ($1, $2, 'active', 0, datetime('now'))`,
      [chatId, match.chat_id]
    );

    await query('UPDATE users SET matches_used = matches_used + 1 WHERE chat_id = $1', [chatId]);

    const matchId = (await query('SELECT MAX(id) as id FROM matches WHERE user1_id = $1 AND user2_id = $2', [chatId, match.chat_id]))[0].id;

    res.json({
      success: true,
      match: {
        matchId,
        chatId: match.chat_id,
        firstName: match.first_name,
        lastName: match.last_name,
        age: match.age,
        city: match.city,
        country: match.country,
        photoUrl: match.photo_url,
        isPremium: Boolean(match.is_premium),
        bio: match.bio
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/matches/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const matches = await query(
      `SELECT m.*,
        CASE WHEN m.user1_id = $1 THEN u2.chat_id ELSE u1.chat_id END as matched_chat_id,
        CASE WHEN m.user1_id = $1 THEN u2.first_name ELSE u1.first_name END as first_name,
        CASE WHEN m.user1_id = $1 THEN u2.last_name ELSE u1.last_name END as last_name,
        CASE WHEN m.user1_id = $1 THEN u2.photo_url ELSE u1.photo_url END as photo_url,
        CASE WHEN m.user1_id = $1 THEN u2.age ELSE u1.age END as age,
        CASE WHEN m.user1_id = $1 THEN u2.city ELSE u1.city END as city,
        CASE WHEN m.user1_id = $1 THEN u2.is_premium ELSE u1.is_premium END as is_premium
       FROM matches m
       LEFT JOIN users u1 ON m.user1_id = u1.chat_id
       LEFT JOIN users u2 ON m.user2_id = u2.chat_id
       WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'
       ORDER BY m.last_message_at DESC`,
      [chatId]
    );
    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Messages ────────────────────────────────────────────────────
app.post('/api/messages/send', async (req, res) => {
  try {
    const { matchId, senderId, content, mediaType, mediaUrl } = req.body;
    if (!matchId || !senderId) return res.status(400).json({ error: 'Missing required fields' });

    // Check message limit (10 per match for free users)
    const users = await query('SELECT is_premium, texts_remaining FROM users WHERE chat_id = $1', [senderId]);
    const user = users[0];

    const msgCountResult = await query('SELECT COUNT(*) as count FROM messages WHERE match_id = $1 AND sender_id = $2', [matchId, senderId]);
    const msgCount = msgCountResult[0].count;

    if (!user.is_premium && msgCount >= 10) {
      return res.status(403).json({ error: 'Message limit reached', needsPremium: true, textsRemaining: user.texts_remaining });
    }

    // Get match to find receiver
    const matches = await query('SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)', [matchId, senderId]);
    if (matches.length === 0) return res.status(404).json({ error: 'Match not found' });

    const match = matches[0];
    const receiverId = match.user1_id === senderId ? match.user2_id : match.user1_id;

    // Insert message
    await query(
      `INSERT INTO messages (match_id, sender_id, receiver_id, content, media_type, media_url, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, datetime('now'))`,
      [matchId, senderId, receiverId, content || '', mediaType || 'text', mediaUrl || null]
    );

    await query('UPDATE matches SET last_message_at = datetime(\'now\') WHERE id = $1', [matchId]);

    // Decrement texts if free user (for now, texts = messages allowance)
    if (!user.is_premium && user.texts_remaining > 0) {
      await query('UPDATE users SET texts_remaining = texts_remaining - 1 WHERE chat_id = $1', [senderId]);
    }

    const updatedUser = await query('SELECT texts_remaining FROM users WHERE chat_id = $1', [senderId]);

    res.status(201).json({
      success: true,
      textsRemaining: updatedUser[0]?.texts_remaining || 0,
      messagesUsed: msgCount ? msgCount[0].count + 1 : 1,
      isPremium: Boolean(user.is_premium)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { chatId } = req.query;
    const messages = await query(
      `SELECT * FROM messages WHERE match_id = $1 ORDER BY created_at ASC LIMIT 100`,
      [matchId]
    );
    if (chatId) {
      await query('UPDATE messages SET is_read = 1 WHERE match_id = $1 AND receiver_id = $2', [matchId, chatId]);
    }
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Premium ─────────────────────────────────────────────────────
app.post('/api/premium/subscribe', async (req, res) => {
  try {
    const { chatId } = req.body;
    await query(
      `UPDATE users SET is_premium = 1, premium_expires = datetime('now', '+365 days'), updated_at = datetime('now') WHERE chat_id = $1`,
      [chatId]
    );
    res.json({
      success: true,
      isPremium: true,
      premiumExpires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      message: 'Premium activated for 1 year!'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Referral ────────────────────────────────────────────────────
app.post('/api/referral/generate', async (req, res) => {
  try {
    const { chatId } = req.body;
    const users = await query('SELECT referral_code FROM users WHERE chat_id = $1', [chatId]);
    if (!users.length || !users[0].referral_code) return res.status(404).json({ error: 'User not found' });
    const botUsername = process.env.BOT_USERNAME || 'wink_dating_bot';
    res.json({
      referralCode: users[0].referral_code,
      referralLink: `https://t.me/${botUsername}?start=ref_${users[0].referral_code}`,
      rewardDescription: 'Refer a friend who completes profile + photo = +5 texts each'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Notifications ────────────────────────────────────────────────
app.get('/api/notifications/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const notifications = await query(
      'SELECT * FROM notifications WHERE user_id = $1 AND is_read = 0 ORDER BY created_at DESC LIMIT 20',
      [chatId]
    );
    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/notifications/:notificationId/read', async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE id = $1', [req.params.notificationId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Telegram Webhook ─────────────────────────────────────────────
const { setupWebhook } = require('../telegramWebhook');
setupWebhook(app, query);

// ─── WebApp Frontend ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../public/webapp')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/webapp/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────
async function startServer() {
  try {
    await db.autoInitialize();
    await db.createTables();
    await db.seedDatabase();

    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n========================================');
      console.log('🚀 WINK Dating Bot Server v2.0');
      console.log('========================================');
      console.log(`📡 Port: ${PORT}`);
      console.log(`🗄️  Database: ${db.isPostgres() ? 'PostgreSQL' : 'SQLite'}`);
      console.log(`📱 Telegram Bot: ${process.env.TELEGRAM_BOT_TOKEN ? 'Configured' : 'Not configured'}`);
      console.log('========================================\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

startServer();
module.exports = app;