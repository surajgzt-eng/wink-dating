// Telegram Dating Bot — Webhook Handler
// Processes incoming Telegram updates (messages, callbacks, photos, videos)
const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Auto-detect the public URL: Render sets RENDER_EXTERNAL_URL, fallback to .env or localhost
function getWebappBase() {
  return process.env.RENDER_EXTERNAL_URL || process.env.WEBAPP_URL || 'http://localhost:3000';
}

// ─── Telegram API helpers ────────────────────────────────────────

async function tg(method, data) {
  try {
    if (process.env.LOG_BOT === '1') {
      const truncated = data && data.text ? data.text.substring(0, 200).replace(/\n/g, ' ') : JSON.stringify(data).substring(0, 300);
      console.log(`📡 [BOT→TG] ${method} chat=${data?.chat_id || data?.callback_query_id || '?'}: ${truncated}`);
      try {
        require('fs').appendFileSync('./bot_trace.log', `${new Date().toISOString()} | ${method} chat=${data?.chat_id || data?.callback_query_id || '?'}: ${truncated}\n`);
      } catch(e) {}
    }
    const res = await axios.post(`${API_BASE}/${method}`, data, {
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data;
  } catch (err) {
    console.error(`Telegram API error (${method}):`, err.response?.data || err.message);
    return null;
  }
}

function sendMessage(chatId, text, opts = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...opts
  });
}

function sendPhoto(chatId, photo, caption, opts = {}) {
  return tg('sendPhoto', {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: 'HTML',
    ...opts
  });
}

function answerCallback(callbackQueryId, text = '', showAlert = false) {
  return tg('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  }).catch(err => {
    if (err?.response?.data?.description?.includes('query is too old')) {
      return null;
    }
    throw err;
  });
}

// ─── Keyboard builders ────────────────────────────────────────────

function mainKeyboard(isVerified = true, isPremium = false) {
  const webappBase = getWebappBase();
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💕 Find Matches', callback_data: 'find_matches' }],
        [{ text: '👤 My Profile', callback_data: 'view_profile' }],
        [{ text: '💬 My Chats', callback_data: 'my_chats' }],
        isVerified ? [{ text: '⭐ Premium', callback_data: 'premium' }] : [{ text: '📸 Verify Photo', callback_data: 'verify_photo' }],
        [{ text: '🎫 Refer Friends', callback_data: 'refer' }]
      ]
    }
  };
}

function skipKeyboard(callbackData) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⏭️ Skip', callback_data: `skip:${callbackData}` }],
        [{ text: '« Back', callback_data: 'main_menu' }]
      ]
    }
  };
}

function openChatKeyboard(matchId, matchedName) {
  const webappBase = getWebappBase();
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💬 Open Chat', web_app: { url: `${webappBase}/chat.html?matchId=${matchId}&name=${encodeURIComponent(matchedName || '')}` } }],
        [{ text: '❌ Next Match', callback_data: `next_match:${matchId}` }]
      ]
    }
  };
}

function setupKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Start Profile Setup', callback_data: 'setup_profile' }]
      ]
    }
  };
}

function genderKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '♂️ Male', callback_data: 'gender:male' }],
        [{ text: '♀️ Female', callback_data: 'gender:female' }],
        [{ text: '⏭️ Skip', callback_data: 'skip:gender' }]
      ]
    }
  };
}

function seekingKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '♂️ Interested in Males', callback_data: 'seeking:male' }],
        [{ text: '♀️ Interested in Females', callback_data: 'seeking:female' }],
        [{ text: '⚧️ Interested in Both', callback_data: 'seeking:both' }],
        [{ text: '⏭️ Skip', callback_data: 'skip:seeking' }]
      ]
    }
  };
}

function photoUploadKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸 Upload Photo', callback_data: 'upload_photo' }],
        [{ text: '⏭️ Skip Photo', callback_data: 'skip:photo' }]
      ]
    }
  };
}

function selfieUploadKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📹 Record Selfie Video', callback_data: 'upload_selfie' }],
        [{ text: '⏭️ Skip Selfie', callback_data: 'skip:selfie' }]
      ]
    }
  };
}

function premiumKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 Subscribe ₹399/Year', callback_data: 'subscribe_premium' }],
        [{ text: '🎫 Refer Friends (Earn 5 texts)', callback_data: 'refer' }],
        [{ text: '« Back', callback_data: 'main_menu' }]
      ]
    }
  };
}

// ─── Conversation state tracking ──────────────────────────────────
// States: name, age, country, city, gender, seeking, photo, selfie, verified
const conversationState = new Map();

function getState(chatId) {
  return conversationState.get(chatId) || {};
}

function setState(chatId, state) {
  if (!conversationState.has(chatId)) conversationState.set(chatId, {});
  conversationState.set(chatId, { ...conversationState.get(chatId), ...state });
}

