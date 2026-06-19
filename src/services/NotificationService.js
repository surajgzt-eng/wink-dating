// Notification Service
class NotificationService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.get('/', this.getNotifications.bind(this));
    this.router.post('/', this.createNotification.bind(this));
    this.router.put('/:notificationId/read', this.markAsRead.bind(this));
    this.router.delete('/:notificationId', this.deleteNotification.bind(this));
    this.router.get('/unread-count/:userId', this.getUnreadCount.bind(this));
  }

  async getNotifications(req, res) {
    try {
      const { userId } = req.query;
      const { limit = 20, offset = 0 } = req.query;
      
      const notifications = await this.db.query(
        `SELECT * FROM notifications 
         WHERE user_id = $1 AND is_read = false
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createNotification(req, res) {
    try {
      const { userId, type, title, body, data } = req.body;
      
      if (!userId || !type || !title || !body) {
        return res.status(400).json({ 
          error: 'Missing required fields: userId, type, title, body' 
        });
      }

      const notification = await this.db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, false, CURRENT_TIMESTAMP) RETURNING *`,
        [userId, type, title, body, JSON.stringify(data || {})]
      );

      // Send push notification if user is online
      await this.sendPushNotification(userId, notification[0]);

      res.status(201).json(notification[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      const { userId } = req.body;
      
      const notification = await this.db.query(
        'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );
      
      if (notification.length === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      await this.db.query(
        'UPDATE notifications SET is_read = true WHERE id = $1',
        [notificationId]
      );

      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;
      const { userId } = req.body;
      
      const result = await this.db.query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
        [notificationId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      res.json({ message: 'Notification deleted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getUnreadCount(req, res) {
    try {
      const { userId } = req.params;
      
      const result = await this.db.query(
        'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
        [userId]
      );

      res.json({ unreadCount: parseInt(result[0].count) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async sendPushNotification(userId, notification) {
    // Send push notification to user
    // This would integrate with Telegram's push notification system
    console.log(`Sending push notification to user ${userId}: ${notification.title} - ${notification.body}`);

    // Also send Telegram message if needed
    if (notification.type === 'match') {
      await this.sendMatchNotification(userId, notification);
    } else if (notification.type === 'message') {
      await this.sendMessageNotification(userId, notification);
    }
  }

  async sendMatchNotification(userId, notification) {
    const message = `🎉 Match Found! ${userId} ${userId} ${userId}\n\n${notification.title}\n\n${notification.body}\n\nTap to view your match! 💕`;
    
    await this.sendMessageToUser(userId, message);
  }

  async sendMessageNotification(userId, notification) {
    const message = `💬 New Message\n\n${notification.title}\n\n${notification.body}\n\nTap to reply! 💬`;
    
    await this.sendMessageToUser(userId, message);
  }

  async sendMessageToUser(chatId, message, options = {}) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const data = {
      chat_id: chatId,
      text: message,
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
}

module.exports = NotificationService;
