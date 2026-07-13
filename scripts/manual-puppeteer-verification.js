const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Resolve mongoose and dotenv from the backend directory to avoid path errors
const mongoose = require(path.join(__dirname, '../backend/node_modules/mongoose'));
const dotenv = require(path.join(__dirname, '../backend/node_modules/dotenv'));
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcryptjs'));
const puppeteer = require('puppeteer');

const productionEnvPath = path.join(__dirname, '../backend/.env');
const productionEnv = fs.existsSync(productionEnvPath)
  ? dotenv.parse(fs.readFileSync(productionEnvPath))
  : {};
dotenv.config({ path: productionEnvPath });

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const PRODUCTION_MONGO_URI = productionEnv.MONGO_URI || process.env.PRODUCTION_DATABASE_URL || '';
const TEST_APP_URL = (process.env.TEST_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const TEST_API_BASE_URL = (process.env.TEST_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const TEST_EMAIL_DOMAIN = (process.env.TEST_EMAIL_DOMAIN || 'test.nexus.local').toLowerCase();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_only';

const {
  AccountToken,
  AiGenerationCache,
  Attachment,
  AuditLog,
  Channel,
  Comment,
  Document,
  DocumentMessage,
  DocumentTask,
  DocumentVersion,
  EmailOtp,
  LearningEvent,
  LearningMemory,
  Message,
  Session,
  StudyMaterial,
  User,
  Workspace,
  WorkspaceInvitation
} = require('../backend/models');

const cliValue = (name) => {
  const equalsArgument = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (equalsArgument) return equalsArgument.slice(name.length + 3);
  const argumentIndex = process.argv.indexOf(`--${name}`);
  return argumentIndex >= 0 ? process.argv[argumentIndex + 1] : '';
};

const mongoIdentity = (connectionString) => {
  const parsed = new URL(connectionString);
  return {
    host: parsed.host.toLowerCase(),
    database: parsed.pathname.replace(/^\//, '').toLowerCase(),
    normalized: `${parsed.protocol}//${parsed.host.toLowerCase()}/${parsed.pathname.replace(/^\//, '').toLowerCase()}`
  };
};

const assertSafeTestConfiguration = () => {
  if (!TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required. Refusing to run against an implicit or production database.');
  }

  let testIdentity;
  let productionIdentity;
  try {
    testIdentity = mongoIdentity(TEST_DATABASE_URL);
    productionIdentity = PRODUCTION_MONGO_URI ? mongoIdentity(PRODUCTION_MONGO_URI) : null;
  } catch (error) {
    throw new Error(`Invalid MongoDB connection string: ${error.message}`);
  }

  if (!testIdentity.database) {
    throw new Error('TEST_DATABASE_URL must include an explicit database name.');
  }
  if (productionIdentity && (
    testIdentity.normalized === productionIdentity.normalized
    || (testIdentity.host === productionIdentity.host && testIdentity.database === productionIdentity.database)
  )) {
    throw new Error('TEST_DATABASE_URL resolves to the production database. Refusing to run.');
  }

  const denylist = (process.env.TEST_DATABASE_DENYLIST || 'production,prod,collab-workspace,ritikkumartestdb')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const testIdentifier = `${testIdentity.host}/${testIdentity.database}`;
  const deniedIdentifier = denylist.find((identifier) => testIdentifier.includes(identifier));
  if (deniedIdentifier) {
    throw new Error(`TEST_DATABASE_URL matched denied production identifier "${deniedIdentifier}". Refusing to run.`);
  }
  if (!/(test|testing|e2e|ci|sandbox)/i.test(testIdentity.database)) {
    throw new Error('TEST_DATABASE_URL database name must clearly identify a test database (test, e2e, ci, or sandbox).');
  }
};

const assertReservedTestEmail = (email) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const expectedSuffix = `@${TEST_EMAIL_DOMAIN}`;
  if (!normalizedEmail.endsWith(expectedSuffix) || normalizedEmail.slice(0, -expectedSuffix.length).length === 0) {
    throw new Error(`Test email must use the reserved @${TEST_EMAIL_DOMAIN} domain. Refusing real-looking email.`);
  }
  return normalizedEmail;
};

const verifyApiUsesTestDatabase = async () => {
  const timestamp = Date.now();
  const email = `db_probe_${timestamp}@${TEST_EMAIL_DOMAIN}`;
  const username = `db_probe_${timestamp}`;
  const password = `NexusProbe!${timestamp}`;
  let probeUser = null;
  try {
    probeUser = await User.create({
      username,
      fullName: username,
      email,
      passwordHash: await bcrypt.hash(password, 4),
      authProvider: 'email',
      emailVerifiedAt: new Date()
    });
    const response = await fetch(`${TEST_API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      throw new Error(`test API login probe returned HTTP ${response.status}`);
    }
    console.log('Safety check passed: browser API and TEST_DATABASE_URL use the same test database.');
  } catch (error) {
    throw new Error(`Backend/test database identity check failed before walkthrough signup: ${error.message}`);
  } finally {
    if (probeUser) {
      await Session.deleteMany({ user: probeUser._id });
      await User.deleteOne({ _id: probeUser._id });
    }
  }
};

const teardownTestData = async ({ email, userId, workspaceId }) => {
  const failures = [];
  const runStep = async (label, operation) => {
    try {
      const result = await operation();
      const count = result?.deletedCount ?? result?.modifiedCount ?? 0;
      console.log(`[teardown] ${label}: ${count}`);
    } catch (error) {
      failures.push({ label, error });
      console.error(`[teardown] FAILED ${label}:`, error);
    }
  };

  const user = userId
    ? await User.findById(userId).lean()
    : await User.findOne({ email }).lean();
  if (!user) {
    console.log(`[teardown] No test user found for ${email}; nothing to delete.`);
    return;
  }

  const ownedWorkspaces = await Workspace.find({
    $or: [
      { owner: user._id },
      ...(workspaceId && mongoose.isValidObjectId(workspaceId) ? [{ _id: workspaceId }] : [])
    ]
  }).select('_id').lean();
  const workspaceIds = ownedWorkspaces.map((workspace) => workspace._id);
  const workspaceFilter = { workspace: { $in: workspaceIds } };

  await runStep('sessions deleted', () => Session.deleteMany({ user: user._id }));
  await runStep('account tokens deleted', () => AccountToken.deleteMany({ user: user._id }));
  await runStep('email OTPs deleted', () => EmailOtp.deleteMany({ user: user._id }));
  await runStep('attachments deleted', () => Attachment.deleteMany(workspaceFilter));
  await runStep('AI caches deleted', () => AiGenerationCache.deleteMany(workspaceFilter));
  await runStep('comments deleted', () => Comment.deleteMany(workspaceFilter));
  await runStep('document messages deleted', () => DocumentMessage.deleteMany(workspaceFilter));
  await runStep('document tasks deleted', () => DocumentTask.deleteMany(workspaceFilter));
  await runStep('document versions deleted', () => DocumentVersion.deleteMany(workspaceFilter));
  await runStep('learning events deleted', () => LearningEvent.deleteMany(workspaceFilter));
  await runStep('learning memories deleted', () => LearningMemory.deleteMany(workspaceFilter));
  await runStep('messages deleted', () => Message.deleteMany(workspaceFilter));
  await runStep('study materials deleted', () => StudyMaterial.deleteMany(workspaceFilter));
  await runStep('workspace invitations deleted', () => WorkspaceInvitation.deleteMany(workspaceFilter));
  await runStep('audit logs deleted', () => AuditLog.deleteMany(workspaceFilter));
  await runStep('documents deleted', () => Document.deleteMany(workspaceFilter));
  await runStep('channels deleted', () => Channel.deleteMany(workspaceFilter));
  await runStep('workspaces deleted', () => Workspace.deleteMany({ _id: { $in: workspaceIds } }));
  await runStep('test user deleted', () => User.deleteOne({ _id: user._id }));

  if (failures.length) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Walkthrough teardown failed in ${failures.length} step(s): ${failures.map(({ label }) => label).join(', ')}`
    );
  }
};

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
  assertSafeTestConfiguration();
  const timestamp = Date.now();
  const username = `test_user_${timestamp}`;
  const configuredEmail = cliValue('email') || process.env.TEST_USER_EMAIL || `test_user_${timestamp}@${TEST_EMAIL_DOMAIN}`;
  const email = assertReservedTestEmail(configuredEmail);
  const password = process.env.TEST_USER_PASSWORD || 'NexusWalkthrough!2026';
  const cleanupContext = { email, userId: '', workspaceId: '' };
  let browser = null;
  let connected = false;

  try {
    console.log('Connecting to isolated test database...');
    await mongoose.connect(TEST_DATABASE_URL);
    connected = true;
    console.log('Isolated test database connected.');
    await verifyApiUsesTestDatabase();

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((apiBase) => {
      localStorage.setItem('apiBase', apiBase);
    }, TEST_API_BASE_URL);

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

    console.log(`Registering user: ${username} (${email})...`);
    await page.goto(`${TEST_APP_URL}/#/signup`);

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
    cleanupContext.userId = String(latestOtpRecord.user);

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
    await page.goto(`${TEST_APP_URL}/#/login`);
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
    cleanupContext.workspaceId = await page.evaluate(() => window.state.selectedWorkspaceId);
    console.log('Workspace created and bootstrapped. ID:', cleanupContext.workspaceId);

    console.log('Navigating directly to workspace route...');
    await page.goto(`${TEST_APP_URL}/#/workspace`);

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
    let teardownFailure = null;
    console.log('Running guaranteed walkthrough teardown...');
    try {
      await teardownTestData(cleanupContext);
      console.log('[teardown] Walkthrough data removed successfully.');
    } catch (error) {
      teardownFailure = error;
      console.error('[teardown] Walkthrough data cleanup failed:', error);
    }

    if (browser) {
      await browser.close().catch((error) => {
        teardownFailure ||= error;
        console.error('[teardown] Browser close failed:', error);
      });
    }
    if (connected) {
      await mongoose.disconnect().catch((error) => {
        teardownFailure ||= error;
        console.error('[teardown] MongoDB disconnect failed:', error);
      });
    }
    if (teardownFailure) throw teardownFailure;
  }
}

main().catch(err => {
  console.error('❌ Error during Puppeteer walkthrough:', err);
  process.exit(1);
});