function clearState(chatId) {
  conversationState.delete(chatId);
}

// ─── Database helpers ─────────────────────────────────────────────

async function query(text, params = []) {
  const db = require('./db_adapter');
  return db.query(text, params);
}

// ─── Face comparison (dHash) ──────────────────────────────────────

async function compareFaces(photoUrl1, photoUrl2) {
  if (!photoUrl1 || !photoUrl2) return 0;
  try {
    const sharp = require('sharp');
    const crypto = require('crypto');
    const [res1, res2] = await Promise.all([
      axios.get(photoUrl1, { responseType: 'arraybuffer', timeout: 5000 }),
      axios.get(photoUrl2, { responseType: 'arraybuffer', timeout: 5000 })
    ]);
    const [buf1, buf2] = [Buffer.from(res1.data), Buffer.from(res2.data)];
    const [pix1, pix2] = await Promise.all([
      sharp(buf1).resize(32, 32, { fit: 'cover' }).greyscale().raw().toBuffer(),
      sharp(buf2).resize(32, 32, { fit: 'cover' }).greyscale().raw().toBuffer()
    ]);
    let diff = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 31; x++) {
        const idx = y * 32 + x;
        if ((pix1[idx + 1] > pix1[idx]) !== (pix2[idx + 1] > pix2[idx])) diff++;
      }
    }
    return 1 - (diff / 992);
  } catch (err) {
    console.error('Face comparison error:', err.message);
    return 0;
  }
}

// ─── Premium check ────────────────────────────────────────────────

async function isUserPremium(chatId) {
  const users = await query('SELECT is_premium, premium_expires FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) return false;
  const user = users[0];
  if (!user.is_premium) return false;
  if (user.premium_expires && new Date(user.premium_expires) < new Date()) {
    await query('UPDATE users SET is_premium = 0 WHERE chat_id = $1', [chatId]);
    return false;
  }
  return true;
}

// ─── Match limit check ────────────────────────────────────────────

async function canUserMatch(chatId) {
  const users = await query('SELECT matches_used, is_premium FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) return false;
  const user = users[0];
  if (user.is_premium) return true; // Unlimited for premium
  return user.matches_used < 20; // Free = 20 matches
}

async function incrementMatchCount(chatId) {
  await query('UPDATE users SET matches_used = matches_used + 1 WHERE chat_id = $1', [chatId]);
}

// ─── Message limit check per match ───────────────────────────────

async function getMatchMessageCount(matchId, senderId) {
  const result = await query(
    'SELECT COUNT(*) as count FROM messages WHERE match_id = $1 AND sender_id = $2',
    [matchId, senderId]
  );
  return result[0]?.count || 0;
}

async function canSendMessage(matchId, senderId) {
  const premium = await isUserPremium(senderId);
  if (premium) return true;
  const count = await getMatchMessageCount(matchId, senderId);
  return count < 10; // Free = 10 messages per match
}

// ─── Command handlers ────────────────────────────────────────────

async function handleStartCommand(chatId, message) {
  const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  const refMatch = message.text && message.text.match(/start\s+ref_(.+)/i);
  const refCode = refMatch ? refMatch[1] : null;

  if (users.length === 0) {
    const firstName = message.from?.first_name || 'User';
    const lastName = message.from?.last_name || '';
    const username = message.from?.username || '';
    const referralCode = 'REF' + chatId + Math.random().toString(36).substring(2, 8).toUpperCase();

    await query(
      `INSERT INTO users (chat_id, first_name, last_name, username, referral_code, is_verified, is_premium, texts_remaining, matches_used, created_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 5, 0, datetime('now'))
       ON CONFLICT (chat_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, username = excluded.username`,
      [chatId, firstName, lastName, username, referralCode]
    );

    if (refCode) {
      const referrers = await query('SELECT chat_id FROM users WHERE referral_code = $1', [refCode]);
      if (referrers.length > 0) {
        await query('UPDATE users SET referred_by = $1 WHERE chat_id = $2', [referrers[0].chat_id, chatId]);
      }
    }

    await sendMessage(chatId,
      `🎉 <b>Welcome to WINK Dating!</b>\n\n` +
      `I help you find meaningful connections.\n\n` +
      `💕 Set up your profile (30 seconds)\n` +
      `📸 Upload a photo & selfie for verification\n` +
      `✨ Get matched with real people\n` +
      `💬 Chat away!\n\n` +
      `<b>Tap below to begin 👇</b>`,
      setupKeyboard()
    );
  } else {
    const user = users[0];
    const firstName = user.first_name || message.from?.first_name || 'there';
    const verified = user.is_verified;
    const premium = await isUserPremium(chatId);
    await sendMessage(chatId,
      `👋 <b>Welcome back, ${firstName}!</b>\n\n` +
      `${verified ? '✅ Verified' : '❌ Not verified'} | ${premium ? '⭐ Premium' : 'Free tier'}\n\n` +
      `${user.is_verified ? 'Ready to find new matches? 💕' : 'Complete your profile to start matching!'}`,
      mainKeyboard(verified, premium)
    );
  }
}

async function handleSetupProfile(chatId, callbackQueryId) {
  clearState(chatId);
  setState(chatId, { step: 'name' });

  if (callbackQueryId) await answerCallback(callbackQueryId, "Let's build your profile!");
  await sendMessage(chatId, `📛 <b>What's your name?</b>\n\nOr tap "Skip" to skip any step.`, skipKeyboard('name'));
}

async function handleViewProfile(chatId, callbackQueryId) {
  const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) {
    if (callbackQueryId) await answerCallback(callbackQueryId, 'Please /start first!');
    return;
  }

  const u = users[0];
  const premium = await isUserPremium(chatId);
  if (callbackQueryId) await answerCallback(callbackQueryId);

  let profile = `👤 <b>Your Profile</b>\n\n`;
  profile += `📛 <b>Name:</b> ${u.first_name || 'Not set'}\n`;
  if (u.age) profile += `🎂 <b>Age:</b> ${u.age}\n`;
  if (u.country) profile += `🌍 <b>Country:</b> ${u.country}\n`;
  if (u.city) profile += `📍 <b>City:</b> ${u.city}\n`;
  if (u.gender) profile += `⚧️ <b>Gender:</b> ${u.gender}\n`;
  if (u.seeking) profile += `💕 <b>Seeking:</b> ${u.seeking}\n`;
  if (u.bio) profile += `📝 <b>Bio:</b> ${u.bio}\n`;
  profile += `\n${u.is_verified ? '✅ <b>Verified</b>' : '❌ <b>Not Verified</b>'}\n`;
  profile += `${premium ? '⭐ <b>Premium</b> (until ' + (u.premium_expires ? new Date(u.premium_expires).toLocaleDateString() : 'N/A') + ')' : 'Free tier'}\n`;
  profile += `💬 <b>Texts:</b> ${u.texts_remaining}/5\n`;
  profile += `🎯 <b>Matches Used:</b> ${u.matches_used}/20\n`;
  profile += `\n📋 Referral code: <code>${u.referral_code}</code>`;

  const webappBase = getWebappBase();

  await sendMessage(chatId, profile, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✏️ Edit in WebApp', web_app: { url: `${webappBase}/profile.html` } }],
        u.is_verified ? [] : [{ text: '📸 Verify Photo', callback_data: 'verify_photo' }],
        [{ text: '💬 My Chats', callback_data: 'my_chats' }],
        [{ text: '« Back', callback_data: 'main_menu' }]
      ].filter(Boolean)
    }
  });
}

