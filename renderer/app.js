const viewIcon = document.getElementById('view-icon');
const viewMenu = document.getElementById('view-menu');
const viewBar = document.getElementById('view-bar');
const btnIcon = document.getElementById('btn-icon');
const btnIconMenu = document.getElementById('btn-icon-menu');
const btnStartSession = document.getElementById('btn-start-session');
const btnEndSession = document.getElementById('btn-end-session');
const barTimer = document.getElementById('bar-timer');
const questionInput = document.getElementById('question-input');
const btnAskAi = document.getElementById('btn-ask-ai');
const btnAskAiHeader = document.getElementById('btn-ask-ai-header');
const aiPlaceholder = document.getElementById('ai-response-placeholder');
const aiLoading = document.getElementById('ai-response-loading');
const aiText = document.getElementById('ai-response-text');
const aiError = document.getElementById('ai-response-error');
const aiQuestionText = document.getElementById('ai-question-text');
const historyList = document.getElementById('history-list');
const btnCollapse = document.getElementById('btn-collapse');
const btnMic = document.getElementById('btn-mic');
const btnSystemAudio = document.getElementById('btn-system-audio');
const btnClearResponse = document.getElementById('btn-clear-response');
const btnHistoryAutoScroll = document.getElementById('btn-history-autoscroll');
const btnHideHistory = document.getElementById('btn-hide-history');
const btnHideResponse = document.getElementById('btn-hide-response');
const historyPanel = document.getElementById('history-area');
const responsePanel = document.getElementById('response-panel');

let timerInterval = null;
let seconds = 0;
let aiBusy = false;
let sessionActive = false;
let suppressIconClick = false;
// Full conversation for follow-up context (user + assistant messages only; system added when sending).
// Keep 7 pairs (14 messages); send last 7 pairs per request for richer follow-up answers.
const MAX_HISTORY_MESSAGES = 14;
const LAST_PAIRS_FOR_REQUEST = 7;
const MAX_HISTORY_DISPLAY = 7;
let conversationHistory = [];
// Live transcriptions from mic (shown in history)
let transcriptHistory = [];
let speechRecognition = null;
let azureRecognizer = null;
let liveTranscriptBuffer = '';
let isMicRecording = false;
let useWhisperFallback = false;
let lastSpeechError = null;
let mediaRecorder = null;
let audioStream = null;
let recordingChunks = [];
let isSystemAudioCapturing = false;
let systemAudioStream = null;
let systemAudioRecorder = null;
let systemAudioAzureRecognizer = null;
let systemAudioQuestionBuffer = '';
let systemAudioLiveBuffer = '';
let systemAudioPauseTimer = null;
let micQuestionBuffer = '';
let micLiveBuffer = '';
let micPauseTimer = null;
let micFlushPending = false; // Track if we've flushed but might get more speech
let micFlushPendingTimer = null;
let deepgramSocket = null;
let deepgramAudioContext = null;
let deepgramProcessor = null;
let deepgramSystemSocket = null;
let deepgramSystemAudioContext = null;
let deepgramSystemProcessor = null;
/** Only generate answer after this much silence. No answer until this pause (e.g. 1 min question). Use 2s for faster response. */
const SYSTEM_AUDIO_PAUSE_MS = 2000;
const SYSTEM_AUDIO_FLUSH_COOLDOWN_MS = 2500;
let systemAudioLastFlushTime = 0;
let historyAutoScroll = true;
let aiStreamBuffer = '';

function setHistoryAutoScroll(enabled) {
  historyAutoScroll = !!enabled;
  if (btnHistoryAutoScroll) {
    btnHistoryAutoScroll.classList.toggle('panel-pill-active', historyAutoScroll);
  }
}

// Click-through: only active when bar view is visible
const PASS_THROUGH_THROTTLE_MS = 16;
const PASS_THROUGH_RECOVER_MS = 200;
let passThroughIgnore = null;
let passThroughLastTime = 0;
let passThroughRecoverTimer = null;
let passThroughMoveBound = null;
let passThroughLeaveBound = null;

function startPassThrough() {
  if (!window.floatingAPI?.setIgnoreMouseEvents) return;
  passThroughIgnore = null;
  passThroughMoveBound = function (e) {
    if (viewBar.classList.contains('hidden')) return;
    const now = Date.now();
    if (now - passThroughLastTime < PASS_THROUGH_THROTTLE_MS) return;
    passThroughLastTime = now;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overTransparent = el && el.closest('[data-transparent="true"]') && !el.closest('[data-no-pass-through="true"]');
    if (overTransparent === passThroughIgnore) return;
    passThroughIgnore = overTransparent;
    window.floatingAPI.setIgnoreMouseEvents(overTransparent);
  };
  passThroughLeaveBound = function () {
    if (passThroughIgnore === false) return;
    passThroughIgnore = false;
    window.floatingAPI.setIgnoreMouseEvents(false);
  };
  document.addEventListener('mousemove', passThroughMoveBound);
  document.addEventListener('mouseleave', passThroughLeaveBound);
  // When cursor moves from transparent area to history (same window), we get no event; un-ignore periodically so next mousemove can fix state
  passThroughRecoverTimer = setInterval(function () {
    if (passThroughIgnore !== true) return;
    window.floatingAPI.setIgnoreMouseEvents(false);
    passThroughIgnore = null;
  }, PASS_THROUGH_RECOVER_MS);
}

function stopPassThrough() {
  if (passThroughMoveBound) {
    document.removeEventListener('mousemove', passThroughMoveBound);
    passThroughMoveBound = null;
  }
  if (passThroughLeaveBound) {
    document.removeEventListener('mouseleave', passThroughLeaveBound);
    passThroughLeaveBound = null;
  }
  if (passThroughRecoverTimer) {
    clearInterval(passThroughRecoverTimer);
    passThroughRecoverTimer = null;
  }
  passThroughIgnore = null;
  if (window.floatingAPI?.setIgnoreMouseEvents) window.floatingAPI.setIgnoreMouseEvents(false);
}

function showView(name) {
  viewIcon.classList.add('hidden');
  viewMenu.classList.add('hidden');
  viewBar.classList.add('hidden');
  if (name === 'icon') {
    viewIcon.classList.remove('hidden');
    stopPassThrough();
  } else if (name === 'menu') {
    viewMenu.classList.remove('hidden');
    stopPassThrough();
  } else if (name === 'bar') {
    viewBar.classList.remove('hidden');
    startPassThrough();
  }
}

