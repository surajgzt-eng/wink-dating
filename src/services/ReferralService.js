// Referral Service
class ReferralService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.post('/generate-link', this.generateReferralLink.bind(this));
    this.router.get('/link/:userId', this.getReferralLink.bind(this));
    this.router.post('/track-referral', this.trackReferral.bind(this));
    this.router.get('/stats/:userId', this.getReferralStats.bind(this));
    this.router.post('/claim-rewards', this.claimReferralRewards.bind(this));
  }

  async generateReferralLink(req, res) {
    try {
      const { userId } = req.body;
      
      const users = await this.db.query(
        'SELECT referral_code FROM users WHERE chat_id = $1', 
        [userId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      if (!user.referral_code) {
        return res.status(400).json({ error: 'User has no referral code' });
      }

      // Generate referral link
      const referralLink = `${process.env.WEBSITE_URL || 'https://dating-bot.com'}/ref/${user.referral_code}`;
      
      res.json({
        referralCode: user.referral_code,
        referralLink,
        message: 'Referral link generated successfully'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getReferralLink(req, res) {
    try {
      const { userId } = req.params;
      
      const users = await this.db.query(
        'SELECT referral_code FROM users WHERE chat_id = $1', 
        [userId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      if (!user.referral_code) {
        return res.status(400).json({ error: 'User has no referral code' });
      }

      const referralLink = `${process.env.WEBSITE_URL || 'https://dating-bot.com'}/ref/${user.referral_code}`;
      
      res.json({
        referralCode: user.referral_code,
        referralLink,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async trackReferral(req, res) {
    try {
      const { referralCode, newUserChatId, referrerChatId } = req.body;
      
      if (!referralCode || !newUserChatId || !referrerChatId) {
        return res.status(400).json({ 
          error: 'Missing required fields: referralCode, newUserChatId, referrerChatId' 
        });
      }

      // Find referrer by referral code
      const referrers = await this.db.query(
        'SELECT chat_id FROM users WHERE referral_code = $1', 
        [referralCode]
      );n      
      if (referrers.length === 0) {
        return res.status(404).json({ error: 'Invalid referral code' });
      }

      const referrer = referrers[0];

      if (referrer.chat_id === newUserChatId) {
        return res.status(400).json({ error: 'Cannot refer yourself' });
      }

      // Check if new user already has a referrer
      const existingUser = await this.db.query(
        'SELECT referred_by FROM users WHERE chat_id = $1', 
        [newUserChatId]
      );
      
      if (existingUser.length > 0 && existingUser[0].referred_by) {
        return res.status(400).json({ error: 'User already has a referrer' });
      }

      // Update new user with referrer
      await this.db.query(
        'UPDATE users SET referred_by = $1 WHERE chat_id = $2',
        [referrer.chat_id, newUserChatId]
      );

      // Add to Redis referral tracking
      await this.redis.incr(`referral_stats:${referrer.chat_id}:total`);
      await this.redis.incr(`referral_stats:${referrer.chat_id}:converted`);

      res.json({
        message: 'Referral tracked successfully',
        referrerId: referrer.chat_id,
        rewards: {
          texts: 10, // 10 extra texts per successful referral
          premium: false // Premium rewards would need payment integration
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getReferralStats(req, res) {
    try {
      const { userId } = req.params;
      
      const stats = await this.db.query(
        `SELECT 
          referral_code,
          referred_by,
          COUNT(CASE WHEN referred_by = $1 THEN 1 END) as successful_referrals,
          SUM(CASE WHEN referred_by = $1 THEN 1 END) as total_referrals
         FROM users 
         WHERE chat_id = $1 OR referred_by = $1
         GROUP BY referral_code, referred_by`, 
        [userId]
      );

      const redisStats = await this.redis.get(`referral_stats:${userId}`);
      
      res.json({
        databaseStats: stats,
        redisStats: redisStats ? JSON.parse(redisStats) : null,
        totalReferrals: stats.reduce((sum, stat) => sum + parseInt(stat.total_referrals || 0), 0),
        successfulReferrals: stats.reduce((sum, stat) => sum + parseInt(stat.successful_referrals || 0), 0),
        referralCode: stats.length > 0 ? stats[0].referral_code : null,
        referralLink: stats.length > 0 
          ? `${process.env.WEBSITE_URL || 'https://dating-bot.com'}/ref/${stats[0].referral_code}`
          : null
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async claimReferralRewards(req, res) {
    try {
      const { userId } = req.body;
      
      // Get referral stats
      const stats = await this.db.query(
        `SELECT referred_by FROM users WHERE chat_id = $1`, 
        [userId]
      );
      
      if (stats.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const referrerId = stats[0].referred_by;
      
      if (!referrerId) {
        return res.status(400).json({ error: 'No referrer found for this user' });
      }

      // Check if referrer has reached threshold
      const successfulReferrals = await this.db.query(
        `SELECT COUNT(*) as count FROM users WHERE referred_by = $1`, 
        [referrerId]
      );
      
      const referralCount = parseInt(successfulReferrals[0].count);

      // Grant rewards (simplified - would need payment integration for actual rewards)
      if (referralCount >= 1) {
        // Grant 10 texts per successful referral
        const currentTexts = await this.db.query(
          'SELECT texts_used FROM users WHERE chat_id = $1', 
          [referrerId]
        );
        
        await this.db.query(
          'UPDATE users SET texts_used = texts_used + 10 WHERE chat_id = $1',
          [referrerId]
        );

        res.json({
          message: `Referral rewards claimed! +10 texts added to your account.
          
          Total successful referrals: ${referralCount}
          Total texts earned: ${referralCount * 10}
          
          Keep referring friends to earn more texts!`,
          textsAdded: 10,
          totalTextsEarned: referralCount * 10
        });
      } else {
        res.json({
          message: 'No referral rewards available yet. Continue referring friends!',
          totalSuccessfulReferrals: referralCount
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getReferralLink(req, res) {
    try {
      const { userId } = req.params;
      
      const users = await this.db.query(
        'SELECT referral_code FROM users WHERE chat_id = $1', 
        [userId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      if (!user.referral_code) {
        return res.status(400).json({ error: 'User has no referral code' });
      }

      const referralLink = `${process.env.WEBSITE_URL || 'https://dating-bot.com'}/ref/${user.referral_code}`;
      
      res.json({
        referralCode: user.referral_code,
        referralLink,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = ReferralService;
