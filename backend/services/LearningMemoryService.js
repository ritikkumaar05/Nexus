const { LearningEvent, LearningMemory } = require('../models');

const MAX_SUMMARY_LENGTH = 900;
const MAX_CONCEPTS = 12;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'between',
  'could', 'document', 'explain', 'from', 'have', 'into', 'learn', 'notes',
  'question', 'should', 'study', 'that', 'their', 'there', 'these', 'thing',
  'this', 'topic', 'using', 'what', 'when', 'where', 'which', 'while', 'with',
  'would', 'your'
]);

const compact = (value = '', maxLength = MAX_SUMMARY_LENGTH) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const cleanConcept = (value = '') => compact(value, 80).replace(/[^\w\s.+#-]/g, '').trim();

const extractConcepts = (...values) => {
  const counts = new Map();
  values
    .filter(Boolean)
    .join(' ')
    .match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g)
    ?.forEach((token) => {
      const cleaned = cleanConcept(token);
      const key = cleaned.toLowerCase();
      if (!key || STOP_WORDS.has(key) || key.length < 3 || /^\d+$/.test(key)) return;
      counts.set(key, { label: cleaned, count: (counts.get(key)?.count || 0) + 1 });
    });

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_CONCEPTS)
    .map((item) => item.label);
};

const memoryKey = (...parts) => parts
  .filter((part) => part !== undefined && part !== null && String(part).trim())
  .map((part) => String(part).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80))
  .join(':')
  .slice(0, 180);

const safeMetadata = (metadata = {}) => JSON.parse(JSON.stringify(metadata || {}));

const inferPreferences = ({ action = '', instructions = '', sourceText = '' } = {}) => {
  const lower = `${action} ${instructions} ${sourceText}`.toLowerCase();
  const preferences = [];

  if (/quiz|important|exam|test|mcq|question/.test(lower)) {
    preferences.push({
      key: 'exam-focused',
      title: 'exam-focused answers',
      summary: 'Learner often asks for exam-focused practice, quizzes, or important questions.'
    });
  }
  if (/flashcard|active.?recall|remember|revise/.test(lower)) {
    preferences.push({
      key: 'active-recall',
      title: 'active recall',
      summary: 'Learner uses flashcards or revision prompts, so active recall is often useful.'
    });
  }
  if (/simple|explain.?simple|like.*10|analogy|real.life|example/.test(lower)) {
    preferences.push({
      key: 'simple-examples',
      title: 'simple examples and analogies',
      summary: 'Learner benefits from simple explanations, examples, and analogies.'
    });
  }
  if (/short|brief|quick|concise|summary/.test(lower)) {
    preferences.push({
      key: 'concise-structured',
      title: 'concise structured answers',
      summary: 'Learner often asks for short, structured explanations.'
    });
  }
  if (/detail|deep|thorough|step.?by.?step|why/.test(lower)) {
    preferences.push({
      key: 'detailed-steps',
      title: 'detailed step-by-step explanations',
      summary: 'Learner sometimes needs deeper reasoning and step-by-step explanations.'
    });
  }
  if (/diagram|visual|flowchart|table|map/.test(lower)) {
    preferences.push({
      key: 'visual-structure',
      title: 'visual structure',
      summary: 'Learner responds to diagrams, tables, or visual organization when appropriate.'
    });
  }

  return preferences.slice(0, 4);
};

class LearningMemoryService {
  async recordEvent(payload = {}) {
    const event = await LearningEvent.create({
      user: payload.userId,
      workspace: payload.workspaceId,
      document: payload.documentId || null,
      type: payload.type,
      action: payload.action,
      concepts: (payload.concepts || []).slice(0, MAX_CONCEPTS),
      summary: compact(payload.summary),
      source: compact(payload.source, 80),
      metadata: safeMetadata(payload.metadata)
    });
    return event;
  }

