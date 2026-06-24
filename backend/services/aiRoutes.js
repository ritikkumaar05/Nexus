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
const authenticateToken = require('../middleware/auth');
const { isValidObjectId, normalizeString, isNonEmptyString } = require('../utils/validation');
const { canEditWorkspaceContent, canViewWorkspace } = require('../utils/permissions');

const MAX_AI_INPUT_CHARS = 12000;
const MAX_WORKSPACE_CONTEXT_CHARS = 30000;

const truncate = (value, maxLength) => {
  if (!value) return '';
  return value.length > maxLength ? value.slice(0, maxLength) : value;
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

    const systemPrompt = `
You are the central AI Brain of an all-in-one collaborative workspace (combining Docs, Notion, and WhatsApp-like chat).
The user is asking you a question. You have access to their team's workspace documents. Use this context to answer their question accurately.
If the documents do not contain the answer, you can use your general knowledge, but clearly distinguish what is from their workspace files vs general knowledge.

--- TEAM WORKSPACE KNOWLEDGE BASE ---
${workspaceKnowledgeBase}
------------------------------------
`;

    // 3. Request completion from Gemini Service
    const aiResponse = await generateText(query, systemPrompt);

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
    const instructions = normalizeString(req.body.instructions);
    const workspaceId = normalizeString(req.body.workspaceId);
    const documentId = normalizeString(req.body.documentId);

    if (!isNonEmptyString(action) || !isNonEmptyString(text)) {
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

    if (text.length > MAX_AI_INPUT_CHARS) {
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

    const aiResponse = await generateText(userPrompt, systemPrompt);
    res.json({ response: aiResponse });

  } catch (err) {
    const status = err.message === 'GEMINI_API_KEY is not configured' ? 503 : 500;
    res.status(status).json({ error: 'AI text operation failed' });
  }
});

module.exports = router;
