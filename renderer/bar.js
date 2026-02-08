const btnMic = document.getElementById('btn-mic');
const btnSystemAudio = document.getElementById('btn-system-audio');
const btnManual = document.getElementById('btn-manual');
const barManualSection = document.getElementById('bar-manual-section');
const barQuestionInput = document.getElementById('bar-question-input');
const barBtnSend = document.getElementById('bar-btn-send');
const btnEndSession = document.getElementById('btn-end-session');
const btnPosition = document.getElementById('btn-position');
const btnCollapse = document.getElementById('btn-collapse');
const btnTranscribe = document.getElementById('btn-transcribe');
const barTimer = document.getElementById('bar-timer');
const barCredit = document.getElementById('bar-credit');
const sessionBarContainer = document.getElementById('session-bar-container');
const barWaveIndicator = document.getElementById('bar-wave-indicator');

const SYSTEM_AUDIO_PAUSE_MS = 450;
let audioContext = null;
let analyser = null;
let visualizerSource = null;
let visualizerSource2 = null;
let mixerGain = null;
let visualizerStream = null;
let micVisualizerStream = null;
let waveAnimationId = null;
let waveLevelsIntervalId = null;
const WAVE_BARS = 5;
const MIN_SCALE = 0.2;
const MAX_SCALE = 1.9;
const SMOOTH = 0.35;
/** Boost so quiet speech still moves bars; raw analyser often 20–80 for speech */
const WAVE_GAIN = 2.6;
let waveLevels = [0, 0, 0, 0, 0];
let waveTargets = [0, 0, 0, 0, 0];
let speechRecognition = null;
let azureRecognizer = null;
let useWhisperFallback = false;
let mediaRecorder = null;
let audioStream = null;
let isMicRecording = false;
let isSystemAudioCapturing = false;
let systemAudioStream = null;
let systemAudioRecorder = null;
let systemAudioAzureRecognizer = null;
let systemAudioQuestionBuffer = '';
let systemAudioPauseTimer = null;

function isNoiseTranscript(text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.length <= 2 && /^[=\-\.\s,;:]+$/.test(t)) return true;
  if (/^=+$/.test(t)) return true;
  return false;
}

function addTranscription(text, time, source) {
  const trimmed = (text || '').trim();
  if (!trimmed || isNoiseTranscript(trimmed)) return;
  if (window.floatingAPI?.appendTranscript) {
    window.floatingAPI.appendTranscript({ text: trimmed, time: time || new Date(), source: source || 'mic' });
  }
}

async function transcribeChunk(blob, mimeType) {
  if (!window.floatingAPI?.transcribeAudio || blob.size < 500) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(',')[1] || '';
      if (!base64) { resolve(null); return; }
      try {
        const result = await window.floatingAPI.transcribeAudio(base64, mimeType);
        resolve(result);
      } catch (e) {
        resolve({ error: e.message });
      }
    };
    reader.readAsDataURL(blob);
  });
}

function stopMic() {
  if (!isMicRecording) return;
  isMicRecording = false;
  if (azureRecognizer) {
    try { azureRecognizer.stopContinuousRecognitionAsync(() => {}, () => {}); } catch (_) {}
    try { azureRecognizer.close(); } catch (_) {}
    azureRecognizer = null;
  }
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (_) {}
    speechRecognition = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;
  const wasMicStream = audioStream;
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }
  if (micVisualizerStream && micVisualizerStream !== wasMicStream) {
    micVisualizerStream.getTracks().forEach((t) => t.stop());
  }
  micVisualizerStream = null;
  if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'mic', text: '', isFinal: true });
  setVisualizerStream(getActiveVisualizerStreams());
  if (btnMic) btnMic.classList.remove('mic-active');
  updateWaveHighlight();
}

async function startWhisperFallback() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    addTranscription('[Mic error: ' + (e.message || 'Permission denied') + ']', new Date());
    return;
  }
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm' : 'audio/webm';
  mediaRecorder = new MediaRecorder(audioStream);
  mediaRecorder.ondataavailable = async (e) => {
    if (!isMicRecording || e.data.size < 500) return;
    const result = await transcribeChunk(e.data, mimeType);
    if (result?.text) addTranscription(result.text, new Date());
    else if (result?.error && !result.error.includes('Empty')) addTranscription('[Whisper: ' + result.error + ']', new Date());
  };
  mediaRecorder.start(1500);
  isMicRecording = true;
  micVisualizerStream = audioStream;
  if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'mic', text: '', isFinal: true });
  setVisualizerStream(getActiveVisualizerStreams());
  if (btnMic) btnMic.classList.add('mic-active');
  updateWaveHighlight();
}