function startTimer() {
  seconds = 0;
  barTimer.textContent = '0:00';
  timerInterval = setInterval(() => {
    seconds++;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    barTimer.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// Icon click → show menu, resize to menu
btnIcon.addEventListener('click', () => {
  if (suppressIconClick) {
    suppressIconClick = false;
    return;
  }
  if (!window.floatingAPI?.setSize) return;
  if (sessionActive) {
    window.floatingAPI.setSize('bar');
    showView('bar');
  } else {
    window.floatingAPI.setSize('menu');
    showView('menu');
  }
});

// Icon click when menu visible → back to icon (optional: or keep menu open)
btnIconMenu.addEventListener('click', () => {
  if (!window.floatingAPI?.setSize) return;
  window.floatingAPI.setSize('icon');
  showView('icon');
});

// Start Session → show bar, resize to bar
btnStartSession.addEventListener('click', () => {
  if (!window.floatingAPI?.setSize) return;
  window.floatingAPI.setSize('bar');
  showView('bar');
  startTimer();
  renderHistory();
  sessionActive = true;
});

// End Session → back to icon, clear conversation for next session
btnEndSession.addEventListener('click', () => {
  if (!window.floatingAPI?.setSize) return;
  stopTimer();
  stopMic();
  stopSystemAudio();
  useWhisperFallback = false;
  conversationHistory = [];
  transcriptHistory = [];
  window.floatingAPI.setSize('icon');
  showView('icon');
  sessionActive = false;
});

// Clear history (delete all in history block)
const btnClearHistory = document.getElementById('btn-clear-history');
if (btnClearHistory) {
  btnClearHistory.addEventListener('click', () => {
    conversationHistory = [];
    transcriptHistory = [];
    liveTranscriptBuffer = '';
    renderHistory();
  });
}

if (btnHistoryAutoScroll) {
  setHistoryAutoScroll(true);
  btnHistoryAutoScroll.addEventListener('click', () => {
    setHistoryAutoScroll(!historyAutoScroll);
  });
}

if (historyList) {
  historyList.addEventListener('scroll', () => {
    if (!historyAutoScroll) return;
    const atBottom = historyList.scrollTop + historyList.clientHeight >= historyList.scrollHeight - 2;
    if (!atBottom) setHistoryAutoScroll(false);
  });
}

if (btnClearResponse) {
  btnClearResponse.addEventListener('click', () => {
    if (aiQuestionText) aiQuestionText.textContent = '';
    if (aiText) aiText.textContent = '';
    showAiState('placeholder');
  });
}

if (btnHideHistory && historyPanel) {
  btnHideHistory.addEventListener('click', () => {
    historyPanel.classList.toggle('hidden');
  });
}

if (btnHideResponse && responsePanel) {
  btnHideResponse.addEventListener('click', () => {
    responsePanel.classList.toggle('hidden');
  });
}

// Mic: Azure Speech (primary), Web Speech, or Whisper fallback
function stopMic() {
  if (!isMicRecording) return;
  isMicRecording = false;
  if (azureRecognizer) {
    try {
      azureRecognizer.stopContinuousRecognitionAsync(() => {}, () => {});
    } catch (_) {}
    azureRecognizer.close();
    azureRecognizer = null;
  }
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (_) {}
    speechRecognition = null;
  }
  if (deepgramSocket) {
    try { deepgramSocket.close(); } catch (_) {}
    deepgramSocket = null;
  }
  if (deepgramProcessor && deepgramAudioContext) {
    try { deepgramProcessor.disconnect(); } catch (_) {}
    deepgramProcessor = null;
  }
  if (deepgramAudioContext && deepgramAudioContext.state !== 'closed') {
    deepgramAudioContext.close().catch(() => {});
    deepgramAudioContext = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
  mediaRecorder = null;
  recordingChunks = [];
  if (micPauseTimer) {
    clearTimeout(micPauseTimer);
    micPauseTimer = null;
  }
  if (micFlushPendingTimer) {
    clearTimeout(micFlushPendingTimer);
    micFlushPendingTimer = null;
  }
  micFlushPending = false;
  if ((micQuestionBuffer || '').trim()) {
    addTranscriptionToHistory(micQuestionBuffer.trim(), new Date(), 'mic');
    micQuestionBuffer = '';
  }
  micLiveBuffer = '';
  liveTranscriptBuffer = '';
  if (btnMic) btnMic.classList.remove('mic-active');
  renderHistory();
}

function addTranscriptionToHistory(text, time, source = 'mic') {
  if (!text || !text.trim()) return;
  if (!sessionActive) return;
  transcriptHistory.push({ text: text.trim(), time: time || new Date(), source });
  setHistoryAutoScroll(true); // scroll down to new transcription
  renderHistory();
}

/** Append to mic buffer; show combined phrase (buffer + live) before pause. Flush one entry after pause. */
function appendMicTranscriptToHistory(transcript) {
  const t = (transcript || '').trim();
  if (!t) return;
  
  // If we have a pending flush but new speech arrived, cancel the pending flush
  if (micFlushPending) {
    micFlushPending = false;
    if (micFlushPendingTimer) {
      clearTimeout(micFlushPendingTimer);
      micFlushPendingTimer = null;
    }
  }
  
  micQuestionBuffer = (micQuestionBuffer ? micQuestionBuffer + ' ' : '') + t;
  if (micPauseTimer) clearTimeout(micPauseTimer);
  micPauseTimer = setTimeout(flushMicQuestion, SYSTEM_AUDIO_PAUSE_MS);
}

function flushMicQuestion() {
  if (micPauseTimer) {
    clearTimeout(micPauseTimer);
    micPauseTimer = null;
  }
  // Combine buffer and live buffer to capture the complete question
  // This ensures we don't lose interim results when flushing
  const buf = (micQuestionBuffer || '').trim();
  const live = (micLiveBuffer || '').trim();
  const q = buf ? (live ? buf + ' ' + live : buf) : live;
  
  if (!q) return;
  
  // Mark as pending flush - wait a bit to see if speech continues
  micFlushPending = true;
  
  // Clear any existing pending timer
  if (micFlushPendingTimer) {
    clearTimeout(micFlushPendingTimer);
    micFlushPendingTimer = null;
  }
  
  // Wait 1.5 seconds more - if no new speech arrives, then flush and trigger AI
  micFlushPendingTimer = setTimeout(() => {
    if (micFlushPending) {
      // Final flush - no new speech arrived, safe to send
      const finalBuf = (micQuestionBuffer || '').trim();
      const finalLive = (micLiveBuffer || '').trim();
      const finalQ = finalBuf ? (finalLive ? finalBuf + ' ' + finalLive : finalBuf) : finalLive;
      
      micQuestionBuffer = '';
      micLiveBuffer = '';
      liveTranscriptBuffer = '';
      micFlushPending = false;
      micFlushPendingTimer = null;
      
      if (finalQ) {
        addTranscriptionToHistory(finalQ, new Date(), 'mic');
        renderHistory();
        // Auto-trigger AI for mic questions - AI will use transcript history instead of direct question
        if (!aiBusy && window.floatingAPI?.callAIStream) askAiWithQuestion('');
      }
    }
  }, 1500); // Additional 1.5s grace period after initial pause
}

function getMicLiveCombined() {
  const buf = (micQuestionBuffer || '').trim();
  const live = (micLiveBuffer || '').trim();
  return buf ? (live ? buf + ' ' + live : buf) : live;
}

function getSystemLiveCombined() {
  const buf = (systemAudioQuestionBuffer || '').trim();
  const live = (systemAudioLiveBuffer || '').trim();
  return buf ? (live ? buf + ' ' + live : buf) : live;
}

function showSpeechErrorOnce(msg) {
  if (lastSpeechError === msg) return;
  lastSpeechError = msg;
  addTranscriptionToHistory('[Speech: ' + msg + '] Using streaming Whisper (~1.5s chunks).', new Date());
}

const FALLBACK_TRANSCRIBE_MIN_BYTES = 4000;
let fallbackTranscribeErrorCount = 0;
async function transcribeChunk(blob, mimeType) {
  if (!window.floatingAPI?.transcribeAudio || blob.size < FALLBACK_TRANSCRIBE_MIN_BYTES) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1] || '';
      if (!base64) { resolve(null); return; }
      try {
        const result = await window.floatingAPI.transcribeAudio(base64, mimeType);
        if (result?.text) fallbackTranscribeErrorCount = 0;
        resolve(result);
      } catch (e) {
        resolve({ error: e.message });
      }
    };
    reader.readAsDataURL(blob);
  });
}