async function handleVerifyPhoto(chatId, callbackQueryId) {
  if (callbackQueryId) await answerCallback(callbackQueryId, 'Verification time!');
  await sendMessage(chatId,
    `📸 <b>Photo Verification</b>\n\n` +
    `Send me a <b>clear photo</b> of yourself.\n\n` +
    `Tips:\n` +
    `• Good lighting\n` +
    `• Face clearly visible\n` +
    `• No sunglasses or hats`,
    { reply_markup: { inline_keyboard: [[{ text: '« Back', callback_data: 'main_menu' }]] } }
  );
}

async function handleFindMatches(chatId, callbackQueryId) {
  await answerCallback(callbackQueryId, 'Finding matches...');

  const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) {
    await sendMessage(chatId, 'Please register with /start first!');
    return;
  }

  const user = users[0];

  // Check match limit
  const canMatch = await canUserMatch(chatId);
  if (!canMatch) {
    await sendMessage(chatId,
      `🎯 <b>Match Limit Reached</b>\n\n` +
      `You've used all 20 free matches.\n\n` +
      `Upgrade to Premium for unlimited matches! 💎`,
      premiumKeyboard()
    );
    return;
  }

  // Check profile completeness (at least name + gender + seeking)
  if (!user.gender || !user.seeking) {
    await sendMessage(chatId, '⚠️ <b>Profile incomplete!</b>\n\nPlease set your gender and preferences first.', {
      reply_markup: { inline_keyboard: [[{ text: '✏️ Edit Profile', web_app: { url: `${getWebappBase()}/profile.html` } }]] }
    });
    return;
  }

  if (!user.photo_url) {
    await sendMessage(chatId, '⚠️ <b>No photo!</b>\n\nUpload a photo so others can see you.', {
      reply_markup: { inline_keyboard: [[{ text: '📸 Upload Photo', callback_data: 'verify_photo' }]] }
    });
    return;
  }

  // Find matches with age-based preference
  let matchQuery;
  let params;

  if (user.seeking === 'female') {
    // Boys → younger girls (primary) or closest age (fallback)
    matchQuery = `
      SELECT * FROM users
      WHERE gender = 'female'
        AND chat_id != $1
        AND is_verified = 1
        AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
      ORDER BY CASE WHEN age < $2 THEN 0 ELSE 1 END, ABS(age - $2) ASC
      LIMIT 1
    `;
    params = [chatId, user.age || 25];
  } else if (user.seeking === 'male') {
    // Girls → older boys (primary) or closest age (fallback)
    matchQuery = `
      SELECT * FROM users
      WHERE gender = 'male'
        AND chat_id != $1
        AND is_verified = 1
        AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
      ORDER BY CASE WHEN age > $2 THEN 0 ELSE 1 END, ABS(age - $2) ASC
      LIMIT 1
    `;
    params = [chatId, user.age || 25];
  } else {
    // Both → closest age
    matchQuery = `
      SELECT * FROM users
      WHERE chat_id != $1
        AND is_verified = 1
        AND photo_url IS NOT NULL
        AND chat_id NOT IN (SELECT user2_id FROM matches WHERE user1_id = $1)
        AND chat_id NOT IN (SELECT user1_id FROM matches WHERE user2_id = $1)
      ORDER BY ABS(age - $2) ASC
      LIMIT 1
    `;
    params = [chatId, user.age || 25];
  }

  try {
    const matches = await query(matchQuery, params);

    if (matches.length === 0) {
      await sendMessage(chatId, '😕 <b>No matches found right now.</b>\n\nCome back later — new people join every day!', {
        reply_markup: { inline_keyboard: [[{ text: '💕 Find Matches', callback_data: 'find_matches' }]] }
      });
      return;
    }

    const match = matches[0];

    // Create match record
    await query(
      `INSERT INTO matches (user1_id, user2_id, status, messages_used, created_at)
       VALUES ($1, $2, 'active', 0, datetime('now'))`,
      [chatId, match.chat_id]
    );

    await incrementMatchCount(chatId);

    const m = match;
    const caption =
      `✨ <b>New Match!</b> ✨\n\n` +
      `👤 <b>${m.first_name}${m.last_name ? ' ' + m.last_name : ''}</b>, ${m.age || '?'}\n` +
      `📍 ${m.city || 'Unknown'}${m.country ? ', ' + m.country : ''}\n` +
      (m.is_premium ? `💎 <b>Premium Member</b>\n` : '') +
      `\n<b>Tap "Open Chat" to say hi 👇</b>`;

    await sendPhoto(chatId, m.photo_url, caption, openChatKeyboard(
      (await query('SELECT MAX(id) as id FROM matches WHERE user1_id = $1 AND user2_id = $2', [chatId, m.chat_id]))[0].id,
      m.first_name + ' ' + (m.last_name || '')
    ));
  } catch (err) {
    console.error('Match error:', err.message);
    await sendMessage(chatId, '⚠️ Could not find a match right now. Please try again later.');
  }
}

