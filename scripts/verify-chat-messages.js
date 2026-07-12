const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Resolve mongoose and dotenv from the backend directory
const mongoose = require(path.join(__dirname, '../backend/node_modules/mongoose'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcryptjs'));
const puppeteer = require('puppeteer');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ritikkumartestdb';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

// Load User model from backend models
const { User } = require(path.join(__dirname, '../backend/models'));

async function createTestUser(username, email, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    username,
    fullName: username,
    email,
    passwordHash,
    authProvider: 'email',
    emailVerifiedAt: new Date()
  });
  return user;
}

async function loginUser(page, email, password) {
  await page.goto('http://localhost:5173/#/login');
  await page.waitForSelector('#pageEmailInput');
  await page.evaluate((e, p) => {
    document.getElementById('pageEmailInput').value = e;
    document.getElementById('pagePasswordInput').value = p;
  }, email, password);
  await page.click('#pageAuthSubmit');
  await page.waitForFunction(() => window.state && window.state.token, { timeout: 15000 });
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);

  const browser1 = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const browser2 = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  const page1 = await browser1.newPage();
  const page2 = await browser2.newPage();

  // Pipe browser logs
  page1.on('console', msg => console.log('PAGE 1 LOG:', msg.text()));
  page1.on('pageerror', err => console.error('PAGE 1 ERROR:', err.toString()));
  page2.on('console', msg => console.log('PAGE 2 LOG:', msg.text()));
  page2.on('pageerror', err => console.error('PAGE 2 ERROR:', err.toString()));

  try {
    const timestamp = Date.now();
    const u1 = `chat_u1_${timestamp}`;
    const e1 = `chat_u1_${timestamp}@university.edu`;
    const u2 = `chat_u2_${timestamp}`;
    const e2 = `chat_u2_${timestamp}@university.edu`;
    const password = 'password123';

    // 1. Programmatically create users in MongoDB
    console.log('Creating User 1 in database...');
    const user1 = await createTestUser(u1, e1, password);
    console.log('Creating User 2 in database...');
    const user2 = await createTestUser(u2, e2, password);

    // 2. Log in User 1 and create Workspace A
    console.log('Logging in User 1...');
    await loginUser(page1, e1, password);
    console.log('User 1 creating Workspace A...');
    await page1.evaluate(() => {
      document.getElementById('workspaceNameInput').value = 'Workspace A';
      document.getElementById('workspaceForm').dispatchEvent(new Event('submit'));
    });
    await page1.waitForFunction(() => window.state && window.state.selectedWorkspaceId, { timeout: 15000 });
    const workspaceId = await page1.evaluate(() => window.state.selectedWorkspaceId);

    // Get invite link / join code
    console.log('Workspace A ID:', workspaceId);
    await page1.goto('http://localhost:5173/#/workspace');
    await page1.waitForSelector('#newDocBtn', { timeout: 15000 });
    const joinCode = await page1.evaluate(async (wId) => {
      const invite = await window.request(`/api/invites/${wId}`, {
        method: 'POST',
        body: JSON.stringify({ role: 'member', email: '' })
      });
      return invite.code;
    }, workspaceId);
    console.log('Join code generated:', joinCode);

    // 3. Log in User 2 and join Workspace A
    console.log('Logging in User 2...');
    await loginUser(page2, e2, password);
    console.log('User 2 joining Workspace A...');
    await page2.evaluate(async (code) => {
      await window.request('/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      await window.loadWorkspaces();
    }, joinCode);

    // Switch User 2 to Workspace A
    console.log('Switching User 2 to Workspace A...');
    await page2.goto('http://localhost:5173/#/workspace');
    await page2.waitForSelector('#newDocBtn', { timeout: 15000 });
    await page2.evaluate(async (id) => {
      state.selectedWorkspaceId = id;
      localStorage.setItem('workspaceId', id);
      state.chatMessages = [];
      teardownYDoc();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('workspace');
    }, workspaceId);
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Nav to Chat page in both sessions
    console.log('Navigating to chat page...');
    await page1.evaluate(() => navigate('chat'));
    await page2.evaluate(() => navigate('chat'));
    await new Promise(resolve => setTimeout(resolve, 2000));

    // --- TEST 1: Real-time Message Send / Receive ---
    console.log('\n--- Test 1: Real-time Message Send/Receive ---');
    await page1.type('#workspaceChatInput', 'Hello from User 1!');
    await page1.click('#workspaceChatSendBtn');
    await new Promise(resolve => setTimeout(resolve, 1500));

    const messagesUser2 = await page2.evaluate(() => state.chatMessages.map(m => m.content));
    console.log('Messages received by User 2:', messagesUser2);
    if (!messagesUser2.includes('Hello from User 1!')) {
      throw new Error('Test 1 Fail: User 2 did not receive User 1 message in real-time!');
    }
    console.log('Test 1 PASS: Message received successfully in real-time.');

    // --- TEST 2: Typing Indicator ---
    console.log('\n--- Test 2: Typing Indicator ---');
    await page1.type('#workspaceChatInput', 'Typing...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const typingUsers2 = await page2.evaluate(() => state.chatTypingUsers.map(u => u.username));
    console.log('Typing users in User 2 state:', typingUsers2);
    if (!typingUsers2.includes(u1)) {
      throw new Error('Test 2 Fail: Typing indicator not visible on User 2!');
    }
    console.log('Test 2 PASS: Typing indicator successfully transmitted.');

    // Clear typing
    await page1.evaluate(() => {
      document.getElementById('workspaceChatInput').value = '';
    });

    // --- TEST 3: Unread Count Badge ---
    console.log('\n--- Test 3: Unread Badge sync ---');
    // Navigate User 2 away from chat
    await page2.evaluate(() => navigate('workspace'));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // User 1 sends message
    await page1.type('#workspaceChatInput', 'Are you there?');
    await page1.click('#workspaceChatSendBtn');
    await new Promise(resolve => setTimeout(resolve, 1500));

    const unreadCount2 = await page2.evaluate(() => state.unreadChatCount);
    console.log('Unread count badge value for User 2:', unreadCount2);
    if (unreadCount2 < 1) {
      throw new Error('Test 3 Fail: Unread badge did not increment on receiving background message!');
    }
    console.log('Test 3 PASS: Unread count badge updated correctly.');

    // --- TEST 4: Reaction Double-Toggle Regression ---
    console.log('\n--- Test 4: Reaction Double-Toggle Regression check ---');
    await page1.evaluate(() => navigate('chat'));
    await page2.evaluate(() => navigate('chat'));
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Get first user chat message ID (non-system message)
    const msgId = await page1.evaluate(() => state.messages.find(m => !m.isSystem)._id);
    console.log('Message ID to react to:', msgId);

    // User 1 reacts to the message locally
    console.log('Toggling reaction locally...');
    await page1.evaluate(async (id) => {
      // Trigger toggle local reaction
      await window.toggleReaction(id, '👍');
    }, msgId);

    const messageReactions = await page1.evaluate((id) => {
      const msg = state.messages.find(m => m._id === id);
      return msg.reactions;
    }, msgId);

    console.log('Reactions array for message after toggle:', JSON.stringify(messageReactions));
    
    // Validate reaction is present
    if (!messageReactions || messageReactions.length === 0 || !messageReactions[0].users.includes(await page1.evaluate(() => state.user.id))) {
      throw new Error('Test 4 Fail: Double-toggle regression occurred (reaction was added and immediately removed)!');
    }
    console.log('Test 4 PASS: Local reaction toggles exactly once with no double-toggle regression.');

    // --- TEST 5: Home Dashboard Preview ---
    console.log('\n--- Test 5: Home Dashboard Preview ---');
    await page1.evaluate(() => navigate('home'));
    await new Promise(resolve => setTimeout(resolve, 1500));

    const homePreviewText = await page1.evaluate(() => {
      const el = document.querySelector('.chat-preview-msg');
      return el ? el.textContent : '';
    });
    console.log('Home dashboard chat preview text:', homePreviewText);
    if (!homePreviewText) {
      throw new Error('Test 5 Fail: Chat preview is empty on home dashboard!');
    }
    console.log('Test 5 PASS: Home dashboard chat preview loads successfully.');

    // --- TEST 6: Demo Mode Chat ---
    console.log('\n--- Test 6: Demo Mode Chat ---');
    await page1.evaluate(async () => {
      window.sessionStorage.setItem('demoMode', 'true');
      state.demoMode = true;
      state.messages = [];
      state.chatMessages = [];
      await window.loadDemoWorkspaceModule();
      await window.requireDemoWorkspaceModule();
      await window.hydrateDemoWorkspace();
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    const demoChatMessagesCount = await page1.evaluate(() => state.chatMessages.length);
    console.log('Demo mode chat messages loaded:', demoChatMessagesCount);
    if (demoChatMessagesCount < 1) {
      throw new Error('Test 6 Fail: Demo mode chat messages did not load!');
    }
    console.log('Test 6 PASS: Demo mode chat loads cleanly.');

    console.log('\n🎉 ALL SIX CHAT MESSAGE CANONICALIZATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await browser1.close();
    await browser2.close();
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error('❌ Verification script failed:', err);
  process.exit(1);
});