async function startWhisperFallback() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    addTranscriptionToHistory('[Mic error: ' + (e.message || 'Permission denied') + ']', new Date());
    return;
  }
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm' : 'audio/webm';
  mediaRecorder = new MediaRecorder(audioStream);
  mediaRecorder.ondataavailable = async (e) => {
    if (!isMicRecording || !sessionActive || !e.data?.size) return;
    const blob = e.data;
    const result = await transcribeChunk(blob, mimeType);
    if (result?.text) appendMicTranscriptToHistory(result.text);
    else if (result?.error && !result.error.includes('Empty')) {
      fallbackTranscribeErrorCount++;
      if (fallbackTranscribeErrorCount <= 2) addTranscriptionToHistory('[Transcribe: ' + result.error + ']', new Date());
    }
  };
  mediaRecorder.onstop = () => {};
  mediaRecorder.start(4000);
  isMicRecording = true;
  if (btnMic) btnMic.classList.add('mic-active');
}

async function startAzureSpeech(keyOrToken, region, language, useToken = false) {
  const sdk = window.SpeechSDK || window.Microsoft?.CognitiveServices?.Speech;
  if (!sdk) {
    addTranscriptionToHistory('[Azure SDK not loaded]', new Date());
    return false;
  }
  const lang = (language || 'en-US').trim() || 'en-US';
  try {
    const speechConfig = useToken
      ? sdk.SpeechConfig.fromAuthorizationToken(keyOrToken, region)
      : sdk.SpeechConfig.fromSubscription(keyOrToken, region);
    speechConfig.speechRecognitionLanguage = lang;
    // Optimize for accuracy over speed
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000'); // Increased from 2000ms for better accuracy
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, 'Time');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '500'); // Increased from 350ms for more accurate phrase detection
    speechConfig.setProperty(sdk.PropertyId.Speech_StartEventSensitivity, 'medium'); // Changed from 'high' to reduce false starts
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '3'); // Increased from 1 for more stable/accurate interim results
    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    azureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    liveTranscriptBuffer = '';
    azureRecognizer.recognizing = (s, e) => {
      if (!sessionActive || !isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        micLiveBuffer = (e.result.text || '').trim();
        // Reset flush timer when interim results arrive to prevent premature flushing
        // This ensures continuous speech accumulates properly even after pauses
        if (micQuestionBuffer && micPauseTimer) {
          clearTimeout(micPauseTimer);
          micPauseTimer = setTimeout(flushMicQuestion, SYSTEM_AUDIO_PAUSE_MS);
        }
        // Cancel pending flush if new speech continues
        if (micFlushPending) {
          micFlushPending = false;
          if (micFlushPendingTimer) {
            clearTimeout(micFlushPendingTimer);
            micFlushPendingTimer = null;
          }
        }
        liveTranscriptBuffer = getMicLiveCombined();
        setHistoryAutoScroll(true);
        renderHistory();
      }
    };
    azureRecognizer.recognized = (s, e) => {
      if (!sessionActive || !isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        appendMicTranscriptToHistory(e.result.text);
        micLiveBuffer = '';
        liveTranscriptBuffer = getMicLiveCombined();
        renderHistory();
      }
    };
    azureRecognizer.canceled = (s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        addTranscriptionToHistory('[Azure: ' + (e.errorDetails || e.errorCode) + ']', new Date());
        useWhisperFallback = true;
        stopMic();
        startWhisperFallback();
      }
    };
    await azureRecognizer.startContinuousRecognitionAsync();
    isMicRecording = true;
    if (btnMic) btnMic.classList.add('mic-active');
    return true;
  } catch (e) {
    addTranscriptionToHistory('[Azure: ' + (e.message || e) + ']', new Date());
    return false;
  }
}

