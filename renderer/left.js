const historyList = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnClosePanel = document.getElementById('btn-close-panel');

const MAX_HISTORY_DISPLAY = 6;

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatTimePM(date) {
  if (!date) return '--:--';
  const d = date instanceof Date ? date : new Date(date);
  const h = d.getHours();
  const m = d.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (am ? 'AM' : 'PM');
}

function normalizeQuestion(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function renderHistory() {
  if (!historyList) return;
  const conversation = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
  const transcript = await (window.floatingAPI?.getTranscriptHistory?.() || Promise.resolve([]));
  const live = await (window.floatingAPI?.getLiveTranscript?.() || Promise.resolve({ mic: '', system: '' }));

  const items = [];
  const pairs = Math.floor(conversation.length / 2);
  const startPairs = Math.max(0, pairs - MAX_HISTORY_DISPLAY) * 2;
  const answeredQuestions = new Set();
  for (let i = startPairs; i < conversation.length; i += 2) {
    const userMsg = conversation[i];
    if (userMsg?.role === 'user' && userMsg?.content) {
      answeredQuestions.add(normalizeQuestion(userMsg.content));
    }
  }
  for (let i = startPairs; i < conversation.length; i += 2) {
    const userMsg = conversation[i];
    const assistantMsg = conversation[i + 1];
    if (userMsg?.role !== 'user' || !assistantMsg) continue;
    const qText = (userMsg.content || '').trim() || '—';
    const qNorm = normalizeQuestion(qText);
    let source = 'qa';
    const matchingTranscript = transcript.find((t) => normalizeQuestion(t.text) === qNorm);
    if (matchingTranscript) source = matchingTranscript.source || 'qa';
    items.push({ text: qText, time: userMsg.time, source, answer: (assistantMsg.content || '').trim() });
  }
  for (const t of transcript) {
    if (answeredQuestions.has(normalizeQuestion(t.text))) continue;
    items.push({
      text: t.text,
      time: t.time,
      source: t.source || 'mic',
      answer: '',
    });
  }
  items.sort((a, b) => {
    const ta = a.time?.getTime?.() || (a.time ? new Date(a.time).getTime() : 0);
    const tb = b.time?.getTime?.() || (b.time ? new Date(b.time).getTime() : 0);
    return ta - tb;
  });
  const recent = items.slice(-MAX_HISTORY_DISPLAY * 2);

  historyList.innerHTML = '';
  for (const it of recent) {
    const q = it.text || '—';
    const timeStr = formatTimePM(it.time);
    const label = it.source === 'system' ? 'Interviewer' : it.source === 'mic' ? 'You' : 'Q&A';
    const canAsk = (it.source === 'mic' || it.source === 'system') && q.length > 3 && !q.startsWith('[') && !it.answer;
    const isLeft = it.source === 'system';
    const sideClass = isLeft ? 'history-item-left' : 'history-item-right';
    const el = document.createElement('div');
    el.className = 'history-item ' + sideClass;
    el.innerHTML =
      '<div class="history-item-header">' + escapeHtml(label) + ' – ' + timeStr +
      (canAsk ? ' <button type="button" class="history-ask-btn" title="Get AI answer">→ Ask</button>' : '') + '</div>' +
      '<div class="history-item-q">' + escapeHtml(q) + '</div>';
    if (canAsk) {
      const btn = el.querySelector('.history-ask-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.floatingAPI?.requestAskQuestion) window.floatingAPI.requestAskQuestion(q);
        });
      }
    }
    historyList.appendChild(el);
  }
  if (live.mic && live.mic.trim()) {
    const el = document.createElement('div');
    el.className = 'history-item history-item-right history-item-live';
    el.innerHTML = '<div class="history-item-header">You – Live</div><div class="history-item-q">' + escapeHtml(live.mic) + '<span class="live-cursor">▌</span></div>';
    historyList.appendChild(el);
  }
  if (live.system && live.system.trim()) {
    const el = document.createElement('div');
    el.className = 'history-item history-item-left history-item-live';
    el.innerHTML = '<div class="history-item-header">Interviewer – Live</div><div class="history-item-q">' + escapeHtml(live.system) + '<span class="live-cursor">▌</span></div>';
    historyList.appendChild(el);
  }
  if (historyList) {
    requestAnimationFrame(() => {
      historyList.scrollTop = historyList.scrollHeight;
    });
  }
}

if (btnClearHistory) {
  btnClearHistory.addEventListener('click', () => {
    if (window.floatingAPI?.clearHistory) window.floatingAPI.clearHistory();
    renderHistory();
  });
}

if (btnClosePanel) {
  btnClosePanel.addEventListener('click', () => {
    if (window.floatingAPI?.setHistoryPanelVisible) window.floatingAPI.setHistoryPanelVisible(false);
    if (window.floatingAPI?.setSnakeBarVisible) window.floatingAPI.setSnakeBarVisible(true);
  });
}

if (window.floatingAPI?.onHistoryUpdated) {
  window.floatingAPI.onHistoryUpdated(() => renderHistory());
}
if (window.floatingAPI?.onLiveTranscriptUpdated) {
  window.floatingAPI.onLiveTranscriptUpdated(() => renderHistory());
}
// Poll for live transcript so main never pushes (avoids disposed-frame errors)
if (window.floatingAPI?.getLiveTranscript) {
  setInterval(() => renderHistory(), 300);
}

renderHistory();