async function startAzureSpeech(keyOrToken, region, language, useToken = false) {
  const sdk = window.SpeechSDK || window.Microsoft?.CognitiveServices?.Speech;
  if (!sdk) {
    addTranscription('[Azure SDK not loaded]', new Date());
    return false;
  }
  const lang = (language || 'en-US').trim() || 'en-US';
  try {
    const speechConfig = useToken
      ? sdk.SpeechConfig.fromAuthorizationToken(keyOrToken, region)
      : sdk.SpeechConfig.fromSubscription(keyOrToken, region);
    speechConfig.speechRecognitionLanguage = lang;
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '2000');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '350');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '1');
    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    azureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    azureRecognizer.recognizing = (s, e) => {
      if (!isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        const t = (e.result.text || '').trim();
        if (t && window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'mic', text: t, isFinal: false });
      }
    };
    azureRecognizer.recognized = (s, e) => {
      if (!isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        addTranscription(e.result.text, new Date());
        if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'mic', text: '', isFinal: true });
      }
    };
    azureRecognizer.canceled = (s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        addTranscription('[Azure: ' + (e.errorDetails || e.errorCode) + ']', new Date());
        useWhisperFallback = true;
        stopMic();
        startWhisperFallback();
      }
    };
    await azureRecognizer.startContinuousRecognitionAsync();
    isMicRecording = true;
    try {
      const vizStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micVisualizerStream = vizStream;
      setVisualizerStream(getActiveVisualizerStreams());
    } catch (_) {}
    if (btnMic) btnMic.classList.add('mic-active');
    updateWaveHighlight();
    return true;
  } catch (e) {
    addTranscription('[Azure: ' + (e.message || e) + ']', new Date());
    return false;
  }
}

async function startMic() {
  if (isMicRecording) return;
  const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
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
    addTranscription('[Live transcription not supported] Using Whisper fallback.', new Date());
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
  speechRecognition.onresult = (e) => {
    if (!isMicRecording) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = (r[0]?.transcript || '').trim();
      if (r.isFinal) {
        if (t) addTranscription(t, new Date());
        if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'mic', text: '', isFinal: true });
      } else if (t && window.floatingAPI?.setLiveTranscript) {
        window.floatingAPI.setLiveTranscript({ source: 'mic', text: t, isFinal: false });
      }
    }
  };
  speechRecognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      addTranscription('[Mic permission denied]', new Date());
      stopMic();
    } else if (e.error === 'network' || e.error === 'service-not-allowed') {
      useWhisperFallback = true;
      stopMic();
      startWhisperFallback();
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
    addTranscription('[Mic error: ' + (e.message || 'Failed to start') + ']', new Date());
  }
}

function toggleMic() {
  if (isMicRecording) stopMic();
  else startMic();
}

function stopSystemAudio() {
  if (!isSystemAudioCapturing) return;
  isSystemAudioCapturing = false;
  if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'system', text: '', isFinal: true });
  if (systemAudioPauseTimer) {
    clearTimeout(systemAudioPauseTimer);
    systemAudioPauseTimer = null;
  }
  systemAudioQuestionBuffer = '';
  if (systemAudioAzureRecognizer) {
    try { systemAudioAzureRecognizer.stopContinuousRecognitionAsync(() => {}, () => {}); } catch (_) {}
    try { systemAudioAzureRecognizer.close(); } catch (_) {}
    systemAudioAzureRecognizer = null;
  }
  if (systemAudioRecorder && systemAudioRecorder.state !== 'inactive') {
    try { systemAudioRecorder.stop(); } catch (_) {}
  }
  systemAudioRecorder = null;
  if (systemAudioStream) {
    systemAudioStream.getTracks().forEach((t) => t.stop());
    systemAudioStream = null;
  }
  setVisualizerStream(getActiveVisualizerStreams());
  if (btnSystemAudio) btnSystemAudio.classList.remove('system-audio-active');
  updateWaveHighlight();
}