function buildDeepgramStreamingUrl(language) {
  const lang = (language || 'en').trim().split('-')[0] || 'en';
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    language: lang,
    model: 'nova-2',
    // More accurate, sentence-level results (no partials)
    interim_results: 'false',
    utterances: 'true',
    punctuate: 'true',
    smart_format: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function createDeepgramPcmSender(socket, contextSampleRate) {
  const targetRate = 16000;
  const ratio = contextSampleRate / targetRate;
  return function (float32) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    // Larger chunks for more context per request (slightly more delay, higher accuracy)
    const len = Math.floor(float32.length / ratio / 2) * 2 || Math.floor(float32.length / ratio);
    const int16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const v = float32[Math.floor(i * ratio)];
      int16[i] = v < -1 ? -32768 : v > 1 ? 32767 : Math.round(v * 32767);
    }
    socket.send(int16.buffer);
  };
}

const DEEPGRAM_WORKLET_CODE = `
class DeepgramPCMProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const channel = input[0];
    if (!channel || !channel.length) return true;
    this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor('deepgram-pcm', DeepgramPCMProcessor);
`;

async function connectDeepgramWithWorklet(ctx, stream, sendPcm, isMic) {
  const blob = new Blob([DEEPGRAM_WORKLET_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'deepgram-pcm');
    node.port.onmessage = (e) => {
      if (isMic && (!isMicRecording || !deepgramSocket || deepgramSocket.readyState !== WebSocket.OPEN)) return;
      if (!isMic && (!isSystemAudioCapturing || !deepgramSystemSocket || deepgramSystemSocket.readyState !== WebSocket.OPEN)) return;
      sendPcm(e.data);
    };
    src.connect(node);
    node.connect(ctx.destination);
    return node;
  } catch (_) {
    URL.revokeObjectURL(url);
    throw new Error('AudioWorklet not available');
  }
}

function connectDeepgramWithScriptProcessor(ctx, stream, sendPcm, isMic) {
  const src = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (isMic && (!isMicRecording || !deepgramSocket || deepgramSocket.readyState !== WebSocket.OPEN)) return;
    if (!isMic && (!isSystemAudioCapturing || !deepgramSystemSocket || deepgramSystemSocket.readyState !== WebSocket.OPEN)) return;
    sendPcm(e.inputBuffer.getChannelData(0));
  };
  src.connect(processor);
  processor.connect(ctx.destination);
  return processor;
}

async function startDeepgramMic(apiKey, language) {
  const url = buildDeepgramStreamingUrl(language);
  try {
    deepgramSocket = new WebSocket(url, ['token', apiKey]);
  } catch (e) {
    addTranscriptionToHistory('[Deepgram: ' + (e.message || 'WebSocket failed') + ']', new Date());
    useWhisperFallback = true;
    startWhisperFallback();
    return;
  }
  deepgramSocket.onopen = () => {
    (async () => {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        deepgramAudioContext = ctx;
        const sendPcm = createDeepgramPcmSender(deepgramSocket, ctx.sampleRate);
        try {
          deepgramProcessor = await connectDeepgramWithWorklet(ctx, audioStream, sendPcm, true);
        } catch (_) {
          deepgramProcessor = connectDeepgramWithScriptProcessor(ctx, audioStream, sendPcm, true);
        }
        isMicRecording = true;
        if (btnMic) btnMic.classList.add('mic-active');
      } catch (e) {
        addTranscriptionToHistory('[Deepgram mic: ' + (e && e.message ? e.message : 'Failed') + '] Using fallback.', new Date());
        useWhisperFallback = true;
        stopMic();
        startWhisperFallback();
      }
    })().catch(() => {
      addTranscriptionToHistory('[Deepgram mic: error] Using fallback.', new Date());
      useWhisperFallback = true;
      stopMic();
      startWhisperFallback();
    });
  };
  deepgramSocket.onmessage = (event) => {
    if (!sessionActive || !isMicRecording) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'Results') return;
      const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript) return;
      if (msg.speech_final || msg.is_final) {
        appendMicTranscriptToHistory(transcript);
        micLiveBuffer = '';
      } else {
        micLiveBuffer = transcript;
        // Reset flush timer when interim results arrive to prevent premature flushing
        // This ensures continuous speech accumulates properly even after pauses
        if (micQuestionBuffer && micPauseTimer) {
          clearTimeout(micPauseTimer);
          micPauseTimer = setTimeout(flushMicQuestion, SYSTEM_AUDIO_PAUSE_MS);
        }
        // Cancel pending flush if new speech continues
        if (micFlushPending) {
          micFlushPending = false;
          if (micFlushPendingTimer) {
            clearTimeout(micFlushPendingTimer);
            micFlushPendingTimer = null;
          }
        }
      }
      liveTranscriptBuffer = getMicLiveCombined();
      setHistoryAutoScroll(true);
      renderHistory();
    } catch (_) {}
  };
  deepgramSocket.onerror = () => {
    addTranscriptionToHistory('[Deepgram: connection error] Using fallback.', new Date());
    useWhisperFallback = true;
    stopMic();
    startWhisperFallback();
  };
  deepgramSocket.onclose = () => {
    if (!isMicRecording) return;
    flushMicQuestion();
  };
}

