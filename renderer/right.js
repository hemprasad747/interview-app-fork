const aiPlaceholder = document.getElementById('ai-response-placeholder');
const aiLoading = document.getElementById('ai-response-loading');
const aiText = document.getElementById('ai-response-text');
const aiError = document.getElementById('ai-response-error');
const responseResizeCorner = document.getElementById('response-resize-corner');
const aiResponseWrap = document.getElementById('ai-response-wrap');
const btnPrevAnswer = document.getElementById('btn-prev-answer');
const btnNextAnswer = document.getElementById('btn-next-answer');
const answerCounter = document.getElementById('answer-counter');

const MAX_HISTORY_MESSAGES = 10;
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant. Answer in 1–3 short sentences. Use the conversation history to answer follow-up questions.';
let aiBusy = false;
let currentAnswerIndex = 0;
let liveAnswerContent = '';

function buildSystemPrompt(config) {
  if (!config || typeof config !== 'object') return DEFAULT_SYSTEM_PROMPT;
  const lang = (config.language || 'en-US').trim() || 'en-US';
  const parts = [
    'You are an interview assistant helping the candidate answer questions during a job interview.',
    `You must answer entirely in the language for locale "${lang}". All your responses must be in this language only.`,
  ];
  if (config.company) parts.push(`Interview company: ${config.company}.`);
  if (config.position) parts.push(`Position: ${config.position}.`);
  if (config.resume) parts.push(`Candidate resume/summary:\n${config.resume}`);
  if (config.instructions) parts.push(`Instructions for how to answer:\n${config.instructions}`);
  parts.push('Keep answers concise (1–3 short sentences when possible). Use the conversation history to answer follow-up questions.');
  parts.push('Format answers clearly: use **bold** for key terms, numbered lists (1. 2. 3.) for multiple points, bullet points (- or *) for lists, and fenced code blocks (```language then code then ```) for code examples.');
  return parts.join('\n');
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatAnswer(text) {
  if (!text || typeof text !== 'string') return '';
  const codeBlocks = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escapedCode = escapeHtml(code.trimEnd());
    const langClass = lang ? ` language-${lang}` : ' language-plaintext';
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="ai-code-block"><code class="ai-code${langClass}">${escapedCode}</code></pre>`);
    return `\n\x01CODE\x01${idx}\x01\n`;
  });
  const escaped = escapeHtml(processed);
  let out = escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\b__(.+?)__\b/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\b_(.+?)_\b/g, '<em>$1</em>');
  const lines = out.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const codeMatch = line.match(/\x01CODE\x01(\d+)\x01/);
    if (codeMatch) {
      result.push(codeBlocks[parseInt(codeMatch[1], 10)]);
      i++;
      continue;
    }
    const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (numMatch) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const m = lines[i].match(/^\d+\.\s+(.*)$/);
        items.push('<li>' + m[1] + '</li>');
        i++;
      }
      result.push('<ol>' + items.join('') + '</ol>');
      continue;
    }
    if (bulletMatch) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        const m = lines[i].match(/^[-*]\s+(.*)$/);
        items.push('<li>' + m[1] + '</li>');
        i++;
      }
      result.push('<ul>' + items.join('') + '</ul>');
      continue;
    }
    result.push(line ? '<p>' + line + '</p>' : '');
    i++;
  }
  return result.filter(Boolean).join('') || escaped.replace(/\n/g, '<br>');
}

function applyHighlighting(container) {
  if (!container || !window.hljs) return;
  container.querySelectorAll('pre code.ai-code').forEach((el) => {
    try { window.hljs.highlightElement(el); } catch (_) {}
  });
}

async function getAnswersFromHistory() {
  const history = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
  return history.filter((m) => m.role === 'assistant').map((m) => m.content).reverse();
}

function updateAnswerNav() {
  if (!btnPrevAnswer || !btnNextAnswer || !answerCounter) return;
  getAnswersFromHistory().then((answers) => {
    const total = Math.max(answers.length, liveAnswerContent ? 1 : 0);
    const canPrev = total > 1 && currentAnswerIndex < total - 1;
    const canNext = currentAnswerIndex > 0;
    btnPrevAnswer.disabled = !canPrev;
    btnNextAnswer.disabled = !canNext;
    answerCounter.textContent = total > 1 ? `${currentAnswerIndex + 1} of ${total}` : '';
  });
}

async function showAnswerAtIndex(index) {
  const answers = await getAnswersFromHistory();
  const total = Math.max(answers.length, liveAnswerContent ? 1 : 0);
  if (total === 0) return;
  currentAnswerIndex = Math.max(0, Math.min(index, total - 1));
  if (currentAnswerIndex === 0 && aiBusy) return;
  if (currentAnswerIndex === 0 && liveAnswerContent) {
    aiText.innerHTML = liveAnswerContent;
  } else if (answers[currentAnswerIndex]) {
    aiText.innerHTML = formatAnswer(answers[currentAnswerIndex]);
  }
  applyHighlighting(aiText);
  showAiState('text');
  updateAnswerNav();
}

function showAiState(which) {
  if (!aiPlaceholder || !aiLoading || !aiText || !aiError) return;
  aiPlaceholder.classList.add('hidden');
  aiLoading.classList.add('hidden');
  aiText.classList.add('hidden');
  aiError.classList.add('hidden');
  if (which === 'placeholder') {
    if ((aiText.textContent || '').trim() || (aiText.dataset.rawBuffer || '').trim()) which = 'text';
    else aiPlaceholder.classList.remove('hidden');
  }
  if (which === 'loading') aiLoading.classList.remove('hidden');
  else if (which === 'text') aiText.classList.remove('hidden');
  else if (which === 'error') aiError.classList.remove('hidden');
}

function onStreamChunk(chunk) {
  if (!aiText) return;
  const raw = (aiText.dataset.rawBuffer || '') + (chunk || '');
  aiText.dataset.rawBuffer = raw;
  aiText.innerHTML = formatAnswer(raw);
  applyHighlighting(aiText);
  showAiState('text');
}

function onStreamDone(currentQuestion) {
  aiBusy = false;
  if (!aiText) return;
  const fullResponse = (aiText.dataset.rawBuffer || aiText.textContent || '').trim() || '(No response)';
  delete aiText.dataset.rawBuffer;
  liveAnswerContent = fullResponse ? formatAnswer(fullResponse) : '(No response)';
  currentAnswerIndex = 0;
  aiText.innerHTML = liveAnswerContent;
  applyHighlighting(aiText);
  showAiState('text');
  aiText.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (window.floatingAPI?.appendConversation) {
    window.floatingAPI.appendConversation(currentQuestion, fullResponse);
  }
  updateAnswerNav();
}

function onStreamError(err) {
  aiBusy = false;
  if (aiError) {
    aiError.textContent = typeof err === 'string' ? err : (err?.message || 'Request failed');
    showAiState('error');
  }
}

async function askAiWithQuestion(q) {
  if (!q || aiBusy || !window.floatingAPI?.callAIStream) return;
  aiBusy = true;
  if (aiText) { aiText.textContent = ''; aiText.innerHTML = ''; delete aiText.dataset.rawBuffer; }
  showAiState('loading');

  const handleChunk = (e) => onStreamChunk(e.detail);
  const handleDone = () => {
    window.removeEventListener('ai-stream-chunk', handleChunk);
    window.removeEventListener('ai-stream-done', handleDone);
    window.removeEventListener('ai-stream-error', handleError);
    onStreamDone(q);
  };
  const handleError = (e) => {
    window.removeEventListener('ai-stream-chunk', handleChunk);
    window.removeEventListener('ai-stream-done', handleDone);
    window.removeEventListener('ai-stream-error', handleError);
    onStreamError(e.detail);
  };

  window.addEventListener('ai-stream-chunk', handleChunk);
  window.addEventListener('ai-stream-done', handleDone);
  window.addEventListener('ai-stream-error', handleError);

  const config = await (window.floatingAPI?.getSessionConfig?.() || Promise.resolve(null));
  const systemPrompt = buildSystemPrompt(config);
  const conversation = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversation.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: q },
  ];

  try {
    await window.floatingAPI.callAIStream({ messages });
  } catch (e) {
    handleError({ detail: e.message || 'Request failed' });
  }
}

if (window.floatingAPI?.onAskQuestion) {
  window.floatingAPI.onAskQuestion((q) => {
    if (q) askAiWithQuestion(q);
  });
}

let layoutInverted = false;
function setLayoutInverted(inverted) {
  layoutInverted = !!inverted;
  const panel = document.querySelector('.panel-right-standalone');
  if (panel) panel.classList.toggle('layout-inverted', layoutInverted);
}
if (window.floatingAPI?.onLayoutInverted) {
  window.floatingAPI.onLayoutInverted(setLayoutInverted);
}
if (window.floatingAPI?.getLayoutInverted) {
  window.floatingAPI.getLayoutInverted().then(setLayoutInverted);
}

if (responseResizeCorner && window.floatingAPI?.getRightPanelBounds && window.floatingAPI?.setRightPanelBounds) {
  let resizeStart = null;
  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    window.floatingAPI.getRightPanelBounds().then((b) => {
      if (!b) return;
      resizeStart = { screenX: e.screenX, screenY: e.screenY, x: b.x, y: b.y, width: b.width, height: b.height };
    });
  }
  function onMove(e) {
    if (!resizeStart) return;
    const dx = e.screenX - resizeStart.screenX;
    const dy = e.screenY - resizeStart.screenY;
    const w = Math.round(Math.max(200, Math.min(800, resizeStart.width + dx)));
    let h;
    let opts;
    if (layoutInverted) {
      h = Math.round(Math.max(120, Math.min(600, resizeStart.height - dy)));
      const newY = resizeStart.y + resizeStart.height - h;
      opts = { x: resizeStart.x, y: newY, width: w, height: h };
      resizeStart = { screenX: e.screenX, screenY: e.screenY, x: resizeStart.x, y: newY, width: w, height: h };
    } else {
      h = Math.round(Math.max(120, Math.min(600, resizeStart.height + dy)));
      opts = { width: w, height: h };
      resizeStart = { screenX: e.screenX, screenY: e.screenY, x: resizeStart.x, y: resizeStart.y, width: w, height: h };
    }
    window.floatingAPI.setRightPanelBounds(opts);
  }
  function onUp() {
    resizeStart = null;
  }
  responseResizeCorner.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

if (btnPrevAnswer) {
  btnPrevAnswer.addEventListener('click', () => showAnswerAtIndex(currentAnswerIndex + 1));
}
if (btnNextAnswer) {
  btnNextAnswer.addEventListener('click', () => showAnswerAtIndex(currentAnswerIndex - 1));
}

showAiState('placeholder');
updateAnswerNav();