async function handleMyChats(chatId, callbackQueryId) {
  await answerCallback(callbackQueryId);

  const matches = await query(
    `SELECT m.*,
      CASE WHEN m.user1_id = $1 THEN u2.chat_id ELSE u1.chat_id END as matched_chat_id,
      CASE WHEN m.user1_id = $1 THEN u2.first_name ELSE u1.first_name END as matched_name,
      CASE WHEN m.user1_id = $1 THEN u2.photo_url ELSE u1.photo_url END as matched_photo
     FROM matches m
     LEFT JOIN users u1 ON m.user1_id = u1.chat_id
     LEFT JOIN users u2 ON m.user2_id = u2.chat_id
     WHERE (m.user1_id = $1 OR m.user2_id = $1) AND m.status = 'active'
     ORDER BY m.last_message_at DESC`,
    [chatId]
  );

  if (matches.length === 0) {
    await sendMessage(chatId, '💬 <b>No chats yet</b>\n\nStart matching to find people!', {
      reply_markup: { inline_keyboard: [[{ text: '💕 Find Matches', callback_data: 'find_matches' }]] }
    });
    return;
  }

  const webappBase = getWebappBase();
  const buttons = matches.map(m => [
    { text: `💬 ${m.matched_name || 'Match'}`, web_app: { url: `${webappBase}/chat.html?matchId=${m.id}&name=${encodeURIComponent(m.matched_name || '')}` } }
  ]);
  buttons.push([{ text: '« Back', callback_data: 'main_menu' }]);

  await sendMessage(chatId, `💬 <b>Your Chats (${matches.length})</b>`, {
    reply_markup: { inline_keyboard: buttons }
  });
}