async function startMic() {
  if (isMicRecording) return;
  lastSpeechError = null;
  if (useWhisperFallback) {
    startWhisperFallback();
    return;
  }
  const provider = await (window.floatingAPI?.getSpeechProvider?.() || Promise.resolve('azure'));
  if (provider === 'deepgram') {
    const dgConfig = await (window.floatingAPI?.getDeepgramStreamingConfig?.() || Promise.resolve(null));
    if (dgConfig?.code === 'FREE_SESSION_COOLDOWN') {
      if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
      return;
    }
    if (dgConfig?.apiKey) {
      await startDeepgramMic(dgConfig.apiKey, dgConfig.language);
      return;
    }
    addTranscriptionToHistory('[Deepgram: no config] Using Azure.', new Date());
  }
  const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
  if (azureConfig?.code === 'FREE_SESSION_COOLDOWN') {
    if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
    return;
  }
  if (azureConfig?.region && (azureConfig.token || azureConfig.key)) {
    const ok = await startAzureSpeech(
      azureConfig.token || azureConfig.key,
      azureConfig.region,
      azureConfig.language,
      !!azureConfig.token
    );
    if (ok) return;
    useWhisperFallback = true;
    startWhisperFallback();
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addTranscriptionToHistory('[Live transcription not supported] Using Whisper fallback.', new Date());
    useWhisperFallback = true;
    startWhisperFallback();
    return;
  }
  let sessionLang = azureConfig?.language || 'en-US';
  if (!sessionLang && window.floatingAPI?.getSessionConfig) {
    const cfg = await (window.floatingAPI.getSessionConfig() || Promise.resolve(null));
    sessionLang = (cfg?.language || 'en-US').trim() || 'en-US';
  }
  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = (sessionLang || 'en-US').trim() || 'en-US';
  liveTranscriptBuffer = '';
  speechRecognition.onresult = (e) => {
    if (!sessionActive || !isMicRecording) return;
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = (r[0]?.transcript || '').trim();
      if (r.isFinal) final += t;
      else interim += t;
    }
    if (final) {
      appendMicTranscriptToHistory(final);
    }
    micLiveBuffer = interim;
    // Reset flush timer when interim results arrive to prevent premature flushing
    // This ensures continuous speech accumulates properly even after pauses
    if (interim && micQuestionBuffer && micPauseTimer) {
      clearTimeout(micPauseTimer);
      micPauseTimer = setTimeout(flushMicQuestion, SYSTEM_AUDIO_PAUSE_MS);
    }
    // Cancel pending flush if new speech continues
    if (interim && micFlushPending) {
      micFlushPending = false;
      if (micFlushPendingTimer) {
        clearTimeout(micFlushPendingTimer);
        micFlushPendingTimer = null;
      }
    }
    liveTranscriptBuffer = getMicLiveCombined();
    setHistoryAutoScroll(true);
    renderHistory();
  };
  speechRecognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      addTranscriptionToHistory('[Mic permission denied]', new Date());
      stopMic();
    } else if (e.error === 'network' || e.error === 'service-not-allowed') {
      showSpeechErrorOnce(e.error);
      useWhisperFallback = true;
      stopMic();
      startWhisperFallback();
    } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
      showSpeechErrorOnce(e.error || 'Unknown');
    }
  };
  speechRecognition.onend = () => {
    if (isMicRecording && speechRecognition && !useWhisperFallback) {
      try { speechRecognition.start(); } catch (_) {}
    }
  };
  try {
    speechRecognition.start();
    isMicRecording = true;
    if (btnMic) btnMic.classList.add('mic-active');
  } catch (e) {
    addTranscriptionToHistory('[Mic error: ' + (e.message || 'Failed to start') + ']', new Date());
  }
}

function toggleMic() {
  if (isMicRecording) stopMic();
  else startMic();
}

if (btnMic) btnMic.addEventListener('click', () => { toggleMic(); });

function stopSystemAudio() {
  if (!isSystemAudioCapturing) return;
  isSystemAudioCapturing = false;
  if (systemAudioPauseTimer) {
    clearTimeout(systemAudioPauseTimer);
    systemAudioPauseTimer = null;
  }
  systemAudioQuestionBuffer = '';
  systemAudioLiveBuffer = '';
  if (systemAudioAzureRecognizer) {
    try {
      systemAudioAzureRecognizer.stopContinuousRecognitionAsync(() => {}, () => {});
    } catch (_) {}
    try { systemAudioAzureRecognizer.close(); } catch (_) {}
    systemAudioAzureRecognizer = null;
  }
  if (deepgramSystemSocket) {
    try { deepgramSystemSocket.close(); } catch (_) {}
    deepgramSystemSocket = null;
  }
  if (deepgramSystemProcessor && deepgramSystemAudioContext) {
    try { deepgramSystemProcessor.disconnect(); } catch (_) {}
    deepgramSystemProcessor = null;
  }
  if (deepgramSystemAudioContext && deepgramSystemAudioContext.state !== 'closed') {
    deepgramSystemAudioContext.close().catch(() => {});
    deepgramSystemAudioContext = null;
  }
  if (systemAudioRecorder && systemAudioRecorder.state !== 'inactive') {
    try { systemAudioRecorder.stop(); } catch (_) {}
  }
  systemAudioRecorder = null;
  if (systemAudioStream) {
    systemAudioStream.getTracks().forEach((t) => t.stop());
    systemAudioStream = null;
  }
  if (btnSystemAudio) btnSystemAudio.classList.remove('system-audio-active');
  renderHistory();
}

function flushSystemAudioQuestion() {
  if (systemAudioPauseTimer) {
    clearTimeout(systemAudioPauseTimer);
    systemAudioPauseTimer = null;
  }
  const q = (systemAudioQuestionBuffer || '').trim();
  systemAudioQuestionBuffer = '';
  systemAudioLiveBuffer = '';
  systemAudioLastFlushTime = Date.now();
  if (q) addTranscriptionToHistory(q, new Date(), 'system');
  renderHistory();
  // Auto-trigger AI - AI will use transcript history instead of direct question
  if (q && !aiBusy && window.floatingAPI?.callAIStream) askAiWithQuestion('');
}

