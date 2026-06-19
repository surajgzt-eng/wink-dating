// Main Application Entry Point

const DatingBot = require('./DatingBot');
const { runMigrations, seedDatabase } = require('./scripts/setup');

async function main() {
  try {
    console.log('🚀 Starting Telegram Dating Bot...');
    console.log('📅', new Date().toISOString());

    // Initialize the dating bot
    const bot = new DatingBot();

    // Run database migrations and seed data
    await runMigrations(bot.db);
    await seedDatabase(bot.db);

    console.log('✅ Database setup completed');
    console.log('🎉 Telegram Dating Bot is ready!');
    console.log('\n📋 Quick Start:');
    console.log('   1. Start the bot: node src/api/server.js');
    console.log('   2. Check health: curl http://localhost:3000/health');
    console.log('   3. View logs: Watch the console output');
    console.log('\n🔧 Features:');
    console.log('   • Profile setup and photo upload with face verification');
    console.log('   • Smart matching based on preferences (age < for boys, age > for girls)');
    console.log('   • 10 free messages per match');
    console.log('   • Premium subscription (₹399) for unlimited features');
    console.log('   • Referral system for extra texts');
    console.log('   • Real-time chat interface');
    console.log('   • WebApp integration with Telegram Mini App');

    return bot;
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  process.exit(0);
});

// Start the application
if (require.main === module) {
  main()
    .then(bot => {
      // Keep the process alive
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    })
    .catch(error => {
      console.error('Application startup failed:', error);
      process.exit(1);
    });
}

module.exports = main;