async function handlePremium(chatId, callbackQueryId) {
  await answerCallback(callbackQueryId);

  const premium = await isUserPremium(chatId);

  if (premium) {
    await sendMessage(chatId, '⭐ <b>You are already Premium!</b>\n\nEnjoy unlimited matches and messages! 💕');
    return;
  }

  await sendMessage(chatId,
    `⭐ <b>Premium Membership</b>\n\n` +
    `₹399 / Year\n\n` +
    `Unlimited:\n` +
    `• 💕 Unlimited matches\n` +
    `• 💬 Unlimited messages per match\n` +
    `• 🎯 Priority matching\n\n` +
    `<i>PayPal integration coming soon — for now use /refer to earn free texts!</i>`,
    premiumKeyboard()
  );
}

async function handleRefer(chatId, callbackQueryId) {
  await answerCallback(callbackQueryId);

  const users = await query('SELECT referral_code FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) return;

  const refCode = users[0].referral_code;
  const botUsername = process.env.BOT_USERNAME || 'wink_dating_bot';
  const refLink = `https://t.me/${botUsername}?start=ref_${refCode}`;

  await sendMessage(chatId,
    `🎫 <b>Refer a Friend</b>\n\n` +
    `Share your link and both of you earn <b>5 free texts</b>!\n\n` +
    `Your friend must:\n` +
    `• Complete profile setup\n` +
    `• Upload a photo\n\n` +
    `<code>${refLink}</code>\n\n` +
    `Tap to copy 👆`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Copy Link', callback_data: 'main_menu' }],
          [{ text: '« Back', callback_data: 'main_menu' }]
        ]
      }
    }
  );
}

async function handleSubscribePremium(chatId, callbackQueryId) {
  try {
    await answerCallback(callbackQueryId, 'Activating premium...');

    await query(
      `UPDATE users SET is_premium = 1, premium_expires = datetime('now', '+365 days'), updated_at = datetime('now') WHERE chat_id = $1`,
      [chatId]
    );

    await sendMessage(chatId,
      '⭐ <b>🎉 Premium Activated!</b>\n\n' +
      '₹399 / Year\n\n' +
      'You now have:\n' +
      '• 💕 Unlimited matches\n' +
      '• 💬 Unlimited messages per match\n\n' +
      'Enjoy! 💕',
      mainKeyboard(true, true)
    );
  } catch (err) {
    console.error('Premium sub error:', err);
    await sendMessage(chatId, '⚠️ Could not activate premium. Please try again.');
  }
}

async function handleMainMenu(chatId, callbackQueryId) {
  await answerCallback(callbackQueryId);
  const users = await query('SELECT is_verified FROM users WHERE chat_id = $1', [chatId]);
  const verified = users.length > 0 && users[0].is_verified;
  const premium = await isUserPremium(chatId);
  await sendMessage(chatId, 'What would you like to do?', mainKeyboard(verified, premium));
}

// ─── Onboarding step handler ─────────────────────────────────────

async function handleOnboardingStep(chatId, text, state) {
  const step = state.step;

  if (step === 'name') {
    if (text.length < 2 && !state.skipped) {
      await sendMessage(chatId, 'Name must be at least 2 characters. Try again or skip:', skipKeyboard('name'));
      return;
    }
    if (state.skipped) {
      setState(chatId, { step: 'age' });
      await sendMessage(chatId, `🎂 <b>How old are you?</b>\n\nEnter your age (18-120):`, skipKeyboard('age'));
    } else {
      await query('UPDATE users SET first_name = $1 WHERE chat_id = $2', [text, chatId]);
      setState(chatId, { step: 'age', first_name: text });
      await sendMessage(chatId, `Nice to meet you, ${text}! 🎉\n\n🎂 <b>How old are you?</b>\n\nEnter your age (18-120):`, skipKeyboard('age'));
    }

  } else if (step === 'age') {
    if (state.skipped) {
      setState(chatId, { step: 'country' });
      await sendMessage(chatId, `🌍 <b>Which country are you from?</b>`, skipKeyboard('country'));
    } else {
      const age = parseInt(text);
      if (isNaN(age) || age < 18 || age > 120) {
        await sendMessage(chatId, 'Please enter a valid age (18-120):', skipKeyboard('age'));
        return;
      }
      await query('UPDATE users SET age = $1 WHERE chat_id = $2', [age, chatId]);
      setState(chatId, { step: 'country', age });
      await sendMessage(chatId, `🌍 <b>Which country are you from?</b>`, skipKeyboard('country'));
    }

  } else if (step === 'country') {
    if (state.skipped) {
      setState(chatId, { step: 'city' });
      await sendMessage(chatId, `📍 <b>What city do you live in?</b>`, skipKeyboard('city'));
    } else {
      await query('UPDATE users SET country = $1 WHERE chat_id = $2', [text, chatId]);
      setState(chatId, { step: 'city', country: text });
      await sendMessage(chatId, `📍 <b>What city do you live in?</b>`, skipKeyboard('city'));
    }

  } else if (step === 'city') {
    if (state.skipped) {
      setState(chatId, { step: 'gender' });
      await sendMessage(chatId, `⚧️ <b>What's your gender?</b>`, genderKeyboard());
    } else {
      await query('UPDATE users SET city = $1 WHERE chat_id = $2', [text, chatId]);
      setState(chatId, { step: 'gender', city: text });
      await sendMessage(chatId, `⚧️ <b>What's your gender?</b>`, genderKeyboard());
    }

  } else if (step === 'gender') {
    if (state.skipped) {
      setState(chatId, { step: 'seeking' });
      await sendMessage(chatId, `💕 <b>Who are you interested in?</b>`, seekingKeyboard());
    } else {
      await query('UPDATE users SET gender = $1 WHERE chat_id = $2', [text, chatId]);
      setState(chatId, { step: 'seeking', gender: text });
      await sendMessage(chatId, `💕 <b>Who are you interested in?</b>`, seekingKeyboard());
    }

  } else if (step === 'seeking') {
    if (state.skipped) {
      // Skip seeking → go to photo
      setState(chatId, { step: 'photo' });
      await sendMessage(chatId,
        `📸 <b>Now let's add your photo!</b>\n\n` +
        `This helps others recognize you and shows you're a real person.\n\n` +
        `Send me a <b>clear photo</b> of yourself:`,
        photoUploadKeyboard()
      );
    } else {
      await query('UPDATE users SET seeking = $1 WHERE chat_id = $2', [text, chatId]);
      setState(chatId, { step: 'photo', seeking: text });
      await sendMessage(chatId,
        `📸 <b>Now let's add your photo!</b>\n\n` +
        `This helps others recognize you and shows you're a real person.\n\n` +
        `Send me a <b>clear photo</b> of yourself:`,
        photoUploadKeyboard()
      );
    }

  } else if (step === 'photo') {
    // Photo is handled separately via message.photo handler
    return;

  } else if (step === 'selfie') {
    // Selfie is handled separately via message.video handler
    return;

  } else {
    clearState(chatId);
    await sendMessage(chatId, 'Something went wrong. Use /start to begin again!');
  }
}

