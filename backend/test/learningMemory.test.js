const test = require('node:test');
const assert = require('node:assert/strict');
const AiGenerationCacheService = require('../services/AiGenerationCacheService');
const LearningContextBuilder = require('../services/LearningContextBuilder');
const LearningContextService = require('../services/LearningContextService');
const LearningMemoryService = require('../services/LearningMemoryService');

test('extractConcepts distills repeated learning terms without raw filler words', () => {
  const concepts = LearningMemoryService.extractConcepts(
    'Explain deadlocks, circular wait, and resource allocation graphs',
    'Deadlocks happen when circular wait and hold-and-wait conditions persist.'
  );

  assert.ok(concepts.includes('Deadlocks') || concepts.includes('deadlocks'));
  assert.ok(concepts.some((concept) => concept.toLowerCase() === 'circular'));
  assert.equal(concepts.some((concept) => concept.toLowerCase() === 'explain'), false);
});

test('memoryKey creates stable bounded keys for upserted memories', () => {
  const key = LearningMemoryService.memoryKey('Weak Topic', 'Circular Wait   Condition', 'Quiz');

  assert.equal(key, 'weak-topic:circular-wait-condition:quiz');
  assert.ok(key.length <= 180);
});

test('LearningContextService composes live, session, and persistent learning context', () => {
  const context = LearningContextService.composePromptContext({
    action: 'quiz',
    text: 'Circular wait is one of the Coffman deadlock conditions.',
    document: {
      title: 'Lecture 5: Deadlocks',
      plainTextContent: 'Deadlock requires mutual exclusion, hold and wait, no preemption, and circular wait.'
    },
    relatedDocs: [
      { title: 'Lecture 4: CPU Scheduling', plainTextContent: 'Scheduling decides which ready process runs next.' }
    ],
    materials: [
      { type: 'quiz', title: 'Deadlock Quiz', quizProgress: { attempts: 1, lastScore: 60, weakTopics: ['Banker algorithm'] } }
    ],
    tasks: [
      { title: 'Revise Banker algorithm', status: 'todo', priority: 'high' }
    ],
    doubts: [
      { body: 'Why does circular wait matter?', status: 'open', linkedText: 'Circular wait condition' }
    ],
    memories: [
      { kind: 'weakness', title: 'Banker algorithm', concepts: ['Deadlock'], confidence: 0.8, evidenceCount: 2 }
    ]
  });

  assert.match(context, /NEXUS LEARNING CONTEXT/);
  assert.match(context, /Current document: Lecture 5: Deadlocks/);
  assert.match(context, /Saved study material/);
  assert.match(context, /Document doubts/);
  assert.match(context, /Persistent learning memory/);
  assert.match(context, /Banker algorithm/);
});

test('composeSystemPrompt preserves the requested output contract while adding learning behavior', () => {
  const prompt = LearningContextService.composeSystemPrompt('Return exactly 10 questions.', 'Persistent learning memory:\n- weakness: Graphs');

  assert.match(prompt, /^Return exactly 10 questions\./);
  assert.match(prompt, /Persistent learning memory/);
  assert.match(prompt, /Keep the requested output format exactly as specified/);
  assert.match(prompt, /Private mentor reasoning before answering/);
  assert.match(prompt, /Think silently/);
  assert.match(prompt, /Observe quietly/);
  assert.match(prompt, /Do not use these generic phrases/);
});

test('composePromptContext encodes quiet mentor posture without adding UI concepts', () => {
  const context = LearningContextService.composePromptContext({
    action: 'explain',
    document: { title: 'Memory Management', plainTextContent: 'Paging and virtual memory notes.' }
  });

  assert.match(context, /Mentor posture/);
  assert.match(context, /quietly observe learning signals/);
  assert.match(context, /guide without announcing/);
});

test('LearningContextService surfaces concept relationships without changing UI contracts', () => {
  const connections = LearningContextService.conceptConnections({
    text: 'Deadlocks are easier after understanding synchronization and semaphores.',
    document: { title: 'Operating Systems' }
  });

  assert.ok(connections.some((connection) => connection === 'Deadlocks <-> Synchronization'));
});

test('LearningContextService infers learning style from actions and saved materials', () => {
  const style = LearningContextService.inferLearningStyle({
    action: 'quiz',
    instructions: 'make this brief with examples',
    materials: [{ type: 'flashcards', title: 'OS Flashcards' }],
    memories: [{ kind: 'preference', title: 'visual structure' }]
  });

  assert.ok(style.includes('exam-focused'));
  assert.ok(style.includes('active recall'));
  assert.ok(style.includes('concise structured answers'));
  assert.ok(style.includes('simple examples and analogies'));
});

test('composeSystemPrompt applies mentor behavior even without stored context', () => {
  const prompt = LearningContextService.composeSystemPrompt('Answer naturally.');

  assert.match(prompt, /Capability: Nexus Mentor/);
  assert.match(prompt, /No durable learning context was found/);
  assert.match(prompt, /What is the learner studying right now/);
});

test('LearningMemoryService infers durable preferences from repeated study behavior', () => {
  const preferences = LearningMemoryService.inferPreferences({
    action: 'generate-quiz',
    instructions: 'brief exam style questions with examples'
  });

  assert.ok(preferences.some((preference) => preference.key === 'exam-focused'));
  assert.ok(preferences.some((preference) => preference.key === 'concise-structured'));
  assert.ok(preferences.some((preference) => preference.key === 'simple-examples'));
});

test('LearningContextBuilder chunks long lecture text without dropping content order', () => {
  const lecture = Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}: ${'memory '.repeat(40)}`).join('\n\n');
  const chunks = LearningContextBuilder.chunkText(lecture);

  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].index, 1);
  assert.ok(chunks[0].text.includes('Paragraph 1'));
  assert.ok(chunks.at(-1).text.includes('Paragraph 80'));
});

test('LearningContextBuilder extracts selected paragraph neighbours', () => {
  const text = [
    'Heading',
    '',
    'Previous paragraph about processes.',
    '',
    'Selected paragraph about threads and scheduling.',
    '',
    'Next paragraph about context switching.'
  ].join('\n');
  const windowText = LearningContextBuilder.findSelectedParagraphWindow(text, 'Selected paragraph about threads and scheduling.');

  assert.match(windowText, /Previous paragraph/);
  assert.match(windowText, /Selected paragraph/);
  assert.match(windowText, /Next paragraph/);
});

test('AiGenerationCacheService builds stable keys for unchanged document AI requests', () => {
  const payload = {
    userId: '507f1f77bcf86cd799439011',
    workspaceId: '507f1f77bcf86cd799439012',
    documentId: '507f1f77bcf86cd799439013',
    action: 'summarize',
    selectedText: '',
    instructions: '',
    documentUpdatedAt: '2026-07-07T10:00:00.000Z'
  };

  assert.equal(
    AiGenerationCacheService.buildKey(payload),
    AiGenerationCacheService.buildKey({ ...payload })
  );
});

test('AiGenerationCacheService invalidates cache key when document freshness changes', () => {
  const base = {
    userId: '507f1f77bcf86cd799439011',
    workspaceId: '507f1f77bcf86cd799439012',
    documentId: '507f1f77bcf86cd799439013',
    action: 'quiz',
    documentUpdatedAt: '2026-07-07T10:00:00.000Z'
  };

  assert.notEqual(
    AiGenerationCacheService.buildKey(base),
    AiGenerationCacheService.buildKey({ ...base, documentUpdatedAt: '2026-07-07T10:01:00.000Z' })
  );
});
