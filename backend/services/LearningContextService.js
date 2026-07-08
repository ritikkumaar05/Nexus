const {
  Document,
  DocumentMessage,
  DocumentTask,
  LearningMemory,
  StudyMaterial
} = require('../models');

const MAX_LIVE_TEXT = 8000;
const MAX_RELATED_TEXT = 900;
const MAX_CONTEXT_BLOCK = 12000;
const PRODUCT_CAPABILITY_NAME = 'Nexus Mentor';
const GENERIC_PHRASES = [
  'Interesting question',
  'As an AI',
  'I hope this helps',
  'Let me know if you have another question'
];
const MENTOR_POSTURE = [
  'quietly observe learning signals before answering',
  'guide without announcing that you are using memory',
  'continue the learner journey instead of restarting the conversation',
  'intervene only when it makes the learner more confident or better directed'
];

const CONCEPT_GRAPH = [
  ['Processes', 'Threads'],
  ['Scheduling', 'Context Switching'],
  ['Deadlocks', 'Synchronization'],
  ['Normalization', 'Functional Dependencies'],
  ['Trees', 'Graphs'],
  ['Recursion', 'Stack'],
  ['Paging', 'Virtual Memory'],
  ['Segmentation', 'Memory Management'],
  ['CPU Scheduling', 'Process Scheduling'],
  ['Semaphores', 'Mutexes'],
  ['Transactions', 'ACID'],
  ['Indexes', 'Query Optimization']
];

const compact = (value = '', maxLength = 1000) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const listLines = (items, formatter) => items.map(formatter).filter(Boolean).join('\n');

const daysBetween = (date, now = new Date()) => {
  const value = new Date(date).getTime();
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.floor((now.getTime() - value) / 86_400_000));
};