// ─── Verification completion handler ─────────────────────────────

async function completeVerification(chatId) {
  const users = await query('SELECT gender, first_name FROM users WHERE chat_id = $1', [chatId]);
  if (users.length === 0) return;

  const user = users[0];
  const isFemale = user.gender === 'female';

  // Auto-activate premium for verified females
  if (isFemale) {
    await query('UPDATE users SET is_premium = 1, premium_expires = datetime(\'now\', \'+365 days\') WHERE chat_id = $1', [chatId]);
    await sendMessage(chatId,
      `✅ <b>Verification Complete!</b> 🎉\n\n` +
      `🌟 <b>Premium Activated!</b>\n\n` +
      `As a verified female member, you get premium free for 1 year!\n\n` +
      `<b>Start matching now! 💕</b>`,
      mainKeyboard(true, true)
    );
  } else {
    await sendMessage(chatId,
      `✅ <b>Verification Complete!</b> 🎉\n\n` +
      `You're all set! <b>Start matching now! 💕</b>`,
      mainKeyboard(true, false)
    );
  }

  clearState(chatId);
}

// ─── Referral reward handler ──────────────────────────────────────

async function awardReferralReward(referredChatId) {
  const users = await query('SELECT referred_by, texts_remaining FROM users WHERE chat_id = $1', [referredChatId]);
  if (users.length === 0) return;

  const { referred_by, texts_remaining } = users[0];
  if (!referred_by) return;

  // Check if referred user completed profile + photo
  const referredUser = await query(
    'SELECT photo_url, gender, seeking, age FROM users WHERE chat_id = $1',
    [referredChatId]
  );
  if (referredUser.length === 0) return;
  if (!referredUser[0].photo_url) return; // Need photo verified

  // Award 5 texts to referrer
  await query('UPDATE users SET texts_remaining = texts_remaining + 5 WHERE chat_id = $1', [referred_by]);

  // Award 5 texts to new user
  await query('UPDATE users SET texts_remaining = texts_remaining + 5 WHERE chat_id = $1', [referredChatId]);

  // Notify referrer
  await sendMessage(referred_by,
    `🎉 <b>Referral Reward!</b>\n\n` +
    `Your friend completed their profile and uploaded a photo!\n\n` +
    `+5 free texts added to your account! 💬`
  );
}

// ─── Webhook dispatcher ──────────────────────────────────────────

