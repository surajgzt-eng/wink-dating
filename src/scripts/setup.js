// Database Setup Script
const fs = require('fs');
const path = require('path');

async function runMigrations(db) {
  try {
    console.log('Running database migrations...');
    
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Executing migration: ${file}`);
        
        try {
          await db.query(sql);
          console.log(`Migration ${file} completed successfully`);
        } catch (error) {
          console.error(`Migration ${file} failed:`, error.message);
          throw error;
        }
      }
    }
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

async function seedDatabase(db) {
  try {
    console.log('Seeding database...');
    
    const existingUsers = await db.query('SELECT COUNT(*) as count FROM users');
    if (existingUsers[0].count > 0) {
      console.log('Database already contains data, skipping seed');
      return;
    }

    const sampleUsers = [
      {
        chat_id: 1,
        first_name: 'Alice',
        last_name: 'Smith',
        photo_url: 'https://picsum.photos/seed/alice/400/400',
        gender: 'female',
        seeking: 'male',
        age: 28,
        city: 'New York',
        country: 'USA',
        interests: 'reading,traveling,music',
        bio: 'Hello! I love exploring new places and meeting new people. Looking for someone adventures and kind.',
        is_verified: true,
        is_premium: false,
        texts_used: 3
      },
      {
        chat_id: 2,
        first_name: 'Bob',
        last_name: 'Johnson',
        photo_url: 'https://picsum.photos/seed/bob/400/400',
        gender: 'male',
        seeking: 'female',
        age: 25,
        city: 'New York',
        country: 'USA',
        interests: 'sports,cooking,fitness',
        bio: 'Hey there! I enjoy outdoor activities and good food. Looking for someone active and fun.',
        is_verified: true,
        is_premium: false,
        texts_used: 7
      },
      {
        chat_id: 3,
        first_name: 'Carol',
        last_name: 'Williams',
        photo_url: 'https://picsum.photos/seed/carol/400/400',
        gender: 'female',
        seeking: 'male',
        age: 32,
        city: 'Los Angeles',
        country: 'USA',
        interests: 'art,photography,dancing',
        bio: 'Creative soul who loves art and capturing moments. Seeking someone who appreciates beauty and adventure.',
        is_verified: true,
        is_premium: true,
        texts_used: 0
      },
      {
        chat_id: 4,
        first_name: 'David',
        last_name: 'Brown',
        photo_url: 'https://picsum.photos/seed/david/400/400',
        gender: 'male',
        seeking: 'female',
        age: 29,
        city: 'Los Angeles',
        country: 'USA',
        interests: 'music,travel,dogs',
        bio: 'Music lover and world traveler. Looking for someone who appreciates good times and new experiences.',
        is_verified: true,
        is_premium: false,
        texts_used: 12
      },
      {
        chat_id: 5,
        first_name: 'Eve',
        last_name: 'Jones',
        photo_url: 'https://picsum.photos/seed/eve/400/400',
        gender: 'female',
        seeking: 'male',
        age: 26,
        city: 'Chicago',
        country: 'USA',
        interests: 'hiking,reading,cooking',
        bio: 'Adventure seeker and book lover. Looking for someone who enjoys both the great outdoors and quiet evenings.',
        is_verified: false,
        is_premium: false,
        texts_used: 1
      }
    ];

    for (const user of sampleUsers) {
      await db.query(
        `INSERT INTO users (chat_id, first_name, last_name, photo_url, gender, seeking, 
         age, city, country, interests, bio, is_verified, is_premium, texts_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (chat_id) DO NOTHING`,
        [
          user.chat_id,
          user.first_name,
          user.last_name,
          user.photo_url,
          user.gender,
          user.seeking,
          user.age,
          user.city,
          user.country,
          user.interests,
          user.bio,
          user.is_verified,
          user.is_premium,
          user.texts_used
        ]
      );
    }

    const sampleMatches = [
      { user1_id: 1, user2_id: 2 },
      { user1_id: 1, user2_id: 4 },
      { user1_id: 3, user2_id: 4 },
      { user1_id: 2, user2_id: 5 }
    ];

    for (const match of sampleMatches) {
      await db.query(
        `INSERT INTO matches (user1_id, user2_id, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT DO NOTHING`,
        [match.user1_id, match.user2_id]
      );
    }

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Database seeding failed:', error);
    throw error;
  }
}

async function runMigrations(db) {
  try {
    console.log('Running database migrations...');
    
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();
    
    for (const file of files) {
      if (file.endsWith('.sql')) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Executing migration: ${file}`);
        
        try {
          await db.query(sql);
          console.log(`Migration ${file} completed successfully`);
        } catch (error) {
          console.error(`Migration ${file} failed:`, error.message);
          throw error;
        }
      }
    }
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

async function initializeServer(db) {
  try {
    console.log('Initializing server...');
    await runMigrations(db);
    await seedDatabase(db);
    console.log('Server initialization completed successfully');
  } catch (error) {
    console.error('Server initialization failed:', error);
    throw error;
  }
}

module.exports = { initializeServer };
