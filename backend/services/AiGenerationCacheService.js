const crypto = require('crypto');
const { AiGenerationCache } = require('../models');

const DEFAULT_TTL_MS = Number(process.env.AI_GENERATION_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

const stableHash = (value = '') => crypto
  .createHash('sha256')
  .update(String(value || ''), 'utf8')
  .digest('hex');

const normalize = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

class AiGenerationCacheService {
  buildKey({ userId, workspaceId, documentId, action, selectedText = '', instructions = '', documentUpdatedAt = null }) {
    return stableHash(JSON.stringify({
      userId: String(userId || ''),
      workspaceId: String(workspaceId || ''),
      documentId: String(documentId || ''),
      action: normalize(action),
      selectedTextHash: stableHash(normalize(selectedText)),
      instructionsHash: stableHash(normalize(instructions)),
      documentUpdatedAt: documentUpdatedAt ? new Date(documentUpdatedAt).toISOString() : ''
    }));
  }

  async get(cacheKey) {
    if (!cacheKey) return null;
    return AiGenerationCache.findOne({
      cacheKey,
      expiresAt: { $gt: new Date() }
    }).lean();
  }

  async set({
    cacheKey,
    userId,
    workspaceId,
    documentId,
    action,
    documentUpdatedAt,
    response,
    structured,
    metadata = {}
  }) {
    if (!cacheKey || !response) return null;
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
    return AiGenerationCache.findOneAndUpdate(
      { cacheKey },
      {
        $set: {
          user: userId,
          workspace: workspaceId,
          document: documentId,
          action,
          documentUpdatedAt,
          response,
          structured: structured || null,
          metadata,
          expiresAt
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  }
}

module.exports = new AiGenerationCacheService();
module.exports.stableHash = stableHash;
