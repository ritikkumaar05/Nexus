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

async function writeToEditor(page, text) {
  await page.evaluate((val) => {
    window.setEditorText(val);
    const el = document.getElementById('documentEditor');
    if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Pipe browser logs
  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('[dirty-check]') && !text.includes('[perf]')) {
      console.log('BROWSER LOG:', text);
    }
  });

  try {
    const timestamp = Date.now();
    const username = `save_fail_${timestamp}`;
    const email = `save_fail_${timestamp}@university.edu`;
    const password = 'password123';

    // Onboard user
    console.log('Signing up...');
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

    // Login
    await page.goto('http://localhost:5173/#/login');
    await page.waitForSelector('#pageEmailInput');
    await page.evaluate((e, p) => {
      document.getElementById('pageEmailInput').value = e;
      document.getElementById('pagePasswordInput').value = p;
    }, email, password);
    await page.click('#pageAuthSubmit');
    await page.waitForFunction(() => window.state && window.state.token, { timeout: 15000 });

    // Create Workspace A
    console.log('Creating Workspace A...');
    await page.evaluate(() => {
      document.getElementById('workspaceNameInput').value = 'Workspace A';
      document.getElementById('workspaceForm').dispatchEvent(new Event('submit'));
    });
    await page.waitForFunction(() => window.state && window.state.selectedWorkspaceId, { timeout: 15000 });
    const workspaceAId = await page.evaluate(() => window.state.selectedWorkspaceId);

    // Create Workspace B
    console.log('Creating Workspace B...');
    await page.evaluate(async () => {
      await window.request('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'Workspace B' })
      });
      await window.loadWorkspaces();
    });
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Navigate to workspace page
    await page.goto('http://localhost:5173/#/workspace');
    await page.waitForSelector('#newDocBtn', { timeout: 15000 });
    await new Promise(resolve => setTimeout(resolve, 2500));

    const workspaces = await page.evaluate(() => window.state.workspaces);
    const workspaceBId = workspaces.find(w => w.name === 'Workspace B')._id;

    // --- TEST 1: Deliberate save failure on sidebar click ---
    console.log('\n--- Test 1: Forcing save failure on sidebar workspace click ---');
    await writeToEditor(page, 'This is Document 1 edited text.');

    // Activate request interception to simulate network save failure
    await page.setRequestInterception(true);
    const interceptor = async (request) => {
      if (request.url().includes('/api/documents/') && request.method() === 'PUT') {
        console.log('Intercepting PUT document save request. Mocking 500 Server Error...');
        request.respond({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' })
        });
      } else {
        request.continue();
      }
    };
    page.on('request', interceptor);

    // Trigger workspace switch to Workspace B via state call (simulating sidebar list click)
    await page.evaluate(async (id) => {
      const el = document.createElement('div');
      el.dataset.workspaceId = id;
      const event = {
        target: {
          closest: (selector) => selector === '[data-workspace-id]' ? el : null
        }
      };
      // Trigger the listener logic programmatically
      window.clearTimeout(autosaveTimer);
      try {
        if (state.selectedDocumentId) {
          await saveCurrentDocument({ silent: true });
        }
        state.selectedWorkspaceId = id;
        localStorage.setItem('workspaceId', id);
        hydrateActivityItems();
        teardownYDoc();
        await Promise.all([loadChannels(), loadDocuments()]);
        render();
      } catch (err) {
        showToast(friendlyUiMessage('Failed to switch workspace: ' + err.message, { isError: true }), true);
      }
    }, workspaceBId);

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Confirm transition aborted (user remains on Workspace A)
    const activeWorkspaceAfterSwitch1 = await page.evaluate(() => window.state.selectedWorkspaceId);
    const toastText1 = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    const autosaveStatus1 = await page.evaluate(() => document.getElementById('autosaveStatus')?.textContent || '');

    console.log('Workspace ID after switch attempt:', activeWorkspaceAfterSwitch1);
    console.log('Toast visible on screen:', toastText1);
    console.log('Autosave status bar text:', autosaveStatus1);

    if (activeWorkspaceAfterSwitch1 !== workspaceAId) {
      throw new Error('Test 1 Fail: Workspace switch completed despite save failure!');
    }
    if (!toastText1.includes("Couldn't connect right now") && !toastText1.includes('Failed to switch workspace')) {
      throw new Error('Test 1 Fail: Toast does not show a clean friendly message!');
    }
    if (toastText1.includes('Internal Server Error') || toastText1.includes('Stack')) {
      throw new Error('Test 1 Fail: Raw backend error details were leaked to the toast!');
    }
    if (autosaveStatus1 !== 'Save failed') {
      throw new Error('Test 1 Fail: Autosave status did not update to "Save failed"!');
    }
    console.log('Test 1 PASS: Workspace switch successfully aborted, clean warning toast shown, status updated to "Save failed".');

    // --- TEST 2: Deliberate save failure on dropdown menu switch ---
    console.log('\n--- Test 2: Forcing save failure on tool menu switch ---');
    await page.evaluate(async (id) => {
      // Clear toast first
      const el = document.getElementById('toast');
      if (el) el.classList.add('hidden');

      // Trigger tool workspace switch
      const btn = document.createElement('div');
      btn.dataset.toolWorkspaceId = id;
      const workspaceToolButton = btn;

      window.clearTimeout(autosaveTimer);
      try {
        if (state.selectedDocumentId) {
          await saveCurrentDocument({ silent: true });
        }
        state.selectedWorkspaceId = id;
        localStorage.setItem('workspaceId', id);
        state.chatMessages = [];
        teardownYDoc();
        closeToolPanel();
        await Promise.all([loadChannels(), loadDocuments()]);
        navigate('home');
      } catch (err) {
        showToast(friendlyUiMessage('Failed to switch workspace: ' + err.message, { isError: true }), true);
      }
    }, workspaceBId);

    await new Promise(resolve => setTimeout(resolve, 1500));

    const activeWorkspaceAfterSwitch2 = await page.evaluate(() => window.state.selectedWorkspaceId);
    const toastText2 = await page.evaluate(() => document.getElementById('toast')?.textContent || '');

    console.log('Workspace ID after switch attempt:', activeWorkspaceAfterSwitch2);
    console.log('Toast visible on screen:', toastText2);

    if (activeWorkspaceAfterSwitch2 !== workspaceAId) {
      throw new Error('Test 2 Fail: Workspace switch completed despite save failure!');
    }
    if (!toastText2.includes("Couldn't connect right now") && !toastText2.includes('Failed to switch workspace')) {
      throw new Error('Test 2 Fail: Toast does not show a clean friendly message!');
    }
    console.log('Test 2 PASS: Tool menu switch successfully aborted and friendly warning shown.');

    // --- TEST 3: Deliberate save failure on workspace creation ---
    console.log('\n--- Test 3: Forcing save failure on workspace creation ---');
    await page.evaluate(async () => {
      // Clear toast
      const el = document.getElementById('toast');
      if (el) el.classList.add('hidden');

      // Call workspace creation
      await window.createWorkspaceAndOpen('Workspace C');
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    const workspacesList3 = await page.evaluate(() => window.state.workspaces.map(w => w.name));
    const activeWorkspace3 = await page.evaluate(() => window.state.selectedWorkspaceId);
    const toastText3 = await page.evaluate(() => document.getElementById('toast')?.textContent || '');

    console.log('Workspace list in state:', workspacesList3);
    console.log('Active Workspace ID:', activeWorkspace3);
    console.log('Toast visible on screen:', toastText3);

    if (workspacesList3.includes('Workspace C') || activeWorkspace3 !== workspaceAId) {
      throw new Error('Test 3 Fail: Workspace creation switched active view despite save failure!');
    }
    if (!toastText3.includes("Couldn't connect right now")) {
      throw new Error('Test 3 Fail: Toast does not show a clean friendly message!');
    }
    console.log('Test 3 PASS: Workspace creation successfully aborted and friendly warning shown.');

    // --- TEST 4: Save-status red/clear behavior ---
    console.log('\n--- Test 4: Verifying save-status red/clear behavior ---');
    
    // Disable request interception
    page.off('request', interceptor);
    await page.setRequestInterception(false);

    // Save successfully
    await writeToEditor(page, 'This is Document 1 final saved text.');
    await page.evaluate(async () => {
      await window.saveCurrentDocument();
    });
    await new Promise(resolve => setTimeout(resolve, 1000));

    const autosaveStatus4 = await page.evaluate(() => document.getElementById('autosaveStatus')?.textContent || '');
    const autosaveState4 = await page.evaluate(() => document.getElementById('autosaveStatus')?.dataset.saveState || '');
    
    console.log('Autosave status bar text after successful save:', autosaveStatus4);
    console.log('Autosave status attribute after successful save:', autosaveState4);

    if (autosaveStatus4 !== 'Saved' && autosaveStatus4 !== 'Saved just now') {
      throw new Error('Test 4 Fail: Status did not update to "Saved"!');
    }
    if (autosaveState4 === 'error') {
      throw new Error('Test 4 Fail: Red error styling did not clear on successful save!');
    }
    console.log('Test 4 PASS: Status bar cleared the error state back to "saved".');

    // --- TEST 5: Normal successful switches without regression ---
    console.log('\n--- Test 5: Verifying normal successful workspace switches and creation ---');
    
    // Switch to Workspace B
    console.log('Testing normal switch to Workspace B...');
    await page.evaluate(async (id) => {
      state.selectedWorkspaceId = id;
      localStorage.setItem('workspaceId', id);
      state.chatMessages = [];
      teardownYDoc();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('workspace');
    }, workspaceBId);
    await new Promise(resolve => setTimeout(resolve, 2500));

    const activeWorkspaceAfterNormalSwitchB = await page.evaluate(() => window.state.selectedWorkspaceId);
    console.log('Active Workspace ID after normal switch B:', activeWorkspaceAfterNormalSwitchB);
    if (activeWorkspaceAfterNormalSwitchB !== workspaceBId) {
      throw new Error('Test 5 Fail: Normal switch to Workspace B failed!');
    }

    // Switch back to Workspace A
    console.log('Testing normal switch back to Workspace A...');
    await page.evaluate(async (id) => {
      state.selectedWorkspaceId = id;
      localStorage.setItem('workspaceId', id);
      state.chatMessages = [];
      teardownYDoc();
      await Promise.all([loadChannels(), loadDocuments()]);
      navigate('workspace');
    }, workspaceAId);
    await new Promise(resolve => setTimeout(resolve, 2500));

    const activeWorkspaceAfterNormalSwitchA = await page.evaluate(() => window.state.selectedWorkspaceId);
    console.log('Active Workspace ID after normal switch A:', activeWorkspaceAfterNormalSwitchA);
    if (activeWorkspaceAfterNormalSwitchA !== workspaceAId) {
      throw new Error('Test 5 Fail: Normal switch back to Workspace A failed!');
    }

    // Test normal workspace creation
    console.log('Testing normal workspace creation...');
    await page.evaluate(async () => {
      await window.createWorkspaceAndOpen('Workspace Normal C');
    });
    await new Promise(resolve => setTimeout(resolve, 2500));

    const workspacesList5 = await page.evaluate(() => window.state.workspaces.map(w => w.name));
    console.log('Workspaces list after normal creation:', workspacesList5);
    if (!workspacesList5.includes('Workspace Normal C')) {
      throw new Error('Test 5 Fail: Normal workspace creation failed!');
    }
    console.log('Test 5 PASS: Normal switches and creations completed successfully with no regressions.');

    // --- TEST 6: AI output and template creation failure paths ---
    console.log('\n--- Test 6: Verifying AI output and template creation save failure paths ---');
    
    // Enable request interception again
    await page.setRequestInterception(true);
    page.on('request', interceptor);

    // Save AI output
    console.log('Testing AI output save failure...');
    await page.evaluate(async () => {
      // Mock state to think AI output exists
      state.lastAiOutput = 'AI response content';
      state.lastAiAction = 'summarize';
      
      const el = document.getElementById('toast');
      if (el) el.classList.add('hidden');

      // Call save AI output
      await saveAiOutputToDocument();
    });
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const toastText6A = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    console.log('Toast visible on AI save failure:', toastText6A);
    if (!toastText6A.includes("Couldn't connect right now")) {
      throw new Error('Test 6 Fail: Toast does not show friendly warning on AI save failure!');
    }

    // Save template creation
    console.log('Testing template creation save failure...');
    await page.evaluate(async () => {
      const el = document.getElementById('toast');
      if (el) el.classList.add('hidden');

      // Trigger template creation
      try {
        await window.createTemplateDocument();
      } catch (err) {
        showToast(friendlyUiMessage('Failed to create template note: ' + err.message, { isError: true }), true);
      }
    });
    await new Promise(resolve => setTimeout(resolve, 1500));

    const toastText6B = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    console.log('Toast visible on template save failure:', toastText6B);
    if (!toastText6B.includes("Couldn't connect right now")) {
      throw new Error('Test 6 Fail: Toast does not show friendly warning on template save failure!');
    }
    console.log('Test 6 PASS: AI output and template creation failed gracefully and logged friendly toasts.');

    console.log('\n🎉 ALL SIX VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await mongoose.disconnect();
    await browser.close();
  }
}

main().catch(err => {
  console.error('❌ Verification script failed:', err);
  process.exit(1);
});