function flushSystemAudioQuestion() {
  if (systemAudioPauseTimer) {
    clearTimeout(systemAudioPauseTimer);
    systemAudioPauseTimer = null;
  }
  const q = (systemAudioQuestionBuffer || '').trim();
  systemAudioQuestionBuffer = '';
  if (q && window.floatingAPI?.requestAskQuestion) {
    window.floatingAPI.requestAskQuestion(q);
  }
}

async function startSystemAudio() {
  if (isSystemAudioCapturing) return;
  const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
  if (!azureConfig?.region || (!azureConfig?.token && !azureConfig?.key)) {
    addTranscription('[System audio: AZURE_SPEECH_KEY and AZURE_SPEECH_REGION required]', new Date(), 'system');
    return;
  }
  const sdk = window.SpeechSDK || window.Microsoft?.CognitiveServices?.Speech;
  if (!sdk) {
    addTranscription('[System audio: Azure Speech SDK not loaded]', new Date(), 'system');
    return;
  }
  try {
    systemAudioStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const audioTracks = systemAudioStream.getAudioTracks();
    if (audioTracks.length === 0) {
      const msg = /win/i.test(navigator.platform) ? '[System audio: No audio. Share a screen and ensure "Share audio" is checked.]' : '[System audio: System audio capture is only supported on Windows.]';
      addTranscription(msg, new Date(), 'system');
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
      return;
    }
    const stream = new MediaStream(audioTracks);
    const speechConfig = azureConfig.token
      ? sdk.SpeechConfig.fromAuthorizationToken(azureConfig.token, azureConfig.region)
      : sdk.SpeechConfig.fromSubscription(azureConfig.key, azureConfig.region);
    const lang = (azureConfig.language || 'en-US').trim() || 'en-US';
    speechConfig.speechRecognitionLanguage = lang;
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '2000');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '350');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '1');
    const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
    systemAudioAzureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    systemAudioQuestionBuffer = '';
    systemAudioAzureRecognizer.recognizing = (s, e) => {
      if (!isSystemAudioCapturing) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        const t = (e.result.text || '').trim();
        if (t && window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'system', text: t, isFinal: false });
      }
    };
    systemAudioAzureRecognizer.recognized = (s, e) => {
      if (!isSystemAudioCapturing) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim();
        if (text && !isNoiseTranscript(text)) {
          addTranscription(text, new Date(), 'system');
          systemAudioQuestionBuffer = (systemAudioQuestionBuffer ? systemAudioQuestionBuffer + ' ' : '') + text;
          if (systemAudioPauseTimer) clearTimeout(systemAudioPauseTimer);
          systemAudioPauseTimer = setTimeout(flushSystemAudioQuestion, SYSTEM_AUDIO_PAUSE_MS);
        }
        if (window.floatingAPI?.setLiveTranscript) window.floatingAPI.setLiveTranscript({ source: 'system', text: '', isFinal: true });
      }
    };
    systemAudioAzureRecognizer.canceled = (s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        addTranscription('[System audio: ' + (e.errorDetails || e.errorCode) + ']', new Date(), 'system');
      }
    };
    systemAudioStream.getTracks().forEach((t) => { t.onended = () => { stopSystemAudio(); }; });
    await systemAudioAzureRecognizer.startContinuousRecognitionAsync();
    isSystemAudioCapturing = true;
    setVisualizerStream(getActiveVisualizerStreams());
    if (btnSystemAudio) btnSystemAudio.classList.add('system-audio-active');
    updateWaveHighlight();
  } catch (e) {
    const msg = e.message || e.name || 'Permission denied or cancelled';
    addTranscription('[System audio: ' + msg + ']', new Date(), 'system');
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

function setVisualizerStream(stream) {
  if (waveAnimationId) {
    cancelAnimationFrame(waveAnimationId);
    waveAnimationId = null;
  }
  if (visualizerSource) {
    try { visualizerSource.disconnect(); } catch (_) {}
    visualizerSource = null;
  }
  if (visualizerSource2) {
    try { visualizerSource2.disconnect(); } catch (_) {}
    visualizerSource2 = null;
  }
  if (mixerGain) {
    try { mixerGain.disconnect(); } catch (_) {}
    mixerGain = null;
  }
  if (analyser && audioContext) {
    try { analyser.disconnect(); } catch (_) {}
  }
  analyser = null;
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
  }
  audioContext = null;
  visualizerStream = null;

  if (!barWaveIndicator) return;
  barWaveIndicator.classList.remove('audio-driven');
  barWaveIndicator.classList.add('idle');
  const bars = barWaveIndicator.querySelectorAll('.bar-wave-bar');
  bars.forEach((b) => { b.style.transform = ''; });

  const streams = Array.isArray(stream) ? stream : (stream ? [stream] : []);
  const valid = streams.filter((s) => s && s.getAudioTracks && s.getAudioTracks().length > 0);
  if (valid.length === 0) return;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    analyser.minDecibels = -70;
    analyser.maxDecibels = -5;

    if (valid.length === 1) {
      visualizerSource = audioContext.createMediaStreamSource(valid[0]);
      visualizerSource.connect(analyser);
      visualizerStream = valid[0];
    } else {
      mixerGain = audioContext.createGain();
      mixerGain.gain.value = 1;
      mixerGain.connect(analyser);
      visualizerSource = audioContext.createMediaStreamSource(valid[0]);
      visualizerSource.connect(mixerGain);
      visualizerSource2 = audioContext.createMediaStreamSource(valid[1]);
      visualizerSource2.connect(mixerGain);
      visualizerStream = valid[0];
    }

    barWaveIndicator.classList.remove('idle');
    barWaveIndicator.classList.add('audio-driven');
    waveLevels = [0, 0, 0, 0, 0];
    waveTargets = [0, 0, 0, 0, 0];
    runWaveLoop();
  } catch (_) {
    barWaveIndicator.classList.add('idle');
  }
}

