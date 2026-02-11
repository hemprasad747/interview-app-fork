const aiPlaceholder = document.getElementById('ai-response-placeholder');
const aiLoading = document.getElementById('ai-response-loading');
const aiText = document.getElementById('ai-response-text');
const aiError = document.getElementById('ai-response-error');
const aiQuestionWrap = document.getElementById('ai-response-question-wrap');
const aiQuestion = document.getElementById('ai-response-question');
const responseResizeCorner = document.getElementById('response-resize-corner');
const aiResponseWrap = document.getElementById('ai-response-wrap');
const btnPrevAnswer = document.getElementById('btn-prev-answer');
const btnNextAnswer = document.getElementById('btn-next-answer');
const answerCounter = document.getElementById('answer-counter');

const MAX_HISTORY_MESSAGES = 10;
const DEFAULT_SYSTEM_PROMPT = 'You are the interviewee in a job interview. Always answer in first person as the candidate. Never act as an AI assistant: do not greet or offer to help; only answer the question asked. Never say you are an AI or assistant. Use the conversation history for follow-up questions.';
let aiBusy = false;
let currentAnswerIndex = 0;
let liveAnswerContent = '';
let liveQuestionContent = '';

const LAST_PAIRS_FOR_REQUEST = 6; // More conversation history for ChatGPT-like continuity
const MAX_RECENT_TRANSCRIPT_PARTS = 4;

/** Return only the current question - no merging with previous transcript to avoid context bleed. */
function mergeRecentTranscriptWithQuestion(transcript, currentQuestion) {
  // Return only the current question - no merging with previous transcript entries
  // This ensures each question is completely independent
  return (typeof currentQuestion === 'string' ? currentQuestion : '').trim();
}