async function handleWebhook(update, queryFn) {
  try {
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = cb.message?.chat?.id || cb.from.id;
      const data = cb.data || '';
      const cbId = cb.id;

      // Skip handlers
      if (data.startsWith('skip:')) {
        const field = data.split(':')[1];
        const state = getState(chatId);
        state.skipped = true;
        state.step = field;
        setState(chatId, { skipped: true });
        await handleOnboardingStep(chatId, '', state);
        return;
      }

      // Gender selection
      if (data.startsWith('gender:')) {
        await answerCallback(cbId);
        const gender = data.split(':')[1];
        const state = getState(chatId);
        if (state.step === 'gender') {
          await handleOnboardingStep(chatId, gender, state);
        }
        return;
      }

      // Seeking selection
      if (data.startsWith('seeking:')) {
        await answerCallback(cbId);
        const seeking = data.split(':')[1];
        const state = getState(chatId);
        if (state.step === 'seeking') {
          await handleOnboardingStep(chatId, seeking, state);
        }
        return;
      }

      // Main menu
      if (data === 'main_menu') {
        await handleMainMenu(chatId, cbId);
        return;
      }

      // Setup profile
      if (data === 'setup_profile') {
        await handleSetupProfile(chatId, cbId);
        return;
      }

      // View profile
      if (data === 'view_profile') {
        await handleViewProfile(chatId, cbId);
        return;
      }

      // Find matches
      if (data === 'find_matches') {
        await handleFindMatches(chatId, cbId);
        return;
      }

      // My chats
      if (data === 'my_chats') {
        await handleMyChats(chatId, cbId);
        return;
      }

      // Premium
      if (data === 'premium') {
        await handlePremium(chatId, cbId);
        return;
      }

      // Subscribe premium
      if (data === 'subscribe_premium') {
        await handleSubscribePremium(chatId, cbId);
        return;
      }

      // Refer
      if (data === 'refer') {
        await handleRefer(chatId, cbId);
        return;
      }

      // Verify photo
      if (data === 'verify_photo') {
        await handleVerifyPhoto(chatId, cbId);
        return;
      }

      // Upload photo
      if (data === 'upload_photo') {
        await answerCallback(cbId, 'Send me a photo!');
        await sendMessage(chatId, '📸 Send me a clear photo of yourself:');
        return;
      }

      // Skip photo → go straight to matching
      if (data === 'skip:photo') {
        await answerCallback(cbId, 'Photo skipped!');
        clearState(chatId);
        await sendMessage(chatId,
          `✅ <b>Photo skipped!</b>\n\n` +
          `You can upload a photo later from your profile.\n\n` +
          `<b>Start matching now! 💕</b>`,
          mainKeyboard(false, false)
        );
        return;
      }

      // Upload selfie
      if (data === 'upload_selfie') {
        await answerCallback(cbId, 'Record a selfie video!');
        await sendMessage(chatId,
          `📹 <b>Record a Selfie Video</b>\n\n` +
          `Hold your phone and record a short video of yourself (5-10 seconds).\n` +
          `Show your face clearly moving slightly.`
        );
        return;
      }

      // Skip selfie → complete verification
      if (data === 'skip:selfie') {
        await answerCallback(cbId, 'Selfie skipped!');
        await completeVerification(chatId);
        return;
      }

      // Next match
      if (data.startsWith('next_match:')) {
        await handleFindMatches(chatId, cbId);
        return;
      }

      // Open chat
      if (data.startsWith('open_chat:')) {
        await answerCallback(cbId, 'Opening chat...');
        const matchId = data.split(':')[1];
        const webappBase = getWebappBase();
        await sendMessage(chatId, '💬 <b>Opening your chat in the WebApp...</b>', {
          reply_markup: {
            inline_keyboard: [[
              { text: '💬 Open Chat', web_app: { url: `${webappBase}/chat.html?matchId=${matchId}` } }
            ]]
          }
        });
        return;
      }

      // Edit profile
      if (data === 'edit_profile') {
        await answerCallback(cbId, 'Opening profile editor...');
        const webappBase = getWebappBase();
        await sendMessage(chatId, '📱 <b>Edit your profile</b>', {
          reply_markup: {
            inline_keyboard: [[
              { text: '✏️ Edit Profile', web_app: { url: `${webappBase}/profile.html` } }
            ]]
          }
        });
        return;
      }

      await answerCallback(cbId);
      return;
    }

    // Handle messages
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat.id;
    const text = msg.text || '';
    const state = getState(chatId);

    // Handle photo upload
    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const fileInfo = await tg('getFile', { file_id: photo.file_id });

      if (fileInfo && fileInfo.ok && fileInfo.result) {
        const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
        await query('UPDATE users SET photo_url = $1, updated_at = datetime(\'now\') WHERE chat_id = $2', [photoUrl, chatId]);

        // Check if in photo step of onboarding
        if (state.step === 'photo') {
          setState(chatId, { step: 'selfie', photoUrl });
          await sendMessage(chatId,
            `📸 <b>Photo received!</b>\n\n` +
            `Now let's verify it's really you.\n\n` +
            `📹 <b>Record a selfie video</b> (5-10 seconds):\n` +
            `Show your face moving slightly.`,
            selfieUploadKeyboard()
          );
        } else {
          // General photo upload (e.g., from verify_photo)
          await sendMessage(chatId, `✅ <b>Photo saved!</b>\n\nWould you like to verify with a selfie?`, selfieUploadKeyboard());
        }
      }
      return;
    }

    // Handle video (selfie video)
    if (msg.video) {
      const state = getState(chatId);

      if (state.step === 'selfie' || state.photoUrl) {
        const fileInfo = await tg('getFile', { file_id: msg.video.file_id });

        if (fileInfo && fileInfo.ok && fileInfo.result) {
          const selfieUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
          const photoUrl = state.photoUrl;

          await query('UPDATE users SET selfie_url = $1, updated_at = datetime(\'now\') WHERE chat_id = $2', [selfieUrl, chatId]);

          // Compare faces
          const similarity = await compareFaces(photoUrl, selfieUrl);

          if (similarity >= 0.65) {
            // Verified!
            await query('UPDATE users SET is_verified = 1, updated_at = datetime(\'now\') WHERE chat_id = $1', [chatId]);

            // Award referral reward if applicable
            await awardReferralReward(chatId);

            await completeVerification(chatId);
          } else {
            // Face mismatch
            setState(chatId, { step: 'photo', photoUrl: null });
            await query('UPDATE users SET selfie_url = NULL WHERE chat_id = $1', [chatId]);
            await sendMessage(chatId,
              `⚠️ <b>Verification Failed</b>\n\n` +
              `The selfie doesn't appear to match your photo.\n` +
              `Similarity: ${(similarity * 100).toFixed(0)}%\n\n` +
              `Please try again with a clearer selfie where your face is clearly visible.`,
              photoUploadKeyboard()
            );
          }
        }
      } else {
        await sendMessage(chatId, 'Please complete your profile first using /start');
      }
      return;
    }

    // Handle commands
    if (text.startsWith('/start')) {
      await handleStartCommand(chatId, msg);
    } else if (text === '/profile') {
      const users = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
      if (users.length > 0) {
        await handleViewProfile(chatId, null);
      } else {
        await sendMessage(chatId, 'Please use /start to register first!');
      }
    } else if (text === '/match' || text === '/find') {
      await handleFindMatches(chatId, null);
    } else if (text === '/chats') {
      await handleMyChats(chatId, null);
    } else if (text === '/premium') {
      await handlePremium(chatId, null);
    } else if (text === '/refer') {
      await handleRefer(chatId, null);
    } else if (text === '/help') {
      await sendMessage(chatId,
        '🤖 <b>WINK Dating Bot Commands</b>\n\n' +
        '/start — Register / main menu\n' +
        '/profile — View your profile\n' +
        '/match — Find a new match\n' +
        '/chats — Your conversations\n' +
        '/premium — Premium info\n' +
        '/refer — Refer friends (earn texts!)\n' +
        '/help — This message'
      );
    } else {
      // Check if in onboarding
      if (state.step) {
        await handleOnboardingStep(chatId, text, state);
      } else {
        await sendMessage(chatId, 'Not sure what you mean. Try /help for commands!', mainKeyboard(false, false));
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }
}

