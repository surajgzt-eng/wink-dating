// Authentication Service
class AuthService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.post('/login', this.login.bind(this));
    this.router.post('/register', this.register.bind(this));
    this.router.post('/logout', this.logout.bind(this));
    this.router.get('/me', this.getCurrentUser.bind(this));
  }

  async login(req, res) {
    try {
      const { chatId } = req.body;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];
      const token = this.generateToken(user.chat_id);
      
      await this.setUserSession(user.chat_id, token);
      
      res.json({
        user,
        token,
        message: 'Login successful'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async register(req, res) {
    try {
      const { chatId, firstName, lastName, username } = req.body;
      
      const existingUser = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      
      if (existingUser.length > 0) {
        return res.status(409).json({ error: 'User already exists' });
      }

      const userId = await this.generateUserId();
      const referralCode = this.generateReferralCode();
      
      const newUser = await this.db.query(
        `INSERT INTO users (chat_id, first_name, last_name, username, referral_code) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [chatId, firstName, lastName, username, referralCode]
      );
      
      const user = newUser[0];
      const token = this.generateToken(user.chat_id);
      
      await this.setUserSession(user.chat_id, token);
      
      // Send welcome message
      await this.sendWelcomeMessage(chatId);
      
      res.status(201).json({
        user,
        token,
        message: 'Registration successful'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  generateToken(userId) {
    return jwt.sign(
      { userId, iat: Math.floor(Date.now() / 1000) },
      process.env.JWT_SECRET || 'your-jwt-secret-key',
      { expiresIn: '7d' }
    );
  }

  async setUserSession(chatId, token) {
    await this.redis.set(`session:${chatId}`, token, { EX: 604800 }); // 7 days
  }

  async getUserFromToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key');
      const chatId = decoded.userId;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      return users[0] || null;
    } catch (error) {
      return null;
    }
  }

  async getCurrentUser(req, res) {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const user = await this.getUserFromToken(token);
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async logout(req, res) {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret-key');
      const chatId = decoded.userId;
      
      await this.redis.del(`session:${chatId}`);
      
      res.json({ message: 'Logout successful' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async sendWelcomeMessage(chatId) {
    const welcomeMessage = `🎉 Welcome to the Dating Bot! 💕\n\nTo get started:

📝 Setup your profile
📸 Upload a photo
💕 Find your matches
💬 Start chatting

Let's begin with your profile setup! 👆`;
    
    await this.sendMessage(chatId, welcomeMessage);
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

  async generateUserId() {
    const result = await this.db.query('SELECT MAX(chat_id) as max_id FROM users');
    const maxId = result[0]?.max_id || 0;
    return maxId + 1;
  }

  generateReferralCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }
}

module.exports = AuthService;
