const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const welcome = document.querySelector('#welcome');
const messagesElement = document.querySelector('#messages');
const conversation = document.querySelector('#conversation');
const toast = document.querySelector('#toast');
const modeLabel = document.querySelector('#composer-mode');
const subjectButtons = [...document.querySelectorAll('.subject-row')];
const modeButtons = [...document.querySelectorAll('.mode-button')];
const starterButtons = [...document.querySelectorAll('.starter-card')];

const modes = {
  guide: { label: 'Patient explanations, real examples', placeholder: 'Ask anything you want to understand...' },
  socratic: { label: 'One thoughtful question at a time', placeholder: 'What would you like to figure out together?' },
  quiz: { label: 'A question at a time, no pressure', placeholder: 'Choose a topic to practice...' },
};

const starterSets = {
  Mathematics: [
    ['Make an idea click', 'Explain fractions with pizza', 'Explain fractions to me using a real-world example.', '½', 'icon-fraction'],
    ['Check what I know', 'A quick algebra quiz', 'Quiz me on the basics of algebra. Ask one question at a time.', '?', 'icon-quiz'],
    ['Follow a curiosity', 'Why does a negative times a negative make a positive?', 'Help me understand why negative numbers multiplied together make a positive. Start with a hint.', '↗', 'icon-idea'],
    ['Make a little plan', 'Seven days of geometry', 'Help me make a one-week plan to get comfortable with geometry.', '7', 'icon-plan'],
  ],
  Biology: [
    ['Make an idea click', 'How do cells make energy?', 'Explain how cells turn food into energy with a real-world analogy.', '✳', 'icon-fraction'],
    ['Check what I know', 'A quick ecosystems quiz', 'Quiz me on ecosystems and food webs. Ask one question at a time.', '?', 'icon-quiz'],
    ['Follow a curiosity', 'How does DNA fit inside a cell?', 'Help me reason through how such a long DNA molecule fits inside a tiny cell. Start with a hint.', '↗', 'icon-idea'],
    ['Make a little plan', 'Seven days of biology', 'Help me make a one-week plan to understand cells and genetics.', '7', 'icon-plan'],
  ],
  History: [
    ['Make an idea click', 'Why did the French Revolution happen?', 'Explain the main causes of the French Revolution with a useful analogy.', '↗', 'icon-fraction'],
    ['Check what I know', 'A quick world history quiz', 'Quiz me on the Industrial Revolution. Ask one question at a time.', '?', 'icon-quiz'],
    ['Follow a curiosity', 'What does this source leave out?', 'Help me think critically about what a historical source might leave out. Start with one question.', '↗', 'icon-idea'],
    ['Make a little plan', 'Seven days of modern history', 'Help me create a one-week plan to study modern world history.', '7', 'icon-plan'],
  ],
  Writing: [
    ['Make an idea click', 'What makes a strong thesis?', 'Explain how to write a strong thesis statement with a before-and-after example.', '✎', 'icon-fraction'],
    ['Check what I know', 'A quick grammar quiz', 'Quiz me on active and passive voice. Ask one question at a time.', '?', 'icon-quiz'],
    ['Follow a curiosity', 'How do I make a paragraph flow?', 'Help me reason through how to make my paragraphs flow better. Start with a question.', '↗', 'icon-idea'],
    ['Make a little plan', 'Seven days of clear writing', 'Help me create a one-week plan to become a clearer writer.', '7', 'icon-plan'],
  ],
};

let currentMode = 'guide';
let currentSubject = 'Mathematics';
let conversationHistory = [];
let isSending = false;
let toastTimeout;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function setBusy(busy) {
  isSending = busy;
  sendButton.disabled = busy;
  input.disabled = busy;
}

async function readApiResponse(response) {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(`EduGenie returned an empty response (HTTP ${response.status}). Refresh and try again; if it repeats, check the server terminal.`);
  }

  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(`EduGenie returned an invalid response (HTTP ${response.status}). Refresh and try again; if it repeats, check the server terminal.`);
  }

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`EduGenie returned an unexpected response (HTTP ${response.status}). Refresh and try again.`);
  }

  return result;
}

function appendInlineText(parent, text) {
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let start = 0;

  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    const element = document.createElement(token.startsWith('`') ? 'code' : token.startsWith('**') ? 'strong' : 'em');
    element.textContent = token.startsWith('**') ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(element);
    start = match.index + token.length;
  }

  parent.append(document.createTextNode(text.slice(start)));
}

function renderReply(target, text) {
  const lines = text.split('\n');
  let paragraph = [];
  let list = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    const element = document.createElement('p');
    appendInlineText(element, paragraph.join(' '));
    target.append(element);
    paragraph = [];
  }

  function closeList() {
    list = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      flushParagraph();
      closeList();
      const element = document.createElement('h3');
      appendInlineText(element, heading[1]);
      target.append(element);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.+)/);
    if (quote) {
      flushParagraph();
      closeList();
      const element = document.createElement('blockquote');
      appendInlineText(element, quote[1]);
      target.append(element);
      continue;
    }

    const item = trimmed.match(/^([-*]|\d+\.)\s+(.+)/);
    if (item) {
      flushParagraph();
      const tag = /^\d/.test(item[1]) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) {
        closeList();
        list = document.createElement(tag);
        target.append(list);
      }
      const element = document.createElement('li');
      appendInlineText(element, item[2]);
      list.append(element);
      continue;
    }

    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
}

