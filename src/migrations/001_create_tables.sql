-- Database Schema for WINK Dating Bot v2.0

CREATE TABLE users (
  chat_id BIGINT PRIMARY KEY,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  username VARCHAR(100),
  photo_url TEXT,
  selfie_url TEXT,
  gender VARCHAR(20) CHECK (gender IN ('male', 'female')),
  seeking VARCHAR(20) CHECK (seeking IN ('male', 'female', 'both')),
  age INTEGER CHECK (age >= 18 AND age <= 120),
  city VARCHAR(100),
  country VARCHAR(100),
  bio TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  is_premium BOOLEAN DEFAULT FALSE,
  premium_expires TIMESTAMP,
  referral_code VARCHAR(50) UNIQUE,
  referred_by BIGINT REFERENCES users(chat_id),
  texts_remaining INTEGER DEFAULT 5,
  matches_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE matches (
  id SERIAL PRIMARY KEY,
  user1_id BIGINT NOT NULL REFERENCES users(chat_id),
  user2_id BIGINT NOT NULL REFERENCES users(chat_id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
  messages_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user1_id, user2_id)
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  sender_id BIGINT NOT NULL REFERENCES users(chat_id),
  receiver_id BIGINT NOT NULL REFERENCES users(chat_id),
  content TEXT DEFAULT '',
  media_type VARCHAR(20) DEFAULT 'text' CHECK (media_type IN ('text', 'image', 'voice')),
  media_url TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(chat_id),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_gender ON users(gender);
CREATE INDEX idx_users_seeking ON users(seeking);
CREATE INDEX idx_users_age ON users(age);
CREATE INDEX idx_users_is_verified ON users(is_verified);
CREATE INDEX idx_users_is_premium ON users(is_premium);
CREATE INDEX idx_matches_user1 ON matches(user1_id);
CREATE INDEX idx_matches_user2 ON matches(user2_id);
CREATE INDEX idx_messages_match ON messages(match_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();