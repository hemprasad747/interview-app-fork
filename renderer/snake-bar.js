const snakeBarText = document.getElementById('snake-bar-text');
const btnExpandHistory = document.getElementById('btn-expand-history');

const SEP = '  ·  ';

function buildSnakeLine(transcriptHistory, live) {
  const parts = [];
  for (const t of transcriptHistory || []) {
    const text = (t.text || '').trim();
    if (text) parts.push(text);
  }
  if (live && typeof live === 'object') {
    const mic = (live.mic || '').trim();
    const system = (live.system || '').trim();
    if (mic) parts.push(mic);
    if (system) parts.push(system);
  }
  if (parts.length === 0) return '';
  return parts.join(SEP);
}

async function refreshSnakeText() {
  if (!snakeBarText) return;
  let transcript = [];
  let live = { mic: '', system: '' };
  try {
    if (window.floatingAPI?.getTranscriptHistory) transcript = await window.floatingAPI.getTranscriptHistory();
    if (window.floatingAPI?.getLiveTranscript) live = await window.floatingAPI.getLiveTranscript();
  } catch (_) {}
  const line = buildSnakeLine(transcript, live);
  snakeBarText.textContent = line;
}

const btnCloseSnake = document.getElementById('btn-close-snake');

if (btnExpandHistory) {
  btnExpandHistory.addEventListener('click', () => {
    if (window.floatingAPI?.setHistoryPanelVisible) window.floatingAPI.setHistoryPanelVisible(true);
    if (window.floatingAPI?.setSnakeBarVisible) window.floatingAPI.setSnakeBarVisible(false);
  });
}
if (btnCloseSnake) {
  btnCloseSnake.addEventListener('click', () => {
    if (window.floatingAPI?.setSnakeBarVisible) window.floatingAPI.setSnakeBarVisible(false);
  });
}

refreshSnakeText();

if (window.floatingAPI?.onLiveTranscriptUpdated) {
  window.floatingAPI.onLiveTranscriptUpdated(refreshSnakeText);
}
if (window.floatingAPI?.onHistoryUpdated) {
  window.floatingAPI.onHistoryUpdated(refreshSnakeText);
}