async function startDeepgramSystemAudio(apiKey, language) {
  const url = buildDeepgramStreamingUrl(language);
  try {
    systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = systemAudioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      const msg = /win/i.test(navigator.platform) ? '[System audio: No audio. Share a screen and ensure "Share audio" is checked.]' : '[System audio: System audio capture is only supported on Windows.]';
      addTranscriptionToHistory(msg, new Date(), 'system');
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
      return;
    }
    deepgramSystemSocket = new WebSocket(url, ['token', apiKey]);
  } catch (e) {
    const msg = e.message || e.name || 'Permission denied or cancelled';
    addTranscriptionToHistory('[System audio: ' + msg + ']', new Date(), 'system');
    if (systemAudioStream) {
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
    }
    return;
  }
  systemAudioStream.getTracks().forEach((t) => { t.onended = () => { stopSystemAudio(); }; });
  deepgramSystemSocket.onopen = async () => {
    try {
      const audioOnly = new MediaStream(systemAudioStream.getAudioTracks());
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      deepgramSystemAudioContext = ctx;
      const sendPcm = createDeepgramPcmSender(deepgramSystemSocket, ctx.sampleRate);
      try {
        deepgramSystemProcessor = await connectDeepgramWithWorklet(ctx, audioOnly, sendPcm, false);
      } catch (_) {
        deepgramSystemProcessor = connectDeepgramWithScriptProcessor(ctx, audioOnly, sendPcm, false);
      }
      isSystemAudioCapturing = true;
      if (btnSystemAudio) btnSystemAudio.classList.add('system-audio-active');
    } catch (e) {
      addTranscriptionToHistory('[System audio: Deepgram ' + (e && e.message ? e.message : 'failed') + ']', new Date(), 'system');
      stopSystemAudio();
    }
  };
  deepgramSystemSocket.onmessage = (event) => {
    if (!isSystemAudioCapturing || !sessionActive) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'Results') return;
      const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript) return;
      if (msg.speech_final || msg.is_final) {
        if (Date.now() - systemAudioLastFlushTime < SYSTEM_AUDIO_FLUSH_COOLDOWN_MS) return;
        systemAudioQuestionBuffer = (systemAudioQuestionBuffer ? systemAudioQuestionBuffer + ' ' : '') + transcript;
        systemAudioLiveBuffer = '';
        if (systemAudioPauseTimer) clearTimeout(systemAudioPauseTimer);
        systemAudioPauseTimer = setTimeout(flushSystemAudioQuestion, SYSTEM_AUDIO_PAUSE_MS);
      } else {
        systemAudioLiveBuffer = transcript;
      }
      setHistoryAutoScroll(true);
      renderHistory();
    } catch (_) {}
  };
  deepgramSystemSocket.onerror = () => {
    addTranscriptionToHistory('[System audio: Deepgram error]', new Date(), 'system');
  };
  deepgramSystemSocket.onclose = () => {};
}

async function startSystemAudio() {
  if (isSystemAudioCapturing) return;
  if (!sessionActive) return;
  const provider = await (window.floatingAPI?.getSpeechProvider?.() || Promise.resolve('azure'));
  if (provider === 'deepgram') {
    const dgConfig = await (window.floatingAPI?.getDeepgramStreamingConfig?.() || Promise.resolve(null));
    if (dgConfig?.code === 'FREE_SESSION_COOLDOWN') {
      if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
      return;
    }
    if (dgConfig?.apiKey) {
      await startDeepgramSystemAudio(dgConfig.apiKey, dgConfig.language);
      return;
    }
    addTranscriptionToHistory('[System audio: Deepgram no config] Using Azure.', new Date(), 'system');
  }
  const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
  if (azureConfig?.code === 'FREE_SESSION_COOLDOWN') {
    if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
    return;
  }
  if (!azureConfig?.region || (!azureConfig?.token && !azureConfig?.key)) {
    addTranscriptionToHistory('[System audio: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION required]', new Date(), 'system');
    return;
  }
  const sdk = window.SpeechSDK || window.Microsoft?.CognitiveServices?.Speech;
  if (!sdk) {
    addTranscriptionToHistory('[System audio: Azure Speech SDK not loaded]', new Date(), 'system');
    return;
  }
  try {
    systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = systemAudioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      const msg = /win/i.test(navigator.platform) ? '[System audio: No audio. Share a screen and ensure "Share audio" is checked.]' : '[System audio: System audio capture is only supported on Windows.]';
      addTranscriptionToHistory(msg, new Date(), 'system');
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
      return;
    }
    const audioStream = new MediaStream(audioTracks);
    const speechConfig = azureConfig.token
      ? sdk.SpeechConfig.fromAuthorizationToken(azureConfig.token, azureConfig.region)
      : sdk.SpeechConfig.fromSubscription(azureConfig.key, azureConfig.region);
    const sysLang = (azureConfig.language || 'en-US').trim() || 'en-US';
    speechConfig.speechRecognitionLanguage = sysLang;
    // Optimize for accuracy over speed
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000'); // Increased for better accuracy
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, 'Time');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '500'); // Increased for more accurate phrase detection
    speechConfig.setProperty(sdk.PropertyId.Speech_StartEventSensitivity, 'medium'); // Reduced false starts
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '3'); // More stable interim results
    const audioConfig = sdk.AudioConfig.fromStreamInput(audioStream);
    systemAudioAzureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    systemAudioQuestionBuffer = '';
    systemAudioLiveBuffer = '';
    systemAudioAzureRecognizer.recognizing = (s, e) => {
      if (!isSystemAudioCapturing || !sessionActive) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        systemAudioLiveBuffer = e.result.text;
        setHistoryAutoScroll(true);
        renderHistory();
      }
    };
    systemAudioAzureRecognizer.recognized = (s, e) => {
      if (!isSystemAudioCapturing || !sessionActive) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim();
        if (text && Date.now() - systemAudioLastFlushTime >= SYSTEM_AUDIO_FLUSH_COOLDOWN_MS) {
          systemAudioQuestionBuffer = (systemAudioQuestionBuffer ? systemAudioQuestionBuffer + ' ' : '') + text;
          systemAudioLiveBuffer = '';
          if (systemAudioPauseTimer) clearTimeout(systemAudioPauseTimer);
          systemAudioPauseTimer = setTimeout(flushSystemAudioQuestion, SYSTEM_AUDIO_PAUSE_MS);
        }
        setHistoryAutoScroll(true);
        renderHistory();
      }
    };
    systemAudioAzureRecognizer.canceled = (s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        addTranscriptionToHistory('[System audio: ' + (e.errorDetails || e.errorCode) + ']', new Date(), 'system');
      }
    };
    systemAudioStream.getTracks().forEach((t) => { t.onended = () => { stopSystemAudio(); }; });
    await systemAudioAzureRecognizer.startContinuousRecognitionAsync();
    isSystemAudioCapturing = true;
    if (btnSystemAudio) btnSystemAudio.classList.add('system-audio-active');
  } catch (e) {
    const msg = e.message || e.name || 'Permission denied or cancelled';
    const hint = /not supported|notsupported/i.test(msg) && /win/i.test(navigator.platform)
      ? ' Try restarting the app. System audio requires Windows.'
      : '';
    addTranscriptionToHistory('[System audio: ' + msg + hint + ']', new Date(), 'system');
    if (systemAudioStream) {
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
    }
  }
}