// ─── Express router integration ──────────────────────────────────

function setupWebhook(app, queryFn) {
  app.post('/webhook', async (req, res) => {
    try {
      await handleWebhook(req.body, queryFn);
      res.json({ ok: true });
    } catch (err) {
      console.error('Webhook route error:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/webhook', (req, res) => {
    res.json({ ok: true, message: 'Webhook endpoint active' });
  });

  app.post('/api/bot/set-webhook', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'Missing webhook URL' });

      const result = await tg('setWebhook', { url: `${url}/webhook` });

      const menuResult = await tg('setChatMenuButton', {
        menu_button: { type: 'web_app', text: 'Open WINK', web_app: { url: process.env.RENDER_EXTERNAL_URL || process.env.WEBAPP_URL || 'http://localhost:3000' } }
      });

      const commandsResult = await tg('setMyCommands', {
        commands: [
          { command: 'start', description: '🏠 Main menu' },
          { command: 'find', description: '💕 Find a new match' },
          { command: 'profile', description: '👤 View my profile' },
          { command: 'chats', description: '💬 My conversations' },
          { command: 'premium', description: '⭐ Premium membership' },
          { command: 'refer', description: '🎫 Refer friends (earn texts)' },
          { command: 'help', description: 'ℹ️ Help' }
        ]
      });

      res.json({
        success: true,
        telegramResponse: result,
        menuResult,
        commandsResult,
        webhookUrl: `${url}/webhook`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bot/webhook-info', async (req, res) => {
    const info = await tg('getWebhookInfo', {});
    res.json(info);
  });

  app.get('/api/bot/info', async (req, res) => {
    const me = await tg('getMe', {});
    res.json(me);
  });
}

module.exports = { setupWebhook, handleWebhook, sendMessage };