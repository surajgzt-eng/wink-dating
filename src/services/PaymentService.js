// Payment Service
class PaymentService {
  constructor(db, redis) {
    this.db = db;
    this.redis = redis;
    this.router = express.Router();
    this.setupRoutes();
  }

  setupRoutes() {
    this.router.post('/create-session', this.createPaymentSession.bind(this));
    this.router.post('/verify', this.verifyPayment.bind(this));
    this.router.get('/status/:userId', this.getPaymentStatus.bind(this));
    this.router.post('/upgrade-premium', this.upgradeToPremium.bind(this));
  }

  async createPaymentSession(req, res) {
    try {
      const { userId, amount = 399, currency = 'INR' } = req.body;
      
      // Validate user exists
      const users = await this.db.query(
        'SELECT * FROM users WHERE chat_id = $1', 
        [userId]
      );
      
      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = users[0];

      // Check if already premium
      if (user.is_premium) {
        return res.status(400).json({ error: 'User already has premium subscription' });
      }

      // Create payment session
      const sessionId = crypto.randomUUID();
      const paymentData = {
        sessionId,
        userId,
        amount,
        currency,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
      };

      await this.redis.setex(
        `payment:${sessionId}`, 
        1800, // 30 minutes
        JSON.stringify(paymentData)
      );

      // Create PayPal payment session (simplified)
      const paypalSession = await this.createPayPalPayment(amount, currency, sessionId);

      res.json({
        sessionId,
        paypalUrl: paypalSession.approvalUrl,
        paymentData,
        amount: amount,
        currency: currency,
        message: 'Payment session created successfully'
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createPayPalPayment(amount, currency, sessionId) {
    // Simplified PayPal integration
    // In production, this would use the PayPal SDK
    
    const approvalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&amount=${amount}&currency_code=${currency}&return=${process.env.WEBSITE_URL}/payment/success?session=${sessionId}&cancel=${process.env.WEBSITE_URL}/payment/cancel?session=${sessionId}`;
    
    return {
      approvalUrl,
      sessionId,
      status: 'created'
    };
  }

  async verifyPayment(req, res) {
    try {
      const { sessionId, payerId, token } = req.body;
      
      const paymentData = await this.redis.get(`payment:${sessionId}`);
      if (!paymentData) {
        return res.status(404).json({ error: 'Payment session not found' });
      }

      const parsedData = JSON.parse(paymentData);

      // Simulate PayPal payment verification
      const paymentVerified = await this.simulatePayPalPayment(parsedData, payerId, token);

      if (paymentVerified) {
        // Update user premium status
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month premium

        await this.db.query(
          `UPDATE users SET is_premium = true, premium_expires = $1, texts_used = 0 WHERE chat_id = $2`,
          [expiresAt, parsedData.userId]
        );

        // Clean up payment session
        await this.redis.del(`payment:${sessionId}`);

        // Send premium activation notification
        await this.sendPremiumActivationNotification(parsedData.userId);

        res.json({
          message: 'Payment verified successfully',
          premiumActivated: true,
          expiresAt: expiresAt.toISOString(),
          sessionId: parsedData.sessionId
        });
      } else {
        res.status(400).json({ error: 'Payment verification failed' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async simulatePayPalPayment(paymentData, payerId, token) {
    // Simulate PayPal payment verification
    // In production, this would integrate with PayPal's API
    
    console.log('Simulating PayPal payment:', { paymentData, payerId, token });
    
    // Simulate successful payment for demo purposes
    return true;
  }

  async getPaymentStatus(req, res) {
    try {
      const { userId } = req.params;
      
      // Get active payment sessions for user
      const activeSessions = [];
      const keys = await this.redis.keys('payment:*');
      
      for (const key of keys) {
        const paymentData = await this.redis.get(key);
        if (paymentData) {
          const parsed = JSON.parse(paymentData);
          if (parsed.userId === userId) {
            activeSessions.push({
              sessionId: parsed.sessionId,
              amount: parsed.amount,
              currency: parsed.currency,
              status: parsed.status,
              createdAt: parsed.createdAt,
              expiresAt: parsed.expiresAt
            });
          }
        }
      }

      res.json({
        activeSessions,
        totalAmount: activeSessions.reduce((sum, session) => sum + session.amount, 0)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async upgradeToPremium(req, res) {
    try {
      const { userId, paymentMethod } = req.body;
      
      // Direct upgrade (for demo - requires payment processing)
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month premium

      await this.db.query(
        `UPDATE users SET is_premium = true, premium_expires = $1 WHERE chat_id = $2`,
        [expiresAt, userId]
      );

      res.json({
        message: 'Premium subscription activated successfully',
        expiresAt: expiresAt.toISOString(),
        features: [
          'Unlimited matches and messages',
          'View contact numbers of matches',
          'Ad-free experience',
          'Priority support',
          'Access to all premium features'
        ]
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async sendPremiumActivationNotification(userId) {
    const message = `🎉 Premium Subscription Activated! ${userId} ${userId} ${userId}\n\nYou now have unlimited access to all premium features:

💕 Unlimited matches and messages
📞 View contact numbers of matches
⭐ Ad-free experience
🛡️ Priority support

Thank you for upgrading! Enjoy your premium experience! 🎊`;
    
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

module.exports = PaymentService;