function toggleSystemAudio() {
  if (isSystemAudioCapturing) stopSystemAudio();
  else startSystemAudio();
}

if (btnSystemAudio) btnSystemAudio.addEventListener('click', () => { toggleSystemAudio(); });

if (btnCollapse) {
  btnCollapse.addEventListener('click', () => {
    if (!window.floatingAPI?.setSize) return;
    stopMic();
    stopSystemAudio();
    window.floatingAPI.setSize('icon');
    showView('icon');
  });
}

// Drag the collapsed mic icon freely around the screen
if (viewIcon && window.floatingAPI?.getWindowBounds && window.floatingAPI?.setWindowBounds) {
  let iconDragStart = null;
  let iconDragMoved = false;

  viewIcon.addEventListener('mousedown', (e) => {
    if (viewIcon.classList.contains('hidden')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    window.floatingAPI.getWindowBounds().then((b) => {
      if (!b) return;
      iconDragStart = { x: e.screenX, y: e.screenY, winX: b.x, winY: b.y };
      iconDragMoved = false;
    });
  });

  document.addEventListener('mousemove', (e) => {
    if (!iconDragStart) return;
    const dx = e.screenX - iconDragStart.x;
    const dy = e.screenY - iconDragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) iconDragMoved = true;
    window.floatingAPI.setWindowBounds({ x: iconDragStart.winX + dx, y: iconDragStart.winY + dy });
  });

  document.addEventListener('mouseup', () => {
    if (!iconDragStart) return;
    if (iconDragMoved) suppressIconClick = true;
    iconDragStart = null;
  });
}

function showAiState(which) {
  if (!aiPlaceholder || !aiLoading || !aiText || !aiError) return;
  aiPlaceholder.classList.add('hidden');
  aiLoading.classList.add('hidden');
  aiText.classList.add('hidden');
  aiError.classList.add('hidden');
  if (which === 'placeholder') {
    if (aiText.textContent.trim()) which = 'text';
    else aiPlaceholder.classList.remove('hidden');
  }
  if (which === 'loading') aiLoading.classList.remove('hidden');
  else if (which === 'text') aiText.classList.remove('hidden');
  else if (which === 'error') aiError.classList.remove('hidden');
}

const SYSTEM_PROMPT = 'You are the interviewee in a job interview. Always answer in first person (I, my, me). Never act as an AI assistant: do not greet or offer to help; only answer the question asked. Give complete, structured answers: use 1. 2. 3. for types or steps, bullet points (- or *) for lists, **bold** for key terms. Never say you are an AI or assistant. Use the conversation history for follow-ups.';

function onStreamChunk(chunk) {
  if (!aiText) return;
  aiStreamBuffer += chunk;
  // During streaming we show plain text; once complete we render rich view with copyable code blocks.
  aiText.textContent = aiStreamBuffer;
  showAiState('text');
}

function onStreamDone(currentQuestion) {
  aiBusy = false;
  if (!aiText) return;
  const fullResponse = (aiStreamBuffer || '').trim() || '(No response)';
  if (!aiStreamBuffer.trim()) {
    aiText.textContent = '(No response)';
    showAiState('text');
  } else {
    renderAiResponse(fullResponse);
  }
  aiStreamBuffer = '';
  aiText.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const now = new Date();
  conversationHistory.push({ role: 'user', content: currentQuestion, time: now });
  conversationHistory.push({ role: 'assistant', content: fullResponse, time: now });
  if (conversationHistory.length > MAX_HISTORY_MESSAGES) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);
  }
  setHistoryAutoScroll(true); // scroll down to new Q&A
  renderHistory();
  const footerTime = document.getElementById('ai-answer-time');
  if (footerTime) footerTime.textContent = formatTimePM(now);
}

function renderAiResponse(text) {
  if (!aiText) return;
  aiText.innerHTML = '';
  const parts = text.split('```');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      // Code block segment (may start with an optional language line)
      if (!part.trim()) continue;
      let lang = '';
      let codeContent = part;
      const firstNewline = part.indexOf('\n');
      if (firstNewline !== -1) {
        lang = part.slice(0, firstNewline).trim();
        codeContent = part.slice(firstNewline + 1);
      }
      const container = document.createElement('div');
      container.className = 'ai-code-block';
      const header = document.createElement('div');
      header.className = 'ai-code-block-header';
      const langLabel = document.createElement('span');
      langLabel.className = 'ai-code-block-lang';
      langLabel.textContent = lang || 'code';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ai-code-block-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        const textToCopy = codeContent.replace(/\s+$/, '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy).catch(() => {});
        }
      });
      header.appendChild(langLabel);
      header.appendChild(copyBtn);
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = codeContent;
      pre.appendChild(codeEl);
      container.appendChild(header);
      container.appendChild(pre);
      aiText.appendChild(container);
    } else {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const p = document.createElement('p');
      p.textContent = trimmed;
      aiText.appendChild(p);
    }
  }
  showAiState('text');
}