function sampleWaveLevels() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const step = Math.floor(data.length / (WAVE_BARS + 1));
  for (let i = 0; i < WAVE_BARS; i++) {
    const idx = (i + 1) * step;
    const raw = data[idx] / 255;
    waveTargets[i] = Math.min(1, raw * WAVE_GAIN);
  }
  for (let i = 0; i < WAVE_BARS; i++) {
    waveLevels[i] = waveLevels[i] + (waveTargets[i] - waveLevels[i]) * SMOOTH;
  }
}

function runWaveLoop() {
  if (!analyser || !barWaveIndicator) return;
  const bars = barWaveIndicator.querySelectorAll('.bar-wave-bar');
  if (bars.length !== WAVE_BARS) return;
  sampleWaveLevels();
  for (let i = 0; i < WAVE_BARS; i++) {
    const scale = MIN_SCALE + waveLevels[i] * (MAX_SCALE - MIN_SCALE);
    bars[i].style.transform = `scaleY(${scale})`;
  }
  waveAnimationId = requestAnimationFrame(runWaveLoop);
}

function updateWaveHighlight() {
  if (!barWaveIndicator) return;
  barWaveIndicator.classList.remove('wave-mic-active', 'wave-system-active');
  if (isSystemAudioCapturing) {
    barWaveIndicator.classList.add('wave-system-active');
  } else if (isMicRecording) {
    barWaveIndicator.classList.add('wave-mic-active');
  }
}

function getActiveVisualizerStreams() {
  const list = [];
  if (isMicRecording && micVisualizerStream) list.push(micVisualizerStream);
  if (isSystemAudioCapturing && systemAudioStream && systemAudioStream.getAudioTracks().length > 0) {
    list.push(new MediaStream(systemAudioStream.getAudioTracks()));
  }
  return list;
}

function toggleManualSection() {
  if (!barManualSection || !btnManual || !sessionBarContainer) return;
  const isHidden = barManualSection.classList.toggle('hidden');
  const expanded = !isHidden;
  sessionBarContainer.classList.toggle('manual-mode', expanded);
  btnManual.classList.toggle('manual-active', expanded);
  if (window.floatingAPI?.setManualMode) window.floatingAPI.setManualMode(expanded);
  if (expanded && barQuestionInput) barQuestionInput.focus();
}

function sendBarQuestion() {
  const q = (barQuestionInput?.value || '').trim();
  if (!q || !window.floatingAPI?.requestAskQuestion) return;
  window.floatingAPI.requestAskQuestion(q);
  if (barQuestionInput) barQuestionInput.value = '';
}

