/**
 * ============================================================================
 * AI ROUTER
 * ============================================================================
 * Exposes endpoints for processing active text (summarize, extract tasks) and
 * executing context-aware workspace chat queries.
 */

const express = require('express');
const router = express.Router();
const { Document, Workspace } = require('../models');
const { generateText } = require('../services/aiService');
const AiGenerationCacheService = require('./AiGenerationCacheService');
const LearningContextBuilder = require('./LearningContextBuilder');
const LearningContextService = require('./LearningContextService');
const LearningMemoryService = require('./LearningMemoryService');
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const { canEditWorkspaceContent, canViewWorkspace } = require('../utils/permissions');

const MAX_AI_INPUT_CHARS = 12000;
const MAX_WORKSPACE_CONTEXT_CHARS = 30000;

const truncate = (value, maxLength) => {
  if (!value) return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const structuredInstructionForAction = (action) => {
  if (['quiz', 'generate-quiz'].includes(action)) {
    return `Return only valid JSON with this shape:
{"questions":[{"question":"...","options":[{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],"answer":"A","explanation":"...","topic":"..."}]}
Create exactly 10 questions.`;
  }

  if (['flashcards', 'generate-flashcards'].includes(action)) {
    return `Return only valid JSON with this shape:
{"cards":[{"front":"...","back":"...","tag":"..."}]}
Create 8 to 12 cards.`;
  }

  return `Return only valid JSON with this shape:
{"sections":[{"title":"...","text":"...","items":["..."]}]}`;
};

const extractJson = (value = '') => {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text.slice(
    Math.max(0, Math.min(...['{', '['].map((char) => {
      const index = text.indexOf(char);
      return index < 0 ? Number.POSITIVE_INFINITY : index;
    }))),
    Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1
  );

  try {
    return JSON.parse(candidate);
  } catch (error) {
    return null;
  }
};

const normalizeStructuredOutput = (action, parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;

  if (['quiz', 'generate-quiz'].includes(action) && Array.isArray(parsed.questions)) {
    return {
      type: 'quiz',
      questions: parsed.questions.slice(0, 20).map((question, index) => ({
        id: question.id || `q-${index}`,
        question: String(question.question || '').trim(),
        options: Array.isArray(question.options) ? question.options.map((option, optionIndex) => ({
          key: String(option.key || String.fromCharCode(65 + optionIndex)).trim().toUpperCase().slice(0, 1),
          text: String(option.text || '').trim()
        })).filter((option) => option.key && option.text).slice(0, 6) : [],
        answer: String(question.answer || '').trim().toUpperCase().slice(0, 1),
        answerText: String(question.answerText || '').trim(),
        explanation: String(question.explanation || '').trim(),
        topic: String(question.topic || 'Study notes').trim()
      })).filter((question) => question.question)
    };
  }

  if (['flashcards', 'generate-flashcards'].includes(action) && Array.isArray(parsed.cards)) {
    return {
      type: 'flashcards',
      cards: parsed.cards.slice(0, 40).map((card, index) => ({
        id: card.id || `card-${index}`,
        front: String(card.front || '').trim(),
        back: String(card.back || '').trim(),
        tag: String(card.tag || 'Study notes').trim()
      })).filter((card) => card.front && card.back)
    };
  }

  if (Array.isArray(parsed.sections)) {
    return {
      type: 'structured',
      sections: parsed.sections.slice(0, 12).map((section) => ({
        title: String(section.title || 'Study Output').trim(),
        text: String(section.text || '').trim(),
        items: Array.isArray(section.items) ? section.items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20) : []
      })).filter((section) => section.title || section.text || section.items.length)
    };
  }

  return null;
};

