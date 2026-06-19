// Quick setup script
const db = require('./src/db_adapter');

(async () => {
  try {
    console.log('Initializing database...');
    await db.initializeDatabase();
    console.log('Creating tables...');
    db.createTables();
    console.log('Seeding data...');
    db.seedDatabase();
    console.log('SUCCESS: Database created!');

    // Test query
    const result = await db.query('SELECT COUNT(*) as c FROM users');
    console.log('Users in DB:', result[0]?.c || 0);

    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();