function buildSystemPrompt(config, interviewSummary) {
  if (!config || typeof config !== 'object') return DEFAULT_SYSTEM_PROMPT;
  const lang = (config.language || 'en-US').trim() || 'en-US';
  const parts = [];
  
  // Only include basic config - let Azure instructions handle behavior
  // NO interview summary or context - each question is independent
  if (config.company) parts.push(`Company: ${config.company}`);
  if (config.position) parts.push(`Role: ${config.position}`);
  if (config.resume) parts.push(`Resume:\n${config.resume}`);
  if (config.instructions) parts.push(`Instructions:\n${config.instructions}`);
  parts.push(`Language: ${lang}`);
  
  return parts.length > 0 ? parts.join('\n\n') : DEFAULT_SYSTEM_PROMPT;
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (typeof window.marked !== 'undefined') {
  window.marked.setOptions({ gfm: true, breaks: true });
}

function formatAnswer(text) {
  if (!text || typeof text !== 'string') return '';
  if (typeof window.marked !== 'undefined') {
    try {
      const html = window.marked.parse(text.trim());
      return html || escapeHtml(text).replace(/\n/g, '<br>');
    } catch (_) {
      return escapeHtml(text).replace(/\n/g, '<br>');
    }
  }
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function applyHighlighting(container) {
  if (!container || !window.hljs) return;
  container.querySelectorAll('pre code').forEach((el) => {
    try { window.hljs.highlightElement(el); } catch (_) {}
  });
}

async function getAnswersFromHistory() {
  const history = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
  return history.filter((m) => m.role === 'assistant').map((m) => m.content).reverse();
}

/** Returns [{ question, answer }, ...] most recent first. */
async function getAnswerPairsFromHistory() {
  const history = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
  const pairs = [];
  for (let i = 0; i < history.length - 1; i += 2) {
    if (history[i].role === 'user' && history[i + 1].role === 'assistant') {
      pairs.push({ question: history[i].content, answer: history[i + 1].content });
    }
  }
  return pairs.reverse();
}

function setQuestionBlock(text) {
  if (!aiQuestionWrap || !aiQuestion) return;
  const t = typeof text === 'string' ? text.trim() : '';
  if (t) {
    aiQuestion.textContent = t;
    aiQuestionWrap.classList.remove('hidden');
  } else {
    aiQuestion.textContent = '';
    aiQuestionWrap.classList.add('hidden');
  }
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
  const pairs = await getAnswerPairsFromHistory();
  const total = Math.max(pairs.length, liveAnswerContent ? 1 : 0);
  if (total === 0) return;
  currentAnswerIndex = Math.max(0, Math.min(index, total - 1));
  if (currentAnswerIndex === 0 && aiBusy) return;
  if (currentAnswerIndex === 0 && liveAnswerContent) {
    setQuestionBlock(liveQuestionContent);
    aiText.innerHTML = liveAnswerContent;
  } else if (pairs[currentAnswerIndex]) {
    setQuestionBlock(pairs[currentAnswerIndex].question);
    aiText.innerHTML = formatAnswer(pairs[currentAnswerIndex].answer);
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
    else {
      aiPlaceholder.classList.remove('hidden');
      setQuestionBlock('');
    }
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
  liveQuestionContent = typeof currentQuestion === 'string' ? currentQuestion.trim() : '';
  liveAnswerContent = fullResponse ? formatAnswer(fullResponse) : '(No response)';
  currentAnswerIndex = 0;
  setQuestionBlock(liveQuestionContent);
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
  if (aiBusy || !window.floatingAPI?.callAIStream) return;
  aiBusy = true;
  if (aiText) { aiText.textContent = ''; aiText.innerHTML = ''; delete aiText.dataset.rawBuffer; }
  
  const handleChunk = (e) => onStreamChunk(e.detail);
  const handleDone = () => {
    window.removeEventListener('ai-stream-chunk', handleChunk);
    window.removeEventListener('ai-stream-done', handleDone);
    window.removeEventListener('ai-stream-error', handleError);
    onStreamDone(actualQuestion);
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

  const [config, , , transcript] = await Promise.all([
    window.floatingAPI?.getSessionConfig?.() || Promise.resolve(null),
    window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]),
    window.floatingAPI?.getInterviewSummary?.() || Promise.resolve(''),
    window.floatingAPI?.getTranscriptHistory?.() || Promise.resolve([]),
  ]);
  
  // Get the current question - use transcript to find latest unanswered question if q is empty
  let actualQuestion = q || '';
  if (!actualQuestion && Array.isArray(transcript) && transcript.length > 0) {
    // Get the latest transcript entry (most recent question)
    for (let i = transcript.length - 1; i >= 0; i--) {
      const t = transcript[i];
      if (t && t.text && !t.text.startsWith('[')) {
        actualQuestion = t.text.trim();
        break;
      }
    }
  }
  
  if (!actualQuestion) {
    aiBusy = false;
    return;
  }
  
  setQuestionBlock(actualQuestion);
  showAiState('loading');
  
  // No interview summary - each question is completely independent
  const systemPrompt = buildSystemPrompt(config, null);
  // No transcript merging - send only the current question
  const userContent = actualQuestion;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    await window.floatingAPI.callAIStream({ messages });
  } catch (e) {
    handleError({ detail: e.message || 'Request failed' });
  }
}

if (window.floatingAPI?.onAskQuestion) {
  // Legacy event-based path (main no longer pushes ask-question, kept for compatibility)
  window.floatingAPI.onAskQuestion((q) => {
    if (q) askAiWithQuestion(q);
  });
}

// Poll for pending questions so right panel pulls instead of main pushing events
if (window.floatingAPI?.getPendingAskQuestion) {
  setInterval(() => {
    window.floatingAPI.getPendingAskQuestion().then((q) => {
      if (q) askAiWithQuestion(q);
    });
  }, 200);
}

window.addEventListener('show-analysis-result', (e) => {
  const { question, answer } = e.detail || {};
  if (question == null && answer == null) return;
  const q = typeof question === 'string' ? question : 'Screen analysis';
  const a = typeof answer === 'string' ? answer : '';
  liveQuestionContent = q;
  liveAnswerContent = a ? formatAnswer(a) : '';
  currentAnswerIndex = 0;
  setQuestionBlock(q);
  if (aiText) {
    aiText.innerHTML = liveAnswerContent;
    applyHighlighting(aiText);
  }
  showAiState('text');
  updateAnswerNav();
});

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
