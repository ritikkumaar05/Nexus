import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Setup mock browser environment before imports
global.location = {
  hash: '#/home'
};
global.window = {
  setTimeout: (fn, delay) => setTimeout(fn, delay),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener: () => {},
  matchMedia: () => ({ matches: false })
};
global.document = {
  startViewTransition: null
};
global.localStorage = {
  _store: {},
  getItem(key) { return this._store[key] || null; },
  setItem(key, value) { this._store[key] = String(value); },
  removeItem(key) { delete this._store[key]; }
};
global.sessionStorage = {
  _store: {},
  getItem(key) { return this._store[key] || null; },
  setItem(key, value) { this._store[key] = String(value); },
  removeItem(key) { delete this._store[key]; }
};
global.performance = {
  now: () => Date.now()
};

// Mock DOM elements and editor state
let editorText = '';
let editorHtml = '';
let titleInputVal = 'Untitled lecture';

const mockEls = {
  documentTitleInput: {
    get value() { return titleInputVal; },
    set value(v) { titleInputVal = v; }
  }
};

// Database mock representing our document persistence
const mockDb = {
  'doc-a': { _id: 'doc-a', title: 'Doc A', plainTextContent: 'Initial A', contentHtml: '' },
  'doc-b': { _id: 'doc-b', title: 'Doc B', plainTextContent: 'Initial B', contentHtml: '' }
};

const mockShell = {
  setCollabStatus: () => {},
  showToast: () => {},
  renderWorkspace: () => {},
  renderHomePage: () => {},
  recordDocumentOpenMeasure: () => {},
  resolveStartupSurface: () => {}
};

// Mock appRuntime
const runtime = {
  config: {
    Y_TEXT_KEY: 'content'
  },
  shell: mockShell,
  els: mockEls,
  getEditorText: () => editorText,
  getEditorHtml: () => editorHtml,
  setEditorText: (t) => { editorText = t; },
  setEditorHtml: (h, t) => { editorHtml = h; editorText = t; },
  setLoading: () => {},
  setError: () => {},
  showToast: () => {},
  setAutosaveStatus: (status) => {
    // console.log('[Autosave Status UI Change]:', status);
  },
  recordDocumentOpenMeasure: () => {},
  finishDocumentOpenProfile: () => {},
  getActiveDocumentOpenProfile: () => null,
  startDocumentOpenProfile: () => {},
  renderDocuments: () => {},
  renderEditor: () => {},
  render: () => {},
  selectedDocumentTasks: () => [],
  refreshLectureProgress: () => {},
  refreshDocumentTitleChrome: () => {},
  markLectureMilestone: () => {},
  resetTaskStore: () => {},
  renderAiEmptyState: () => {},
  updateActiveDocumentSelection: () => {},
  ensureActiveContextData: () => {},
  scheduleDashboardDataLoad: () => {},
  setCollabStatus: () => {},
  presence: {
    renderPresence: () => {}
  },
  isDocumentDirty: () => {
    return dataOps.isDocumentDirty();
  },
  // Request mock
  request: async (url, options) => {
    const docMatch = url.match(/\/api\/documents\/([a-z0-9-]+)$/);
    if (docMatch) {
      const docId = docMatch[1];
      if (options && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        
        // Simulate network latency of 30ms
        await new Promise(resolve => setTimeout(resolve, 30));
        
        mockDb[docId].plainTextContent = body.plainTextContent;
        mockDb[docId].title = body.title;
        mockDb[docId].contentHtml = body.contentHtml;
        return { ...mockDb[docId] };
      } else {
        // GET
        // Simulate network latency of 30ms
        await new Promise(resolve => setTimeout(resolve, 30));
        return { ...mockDb[docId] };
      }
    }
    throw new Error('Unknown API path: ' + url);
  }
};

// 2. Import state and operations
const { state } = await import('../frontend/state/store.js');
const dataOps = await import('../frontend/services/dataOperations.js');
dataOps.configureDataRuntime(runtime);

const socketOps = await import('../frontend/services/socket.js');
socketOps.configureSocketRuntime(runtime);

// Helper to simulate user typing
function typeText(newText) {
  editorText = newText;
  dataOps.scheduleAutosave();
}

async function runTestCase(runId) {
  console.log(`Running Concurrency Test Case #${runId}...`);
  
  // Reset DB values
  mockDb['doc-a'].plainTextContent = 'Initial A';
  mockDb['doc-b'].plainTextContent = 'Initial B';
  
  // Set initial selected document to doc-a
  state.selectedDocumentId = 'doc-a';
  state.lastSavedText = 'Initial A';
  state.lastSavedTitle = 'Doc A';
  editorText = 'Initial A';
  titleInputVal = 'Doc A';
  
  // Step 1: User types text into doc-a
  typeText('Initial A - Hello');
  
  // Step 2: Autosave fires (simulate save in-flight)
  const savePromise = dataOps.saveCurrentDocument({ silent: true });
  
  // Step 3: While save is in flight, user types more text into doc-a
  typeText('Initial A - Hello World!');
  
  // Step 4: User immediately clicks to switch to doc-b
  // We call dataOps.loadDocument('doc-b') which must block until doc-a is saved.
  console.log('Switching to doc-b...');
  await dataOps.loadDocument('doc-b');
  
  // Verify state
  console.log('Selected document is now:', state.selectedDocumentId);
  console.log('Final text in DB for doc-a:', mockDb['doc-a'].plainTextContent);
  console.log('Final text in DB for doc-b:', mockDb['doc-b'].plainTextContent);
  
  // Assertions:
  // 1. Selected document must be doc-b
  assert.strictEqual(state.selectedDocumentId, 'doc-b');
  // 2. Final text for doc-a in the DB MUST be the latest typed text ('Initial A - Hello World!')
  assert.strictEqual(mockDb['doc-a'].plainTextContent, 'Initial A - Hello World!');
  
  console.log(`Test Case #${runId} PASSED!\n`);
}

async function main() {
  try {
    for (let i = 1; i <= 10; i++) {
      await runTestCase(i);
    }
    console.log('🎉 ALL 10 CONCURRENCY RUNS PASSED SUCCESSFULLY! NO DATA LOSS DETECTED.');
    process.exit(0);
  } catch (err) {
    console.error('❌ CONCURRENCY TEST FAILED:', err);
    process.exit(1);
  }
}

main();
