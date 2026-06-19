// Matching Service - Fixed Version
class MatchingService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.post('/find', this.findMatches.bind(this));
    this.router.post('/start-matching', this.startMatching.bind(this));
    this.router.get('/status/:chatId', this.getMatchingStatus.bind(this));
    this.router.post('/stop-matching', this.stopMatching.bind(this));
    this.router.get('/recommendations/:chatId', this.getRecommendations.bind(this));
    this.router.post('/feedback/:matchId', this.provideFeedback.bind(this));
  }

  async findMatches(req, res) {
    try {
      const { chatId } = req.body;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = users[0];
      
      if (!user.gender || !user.seeking || !user.age) {
        return res.status(400).json({ 
          error: 'Please complete your profile including gender, age, and seeking preferences' 
        });
      }

      const potentialMatches = await this.findPotentialMatches(user);
      const filteredMatches = this.filterByAgePreferences(user, potentialMatches);
      
      const matchUsers = [];
      for (const match of filteredMatches.slice(0, 10)) {
        const users = await this.db.query(
          `SELECT * FROM users WHERE chat_id = $1 AND (photo_url IS NOT NULL OR is_verified = true)`, 
          [match.chat_id]
        );
        if (users.length > 0) {
          matchUsers.push(users[0]);
        }
      }

      res.json({
        user: {
          id: user.chat_id,
          age: user.age,
          gender: user.gender,
          seeking: user.seeking,
          city: user.city,
          country: user.country
        },
        matches: matchUsers.map(match => ({
          id: match.chat_id,
          firstName: match.first_name,
          lastName: match.last_name,
          age: match.age,
          gender: match.gender,
          seeking: match.seeking,
          city: match.city,
          country: match.country,
          photoUrl: match.photo_url,
          interests: match.interests,
          bio: match.bio,
          isVerified: match.is_verified,
          isPremium: match.is_premium,
          textsUsed: match.texts_used
        })),
        message: matchUsers.length > 0 
          ? `Found ${matchUsers.length} potential matches!` 
          : 'No matches found. Try expanding your search criteria.'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async startMatching(req, res) {
    try {
      const { chatId } = req.body;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = users[0];

      if (!user.gender || !user.seeking || !user.age) {
        return res.status(400).json({ 
          error: 'Please complete your profile including gender, age, and seeking preferences' 
        });
      }

      await this.addToMatchingQueue(user);

      res.json({
        message: `Started searching for matches! You'll be matched with someone soon.\n\nCurrent preferences:\n• Gender: ${user.gender}\n• Seeking: ${user.seeking}\n• Age: ${user.age}\n• Location: ${user.city}, ${user.country}\n\nMatching is based on random selection from qualified candidates.\nYou'll get notifications when you get a match! 💕`,
        queuePosition: await this.getQueuePosition(chatId)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getMatchingStatus(req, res) {
    try {
      const { chatId } = req.params;
      
      const queueStatus = await this.getQueuePosition(chatId);
      const currentMatches = await this.getUserMatches(chatId);

      res.json({
        queueStatus,
        currentMatches: currentMatches.length,
        isSearching: queueStatus > 0,
        message: queueStatus > 0 
          ? `You're at position ${queueStatus} in the matching queue.`
          : 'Not in matching queue'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async stopMatching(req, res) {
    try {
      const { chatId } = req.body;
      
      await this.removeFromMatchingQueue(chatId);

      res.json({
        message: 'Stopped searching for matches. You can start again anytime!'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRecommendations(req, res) {
    try {
      const { chatId } = req.params;
      
      const users = await this.db.query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = users[0];

      const recommendations = await this.getSmartRecommendations(user);

      res.json({
        recommendations: recommendations.map(rec => ({
          id: rec.chat_id,
          firstName: rec.first_name,
          age: rec.age,
          gender: rec.gender,
          seeking: rec.seeking,
          city: rec.city,
          country: rec.country,
          photoUrl: rec.photo_url,
          interests: rec.interests,
          bio: rec.bio,
          matchScore: rec.matchScore || this.calculateMatchScore(user, rec),
          reason: this.getMatchReason(user, rec)
        })),
        algorithm: 'ai-powered-matching',
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async provideFeedback(req, res) {
    try {
      const { matchId } = req.params;
      const { chatId, feedback, rating } = req.body;
      
      await this.db.query(
        `INSERT INTO feedback (match_id, user_id, feedback, rating, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [matchId, chatId, feedback, rating]
      );

      await this.updateMatchingAlgorithm(feedback, rating);

      res.json({
        message: 'Thank you for your feedback! This helps us improve matches.'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async addToMatchingQueue(user) {
    const queueKey = `queue:${user.gender}_seeking_${user.seeking}`;
    
    await this.redis.rpush(queueKey, JSON.stringify({
      chatId: user.chat_id,
      age: user.age,
      city: user.city,
      country: user.country,
      timestamp: Date.now()
    }));

    await this.redis.expire(queueKey, 86400);
    await this.processMatchingQueue();
  }

  async processMatchingQueue() {
    const queueKeys = await this.redis.keys('queue:*');
    
    for (const queueKey of queueKeys) {
      const queueMembers = await this.redis.lrange(queueKey, 0, 4);
      
      if (queueMembers.length < 2) {
        continue;
      }

      const users = queueMembers.map(member => JSON.parse(member));
      const filteredUsers = this.filterByAgePreferencesRandom(users[0], users.slice(1));
      
      if (filteredUsers.length > 0) {
        await this.createMatch(users[0].chatId, filteredUsers[0].chatId);
        await this.redis.lrem(queueKey, 1, JSON.stringify(users[0]));
        
        const otherQueueKey = `queue:${filteredUsers[0].gender}_seeking_${users[0].seeking}`;
        await this.redis.lrem(otherQueueKey, 1, JSON.stringify(filteredUsers[0]));
      }
    }
  }

  filterByAgePreferences(user, potentialMatches) {
    const filtered = [];
    
    for (const match of potentialMatches) {
      let ageConditionMet = false;
      
      if (user.gender === 'male' && user.seeking === 'female') {
        if (match.age < user.age) {
          ageConditionMet = true;
        }
      } else if (user.gender === 'female' && user.seeking === 'male') {
        if (match.age > user.age) {
          ageConditionMet = true;
        }
      } else {
        if (Math.abs(match.age - user.age) <= 10) {
          ageConditionMet = true;
        }
      }
      
      if (ageConditionMet) {
        filtered.push(match);
      }
    }
    
    return filtered;
  }

  filterByAgePreferencesRandom(user, potentialMatches) {
    return this.filterByAgePreferences(user, potentialMatches);
  }

  async createMatch(user1Id, user2Id) {
    const existingMatches = await this.db.query(
      `SELECT * FROM matches WHERE 
       (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`, 
      [user1Id, user2Id]
    );
    
    if (existingMatches.length > 0) {
      return existingMatches[0];
    }

    const match = await this.db.query(
      `INSERT INTO matches (user1_id, user2_id, status) 
       VALUES ($1, $2, 'active') RETURNING *`,
      [user1Id, user2Id]
    );

    await this.sendMatchNotification(user1Id, user2Id, match[0]);
    return match[0];
  }

  async sendMatchNotification(user1Id, user2Id, match) {
    const notificationMessage = `🎉 You've got a match! ${user1Id} ${user2Id}\n\nYou can now start chatting! 💬\n\nTap to open chat`;
    
    await this.sendMessageToUser(user1Id, notificationMessage);
    await this.sendMessageToUser(user2Id, notificationMessage);
  }

  async getUserMatches(chatId) {
    const matches = await this.db.query(
      `SELECT m.*, u1.chat_id as user1_id, u2.chat_id as user2_id,
              u1.first_name as user1_first_name, u2.first_name as user2_first_name
       FROM matches m
       JOIN users u1 ON m.user1_id = u1.chat_id
       JOIN users u2 ON m.user2_id = u2.chat_id
       WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'`, 
      [chatId]
    );
    
    return matches;
  }

  async getQueuePosition(chatId) {
    const queueKeys = await this.redis.keys('queue:*');
    let totalQueue = 0;
    
    for (const queueKey of queueKeys) {
      const queueMembers = await this.redis.lrange(queueKey, 0, -1);
      for (const member of queueMembers) {
        const userData = JSON.parse(member);
        if (userData.chatId === chatId) {
          return totalQueue + 1;
        }
        totalQueue++;
      }
    }
    
    return 0;
  }

  async removeFromMatchingQueue(chatId) {
    const queueKeys = await this.redis.keys('queue:*');
    
    for (const queueKey of queueKeys) {
      const members = await this.redis.lrange(queueKey, 0, -1);
      const memberToRemove = this.findMemberByChatId(members, chatId);
      if (memberToRemove) {
        await this.redis.lrem(queueKey, 1, memberToRemove);
      }
    }
  }

  findMemberByChatId(members, chatId) {
    for (const member of members) {
      const userData = JSON.parse(member);
      if (userData.chatId === chatId) {
        return member;
      }
    }
    return null;
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
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

  async findPotentialMatches(user) {
    const queueKeys = await this.redis.keys('queue:*');
    const potentialMatches = [];
    
    for (const queueKey of queueKeys) {
      const queueMembers = await this.redis.lrange(queueKey, 0, 9);
      
      for (const member of queueMembers) {
        const match = JSON.parse(member);
        if (match.chatId !== user.chat_id) {
          potentialMatches.push(match);
        }
      }
    }
    
    return potentialMatches;
  }

  async getSmartRecommendations(user) {
    const allUsers = await this.db.query(
      `SELECT * FROM users 
       WHERE gender = $1 AND age BETWEEN $2 AND $3 AND is_verified = true
       AND chat_id != $4 LIMIT 50`,
      [user.seeking, user.age - 5, user.age + 5, user.chat_id]
    );

    return allUsers.map(rec => ({
      ...rec,
      matchScore: this.calculateMatchScore(user, rec)
    }));
  }

  calculateMatchScore(user, potentialMatch) {
    let score = 0;
    
    if (user.seeking === potentialMatch.gender) {
      score += 40;
    }
    
    let ageDiff = Math.abs(user.age - potentialMatch.age);
    if (ageDiff <= 3) {
      score += 30;
    } else if (ageDiff <= 8) {
      score += 20;
    } else if (ageDiff <= 15) {
      score += 10;
    }
    
    if (user.city === potentialMatch.city || user.country === potentialMatch.country) {
      score += 20;
    }
    
    score += Math.random() * 10;
    
    return Math.min(score, 100);
  }

  getMatchReason(user, match) {
    const reasons = [];
    
    if (user.seeking === match.gender) {
      reasons.push('Gender match');
    }
    
    if (match.age > user.age && user.gender === 'female') {
      reasons.push('Age preference (girl prefers older)');
    } else if (match.age < user.age && user.gender === 'male') {
      reasons.push('Age preference (boy prefers younger)');
    }
    
    if (user.city === match.city) {
      reasons.push('Same city');
    }
    
    if (match.is_verified) {
      reasons.push('Verified profile');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : 'Potential match';
  }

  async updateMatchingAlgorithm(feedback, rating) {
    await this.db.query(
      `INSERT INTO algorithm_feedback (feedback, rating, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)`,
      [feedback, rating]
    );
  }
}

module.exports = MatchingService;
