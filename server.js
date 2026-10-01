const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_SIZE = 128 * 1024;
const TRANSIENT_GEMINI_STATUSES = new Set([500, 502, 503, 504]);
const FALLBACK_GEMINI_MODELS = ['gemini-3.5-flash'];
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const TUTOR_INSTRUCTIONS = {
  guide: 'You are EduGenie, a thoughtful learning coach. Explain the idea clearly for a curious beginner, use a concrete example, and finish with one short check-for-understanding question. Use readable Markdown.',
  socratic: 'You are EduGenie, a patient Socratic tutor. Help the learner reason things out with one focused question at a time. Give small hints when needed; do not reveal the full answer unless the learner asks. Use readable Markdown.',
  quiz: 'You are EduGenie, a friendly quiz coach. Ask one question at a time, wait for the learner to answer, then explain what they got right and gently correct misconceptions before asking the next question. Use readable Markdown.',
};
const SUBJECTS = ['Mathematics', 'Biology', 'History', 'Writing'];
const DEFAULT_MODEL = 'gemini-3.8-flash';

function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY?.trim() || process.env.api_key?.trim() || '';
}

function getGeminiConfigError() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return 'Gemini API key is missing. Copy .env.example to .env, add GEMINI_API_KEY, then restart npm run dev.';
  }
  if (/^(your[_ -]|replace[_ -]|paste[_ -]|<)/i.test(apiKey)) {
    return 'GEMINI_API_KEY is still a placeholder. Replace it in .env with a key from Google AI Studio, then restart npm run dev.';
  }
  return null;
}

function explainGeminiError(result, statusCode) {
  const providerError = result?.error || {};
  const code = providerError.status || `HTTP_${statusCode}`;
  const details = `${providerError.status || ''} ${providerError.message || ''}`.toLowerCase();
  let error;

  if (statusCode === 401 || /api.?key.*(invalid|not valid)|api_key_invalid|unauthenticated/.test(details)) {
    error = 'Gemini rejected this API key. Create or recopy a key from Google AI Studio, replace GEMINI_API_KEY in .env, and restart npm run dev. Check that the key has not been restricted from using the Gemini API.';
  } else if (/service_disabled|api.*not.*activated|generativelanguage.*disabled/.test(details)) {
    error = 'The Gemini API is not enabled for the key’s Google Cloud project. Enable the Generative Language API for that project, then try again.';
  } else if (statusCode === 403 || /permission_denied/.test(details)) {
    error = 'Google denied access to Gemini. Check the API key’s project and API restrictions, and make sure the Generative Language API is enabled for that project.';
  } else if (statusCode === 429 || /resource_exhausted|quota/.test(details)) {
    error = 'The Gemini project has reached a quota or rate limit. Check its Gemini API usage and quotas in Google AI Studio or Google Cloud, then try again later.';
  } else if (statusCode === 404) {
    error = `Gemini model “${getGeminiModel()}” was not found or is unavailable. Set GEMINI_MODEL in .env to a model that supports generateContent, then restart npm run dev.`;
  } else if (statusCode === 400) {
    error = 'Gemini rejected the request. Check that GEMINI_MODEL supports generateContent and try a shorter question.';
  } else if (statusCode >= 500) {
    error = 'Google Gemini is temporarily unavailable. Try again in a moment.';
  } else {
    error = `Gemini returned HTTP ${statusCode}. Check the server log for the diagnostic code, then verify the API key and model settings.`;
  }

  console.warn(`[Gemini] Request failed: HTTP ${statusCode}, ${code}, model ${getGeminiModel()}`);
  return { error, code };
}

async function requestGeminiWithRetry(body, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': getGeminiApiKey(),
        },
        body: JSON.stringify(body),
      });

      if (!TRANSIENT_GEMINI_STATUSES.has(response.status) || attempt === 2) return response;
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }

  throw lastError;
}