if (btnManual) btnManual.addEventListener('click', toggleManualSection);
if (barBtnSend) barBtnSend.addEventListener('click', sendBarQuestion);
if (barQuestionInput) {
  barQuestionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBarQuestion();
  });
}

if (btnMic) btnMic.addEventListener('click', toggleMic);
if (btnSystemAudio) btnSystemAudio.addEventListener('click', toggleSystemAudio);

if (btnEndSession) {
  btnEndSession.addEventListener('click', () => {
    stopMic();
    stopSystemAudio();
    if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
  });
}

if (btnCollapse) {
  btnCollapse.addEventListener('click', () => {
    if (window.floatingAPI?.collapseSession) window.floatingAPI.collapseSession();
  });
}

if (btnPosition) {
  btnPosition.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.floatingAPI?.showPositionOverlay) window.floatingAPI.showPositionOverlay();
  });
}

function setTranscribeButtonState(historyVisible) {
  if (!btnTranscribe) return;
  btnTranscribe.classList.toggle('transcribe-history-visible', !!historyVisible);
  btnTranscribe.title = 'Transcribe (open history)';
}

if (btnTranscribe) {
  btnTranscribe.addEventListener('click', () => {
    if (window.floatingAPI?.setSnakeBarVisible) window.floatingAPI.setSnakeBarVisible(true);
  });
}
if (window.floatingAPI?.getHistoryVisible) {
  window.floatingAPI.getHistoryVisible().then(setTranscribeButtonState);
}
if (window.floatingAPI?.onHistoryVisibleChanged) {
  window.floatingAPI.onHistoryVisibleChanged(setTranscribeButtonState);
}

let sessionType = 'free';
let creditsMinutes = 10;
let freeSessionEnded = false;

function updateCreditDisplay(seconds) {
  if (!barCredit) return;
  const totalSec = creditsMinutes * 60;
  const remaining = Math.max(0, totalSec - seconds);
  const rm = Math.floor(remaining / 60);
  const rs = remaining % 60;
  barCredit.textContent = rm + ':' + (rs < 10 ? '0' : '') + rs + ' left';
  barCredit.title = remaining <= 60 ? 'Almost out – session will end soon' : 'Available time';
  barCredit.classList.remove('credits-disabled');
  barCredit.classList.toggle('credit-low', remaining > 0 && remaining <= 60);
}

if (window.floatingAPI?.getSessionConfig) {
  window.floatingAPI.getSessionConfig().then((cfg) => {
    if (cfg) {
      sessionType = cfg.sessionType || 'free';
      creditsMinutes = Math.max(0, Number(cfg.creditsMinutes) || (sessionType === 'free' ? 10 : 0));
    }
    if (window.floatingAPI?.getTimer) {
      window.floatingAPI.getTimer().then(updateCreditDisplay);
    }
  });
}

if (window.floatingAPI?.onTimerTick) {
  window.floatingAPI.onTimerTick((seconds) => {
    if (barTimer) {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      barTimer.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
    updateCreditDisplay(seconds);
    if (!freeSessionEnded) {
      const remaining = Math.max(0, creditsMinutes * 60 - seconds);
      if (remaining <= 0) {
        freeSessionEnded = true;
        if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
      }
    }
  });
}

if (window.floatingAPI?.onSessionMinimized) {
  window.floatingAPI.onSessionMinimized(() => {
    if (waveLevelsIntervalId) return;
    waveLevelsIntervalId = setInterval(() => {
      if (!analyser) return;
      sampleWaveLevels();
      if (window.floatingAPI?.sendWaveLevels) window.floatingAPI.sendWaveLevels(waveLevels);
    }, 50);
  });
}
if (window.floatingAPI?.onSessionExpanded) {
  window.floatingAPI.onSessionExpanded(() => {
    if (waveLevelsIntervalId) {
      clearInterval(waveLevelsIntervalId);
      waveLevelsIntervalId = null;
    }
    if (window.floatingAPI?.sendManualState && barManualSection) {
      const expanded = !barManualSection.classList.contains('hidden');
      window.floatingAPI.sendManualState(expanded);
    }
  });
}

if (barWaveIndicator) barWaveIndicator.classList.add('idle');