function renderHistory() {
  if (!historyList) return;
  historyList.innerHTML = '';
  const items = [];
  const pairs = Math.floor(conversationHistory.length / 2);
  const startPairs = Math.max(0, pairs - MAX_HISTORY_DISPLAY) * 2;
  for (let i = startPairs; i < conversationHistory.length; i += 2) {
    const userMsg = conversationHistory[i];
    const assistantMsg = conversationHistory[i + 1];
    if (userMsg?.role !== 'user' || !assistantMsg) continue;
    items.push({ text: (userMsg.content || '').trim() || '—', time: userMsg.time, source: 'qa' });
  }
  for (const t of transcriptHistory) {
    items.push({ text: t.text, time: t.time, source: t.source || 'mic' });
  }
  items.sort((a, b) => (a.time?.getTime?.() || 0) - (b.time?.getTime?.() || 0));
  const recent = items.slice(-MAX_HISTORY_DISPLAY * 2);
  for (const it of recent) {
    const q = it.text || '—';
    const timeStr = it.time ? formatTimePM(it.time) : '06:56 PM';
    const label = it.source === 'system' ? 'System' : it.source === 'mic' ? 'Mic' : 'Client 1';
    const isLeft = it.source === 'system';
    const sideClass = isLeft ? 'history-item-left' : 'history-item-right';
    const el = document.createElement('div');
    el.className = 'history-item ' + sideClass;
    el.innerHTML =
      '<div class="history-item-header">' + escapeHtml(label) + ' – ' + timeStr + '</div>' +
      '<div class="history-item-q">' + escapeHtml(q) + '</div>';
    historyList.appendChild(el);
  }
  if (liveTranscriptBuffer && liveTranscriptBuffer.trim()) {
    const el = document.createElement('div');
    el.className = 'history-item history-item-right history-item-live';
    el.innerHTML =
      '<div class="history-item-header">Mic – Live</div>' +
      '<div class="history-item-q">' + escapeHtml(liveTranscriptBuffer) + '<span class="live-cursor">▌</span></div>';
    historyList.appendChild(el);
  }
  if (isSystemAudioCapturing && (systemAudioQuestionBuffer || systemAudioLiveBuffer)) {
    const combined = (systemAudioQuestionBuffer + (systemAudioLiveBuffer ? ' ' + systemAudioLiveBuffer : '')).trim();
    if (combined) {
      const el = document.createElement('div');
      el.className = 'history-item history-item-left history-item-live';
      el.innerHTML =
        '<div class="history-item-header">System – Live</div>' +
        '<div class="history-item-q">' + escapeHtml(combined) + '<span class="live-cursor">▌</span></div>';
      historyList.appendChild(el);
    }
  }
  // Whenever history updates (new question or audio transcribing), scroll down to show it
  if (historyList && historyAutoScroll) {
    const scrollToBottom = () => {
      historyList.scrollTop = historyList.scrollHeight;
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom);
    });
    setTimeout(scrollToBottom, 50);
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function onStreamError(err) {
  aiBusy = false;
  aiError.textContent = typeof err === 'string' ? err : (err?.message || 'Request failed');
  showAiState('error');
}

function formatTimePM(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const am = h < 12;
  const h12 = h % 12 || 12;
  return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + (am ? 'AM' : 'PM');
}

async function askAiWithQuestion(q) {
  const userQuestion = (q || '').trim();
  if (!userQuestion || aiBusy || !window.floatingAPI?.callAIStream) return;
  aiBusy = true;
  aiText.textContent = '';
  if (aiQuestionText) aiQuestionText.textContent = userQuestion;
  showAiState('loading');

  const handleChunk = (e) => onStreamChunk(e.detail);
  const handleDone = () => {
    window.removeEventListener('ai-stream-chunk', handleChunk);
    window.removeEventListener('ai-stream-done', handleDone);
    window.removeEventListener('ai-stream-error', handleError);
    onStreamDone(userQuestion);
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

  const recent = conversationHistory.slice(-LAST_PAIRS_FOR_REQUEST * 2);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...recent.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userQuestion },
  ];

  // Get selected model from session config, default to gpt-4o-mini
  let selectedModel = 'gpt-4o-mini';
  try {
    const config = await (window.floatingAPI?.getSessionConfig?.() || Promise.resolve(null));
    if (config && config.aiModel) {
      selectedModel = config.aiModel;
    }
  } catch (_) {
    // Fallback to default if config fetch fails
  }

  try {
    await window.floatingAPI.callAIStream({ messages, model: selectedModel });
  } catch (e) {
    handleError({ detail: e.message || 'Request failed' });
  }
}

async function askAi() {
  const q = (questionInput.value || '').trim();
  if (!q) return;
  questionInput.value = '';
  await askAiWithQuestion(q);
}

async function triggerManualAiWithMic() {
  if (aiBusy || !window.floatingAPI?.callAIStream) return;
  const typed = (questionInput?.value || '').trim();
  // Bypass pause: use whatever mic has captured so far and cancel pending timers
  const micCombined = getMicLiveCombined();
  if (micPauseTimer) {
    clearTimeout(micPauseTimer);
    micPauseTimer = null;
  }
  if (micFlushPendingTimer) {
    clearTimeout(micFlushPendingTimer);
    micFlushPendingTimer = null;
  }
  micFlushPending = false;
  let combined = '';
  if (typed && micCombined) {
    combined = typed + '\\n\\nRecent transcript:\\n' + micCombined;
  } else {
    combined = typed || micCombined;
  }
  if (!combined) return;
  // Clear typed question only when user provided one
  if (typed) questionInput.value = '';
  await askAiWithQuestion(combined);
}

btnAskAi.addEventListener('click', triggerManualAiWithMic);
if (btnAskAiHeader) {
  btnAskAiHeader.addEventListener('click', triggerManualAiWithMic);
}
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    triggerManualAiWithMic();
  } else if (e.key === 'Enter') {
    askAi();
  }
});

// Resize only the response block (Answer area): drag the corner to change its height (80–400px).
const responseResizeCorner = document.getElementById('response-resize-corner');
const aiResponseWrap = document.getElementById('ai-response-wrap');
if (responseResizeCorner && aiResponseWrap) {
  const MIN_H = 80;
  const MAX_H = 400;
  const DEFAULT_H = 200;
  let resizeStart = null;

  // Initial height for the response block only
  if (!aiResponseWrap.style.height) aiResponseWrap.style.height = DEFAULT_H + 'px';

  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const h = aiResponseWrap.offsetHeight || DEFAULT_H;
    resizeStart = { startY: e.clientY, startH: h };
    responseResizeCorner.style.cursor = 'nwse-resize';
  }

  function onMove(e) {
    if (!resizeStart) return;
    const dy = e.clientY - resizeStart.startY;
    const h = Math.round(Math.max(MIN_H, Math.min(MAX_H, resizeStart.startH + dy)));
    aiResponseWrap.style.height = h + 'px';
  }

  function onUp() {
    if (!resizeStart) return;
    resizeStart = null;
    responseResizeCorner.style.cursor = 'nwse-resize';
  }

  responseResizeCorner.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Header clock (e.g. 8:28)
function updateClock() {
  const el = document.getElementById('header-clock');
  if (!el) return;
  const d = new Date();
  el.textContent = (d.getHours() % 12 || 12) + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
}
setInterval(updateClock, 1000);
updateClock();

// Set initial footer time
const footerTimeEl = document.getElementById('ai-answer-time');
if (footerTimeEl) footerTimeEl.textContent = formatTimePM(new Date());

// Initial state: icon only
showView('icon');