const renderStructuredResponse = (action, structured, fallback = '') => {
  if (!structured) return fallback;
  if (structured.type === 'quiz') {
    return `Quiz from your notes\n\n${structured.questions.map((question, index) => {
      const options = (question.options || []).map((option) => `${option.key}) ${option.text}`).join('\n');
      return `Question ${index + 1}: ${question.question}
${options}
Answer: ${question.answer || question.answerText}
Explanation: ${question.explanation}
Topic: ${question.topic || 'Study notes'}`;
    }).join('\n\n')}`;
  }

  if (structured.type === 'flashcards') {
    return `Flashcards:\n\n${structured.cards.map((card) => `Front: ${card.front}
Back: ${card.back}
Tag: ${card.tag || 'Study notes'}`).join('\n\n')}`;
  }

  return (structured.sections || []).map((section) => {
    const items = (section.items || []).map((item) => `- ${item}`).join('\n');
    return `${section.title}\n${section.text || ''}${items ? `\n${items}` : ''}`.trim();
  }).join('\n\n') || fallback;
};

const summarizeDocumentChunks = async ({ action, documentTitle, chunks }) => {
  if (!chunks || chunks.length <= 1) return '';

  const summaries = [];
  for (const chunk of chunks) {
    const prompt = LearningContextBuilder.buildChunkPrompt({
      documentTitle,
      action,
      chunk,
      totalChunks: chunks.length
    });
    const summary = await generateText(prompt, 'You prepare compact lecture chunk summaries for a later final AI study response. Return concise markdown notes only.');
    summaries.push(`Section ${chunk.index}: ${summary}`);
  }

  return summaries.join('\n\n');
};

// --- ENDPOINT A: CONTEXTUAL WORKSPACE ASSISTANT (RAG Lite) ---
// POST /api/ai/chat
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { workspaceId } = req.body;
    const query = normalizeString(req.body.query);

    if (!isValidObjectId(workspaceId) || !isNonEmptyString(query)) {
      return res.status(400).json({ error: 'A valid workspace ID and user query are required' });
    }

    if (query.length > 4000) {
      return res.status(413).json({ error: 'User query is too large' });
    }

    // 1. Security Check: Is the user part of this workspace?
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      'members.user': req.user.id
    });
    if (!workspace || !canViewWorkspace(workspace, req.user.id)) {
      return res.status(403).json({ error: 'Access Denied' });
    }

    // 2. Fetch all document titles & clean plain-text contents from this workspace to build dynamic context.
    // This allows the AI to answer questions like: "What is our plan for next week?" by reading real database content.
    const documents = await Document.find({ workspace: workspaceId })
                                    .select('title plainTextContent')
                                    .limit(10); // Safeguard against massive payloads

    let workspaceKnowledgeBase = "";
    documents.forEach((doc, idx) => {
      if (workspaceKnowledgeBase.length >= MAX_WORKSPACE_CONTEXT_CHARS) return;
      const title = truncate(doc.title || 'Untitled Page', 120);
      const content = truncate(doc.plainTextContent || "Empty document", 6000);
      workspaceKnowledgeBase += `\n--- Document #${idx + 1} [Title: ${title}] ---\n${content}\n`;
    });
    workspaceKnowledgeBase = truncate(workspaceKnowledgeBase, MAX_WORKSPACE_CONTEXT_CHARS);
    const learningContext = await LearningContextService.buildWorkspaceChatContext({
      userId: req.user.id,
      workspaceId
    });

    const baseSystemPrompt = `
You are the central AI Brain of an all-in-one collaborative workspace (combining Docs, Notion, and WhatsApp-like chat).
The user is asking you a question. You have access to their team's workspace documents. Use this context to answer their question accurately.
If the documents do not contain the answer, you can use your general knowledge, but clearly distinguish what is from their workspace files vs general knowledge.

--- TEAM WORKSPACE KNOWLEDGE BASE ---
${workspaceKnowledgeBase}
------------------------------------
`;
    const systemPrompt = LearningContextService.composeSystemPrompt(baseSystemPrompt, learningContext);

    // 3. Request completion from Gemini Service
    const aiResponse = await generateText(query, systemPrompt);
    LearningMemoryService.safeRecord(() => LearningMemoryService.recordAiInteraction({
      userId: req.user.id,
      workspaceId,
      action: 'workspace-chat',
      sourceText: query,
      responseText: aiResponse,
      source: 'workspace-chat'
    }));

    res.json({ response: aiResponse });

  } catch (err) {
    const status = err.message === 'GEMINI_API_KEY is not configured' ? 503 : 500;
    res.status(status).json({ error: 'AI processing failed' });
  }
});

