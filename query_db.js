const Database = require('better-sqlite3');
const db = new Database('dating_bot.db');

console.log('Tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name));

// Check messages table
try {
  const messages = db.prepare("SELECT * FROM messages LIMIT 20").all();
  console.log('\n--- Messages ---');
  console.log(messages);
} catch (e) {
  console.log('Messages table error:', e.message);
}

// Check users table
try {
  const users = db.prepare("SELECT * FROM users LIMIT 10").all();
  console.log('\n--- Users ---');
  console.log(users);
} catch (e) {
  console.log('Users table error:', e.message);
}

// Check matches table
try {
  const matches = db.prepare("SELECT * FROM matches LIMIT 10").all();
  console.log('\n--- Matches ---');
  console.log(matches);
} catch (e) {
  console.log('Matches table error:', e.message);
}