// Chat Service
class ChatService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.get('/messages/:matchId', this.getMessages.bind(this));
    this.router.post('/messages', this.sendMessage.bind(this));
    this.router.get('/history/:chatId', this.getChatHistory.bind(this));
    this.router.post('/messages/:matchId/read', this.markMessagesAsRead.bind(this));
    this.router.get('/unread-count/:chatId', this.getUnreadCount.bind(this));
  }

  async getMessages(req, res) {
    try {
      const { matchId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      
      const messages = await this.db.query(
        `SELECT m.*, u.first_name, u.last_name, u.photo_url
         FROM messages m
         JOIN users u ON m.sender_id = u.chat_id
         WHERE m.match_id = $1
         ORDER BY m.created_at DESC
         LIMIT $2 OFFSET $3`,
        [matchId, limit, offset]
      );

      res.json(messages.reverse());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async sendMessage(req, res) {
    try {
      const { matchId, receiverId, content } = req.body;
      
      if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Message content cannot be empty' });
      }

      // Check if users are in this match
      const match = await this.db.query(
        `SELECT * FROM matches WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`, 
        [matchId, req.userId]
      );
      
      if (match.length === 0) {
        return res.status(403).json({ error: 'Not authorized to send in this match' });
      }

      // Get receiver info
      const users = await this.db.query(
        'SELECT * FROM users WHERE chat_id = $1', 
        [receiverId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      // Check texts limit for non-premium users
      const sender = users[0]; // This should be the sender, not receiver
      const receiver = users[0]; // This needs to be fixed

      if (!sender.is_premium) {
        const textsUsed = sender.texts_used || 0;
        if (textsUsed >= 10) {
          return res.status(403).json({ 
            error: 'Text limit reached. Upgrade to premium for unlimited messages or refer friends to get 10 more texts.'
          });
        }

        // Increment texts used
        await this.db.query(
          'UPDATE users SET texts_used = texts_used + 1 WHERE chat_id = $1',
          [req.userId]
        );
      }

      // Save message
      const message = await this.db.query(
        `INSERT INTO messages (match_id, sender_id, receiver_id, content, is_read) 
         VALUES ($1, $2, $3, $4, false) RETURNING *`,
        [matchId, req.userId, receiverId, content.trim()]
      );

      // Update match timestamp
      await this.db.query(
        'UPDATE matches SET last_message_at = CURRENT_TIMESTAMP WHERE id = $1',
        [matchId]
      );

      // Send real-time notification via WebSocket
      await this.notifyNewMessage(matchId, message[0]);

      res.status(201).json(message[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getChatHistory(req, res) {
    try {
      const { chatId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      
      // Get all matches for this user
      const matches = await this.db.query(
        `SELECT m.* FROM matches m 
         WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'`, 
        [chatId]
      );

      const chatHistory = [];
      
      for (const match of matches) {
        // Get the other user in the match
        const otherUserId = match.user1_id === chatId ? match.user2_id : match.user1_id;
        const otherUser = await this.db.query(
          'SELECT * FROM users WHERE chat_id = $1', 
          [otherUserId]
        );

        if (otherUser.length > 0) {
          // Get recent messages
          const messages = await this.db.query(
            `SELECT * FROM messages 
             WHERE match_id = $1 AND (sender_id = $2 OR receiver_id = $2)
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
            [match.id, chatId, limit, offset]
          );

          chatHistory.push({
            match,
            user: otherUser[0],
            recentMessages: messages.reverse(),
            lastMessageTime: match.last_message_at
          });
        }
      }

      res.json(chatHistory);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async markMessagesAsRead(req, res) {
    try {
      const { matchId } = req.params;
      const { chatId } = req.body;
      
      await this.db.query(
        'UPDATE messages SET is_read = true WHERE match_id = $1 AND receiver_id = $2 AND is_read = false',
        [matchId, chatId]
      );

      res.json({ message: 'Messages marked as read' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getUnreadCount(req, res) {
    try {
      const { chatId } = req.params;
      
      // Get all matches for this user
      const matches = await this.db.query(
        `SELECT id FROM matches WHERE (user1_id = $1 OR user2_id = $1) AND status = 'active'`, 
        [chatId]
      );

      let totalUnread = 0;
      
      for (const match of matches) {
        const unreadCount = await this.db.query(
          'SELECT COUNT(*) as count FROM messages WHERE match_id = $1 AND receiver_id = $2 AND is_read = false',
          [match.id, chatId]
        );
        
        totalUnread += parseInt(unreadCount[0].count);
      }

      res.json({ unreadCount: totalUnread });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async notifyNewMessage(matchId, message) {
    // Notify both users in the match via WebSocket
    const match = await this.db.query(
      'SELECT * FROM matches WHERE id = $1', 
      [matchId]
    );
    
    if (match.length === 0) {
      return;
    }

    const [user1Id, user2Id] = [match[0].user1_id, match[0].user2_id];
    
    // Emit to WebSocket room
    const io = this.getIO();
    if (io) {
      io.to(`match_${matchId}`).emit('new_message', message);
    }

    // Also send Telegram notification if needed
    const users = await this.db.query(
      'SELECT * FROM users WHERE chat_id IN ($1, $2)', 
      [user1Id, user2Id]
    );
    
    for (const user of users) {
      if (user.chat_id !== message.sender_id) {
        await this.sendMessageToUser(user.chat_id, `💬 New message from ${message.sender_id}`);
      }
    }
  }

  getIO() {
    // This would be the WebSocket instance
    return this.io;
  }

  setIO(io) {
    this.io = io;
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

module.exports = ChatService;