// --- ENDPOINT B: TEXT COMMAND EXECUTION (Highlight & Edit) ---
// POST /api/ai/document-action
router.post('/document-action', authenticateToken, async (req, res) => {
  try {
    const action = normalizeString(req.body.action);
    const text = typeof req.body.text === 'string' ? req.body.text : '';
    const selectedText = typeof req.body.selectedText === 'string'
      ? req.body.selectedText
      : normalizeString(req.body.source) === 'selection'
        ? text
        : '';
    const instructions = normalizeString(req.body.instructions);
    const workspaceId = normalizeString(req.body.workspaceId);
    const documentId = normalizeString(req.body.documentId);
    const hasDocumentContext = isValidObjectId(workspaceId) && isValidObjectId(documentId);

    if (!isNonEmptyString(action)) {
      return res.status(400).json({ error: 'Action is required' });
    }

    if (!hasDocumentContext && !isNonEmptyString(text)) {
      return res.status(400).json({ error: 'Action and source text are required' });
    }

    if (workspaceId || documentId) {
      if (!isValidObjectId(workspaceId) || !isValidObjectId(documentId)) {
        return res.status(400).json({ error: 'Valid workspace and document IDs are required for document actions' });
      }

      const [workspace, document] = await Promise.all([
        Workspace.findOne({ _id: workspaceId, 'members.user': req.user.id }),
        Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null }).select('_id')
      ]);

      if (!workspace || !document || !canEditWorkspaceContent(workspace, req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    if (!hasDocumentContext && text.length > MAX_AI_INPUT_CHARS) {
      return res.status(413).json({ error: 'Source text is too large for one AI operation' });
    }

    let systemPrompt = "";
    let userPrompt = text;

    switch (action) {
      case 'summarize':
        systemPrompt = `You are Nexus, an exam-focused study assistant. Create study material from the user's notes.
Return markdown with these sections:
Short Summary
Detailed Summary
Key Points
Things to Remember`;
        break;
      case 'quiz':
      case 'generate-quiz':
        systemPrompt = `You are Nexus, an exam-focused study assistant. Generate a medium difficulty MCQ quiz from the user's notes.
Return exactly this repeatable format so Nexus can render an interactive quiz:
Quiz from your notes

Question 1: [question text]
A) [option]
B) [option]
C) [option]
D) [option]
Answer: [A/B/C/D]
Explanation: [short explanation]
Topic: [topic]

Create 10 questions. Keep options clear, plausible, and exam-focused.`;
        break;
      case 'flashcards':
      case 'generate-flashcards':
        systemPrompt = `You are Nexus, an active-recall study assistant. Turn the user's notes into flashcards.
Return markdown as a deck with 8-12 cards.
Each card must use:
Front: ...
Back: ...
Tag: ...`;
        break;
      case 'simple-explanation':
      case 'explain-simple':
      case 'explain':
        systemPrompt = `You are Nexus, a simple teaching assistant. Explain the user's notes like the learner is 10 years old.
Return markdown with:
Simple Explanation
Real-life Example
Exam Answer Version`;
        break;
      case 'important-questions':
        systemPrompt = `You are Nexus, an exam-prep assistant. Find important exam questions from the user's notes.
Return markdown with:
Very Important
Medium Important
Quick Revision
Then add a short note on what to revise first.`;
        break;
      case 'expand':
        systemPrompt = "You are a creative writer. Expand on the thoughts, notes, or bullet points provided by the user into a cohesive, professional draft.";
        break;
      case 'extract-tasks':
        systemPrompt = "Analyze the text and extract any clear actionable items, assignments, or tasks into an ordered checklist format.";
        break;
      case 'custom':
        if (!isNonEmptyString(instructions)) return res.status(400).json({ error: 'Instructions required for custom actions' });
        if (instructions.length > 2000) return res.status(413).json({ error: 'Instructions are too large' });
        systemPrompt = `You are a helpful AI document editor. Modify or process the text provided based on these user instructions: "${instructions}". Return only the modified text.`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported action type' });
    }

    let structured = null;
    let sourceTextForMemory = text;
    let generationCacheKey = '';
    let generationDocumentUpdatedAt = null;

    if (hasDocumentContext) {
      const documentContext = await LearningContextBuilder.buildDocumentContext({
        userId: req.user.id,
        workspaceId,
        documentId,
        action,
        selectedText,
        legacyText: text,
        instructions
      });

      if (!documentContext || !isNonEmptyString(documentContext.sourceText)) {
        return res.status(400).json({ error: 'Add lecture text before running AI' });
      }

      generationDocumentUpdatedAt = documentContext.document?.updatedAt || null;
      generationCacheKey = AiGenerationCacheService.buildKey({
        userId: req.user.id,
        workspaceId,
        documentId,
        action,
        selectedText: documentContext.selectedText,
        instructions,
        documentUpdatedAt: generationDocumentUpdatedAt
      });
      const cached = await AiGenerationCacheService.get(generationCacheKey);
      if (cached) {
        return res.json({
          response: cached.response,
          structured: cached.structured || null,
          cached: true
        });
      }

      const chunkSummaries = await summarizeDocumentChunks({
        action,
        documentTitle: documentContext.document?.title || 'Untitled lecture',
        chunks: documentContext.chunks
      });

      sourceTextForMemory = documentContext.selectedText || truncate(documentContext.documentText, MAX_AI_INPUT_CHARS);
      userPrompt = [
        documentContext.selectedText ? `Selected text:\n${documentContext.selectedText}` : '',
        chunkSummaries ? `Lecture section summaries:\n${chunkSummaries}` : `Lecture source:\n${documentContext.sourceText}`,
        documentContext.currentHeading ? `Current heading: ${documentContext.currentHeading}` : '',
        `Requested action: ${action}`
      ].filter(Boolean).join('\n\n');
      systemPrompt = `${systemPrompt}

Structured output contract:
${structuredInstructionForAction(action)}`;
      systemPrompt = LearningContextService.composeSystemPrompt(systemPrompt, documentContext.contextBlock);
    } else {
      systemPrompt = `${systemPrompt}

Structured output contract:
${structuredInstructionForAction(action)}`;
    }

    const rawAiResponse = await generateText(userPrompt, systemPrompt);
    structured = normalizeStructuredOutput(action, extractJson(rawAiResponse));
    const aiResponse = renderStructuredResponse(action, structured, rawAiResponse);

    if (hasDocumentContext) {
      LearningMemoryService.safeRecord(() => LearningMemoryService.recordAiInteraction({
        userId: req.user.id,
        workspaceId,
        documentId,
        action,
        sourceText: sourceTextForMemory,
        responseText: aiResponse,
        source: normalizeString(req.body.source) || 'document'
      }));
      LearningMemoryService.safeRecord(() => AiGenerationCacheService.set({
        cacheKey: generationCacheKey,
        userId: req.user.id,
        workspaceId,
        documentId,
        action,
        documentUpdatedAt: generationDocumentUpdatedAt,
        response: aiResponse,
        structured,
        metadata: { source: normalizeString(req.body.source) || 'document' }
      }));
    }
    res.json({ response: aiResponse, structured });

  } catch (err) {
    const status = err.message === 'GEMINI_API_KEY is not configured' ? 503 : 500;
    res.status(status).json({ error: 'AI text operation failed' });
  }
});

module.exports = router;