function addMessage(role, text, { pending = false, error = false } = {}) {
  const article = document.createElement('article');
  article.className = `chat-message ${role === 'user' ? 'user' : 'assistant'}`;

  if (role !== 'user') {
    const mark = document.createElement('span');
    mark.className = 'message-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✳';
    article.append(mark);
  }

  const body = document.createElement('div');
  body.className = 'message-body';
  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role === 'user' ? 'YOU' : 'EDUGENIE';
  body.append(roleLabel);

  const content = document.createElement('div');
  content.className = 'message-content';
  if (pending) {
    content.classList.add('typing-indicator');
    content.setAttribute('aria-label', 'EduGenie is thinking');
    for (let index = 0; index < 3; index += 1) content.append(document.createElement('span'));
  } else if (error) {
    content.classList.add('error-message');
    content.textContent = text;
  } else if (role === 'user') {
    content.textContent = text;
  } else {
    renderReply(content, text);
  }
  body.append(content);

  if (role !== 'user' && !pending && !error) {
    const tools = document.createElement('div');
    tools.className = 'message-tools';
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button';
    copyButton.type = 'button';
    copyButton.title = 'Copy response';
    copyButton.setAttribute('aria-label', 'Copy response');
    copyButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg><span>Copy</span>';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Response copied');
      } catch {
        showToast('Clipboard access is unavailable in this browser');
      }
    });
    tools.append(copyButton);
    body.append(tools);
  }

  article.append(body);
  messagesElement.append(article);
  return article;
}

function updatePath(stage) {
  const pathItems = [...document.querySelectorAll('.path-item')];
  pathItems.forEach((item, index) => {
    item.classList.toggle('completed', index < stage);
    item.classList.toggle('current', index === stage);
  });
  document.querySelector('.focus-rule span').style.width = `${stage === 0 ? 36 : stage === 1 ? 68 : 100}%`;
}

function setSubject(button) {
  currentSubject = button.dataset.subject;
  subjectButtons.forEach((subjectButton) => {
    const selected = subjectButton === button;
    subjectButton.classList.toggle('selected', selected);
    if (selected) subjectButton.setAttribute('aria-current', 'true');
    else subjectButton.removeAttribute('aria-current');
  });
  document.querySelector('#breadcrumb-subject').textContent = currentSubject.toUpperCase();
  document.querySelector('#focus-subject').textContent = currentSubject;
  document.querySelector('#focus-note').textContent = button.dataset.note;
  document.querySelector('#welcome-subject-note').textContent = button.dataset.note.toUpperCase();

  starterButtons.forEach((starter, index) => {
    const [label, text, prompt, mark, iconClass] = starterSets[currentSubject][index];
    starter.dataset.prompt = prompt;
    starter.querySelector('.starter-label').textContent = label;
    starter.querySelector('.starter-text').textContent = text;
    const icon = starter.querySelector('.starter-icon');
    icon.textContent = mark;
    icon.className = `starter-icon ${iconClass}`;
  });
}

function setMode(mode) {
  currentMode = mode;
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  modeLabel.textContent = modes[mode].label;
  input.placeholder = modes[mode].placeholder;
}

function resetSession() {
  if (isSending) return;
  conversationHistory = [];
  messagesElement.replaceChildren();
  welcome.hidden = false;
  updatePath(0);
  conversation.scrollTop = 0;
  input.value = '';
  input.focus();
}

async function sendMessage(value) {
  const text = value.trim();
  if (!text || isSending) return;

  welcome.hidden = true;
  addMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });
  conversationHistory = conversationHistory.slice(-19);
  while (conversationHistory[0]?.role === 'model') conversationHistory.shift();
  input.value = '';
  input.style.height = 'auto';
  setBusy(true);
  updatePath(1);
  const pending = addMessage('model', '', { pending: true });
  conversation.scrollTop = conversation.scrollHeight;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: currentMode, subject: currentSubject, messages: conversationHistory }),
    });
    const result = await readApiResponse(response);
    pending.remove();
    if (!response.ok) throw new Error(result.error || 'Your tutor could not answer right now.');

    conversationHistory.push({ role: 'model', content: result.reply });
    addMessage('model', result.reply);
    updatePath(2);
  } catch (error) {
    pending.remove();
    const message = error instanceof TypeError
      ? 'Could not connect to EduGenie. Check that the server is running, then try again.'
      : error.message;
    addMessage('model', message, { error: true });
  } finally {
    setBusy(false);
    input.focus();
    conversation.scrollTop = conversation.scrollHeight;
  }
}

async function testConnection() {
  const button = document.querySelector('#test-connection');
  if (isSending || button.disabled) return;

  button.disabled = true;
  button.textContent = 'Checking...';
  try {
    const response = await fetch('/api/test-connection', { method: 'POST' });
    const result = await readApiResponse(response);
    if (!response.ok) {
      welcome.hidden = true;
      addMessage('model', result.error || 'Gemini connection test failed. Check the server configuration and try again.', { error: true });
      conversation.scrollTop = conversation.scrollHeight;
      return;
    }
    showToast(result.message);
  } catch (error) {
    welcome.hidden = true;
    const message = error instanceof TypeError
      ? 'Could not reach the EduGenie server. Check that it is running, then try the connection test again.'
      : error.message;
    addMessage('model', message, { error: true });
    conversation.scrollTop = conversation.scrollHeight;
  } finally {
    button.disabled = false;
    button.textContent = 'Test Gemini';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
subjectButtons.forEach((button) => button.addEventListener('click', () => setSubject(button)));
starterButtons.forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
document.querySelector('#new-session').addEventListener('click', resetSession);
document.querySelector('#sidebar-new-session').addEventListener('click', resetSession);
document.querySelector('#clear-session').addEventListener('click', resetSession);
document.querySelector('#test-connection').addEventListener('click', testConnection);