async function requestGemini(body) {
  const primaryModel = getGeminiModel();
  let primaryResponse;
  let lastError;

  try {
    primaryResponse = await requestGeminiWithRetry(body, primaryModel);
    if (primaryResponse.ok || (!TRANSIENT_GEMINI_STATUSES.has(primaryResponse.status) && primaryResponse.status !== 404)) {
      return { response: primaryResponse, model: primaryModel };
    }
    await primaryResponse.body?.cancel();
  } catch (error) {
    lastError = error;
  }

  for (const model of FALLBACK_GEMINI_MODELS) {
    if (model === primaryModel) continue;
    try {
      const response = await requestGeminiWithRetry(body, model);
      if (response.ok) {
        console.warn(`[Gemini] Primary model ${primaryModel} unavailable; using fallback ${model}`);
        return { response, model };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (primaryResponse) return { response: primaryResponse, model: primaryModel };
  throw lastError;
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      const error = new Error('Request is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

async function handleChat(request, response) {
  const configError = getGeminiConfigError();
  if (configError) {
    sendJson(response, 503, { error: configError, code: 'GEMINI_API_KEY_NOT_CONFIGURED' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.statusCode || 400, { error: error.message });
    return;
  }

  const messages = payload?.messages;
  const mode = payload?.mode;
  const subject = payload?.subject;
  const validMessages = Array.isArray(messages)
    && messages.length > 0
    && messages.length <= 20
    && messages.every((message) => (
      ['user', 'model'].includes(message?.role)
      && typeof message.content === 'string'
      && message.content.trim().length > 0
      && message.content.length <= 6000
    ));

  if (!validMessages || !TUTOR_INSTRUCTIONS[mode] || !SUBJECTS.includes(subject) || messages.at(-1).role !== 'user') {
    sendJson(response, 400, { error: 'Send a valid message and learning mode to continue.' });
    return;
  }

  let geminiResponse;
  try {
    const geminiRequest = await requestGemini({
      systemInstruction: { parts: [{ text: `${TUTOR_INSTRUCTIONS[mode]} The learner's current subject focus is ${subject}.` }] },
      contents: messages.map(({ role, content }) => ({ role, parts: [{ text: content }] })),
      generationConfig: { temperature: 0.65, maxOutputTokens: 1200 },
    });
    geminiResponse = geminiRequest.response;
  } catch {
    sendJson(response, 502, { error: 'Could not reach Gemini. Check your connection and try again.' });
    return;
  }

  let result;
  try {
    result = await geminiResponse.json();
  } catch {
    sendJson(response, 502, { error: 'Gemini returned an unreadable response. Please try again.' });
    return;
  }

  if (!geminiResponse.ok) {
    sendJson(response, geminiResponse.status, explainGeminiError(result, geminiResponse.status));
    return;
  }

  const reply = result?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!reply) {
    sendJson(response, 502, { error: 'Gemini did not return a reply. Try rephrasing your question.' });
    return;
  }

  sendJson(response, 200, { reply });
}

async function handleConnectionTest(response) {
  const configError = getGeminiConfigError();
  if (configError) {
    sendJson(response, 503, { error: configError, code: 'GEMINI_API_KEY_NOT_CONFIGURED' });
    return;
  }

  let geminiResponse;
  try {
    const geminiRequest = await requestGemini({
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    });
    geminiResponse = geminiRequest.response;
  } catch {
    sendJson(response, 502, { error: 'Could not reach Google Gemini. Check your internet connection and try the connection test again.', code: 'GEMINI_NETWORK_ERROR' });
    return;
  }

  if (!geminiResponse.ok) {
    let result = {};
    try {
      result = await geminiResponse.json();
    } catch {
      // The HTTP status still gives the learner a useful starting point.
    }
    sendJson(response, geminiResponse.status, explainGeminiError(result, geminiResponse.status));
    return;
  }

  sendJson(response, 200, { message: `Connected successfully to Gemini (${geminiRequest.model}).` });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/chat') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    await handleChat(request, response);
    return;
  }

  if (url.pathname === '/api/test-connection') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    await handleConnectionTest(response);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { error: 'Something went wrong. Please try again.' });
    else response.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`EduGenie is running at http://localhost:${PORT}`);
});
