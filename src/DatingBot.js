// Telegram Dating Bot - Main Application Logic

const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const qrcode = require('qrcode');
require('dotenv').config();

class DatingBot {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.db = new Pool({ connectionString: process.env.DATABASE_URL });
    this.redis = redis.createClient({ url: process.env.REDIS_URL });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupServices();
  }

  setupMiddleware() {
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  setupServices() {
    this.authService = new AuthService(this.db, this.redis);
    this.profileService = new ProfileService(this.db, this.redis);
    this.matchingService = new MatchingService(this.db, this.redis);
    this.chatService = new ChatService(this.db, this.redis);
    this.paymentService = new PaymentService(this.db, this.redis);
    this.notificationService = new NotificationService(this.db, this.redis);
    this.faceVerificationService = new FaceVerificationService();
    this.referralService = new ReferralService(this.db, this.redis);
  }

  setupRoutes() {
    // Telegram Bot webhook
    this.app.post('/webhook', express.raw({ type: 'application/json' }), this.handleWebhook.bind(this));
    
    // API Routes
    this.app.use('/api/auth', this.authService.router);
    this.app.use('/api/profile', this.authenticateToken, this.profileService.router);
    this.app.use('/api/matching', this.authenticateToken, this.matchingService.router);
    this.app.use('/api/chat', this.authenticateToken, this.chatService.router);
    this.app.use('/api/payments', this.authenticateToken, this.paymentService.router);
    this.app.use('/api/referrals', this.authenticateToken, this.referralService.router);
    this.app.use('/api/notifications', this.authenticateToken, this.notificationService.router);
    
    // WebApp static files
    this.app.use(express.static('public/webapp'));
    
    // Health check
    this.app.get('/health', this.healthCheck.bind(this));
  }

  async handleWebhook(req, res) {
    try {
      const update = JSON.parse(req.body);
      
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.chosen_inline_result) {
        await this.handleInlineResult(update.chosen_inline_result);
      }
      
      res.json({ ok: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text || '';
    
    // Handle commands
    if (text.startsWith('/start')) {
      await this.handleStartCommand(chatId, message);
    } else if (text.startsWith('/profile')) {
      await this.handleProfileCommand(chatId);
    } else if (text.startsWith('/match')) {
      await this.handleMatchCommand(chatId);
    } else if (text.startsWith('/chat')) {
      await this.handleChatCommand(chatId);
    } else if (text.startsWith('/premium')) {
      await this.handlePremiumCommand(chatId);
    } else if (text.startsWith('/help')) {
      await this.handleHelpCommand(chatId);
    } else {
      // Handle regular conversation
      await this.handleConversation(chatId, text);
    }
  }

  async handleStartCommand(chatId, message) {
    const userExists = await this.profileService.getUser(chatId);
    
    if (!userExists) {
      // Send profile setup message
      await this.sendMessage(chatId, 'Welcome to the Dating Bot! 🎉\n\nLet\'s set up your profile first:')
        .then(() => this.sendProfileSetupKeyboard(chatId));
    } else {
      await this.sendMessage(chatId, 'Welcome back! Ready to find new matches? 💕');
      await this.sendMainKeyboard(chatId);
    }
  }

  async sendMessage(chatId, text, options = {}) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const data = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      ...options
    };
    
    try {
      await axios.post(url, data);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  async sendProfileSetupKeyboard(chatId) {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Start Profile Setup', callback_data: 'setup_profile' }]
        ]
      }
    };
    
    await this.sendMessage(chatId, 'Click the button below to start setting up your profile:', keyboard);
  }

  async sendMainKeyboard(chatId) {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💕 Find Matches', callback_data: 'find_matches' }],
          [{ text: '👤 View Profile', callback_data: 'view_profile' }],
          [{ text: '💬 My Chats', callback_data: 'my_chats' }],
          [{ text: '⭐ Premium', callback_data: 'premium' }],
          [{ text: '🎫 Refer Friends', callback_data: 'refer' }],
          [{ text: '⚙️ Settings', callback_data: 'settings' }]
        ]
      }
    };
    
    await this.sendMessage(chatId, 'What would you like to do?', keyboard);
  }

  async healthCheck(req, res) {
    try {
      // Check database connection
      await this.db.query('SELECT 1');
      
      // Check Redis connection
      await this.redis.ping();
      
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          redis: 'connected',
          telegram: 'connected'
        },
        features: [
          'profile-management',
          'photo-upload',
          'face-verification',
          'smart-matching',
          'chat-interface',
          'premium-subscription',
          'referral-system'
        ]
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }

  async start() {
    try {
      await this.redis.connect();
      await this.app.listen(this.port);
      console.log(`Telegram Dating Bot running on port ${this.port}`);
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

module.exports = DatingBot;