const relativeTime = (date) => {
  const days = daysBetween(date);
  if (days === null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${Math.floor(days / 7)} weeks ago`;
};

const conceptHaystack = (...values) => values
  .flat()
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const conceptConnections = ({ document, relatedDocs = [], materials = [], tasks = [], doubts = [], memories = [], text = '' }) => {
  const haystack = conceptHaystack(
    text,
    document?.title,
    document?.plainTextContent,
    relatedDocs.map((doc) => `${doc.title} ${doc.plainTextContent}`),
    materials.map((material) => material.title),
    tasks.map((task) => task.title),
    doubts.map((doubt) => `${doubt.body} ${doubt.linkedText}`),
    memories.map((memory) => `${memory.title} ${memory.summary} ${(memory.concepts || []).join(' ')}`)
  );

  return CONCEPT_GRAPH
    .filter(([left, right]) => haystack.includes(left.toLowerCase()) || haystack.includes(right.toLowerCase()))
    .slice(0, 5)
    .map(([left, right]) => `${left} <-> ${right}`);
};

const inferLearningStyle = ({ action, instructions = '', materials = [], memories = [] }) => {
  const signals = new Set();
  const lower = `${action || ''} ${instructions || ''}`.toLowerCase();

  if (/quiz|important|exam|question|test/.test(lower)) signals.add('exam-focused');
  if (/flashcard|active.?recall/.test(lower)) signals.add('active recall');
  if (/simple|analogy|example|like.*10|real.life/.test(lower)) signals.add('simple examples and analogies');
  if (/summary|brief|short|quick|concise/.test(lower)) signals.add('concise structured answers');
  if (/detail|deep|thorough|why/.test(lower)) signals.add('detailed explanations');
  if (/diagram|visual|flow|table/.test(lower)) signals.add('visual structure');

  materials.forEach((material) => {
    if (material.type === 'quiz' || material.type === 'important_questions') signals.add('exam-focused');
    if (material.type === 'flashcards') signals.add('active recall');
    if (material.type === 'explanation') signals.add('simple examples and analogies');
  });

  memories
    .filter((memory) => memory.kind === 'preference')
    .forEach((memory) => signals.add(compact(memory.title || memory.summary, 80)));

  return [...signals].slice(0, 5);
};

const learningTimeline = ({ document, materials = [], tasks = [], doubts = [], memories = [] }) => {
  const entries = [];
  if (document?.updatedAt) entries.push(`Current document last changed ${relativeTime(document.updatedAt)}`);
  materials.slice(0, 3).forEach((material) => {
    if (material.updatedAt) entries.push(`${material.type} "${compact(material.title, 80)}" updated ${relativeTime(material.updatedAt)}`);
  });
  tasks.filter((task) => task.status !== 'done').slice(0, 3).forEach((task) => {
    entries.push(`Unfinished task: ${compact(task.title, 90)}${task.dueDate ? ` due ${relativeTime(task.dueDate)}` : ''}`);
  });
  doubts.filter((doubt) => doubt.status === 'open').slice(0, 3).forEach((doubt) => {
    entries.push(`Open doubt: ${compact(doubt.body, 100)}`);
  });
  memories.slice(0, 4).forEach((memory) => {
    if (memory.lastSeenAt) entries.push(`${memory.kind} "${compact(memory.title || memory.summary, 80)}" seen ${relativeTime(memory.lastSeenAt)}`);
  });
  return entries.filter(Boolean).slice(0, 8);
};

const materialSummary = (material) => {
  const title = compact(material.title || material.type, 120);
  const progress = material.type === 'quiz' && material.quizProgress?.attempts
    ? ` score=${material.quizProgress.lastScore ?? 'n/a'} weak=${(material.quizProgress.weakTopics || []).join(', ') || 'none'}`
    : material.type === 'flashcards' && (material.flashcardProgress?.knownCount || material.flashcardProgress?.hardCount)
      ? ` known=${material.flashcardProgress.knownCount || 0} hard=${material.flashcardProgress.hardCount || 0}`
      : '';
  return `- ${material.type}: ${title}${progress}`;
};

class LearningContextService {
  async buildDocumentContext({ userId, workspaceId, documentId, action, text, instructions }) {
    try {
      const [document, relatedDocs, materials, tasks, doubts, memories] = await Promise.all([
        Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null })
          .select('title plainTextContent updatedAt')
          .lean(),
        Document.find({ workspace: workspaceId, _id: { $ne: documentId }, deletedAt: null })
          .select('title plainTextContent updatedAt')
          .sort({ updatedAt: -1 })
          .limit(4)
          .lean(),
        StudyMaterial.find({ workspace: workspaceId, document: documentId })
          .select('type title quizProgress flashcardProgress updatedAt')
          .sort({ updatedAt: -1 })
          .limit(8)
          .lean(),
        DocumentTask.find({ workspace: workspaceId, document: documentId })
          .select('title status priority dueDate updatedAt')
          .sort({ status: 1, dueDate: 1, updatedAt: -1 })
          .limit(8)
          .lean(),
        DocumentMessage.find({ workspace: workspaceId, document: documentId, parentMessage: null, deletedAt: null })
          .select('body linkedText status updatedAt')
          .sort({ status: 1, updatedAt: -1 })
          .limit(6)
          .lean(),
        LearningMemory.find({
          user: userId,
          workspace: workspaceId,
          $or: [{ document: documentId }, { document: null }]
        })
          .select('kind title summary concepts confidence evidenceCount lastSeenAt')
          .sort({ lastSeenAt: -1 })
          .limit(12)
          .lean()
      ]);

      return this.composePromptContext({
        document,
        relatedDocs,
        materials,
        tasks,
        doubts,
        memories,
        action,
        text,
        instructions
      });
    } catch (error) {
      console.warn(`Learning context fallback used: ${error.message}`);
      return '';
    }
  }

  async buildWorkspaceChatContext({ userId, workspaceId }) {
    try {
      const memories = await LearningMemory.find({ user: userId, workspace: workspaceId })
        .select('kind title summary concepts confidence evidenceCount lastSeenAt')
        .sort({ lastSeenAt: -1 })
        .limit(12)
        .lean();

      if (!memories.length) return '';
      return this.memoryBlock(memories);
    } catch (error) {
      console.warn(`Workspace learning context fallback used: ${error.message}`);
      return '';
    }
  }

  composePromptContext({ document, relatedDocs = [], materials = [], tasks = [], doubts = [], memories = [], action, text, instructions }) {
    const styleSignals = inferLearningStyle({ action, instructions, materials, memories });
    const connections = conceptConnections({ document, relatedDocs, materials, tasks, doubts, memories, text });
    const timeline = learningTimeline({ document, materials, tasks, doubts, memories });

    const sections = [
      '--- NEXUS LEARNING CONTEXT ---',
      `Capability: ${PRODUCT_CAPABILITY_NAME}. Use this context to mentor the learner, not to announce memory features.`,
      `Mentor posture: ${MENTOR_POSTURE.join('; ')}.`,
      'Use this context to adapt the response. Do not expose internal memory mechanics to the user.',
      `Requested action: ${compact(action, 80)}`,
      instructions ? `User instructions: ${compact(instructions, 500)}` : '',
      document ? `Current document: ${compact(document.title || 'Untitled Page', 140)}` : '',
      timeline.length ? `Learning timeline:\n${listLines(timeline, (entry) => `- ${entry}`)}` : '',
      connections.length ? `Relevant concept relationships:\n${listLines(connections, (entry) => `- ${entry}`)}` : '',
      styleSignals.length ? `Inferred learning style:\n${listLines(styleSignals, (entry) => `- ${entry}`)}` : '',
      document?.plainTextContent ? `Current document excerpt:\n${compact(document.plainTextContent, MAX_LIVE_TEXT)}` : '',
      text ? `Active source excerpt:\n${compact(text, MAX_LIVE_TEXT)}` : '',
      relatedDocs.length ? `Related workspace documents:\n${listLines(relatedDocs, (doc) => `- ${compact(doc.title || 'Untitled Page', 120)}: ${compact(doc.plainTextContent, MAX_RELATED_TEXT)}`)}` : '',
      materials.length ? `Saved study material:\n${listLines(materials, materialSummary)}` : '',
      tasks.length ? `Study tasks:\n${listLines(tasks, (task) => `- [${task.status}] ${compact(task.title, 140)} (${task.priority || 'medium'})`)}` : '',
      doubts.length ? `Document doubts:\n${listLines(doubts, (doubt) => `- [${doubt.status}] ${compact(doubt.body, 220)}${doubt.linkedText ? ` | context: ${compact(doubt.linkedText, 220)}` : ''}`)}` : '',
      memories.length ? this.memoryBlock(memories) : '',
      '--- END NEXUS LEARNING CONTEXT ---'
    ].filter(Boolean);

    return compact(sections.join('\n\n'), MAX_CONTEXT_BLOCK);
  }

  memoryBlock(memories = []) {
    return `Persistent learning memory:\n${listLines(memories, (memory) => {
      const concepts = (memory.concepts || []).slice(0, 6).join(', ');
      const confidence = memory.confidence !== undefined ? ` confidence=${Math.round(memory.confidence * 100)}%` : '';
      const evidence = memory.evidenceCount ? ` evidence=${memory.evidenceCount}` : '';
      return `- ${memory.kind}: ${compact(memory.title || memory.summary, 120)}${concepts ? ` | concepts: ${concepts}` : ''}${confidence}${evidence}`;
    })}`;
  }

  composeSystemPrompt(basePrompt, contextBlock) {
    return `${basePrompt}

${contextBlock || `--- NEXUS LEARNING CONTEXT ---\nCapability: ${PRODUCT_CAPABILITY_NAME}. No durable learning context was found for this request.\n--- END NEXUS LEARNING CONTEXT ---`}

Private mentor reasoning before answering:
- What is the learner studying right now?
- What have they already learned or generated?
- Which prerequisite or related concepts would make this easier?
- What mistakes, weak topics, or unfinished tasks matter here?
- Which explanation style should this learner receive?
- Is there a natural continuation from a recent session?
- Should I quietly guide, or simply answer because guidance would be noise?

Response behavior:
- Be ${PRODUCT_CAPABILITY_NAME}: guide like a learning mentor, not a generic chatbot.
- Think silently; never reveal this checklist or narrate internal reasoning.
- Observe quietly: use learning signals as judgment, not as something to show off.
- Continue the learning journey when there is a real thread to continue; otherwise answer directly.
- Reference previous learning only when it improves understanding; never force memory into the answer.
- Connect concepts naturally instead of explaining them in isolation.
- Adapt to inferred style without repeatedly asking the learner.
- Give occasional next-step guidance only when relevant and useful.
- Prefer grounded, specific guidance over generic encouragement.
- Increase confidence: make the learner know what they understand, what to study next, and what remains unclear.
- Keep the requested output format exactly as specified.
- Use only compact references to learning continuity; never say you remember private raw chats.
- Do not use these generic phrases: ${GENERIC_PHRASES.join('; ')}.`;
  }
}

module.exports = new LearningContextService();
module.exports.compact = compact;
module.exports.conceptConnections = conceptConnections;
module.exports.inferLearningStyle = inferLearningStyle;
module.exports.MENTOR_POSTURE = MENTOR_POSTURE;
