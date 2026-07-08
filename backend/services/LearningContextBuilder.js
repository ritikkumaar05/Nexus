const { Document } = require('../models');
const LearningContextService = require('./LearningContextService');

const CHUNK_SIZE = Number(process.env.AI_DOCUMENT_CHUNK_CHARS || 9000);
const CHUNK_OVERLAP = Number(process.env.AI_DOCUMENT_CHUNK_OVERLAP || 500);

const compact = (value = '', maxLength = 1000) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
};

const stripHtml = (html = '') => String(html || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const splitParagraphs = (text = '') => String(text || '')
  .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean);

const findSelectedParagraphWindow = (documentText = '', selectedText = '') => {
  const cleanSelected = compact(selectedText, 1000);
  if (!cleanSelected) return '';

  const paragraphs = splitParagraphs(documentText);
  const selectedIndex = paragraphs.findIndex((paragraph) => paragraph.includes(cleanSelected));
  if (selectedIndex < 0) return cleanSelected;

  return paragraphs
    .slice(Math.max(0, selectedIndex - 1), Math.min(paragraphs.length, selectedIndex + 2))
    .join('\n\n');
};

const detectCurrentHeading = (documentText = '', selectedText = '') => {
  const beforeSelection = selectedText && documentText.includes(selectedText)
    ? documentText.slice(0, documentText.indexOf(selectedText))
    : documentText.slice(0, 3000);

  const heading = beforeSelection
    .split(/\r?\n/)
    .reverse()
    .map((line) => line.replace(/^#{1,6}\s*/, '').trim())
    .find((line) => line.length >= 3 && line.length <= 120 && !/[.!?]$/.test(line));

  return heading || '';
};

const chunkText = (text = '', chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) => {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [{ index: 1, text: normalized }];

  const chunks = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const hardEnd = Math.min(normalized.length, cursor + chunkSize);
    const softEnd = hardEnd < normalized.length
      ? Math.max(cursor + Math.floor(chunkSize * 0.7), normalized.lastIndexOf('\n\n', hardEnd))
      : hardEnd;
    const end = softEnd > cursor ? softEnd : hardEnd;
    chunks.push({ index: chunks.length + 1, text: normalized.slice(cursor, end).trim() });
    if (end >= normalized.length) break;
    cursor = Math.max(0, end - overlap);
  }
  return chunks.filter((chunk) => chunk.text);
};

const buildChunkPrompt = ({ documentTitle, action, chunk, totalChunks }) => `Document: ${documentTitle}
Target action: ${action}
Chunk ${chunk.index} of ${totalChunks}

Summarize this lecture chunk for a later final answer.
Keep concepts, examples, formulas, definitions, doubts, and exam-relevant points.
Do not answer the final user request yet.

${chunk.text}`;

class LearningContextBuilder {
  async buildDocumentContext({ userId, workspaceId, documentId, action, selectedText = '', legacyText = '', instructions = '' }) {
    const document = await Document.findOne({ _id: documentId, workspace: workspaceId, deletedAt: null })
      .select('title plainTextContent contentHtml updatedAt')
      .lean();

    if (!document) return null;

    const documentText = String(document.plainTextContent || stripHtml(document.contentHtml) || legacyText || '').trim().slice(0, 1_000_000);
    const activeText = compact(selectedText || '', 12000);
    const paragraphWindow = findSelectedParagraphWindow(documentText, activeText);
    const currentHeading = detectCurrentHeading(documentText, activeText);
    const sourceText = activeText || documentText;
    const chunks = chunkText(sourceText);
    const contextText = activeText || paragraphWindow || compact(documentText, CHUNK_SIZE);

    const learningContext = await LearningContextService.buildDocumentContext({
      userId,
      workspaceId,
      documentId,
      action,
      text: contextText,
      instructions
    });

    const builderContext = [
      '--- BACKEND LEARNING CONTEXT BUILDER ---',
      `Document title: ${document.title || 'Untitled lecture'}`,
      currentHeading ? `Current heading: ${currentHeading}` : '',
      activeText ? `Selected paragraph: ${activeText}` : '',
      paragraphWindow && paragraphWindow !== activeText ? `Neighbour paragraphs:\n${paragraphWindow}` : '',
      `Document source length: ${documentText.length} characters`,
      `Chunk count for this action: ${chunks.length}`,
      '--- END BACKEND LEARNING CONTEXT BUILDER ---'
    ].filter(Boolean).join('\n\n');

    return {
      document,
      documentText,
      sourceText,
      selectedText: activeText,
      currentHeading,
      paragraphWindow,
      chunks,
      chunked: chunks.length > 1,
      contextBlock: `${learningContext}\n\n${builderContext}`.trim()
    };
  }

  chunkText(text) {
    return chunkText(text);
  }

  buildChunkPrompt(payload) {
    return buildChunkPrompt(payload);
  }
}

module.exports = new LearningContextBuilder();
module.exports.chunkText = chunkText;
module.exports.findSelectedParagraphWindow = findSelectedParagraphWindow;
module.exports.detectCurrentHeading = detectCurrentHeading;
