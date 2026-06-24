/**
 * ============================================================================
 * GOOGLE GEMINI AI SERVICE
 * ============================================================================
 * Interfaces with the Gemini API. Implements exponential backoff for resilience,
 * structured payload generation, and strict formatting.
 */

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);

/**
 * Helper to pause execution (used for exponential backoff)
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getApiUrl = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
};

const shouldRetry = (status) => status === 429 || status >= 500;

/**
 * Generates content from the Google Gemini API with robust exponential backoff.
 * Retry strategy: up to 5 times with delays of 1s, 2s, 4s, 8s, 16s.
 * * @param {string} prompt - The primary user input query.
 * @param {string} systemInstruction - Guiding context/persona for the AI behavior.
 * @returns {Promise<string>} - The generated markdown text response.
 */
const generateText = async (prompt, systemInstruction = "You are a helpful collaborative workspace AI assistant.") => {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error("Prompt must be a non-empty string");
  }

  const maxRetries = 5;
  let attempt = 0;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048
    }
  };

  while (attempt < maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const response = await fetch(getApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errBody = await response.text();
        const error = new Error(`Gemini API error: ${response.status} - ${errBody}`);
        error.status = response.status;
        error.retryable = shouldRetry(response.status);
        throw error;
      }

      const result = await response.json();
      const outputText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!outputText) {
        throw new Error("Invalid response format received from Gemini API");
      }

      return outputText;

    } catch (error) {
      if (error.message === "GEMINI_API_KEY is not configured") {
        throw error;
      }

      attempt++;

      const retryable = error.name === 'AbortError' || error.retryable !== false;
      if (!retryable || attempt >= maxRetries) {
        console.error(`Gemini API call failed after ${attempt} attempt(s): ${error.message}`);
        throw new Error("AI service temporarily unavailable. Please try again later.");
      }
      // Calculate delay: 1000 * 2^(attempt-1) seconds: 1s, 2s, 4s, 8s...
      const backoffDelay = Math.pow(2, attempt - 1) * 1000;
      await delay(backoffDelay);
    } finally {
      clearTimeout(timeout);
    }
  }
};

module.exports = {
  generateText
};
