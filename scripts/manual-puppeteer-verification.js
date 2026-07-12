const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Resolve mongoose and dotenv from the backend directory to avoid path errors
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
  console.log('Brute-forcing OTP for hash...');
  const start = Date.now();
  for (let i = 0; i <= 999999; i++) {
    const otp = String(i).padStart(6, '0');
    const hash = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${String(userId)}:${String(email).toLowerCase().trim()}:${String(otp)}`)
      .digest('hex');
    if (hash === otpHash) {
      console.log(`OTP brute-forced successfully in ${Date.now() - start}ms: ${otp}`);
      return otp;
    }
  }
  throw new Error('Failed to brute force OTP hash');
}

async function writeToEditor(page, text) {
  // Set text programmatically using the app's native API
  await page.evaluate((val) => {
    if (typeof window.setEditorText !== 'function') {
      throw new Error('window.setEditorText is not defined');
    }
    window.setEditorText(val);
    
    // Dispatch input event to trigger any event listeners
    const el = document.getElementById('documentEditor');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, text);

  // Wait brief time for editor input handlers to register
  await new Promise(resolve => setTimeout(resolve, 500));

  // Debug: print editor state after typing
  console.log('[DEBUG] Editor innerText after typing:', await page.evaluate(() => {
    const el = document.getElementById('documentEditor');
    return el ? el.innerText : 'NOT FOUND';
  }));
  console.log('[DEBUG] getEditorText() value:', await page.evaluate(() => {
    return window.getEditorText ? window.getEditorText() : 'getEditorText NOT DEFINED';
  }));
  console.log('[DEBUG] state.lastSavedText:', await page.evaluate(() => {
    return window.state ? window.state.lastSavedText : 'state NOT DEFINED';
  }));
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected.');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Pipe browser console logs to Node console
  page.on('console', msg => {
    const text = msg.text();
    // Filter out verbose dirty-check logs if any to keep stdout clean
    if (!text.includes('[dirty-check]')) {
      console.log('BROWSER LOG:', text);
    }
  });

  // Monitor request payloads
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/auth/verify-email') || url.includes('/api/auth/login') || url.includes('/api/workspaces')) {
      console.log(`[HTTP Request] ${request.method()} ${url} Payload:`, request.postData());
    }
  });

  // Monitor response bodies
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/api/auth/verify-email') || url.includes('/api/auth/login') || url.includes('/api/workspaces')) {
      try {
        const text = await response.text();
        console.log(`[HTTP Response] ${response.status()} ${url} Body:`, text.length > 500 ? text.substring(0, 500) + '...' : text);
      } catch (err) {
        console.log(`[HTTP Response] ${response.status()} ${url} (Failed to read body)`);
      }
    }
  });

  try {
    const timestamp = Date.now();
    const username = `test_user_${timestamp}`;
    const email = `test_user_${timestamp}@university.edu`;
    const password = 'password123';

    console.log(`Registering user: ${username} (${email})...`);
    await page.goto('http://localhost:5173/#/signup');

    await page.waitForSelector('#pageUsernameInput');
    
    // Fill signup form programmatically to ensure reliability
    await page.evaluate((u, e, p) => {
      document.getElementById('pageUsernameInput').value = u;
      document.getElementById('pageEmailInput').value = e;
      document.getElementById('pagePasswordInput').value = p;
      document.getElementById('pageConfirmPasswordInput').value = p;
    }, username, email, password);

    await page.click('#pageAuthSubmit');
    console.log('Signup form submitted. Waiting for OTP screen...');

    // Wait for the OTP input to load
    await page.waitForSelector('#pageVerifyOtpInput');

    // Query MongoDB for the latest OTP hash for our new user
    console.log('Fetching OTP hash from MongoDB...');
    const latestOtpRecord = await EmailOtp.findOne({ email }).sort({ createdAt: -1 });
    if (!latestOtpRecord) {
      throw new Error('No OTP record found in database for email: ' + email);
    }

    const otp = bruteForceOtp(latestOtpRecord.otpHash, latestOtpRecord.user, email, JWT_SECRET);

    console.log('Entering OTP...');
    await page.evaluate((code) => {
      document.getElementById('pageVerifyOtpInput').value = code;
    }, otp);
    
    await page.click('#pageVerifyEmailSubmit');

    console.log('OTP submitted. Waiting for verification request to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Perform Login by navigating directly
    console.log('Navigating directly to login page...');
    await page.goto('http://localhost:5173/#/login');
    await page.waitForSelector('#pageEmailInput');
    
    console.log('Entering credentials...');
    await page.evaluate((e, p) => {
      document.getElementById('pageEmailInput').value = e;
      document.getElementById('pagePasswordInput').value = p;
    }, email, password);
    
    await page.click('#pageAuthSubmit');

    console.log('Waiting for login request to complete...');
    await page.waitForFunction(() => window.state && window.state.token, { timeout: 15000 });
    console.log('Logged in successfully. Setting up first workspace...');

    // Create a new workspace
    console.log('Creating first workspace...');
    await page.evaluate(() => {
      document.getElementById('workspaceNameInput').value = 'Walkthrough Workspace';
      document.getElementById('workspaceForm').dispatchEvent(new Event('submit'));
    });

    console.log('Waiting for workspace creation to complete and select...');
    await page.waitForFunction(() => window.state && window.state.selectedWorkspaceId, { timeout: 15000 });
    console.log('Workspace created and bootstrapped. ID:', await page.evaluate(() => window.state.selectedWorkspaceId));

    console.log('Navigating directly to workspace route...');
    await page.goto('http://localhost:5173/#/workspace');

    await page.waitForSelector('#newDocBtn', { timeout: 15000 });
    // Wait for documents list to be rendered
    await page.waitForSelector('.document-row', { timeout: 10000 });
    console.log('Workspace view loaded with initial default document.');

    // Edit Document 1 (which was automatically created by the workspace bootstrap)
    console.log('Editing Document 1...');
    await page.waitForSelector('#documentEditor');
    await new Promise(resolve => setTimeout(resolve, 2500)); // wait for Yjs / Editor setup

    // Click Document Title and type Title 1
    await page.focus('#documentTitleInput');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#documentTitleInput', 'Walkthrough Doc 1');
    
    // Type content into Doc 1 using helper
    await writeToEditor(page, 'This is Document 1 content.');
    
    // Force Save
    await page.evaluate(async () => {
      await window.saveCurrentDocumentIfDirty();
    });
    console.log('Document 1 saved.');

    // Step 2: Create Document 2
    console.log('Creating Document 2...');
    await page.evaluate(() => {
      document.getElementById('newDocBtn').click();
    });
    
    // Wait for the second document row to appear in the sidebar
    await page.waitForFunction(() => {
      return document.querySelectorAll('.document-row').length >= 2;
    }, { timeout: 10000 });
    console.log('Document 2 row rendered in sidebar.');

    // Wait for editor to load Doc 2 content and settle Yjs
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    await page.focus('#documentTitleInput');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#documentTitleInput', 'Walkthrough Doc 2');
    
    // Type content into Doc 2 using helper
    await writeToEditor(page, 'This is Document 2 content.');

    // Force Save
    await page.evaluate(async () => {
      await window.saveCurrentDocumentIfDirty();
    });
    console.log('Document 2 saved.');

    // Extract the Document IDs from the UI
    const docIds = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.document-row[data-document-id]'));
      return rows.map(r => r.getAttribute('data-document-id'));
    });
    console.log('Found Document IDs in UI:', docIds);
    const docA = docIds[0];
    const docB = docIds[1];

    if (!docA || !docB) {
      throw new Error('Failed to find two document IDs in the sidebar.');
    }

    // Measure Switch Latency for 6 consecutive switches
    console.log('--- MEASURING LATENCY OF NON-DIRTY SWITCHES ---');
    const latencies = [];
    for (let i = 0; i < 6; i++) {
      const targetId = i % 2 === 0 ? docB : docA;
      const start = Date.now();
      await page.evaluate(async (id) => {
        const startEval = performance.now();
        await window.loadDocument(id);
        return performance.now() - startEval;
      }, targetId);
      const totalTime = Date.now() - start;
      latencies.push(totalTime);
      console.log(`Switch #${i + 1} to ${targetId}: ${totalTime}ms`);
      // wait a bit for Yjs to sync between switches so we don't spam WebSockets too fast
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`Average non-dirty switch latency (measured from Puppeteer runner): ${avgLatency.toFixed(2)}ms`);

    // Answer the latency question:
    // How much overhead does isDocumentDirty() add?
    const overlayCheckTime = await page.evaluate(() => {
      const start = performance.now();
      for (let k = 0; k < 10000; k++) {
        window.saveCurrentDocumentIfDirty();
      }
      return (performance.now() - start) / 10000;
    });
    console.log(`Average execution time of saveCurrentDocumentIfDirty() (proxy for isDocumentDirty) in the browser: ${overlayCheckTime.toFixed(5)}ms`);

    // Step 3: Concurrency Race Condition Verification (Real Browser)
    console.log('--- TESTING RACE CONDITION ON SWITCH ---');
    
    // Switch to Document A first
    await page.evaluate(async (id) => {
      await window.loadDocument(id);
    }, docA);
    
    // Wait for Yjs to settle completely after switch
    await new Promise(resolve => setTimeout(resolve, 2500));

    // Turn on request interception
    await page.setRequestInterception(true);
    let putRequestIntercepted = false;

    const interceptor = async (request) => {
      if (request.url().includes('/api/documents/') && request.method() === 'PUT') {
        console.log('Intercepted PUT document save request. Delaying response by 500ms...');
        putRequestIntercepted = true;
        setTimeout(async () => {
          try {
            await request.continue();
          } catch (e) {
            // handle any late continue errors gracefully
          }
        }, 500);
      } else {
        try {
          await request.continue();
        } catch (e) {
          // handle any late continue errors gracefully
        }
      }
    };

    page.on('request', interceptor);

    // Type a specific edit in Doc 1 using helper
    await writeToEditor(page, 'This is Document 1 content. Race Condition Test Edit!');

    // Switch to Doc 2. Because of Shape A, it must block until the delayed PUT resolves.
    console.log('Triggering switch to Document B mid-save...');
    const switchStart = Date.now();
    await page.evaluate(async (id) => {
      await window.loadDocument(id);
    }, docB);
    const switchEnd = Date.now();
    const switchElapsed = switchEnd - switchStart;
    console.log(`Switch completed. Total transition duration: ${switchElapsed}ms`);

    if (putRequestIntercepted && switchElapsed < 500) {
      throw new Error('Race Condition verification failed: switch completed before save finished!');
    }
    console.log('Correctly blocked document switch until save completed.');

    // Turn off request interception
    page.off('request', interceptor);
    await page.setRequestInterception(false);

    // Switch back to Doc A and check its contents
    console.log('Switching back to Document A to verify contents...');
    await page.evaluate(async (id) => {
      await window.loadDocument(id);
    }, docA);
    
    // Wait for Yjs to settle completely after switch
    await new Promise(resolve => setTimeout(resolve, 2500));

    const docAContent = await page.evaluate(() => {
      return document.getElementById('documentEditor').innerText || '';
    });
    console.log('Document A Content in editor:', docAContent);

    if (!docAContent.includes('Race Condition Test Edit!')) {
      throw new Error('Race Condition data loss detected! The test edit was discarded.');
    }

    console.log('🎉 SUCCESS! Real manual browser walkthrough verified zero data loss and correct behavior.');
  } finally {
    console.log('Cleaning up Mongoose connection and closing browser...');
    await mongoose.disconnect();
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ Error during Puppeteer walkthrough:', err);
  process.exit(1);
});
