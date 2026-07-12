const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Resolve mongoose and dotenv from the backend directory
const mongoose = require(path.join(__dirname, '../backend/node_modules/mongoose'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
const puppeteer = require('puppeteer');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ritikkumartestdb';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

// Mongoose Schemas for verification
const EmailOtpSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.ObjectId,
  email: String,
  purpose: String,
  otpHash: String,
  usedAt: Date,
  expiresAt: Date
}, { collection: 'emailotps', timestamps: true });

const EmailOtp = mongoose.models.EmailOtp || mongoose.model('EmailOtp', EmailOtpSchema);

function bruteForceOtp(otpHash, userId, email, jwtSecret) {
  for (let i = 0; i <= 999999; i++) {
    const otp = String(i).padStart(6, '0');
    const hash = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${String(userId)}:${String(email).toLowerCase().trim()}:${String(otp)}`)
      .digest('hex');
    if (hash === otpHash) {
      return otp;
    }
  }
  throw new Error('Failed to brute force OTP hash');
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const errors = [];
  const requestCounts = {
    messages: 0,
    channels: 0
  };

  // Capture page console errors
  page.on('pageerror', err => {
    console.error('BROWSER ERROR:', err.toString());
    errors.push(err.toString());
  });

  // Pipe browser logs
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('[dirty-check]')) {
      console.log('BROWSER LOG:', text);
    }
  });

  // Intercept and monitor API request counts
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/messages/')) {
      requestCounts.messages++;
    }
    if (url.includes('/api/channels/')) {
      requestCounts.channels++;
    }
  });

  try {
    const timestamp = Date.now();
    const username = `loop_user_${timestamp}`;
    const email = `loop_user_${timestamp}@university.edu`;
    const password = 'password123';

    // Step 1: Sign up and Login
    console.log('--- Step 1: Sign up and Login ---');
    await page.goto('http://localhost:5173/#/signup');
    await page.waitForSelector('#pageUsernameInput');
    await page.evaluate((u, e, p) => {
      document.getElementById('pageUsernameInput').value = u;
      document.getElementById('pageEmailInput').value = e;
      document.getElementById('pagePasswordInput').value = p;
      document.getElementById('pageConfirmPasswordInput').value = p;
    }, username, email, password);
    await page.click('#pageAuthSubmit');

    await page.waitForSelector('#pageVerifyOtpInput');
    const latestOtpRecord = await EmailOtp.findOne({ email }).sort({ createdAt: -1 });
    const otp = bruteForceOtp(latestOtpRecord.otpHash, latestOtpRecord.user, email, JWT_SECRET);
    await page.evaluate((code) => {
      document.getElementById('pageVerifyOtpInput').value = code;
    }, otp);
    await page.click('#pageVerifyEmailSubmit');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Navigate to Login page
    await page.goto('http://localhost:5173/#/login');
    await page.waitForSelector('#pageEmailInput');
    await page.evaluate((e, p) => {
      document.getElementById('pageEmailInput').value = e;
      document.getElementById('pagePasswordInput').value = p;
    }, email, password);
    await page.click('#pageAuthSubmit');
    await page.waitForFunction(() => window.state && window.state.token, { timeout: 15000 });
    console.log('Step 1 Pass: Successfully registered and logged in.');

    // Step 2: Create Workspace A
    console.log('--- Step 2: Create Workspace A ---');
    await page.evaluate(() => {
      document.getElementById('workspaceNameInput').value = 'Workspace A';
      document.getElementById('workspaceForm').dispatchEvent(new Event('submit'));
    });
    await page.waitForFunction(() => window.state && window.state.selectedWorkspaceId, { timeout: 15000 });
    const workspaceAId = await page.evaluate(() => window.state.selectedWorkspaceId);
    console.log('Step 2 Pass: Created Workspace A with ID:', workspaceAId);

    // Step 3: Create Workspace B
    console.log('--- Step 3: Create Workspace B ---');
    const workspaceBId = await page.evaluate(async () => {
      const ws = await window.request('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'Workspace B' })
      });
      return ws._id;
    });
    console.log('Step 3 Pass: Created Workspace B with ID:', workspaceBId);

    // Navigate to workspace page
    await page.goto('http://localhost:5173/#/workspace');
    await page.waitForSelector('#newDocBtn', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Reset request counters before switching to capture only switch-triggered requests
    requestCounts.messages = 0;
    requestCounts.channels = 0;

    // Step 4: Switch to Workspace A
    console.log('--- Step 4: Switch to Workspace A ---');
    await page.evaluate(async (id) => {
      state.selectedWorkspaceId = id;
      localStorage.setItem('workspaceId', id);
      state.chatMessages = [];
      teardownYDoc();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('home');
    }, workspaceAId);
    await new Promise(resolve => setTimeout(resolve, 2500));
    console.log('Step 4 Pass: Switched back to Workspace A successfully.');

    // Step 5: Switch to Workspace B
    console.log('--- Step 5: Switch to Workspace B ---');
    await page.evaluate(async (id) => {
      state.selectedWorkspaceId = id;
      localStorage.setItem('workspaceId', id);
      state.chatMessages = [];
      teardownYDoc();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('home');
    }, workspaceBId);
    await new Promise(resolve => setTimeout(resolve, 2500));
    console.log('Step 5 Pass: Switched back to Workspace B successfully.');

    // Step 6: Verify Request Loops and Console Errors
    console.log('--- Step 6: Verify Request Loop & Error Absence ---');
    console.log('GET /api/messages request count since test start:', requestCounts.messages);
    console.log('GET /api/channels request count since test start:', requestCounts.channels);
    
    // Check if there are type errors (specifically currentRoute type error or loop triggers)
    const currentRouteErrors = errors.filter(e => e.includes('currentRoute') || e.includes('TypeError'));
    if (currentRouteErrors.length > 0) {
      throw new Error(`Step 6 Fail: Found currentRoute or TypeError in browser console! ${currentRouteErrors.join(', ')}`);
    }

    // If there is an infinite loop, request counts would be extremely high (> 10 requests inside 2.5 seconds)
    if (requestCounts.messages > 5 || requestCounts.channels > 5) {
      throw new Error(`Step 6 Fail: Infinite request loop detected! Messages count: ${requestCounts.messages}, Channels count: ${requestCounts.channels}`);
    }

    console.log('Step 6 Pass: No infinite request loops or TypeError exceptions occurred.');
    console.log('🎉 ALL SIX STEPS PASSED SUCCESSFULLY!');
  } finally {
    await mongoose.disconnect();
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ Walkthrough Failed:', err);
  process.exit(1);
});
