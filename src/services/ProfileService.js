// Profile Service
class ProfileService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.post('/setup', this.setupProfile.bind(this));
    this.router.put('/update', this.updateProfile.bind(this));
    this.router.post('/photo', this.uploadPhoto.bind(this));
    this.router.post('/verify-face', this.verifyFace.bind(this));
    this.router.get('/user/:chatId', this.getUserProfile.bind(this));
    this.router.get('/matches/:chatId', this.getMatches.bind(this));
    this.router.post('/preferences', this.updatePreferences.bind(this));
    this.router.post('/location', this.updateLocation.bind(this));
  }

  async setupProfile(req, res) {
    try {
      const { chatId, firstName, lastName, age, gender, preferredGender, interests, bio } = req.body;
      
      // Validate required fields
      if (!chatId || !age || !gender || !preferredGender) {
        return res.status(400).json({ 
          error: 'Required fields: chatId, age, gender, preferredGender' 
        });
      }

      // Validate age range
      if (age < 18 || age > 100) {
        return res.status(400).json({ error: 'Age must be between 18 and 100' });
      }

      // Check if user already exists
      const existingUser = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      if (existingUser.length > 0) {
        return res.status(409).json({ error: 'Profile already exists' });
      }

      // Generate unique user ID
      const userId = await this.generateUserId();

      // Insert user profile
      const user = await this.db.query(
        `INSERT INTO users (chat_id, first_name, last_name, age, gender, seeking, 
         interests, bio, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [chatId, firstName, lastName, age, gender, preferredGender, interests, bio, false]
      );

      // Generate referral code
      const referralCode = this.generateReferralCode();
      await this.db.query(
        'UPDATE users SET referral_code = $1 WHERE chat_id = $2',
        [referralCode, chatId]
      );

      // Send welcome message
      await this.sendProfileSetupCompleteMessage(chatId);

      res.status(201).json({
        user: user[0],
        message: 'Profile setup completed successfully'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async uploadPhoto(req, res) {
    try {
      const { chatId } = req.body;
      const photoUrl = req.body.photoUrl || req.body.photo; // Handle different formats
      
      if (!photoUrl) {
        return res.status(400).json({ error: 'Photo URL is required' });
      }

      // Validate photo URL
      if (!this.isValidUrl(photoUrl)) {
        return res.status(400).json({ error: 'Invalid photo URL' });
      }

      // Update user photo
      await this.db.query(
        'UPDATE users SET photo_url = $1 WHERE chat_id = $2',
        [photoUrl, chatId]
      );

      res.json({
        message: 'Photo uploaded successfully',
        photoUrl
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async verifyFace(req, res) {
    try {
      const { chatId, photoUrl } = req.body;
      
      if (!photoUrl) {
        return res.status(400).json({ error: 'Photo URL is required for face verification' });
      }

      // Get user profile
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      // Use AI face verification service
      const faceVerificationResult = await this.faceVerificationService.verifyFace(
        user.photo_url,
        photoUrl
      );

      if (faceVerificationResult.isMatch) {
        // Update user verification status
        await this.db.query(
          'UPDATE users SET is_verified = $1 WHERE chat_id = $2',
          [true, chatId]
        );

        res.json({
          message: 'Face verification successful',
          isMatch: true,
          similarity: faceVerificationResult.similarity
        });
      } else {
        res.status(400).json({
          message: 'Face verification failed',
          isMatch: false,
          similarity: faceVerificationResult.similarity
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getUserProfile(req, res) {
    try {
      const { chatId } = req.params;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      // Get match count
      const matches = await this.db.query(
        `SELECT m.* FROM matches m 
         WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'`, 
        [chatId]
      );

      res.json({
        ...user,
        matchCount: matches.length,
        textsUsed: user.texts_used,
        isPremium: user.is_premium
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getMatches(req, res) {
    try {
      const { chatId } = req.params;
      
      const matches = await this.db.query(
        `SELECT u.*, m.id, m.created_at 
         FROM users u JOIN matches m ON (u.chat_id = m.user1_id OR u.chat_id = m.user2_id)
         WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'`, 
        [chatId]
      );

      res.json(matches);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateProfile(req, res) {
    try {
      const { chatId } = req.body;
      const updates = req.body;

      // Remove fields that shouldn't be updated directly
      delete updates.chat_id;
      delete updates.id;
      delete updates.is_verified;
      delete updates.is_premium;
      delete updates.texts_used;
      delete updates.created_at;
      delete updates.updated_at;

      const updateFields = Object.keys(updates).map((key, index) => {
        return `${key} = $${index + 1}`;
      }).join(', ');

      const values = Object.values(updates);
      values.push(chatId);

      await this.db.query(
        `UPDATE users SET ${updateFields} WHERE chat_id = $${values.length}`, 
        values
      );

      res.json({ message: 'Profile updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updatePreferences(req, res) {
    try {
      const { chatId, gender, seeking, age, interests, bio } = req.body;
      
      await this.db.query(
        `UPDATE users SET gender = $1, seeking = $2, age = $3, 
         interests = $4, bio = $5 WHERE chat_id = $6`,
        [gender, seeking, age, interests, bio, chatId]
      );

      res.json({ message: 'Preferences updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateLocation(req, res) {
    try {
      const { chatId, city, country } = req.body;
      
      await this.db.query(
        'UPDATE users SET city = $1, country = $2 WHERE chat_id = $3',
        [city, country, chatId]
      );

      res.json({ message: 'Location updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async sendProfileSetupCompleteMessage(chatId) {
    const message = `🎉 Profile Setup Complete! ${chatId} ${chatId} ${chatId}\n\nYour profile has been successfully set up! Here's what you can do now:

💕 Find Matches
👥 View other profiles
💬 Start conversations
⭐ Upgrade to Premium

Ready to meet someone special? Let's find your first match! 🌟`;
    
    await this.sendMessage(chatId, message);
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
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
}

module.exports = ProfileService;