  async upsertMemory(payload = {}) {
    const now = new Date();
    const filter = {
      user: payload.userId,
      workspace: payload.workspaceId,
      document: payload.documentId || null,
      kind: payload.kind,
      key: payload.key
    };
    const update = {
      $set: {
        scope: payload.documentId ? 'document' : 'workspace',
        title: compact(payload.title, 180),
        summary: compact(payload.summary),
        concepts: (payload.concepts || []).slice(0, MAX_CONCEPTS),
        confidence: payload.confidence ?? 0.6,
        lastSeenAt: now,
        metadata: safeMetadata(payload.metadata)
      },
      $setOnInsert: {
        user: payload.userId,
        workspace: payload.workspaceId,
        document: payload.documentId || null,
        kind: payload.kind,
        key: payload.key
      },
      $inc: { evidenceCount: 1 }
    };

    return LearningMemory.findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after'
    });
  }

  async recordAiInteraction(payload = {}) {
    const concepts = extractConcepts(payload.action, payload.sourceText, payload.responseText);
    const summary = compact(`${payload.action}: ${payload.responseText || payload.sourceText}`, 500);

    await this.recordEvent({
      ...payload,
      type: 'ai_action',
      action: payload.action,
      concepts,
      summary,
      source: payload.source || 'document-action',
      metadata: {
        textLength: String(payload.sourceText || '').length,
        responseLength: String(payload.responseText || '').length
      }
    });

    const writes = [
      this.upsertMemory({
        ...payload,
        kind: 'activity',
        key: memoryKey('ai', payload.action, payload.source || 'document'),
        title: `AI ${payload.action}`,
        summary,
        concepts,
        confidence: 0.55,
        metadata: { lastAction: payload.action, source: payload.source || 'document' }
      })
    ];

    inferPreferences(payload).forEach((preference) => {
      writes.push(this.upsertMemory({
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        documentId: null,
        kind: 'preference',
        key: memoryKey('preference', preference.key),
        title: preference.title,
        summary: preference.summary,
        concepts,
        confidence: 0.62,
        metadata: { source: 'ai-interaction', inferredFrom: payload.action }
      }));
    });

    return Promise.all(writes);
  }

  async recordPreferenceFromStudyMaterial(payload = {}) {
    const material = payload.material || {};
    const byType = {
      quiz: {
        key: 'exam-focused',
        title: 'exam-focused answers',
        summary: 'Learner saves quizzes, so exam-style practice is often useful.'
      },
      important_questions: {
        key: 'exam-focused',
        title: 'exam-focused answers',
        summary: 'Learner saves important questions, so exam relevance matters.'
      },
      flashcards: {
        key: 'active-recall',
        title: 'active recall',
        summary: 'Learner saves flashcards, so active recall is often useful.'
      },
      explanation: {
        key: 'simple-examples',
        title: 'simple examples and analogies',
        summary: 'Learner saves explanations, so examples and analogies can help.'
      },
      summary: {
        key: 'concise-structured',
        title: 'concise structured answers',
        summary: 'Learner saves summaries, so concise structure is useful.'
      }
    };
    const preference = byType[material.type];
    if (!preference) return null;

    return this.upsertMemory({
      userId: payload.userId,
      workspaceId: material.workspace,
      documentId: null,
      kind: 'preference',
      key: memoryKey('preference', preference.key),
      title: preference.title,
      summary: preference.summary,
      concepts: extractConcepts(material.title, JSON.stringify(material.content || {})),
      confidence: 0.7,
      metadata: { source: 'study-material', materialType: material.type }
    });
  }

  async recordStudyMaterial(payload = {}) {
    const material = payload.material || {};
    const concepts = extractConcepts(material.title, JSON.stringify(material.content || {}));
    const summary = compact(`Saved ${material.type} study material: ${material.title}`, 500);

    await this.recordEvent({
      userId: payload.userId,
      workspaceId: material.workspace,
      documentId: material.document,
      type: 'study_material',
      action: `study_material.${material.type}.saved`,
      concepts,
      summary,
      source: 'study-library',
      metadata: { materialId: material._id, type: material.type }
    });

    return Promise.all([
      this.upsertMemory({
        userId: payload.userId,
        workspaceId: material.workspace,
        documentId: material.document,
        kind: 'artifact',
        key: memoryKey('study', material.type, material._id),
        title: material.title,
        summary,
        concepts,
        confidence: 0.75,
        metadata: { materialId: material._id, type: material.type }
      }),
      this.recordPreferenceFromStudyMaterial(payload)
    ]);
  }

  async recordStudyProgress(payload = {}) {
    const material = payload.material || {};
    const progress = payload.progress || {};
    const writes = [];

    if (progress.quizProgress) {
      const weakTopics = (progress.quizProgress.weakTopics || []).map(cleanConcept).filter(Boolean).slice(0, MAX_CONCEPTS);
      await this.recordEvent({
        userId: payload.userId,
        workspaceId: material.workspace,
        documentId: material.document,
        type: 'study_progress',
        action: 'quiz.attempted',
        concepts: weakTopics,
        summary: compact(`Quiz score ${progress.quizProgress.correctCount ?? '?'} of ${progress.quizProgress.totalQuestions ?? '?'}; weak topics: ${weakTopics.join(', ') || 'none recorded'}`),
        source: 'quiz',
        metadata: { materialId: material._id, score: progress.quizProgress.lastScore }
      });
      weakTopics.forEach((topic) => {
        writes.push(this.upsertMemory({
          userId: payload.userId,
          workspaceId: material.workspace,
          documentId: material.document,
          kind: 'weakness',
          key: memoryKey('weak-topic', topic),
          title: topic,
          summary: `Needs more revision from recent quiz attempts: ${topic}`,
          concepts: [topic],
          confidence: 0.8,
          metadata: { materialId: material._id, source: 'quiz' }
        }));
      });
    }

    if (progress.flashcardProgress) {
      await this.recordEvent({
        userId: payload.userId,
        workspaceId: material.workspace,
        documentId: material.document,
        type: 'study_progress',
        action: 'flashcards.studied',
        concepts: extractConcepts(material.title),
        summary: compact(`Flashcards studied: ${progress.flashcardProgress.knownCardIds?.length || 0} known, ${progress.flashcardProgress.hardCardIds?.length || 0} hard.`),
        source: 'flashcards',
        metadata: { materialId: material._id }
      });
    }

    return Promise.all(writes);
  }

  async recordTask(payload = {}) {
    const task = payload.task || {};
    const concepts = extractConcepts(task.title, task.description);
    return Promise.all([
      this.recordEvent({
        userId: payload.userId,
        workspaceId: task.workspace,
        documentId: task.document,
        type: 'study_task',
        action: payload.action || 'document_task.changed',
        concepts,
        summary: compact(`${payload.action || 'Task'}: ${task.title}`),
        source: 'document-task',
        metadata: { taskId: task._id, status: task.status, priority: task.priority }
      }),
      this.upsertMemory({
        userId: payload.userId,
        workspaceId: task.workspace,
        documentId: task.document,
        kind: 'activity',
        key: memoryKey('task', task._id),
        title: task.title,
        summary: compact(`${task.status || 'todo'} task: ${task.title}`),
        concepts,
        confidence: 0.65,
        metadata: { taskId: task._id, status: task.status, priority: task.priority }
      })
    ]);
  }

  async recordDoubt(payload = {}) {
    const message = payload.message || {};
    const concepts = extractConcepts(message.body, message.linkedText);
    return Promise.all([
      this.recordEvent({
        userId: payload.userId,
        workspaceId: message.workspace,
        documentId: message.document,
        type: 'document_doubt',
        action: payload.action || 'document_doubt.created',
        concepts,
        summary: compact(message.body, 500),
        source: 'document-thread',
        metadata: { messageId: message._id, status: message.status }
      }),
      this.upsertMemory({
        userId: payload.userId,
        workspaceId: message.workspace,
        documentId: message.document,
        kind: 'doubt',
        key: memoryKey('doubt', message._id),
        title: compact(message.body, 120),
        summary: compact(message.linkedText ? `${message.body} Context: ${message.linkedText}` : message.body),
        concepts,
        confidence: message.status === 'resolved' ? 0.7 : 0.85,
        metadata: { messageId: message._id, status: message.status }
      })
    ]);
  }

  safeRecord(promiseFactory) {
    Promise.resolve()
      .then(promiseFactory)
      .catch((error) => {
        console.warn(`Learning memory write skipped: ${error.message}`);
      });
  }
}

module.exports = new LearningMemoryService();
module.exports.extractConcepts = extractConcepts;
module.exports.compact = compact;
module.exports.memoryKey = memoryKey;
module.exports.inferPreferences = inferPreferences;
