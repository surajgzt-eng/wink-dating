const path = require('path');
const fs = require('fs');

let db = null;
let isPostgres = false;

async function initializeDatabase() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '../dating_bot.db');

  if (process.env.RESET_DB === '1' && fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log('🔄 RESET_DB=1 — cleared old database');
    } catch (e) {
      console.log('⚠️  could not delete existing db (still open elsewhere), reusing:', e.message);
    }
  }

  db = new Database(dbPath);
  isPostgres = false;

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('📦 Using SQLite database for local development');
  return db;
}

async function initializeDatabaseFromPool(pool) {
  isPostgres = true;
  db = pool;
  console.log('🐘 Using PostgreSQL database for production');
  return db;
}

async function autoInitialize() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await initializeDatabaseFromPool(pool);
  } else {
    await initializeDatabase();
  }
}

function getSchemas() {
  return {
    postgres: `
      CREATE TABLE IF NOT EXISTS users (
        chat_id BIGINT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        photo_url TEXT,
        selfie_url TEXT,
        gender TEXT,
        seeking TEXT,
        age INTEGER,
        city TEXT,
        country TEXT,
        interests TEXT,
        bio TEXT,
        is_verified INTEGER DEFAULT 0,
        is_premium INTEGER DEFAULT 0,
        premium_expires TIMESTAMP,
        referral_code TEXT UNIQUE,
        referred_by TEXT,
        texts_remaining INTEGER DEFAULT 5,
        matches_used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        user1_id BIGINT REFERENCES users(chat_id),
        user2_id BIGINT REFERENCES users(chat_id),
        status TEXT DEFAULT 'active',
        messages_used INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        match_id INTEGER REFERENCES matches(id),
        sender_id BIGINT REFERENCES users(chat_id),
        receiver_id BIGINT REFERENCES users(chat_id),
        content TEXT,
        media_type TEXT,
        media_url TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(chat_id),
        type TEXT,
        title TEXT,
        body TEXT,
        data TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
      CREATE INDEX IF NOT EXISTS idx_users_seeking ON users(seeking);
      CREATE INDEX IF NOT EXISTS idx_users_age ON users(age);
      CREATE INDEX IF NOT EXISTS idx_users_is_verified ON users(is_verified);
      CREATE INDEX IF NOT EXISTS idx_users_is_premium ON users(is_premium);
      CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
      CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
      CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    `,
    sqlite: `
      CREATE TABLE IF NOT EXISTS users (
        chat_id INTEGER PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        username TEXT,
        photo_url TEXT,
        selfie_url TEXT,
        gender TEXT,
        seeking TEXT,
        age INTEGER,
        city TEXT,
        country TEXT,
        interests TEXT,
        bio TEXT,
        is_verified INTEGER DEFAULT 0,
        is_premium INTEGER DEFAULT 0,
        premium_expires TEXT,
        referral_code TEXT UNIQUE,
        referred_by TEXT,
        texts_remaining INTEGER DEFAULT 5,
        matches_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user1_id INTEGER REFERENCES users(chat_id),
        user2_id INTEGER REFERENCES users(chat_id),
        status TEXT DEFAULT 'active',
        messages_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        last_message_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER REFERENCES matches(id),
        sender_id INTEGER REFERENCES users(chat_id),
        receiver_id INTEGER REFERENCES users(chat_id),
        content TEXT,
        media_type TEXT,
        media_url TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(chat_id),
        type TEXT,
        title TEXT,
        body TEXT,
        data TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_users_gender ON users(gender);
      CREATE INDEX IF NOT EXISTS idx_users_seeking ON users(seeking);
      CREATE INDEX IF NOT EXISTS idx_users_age ON users(age);
      CREATE INDEX IF NOT EXISTS idx_users_is_verified ON users(is_verified);
      CREATE INDEX IF NOT EXISTS idx_users_is_premium ON users(is_premium);
      CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
      CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
      CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    `
  };
}

async function createTables() {
  console.log('🗄️ Creating database tables...');
  const schemas = getSchemas();

  if (isPostgres) {
    const client = await db.connect();
    try {
      await client.query(schemas.postgres);
    } finally {
      client.release();
    }
  } else {
    db.exec(schemas.sqlite);
  }

  console.log('✅ Database tables created successfully');
}

const seedUsers = [
  [1, 'Alice', 'Smith', 'https://picsum.photos/seed/alice/400/400', null, 'female', 'male', 28, 'New York', 'USA', 'reading,traveling,music', 'Hello! I love exploring new places.', 1, 0, 5, 0],
  [2, 'Bob', 'Johnson', 'https://picsum.photos/seed/bob/400/400', null, 'male', 'female', 25, 'New York', 'USA', 'sports,cooking,fitness', 'I enjoy outdoor activities.', 1, 0, 5, 0],
  [3, 'Carol', 'Williams', 'https://picsum.photos/seed/carol/400/400', null, 'female', 'male', 32, 'Los Angeles', 'USA', 'art,photography,dancing', 'Creative soul who loves art.', 1, 1, 15, 3],
  [4, 'David', 'Brown', 'https://picsum.photos/seed/david/400/400', null, 'male', 'female', 29, 'Los Angeles', 'USA', 'music,travel,dogs', 'Music lover and world traveler.', 1, 0, 5, 0],
  [5, 'Eve', 'Jones', 'https://picsum.photos/seed/eve/400/400', null, 'female', 'male', 26, 'Chicago', 'USA', 'hiking,reading,cooking', 'Adventure seeker and book lover.', 0, 0, 5, 0],
  [6, 'Frank', 'Miller', 'https://picsum.photos/seed/frank/400/400', null, 'male', 'female', 22, 'Chicago', 'USA', 'gaming,music,tech', 'Gamer and tech enthusiast.', 1, 0, 5, 0],
  [7, 'Grace', 'Davis', 'https://picsum.photos/seed/grace/400/400', null, 'female', 'male', 30, 'New York', 'USA', 'yoga,cooking,travel', 'Yoga lover and foodie.', 1, 0, 5, 0],
  [8, 'Henry', 'Wilson', 'https://picsum.photos/seed/henry/400/400', null, 'male', 'female', 35, 'Los Angeles', 'USA', 'hiking,photography,music', 'Nature photographer.', 1, 1, 15, 2]
];

const seedMatches = [
  [1, 2], [1, 4], [3, 4], [2, 5], [6, 7], [8, 3]
];

async function seedDatabase() {
  if (isPostgres) {
    const existing = await query('SELECT COUNT(*) as count FROM users');
    if (parseInt(existing[0].count) > 0) {
      console.log('Database already contains data, skipping seed');
      return;
    }
  } else {
    const existing = db.prepare('SELECT COUNT(*) as count FROM users').get();
    if (existing.count > 0) {
      console.log('Database already contains data, skipping seed');
      return;
    }
  }

  console.log('🌱 Seeding sample data...');

  if (isPostgres) {
    for (const u of seedUsers) {
      await query(
        `INSERT INTO users (chat_id, first_name, last_name, photo_url, selfie_url, gender, seeking, age, city, country, interests, bio, is_verified, is_premium, texts_remaining, matches_used)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        u
      );
    }
    for (const m of seedMatches) {
      try {
        await query('INSERT INTO matches (user1_id, user2_id, status) VALUES ($1,$2,$3)', [m[0], m[1], 'active']);
      } catch (e) { /* ignore duplicates */ }
    }
  } else {
    const insertUser = db.prepare(`
      INSERT INTO users (chat_id, first_name, last_name, photo_url, selfie_url, gender, seeking, age, city, country, interests, bio, is_verified, is_premium, texts_remaining, matches_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const user of seedUsers) {
      insertUser.run(...user);
    }

    const insertMatch = db.prepare(`
      INSERT INTO matches (user1_id, user2_id, status) VALUES (?, ?, 'active')
    `);
    for (const match of seedMatches) {
      try { insertMatch.run(...match); } catch (e) {}
    }
  }

  console.log('✅ Sample data seeded successfully');
}

async function query(text, params = []) {
  if (isPostgres) {
    const result = await db.query(text, params);
    return result.rows;
  } else {
    try {
      const orderedRefs = [];
      const sql = text.replace(/\$(\d+)/g, (_, n) => {
        orderedRefs.push(parseInt(n));
        return '?';
      });
      const orderedParams = orderedRefs.map(n => params[n - 1]);
      const stmt = db.prepare(sql);
      const normalizedSql = sql.trim().toLowerCase();

      if (normalizedSql.startsWith('select') || normalizedSql.startsWith('returning')) {
        return stmt.all(...orderedParams);
      } else if (normalizedSql.startsWith('insert') || normalizedSql.startsWith('update') || normalizedSql.startsWith('delete')) {
        const result = stmt.run(...orderedParams);
        if (text.includes('RETURNING')) {
          const returningMatch = text.match(/RETURNING\s+(.+)/i);
          if (returningMatch) {
            const lastInsertedId = result.lastInsertRowid;
            const columns = returningMatch[1].split(',').map(c => c.trim().split(/\s+/)[0]);
            const row = db.prepare(`SELECT ${columns.join(',')} FROM last_insert_rowid()`).get();
            return row ? [row] : [];
          }
        }
        return { rowCount: result.changes, insertId: result.lastInsertRowid };
      } else if (normalizedSql.startsWith('create')) {
        stmt.run();
        return [];
      }
      return [];
    } catch (error) {
      console.error('SQLite error:', error.message);
      console.error('SQL:', text);
      console.error('Params:', params);
      throw error;
    }
  }
}

async function getCache(key) {
  try {
    if (isPostgres) {
      const redis = require('redis').createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      await redis.connect();
      const value = await redis.get(key);
      await redis.quit();
      return value ? JSON.parse(value) : null;
    } else {
      const cache = global.__cache || {};
      const entry = cache[key];
      if (entry && Date.now() - entry.time < 3600000) {
        return entry.value;
      }
      return null;
    }
  } catch (error) {
    console.error('Cache error:', error.message);
    return null;
  }
}

async function setCache(key, value, ttl = 3600) {
  try {
    if (isPostgres) {
      const redis = require('redis').createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      await redis.connect();
      await redis.setEx(key, ttl, JSON.stringify(value));
      await redis.quit();
    } else {
      if (!global.__cache) global.__cache = {};
      global.__cache[key] = { value, time: Date.now() };
    }
  } catch (error) {
    console.error('Cache error:', error.message);
  }
}

function now() {
  return isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}

function addDays(days) {
  return isPostgres ? `CURRENT_TIMESTAMP + INTERVAL '${days} days'` : `datetime('now', '+${days} days')`;
}

module.exports = {
  initializeDatabase,
  initializeDatabaseFromPool,
  autoInitialize,
  query,
  getCache,
  setCache,
  createTables,
  seedDatabase,
  isPostgres: () => isPostgres,
  getDb: () => db,
  now,
  addDays
};
