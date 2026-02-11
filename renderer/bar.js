const btnMic = document.getElementById('btn-mic');
const btnSystemAudio = document.getElementById('btn-system-audio');
const btnManual = document.getElementById('btn-manual');
const btnPhotoAnalysis = document.getElementById('btn-photo-analysis');
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

/** Only generate answer after this much silence. No answer until this pause (e.g. 1 min question is fine). Use 5s so engine segment gaps don't flush mid-speech. */
const SYSTEM_AUDIO_PAUSE_MS = 2000;
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
let systemAudioLiveBuffer = '';
let systemAudioLastFlushTime = 0;
const SYSTEM_AUDIO_FLUSH_COOLDOWN_MS = 2500;
let micQuestionBuffer = '';
let micLiveBuffer = '';
let micPauseTimer = null;
let deepgramSocket = null;
let deepgramAudioContext = null;
let deepgramProcessor = null;
let deepgramSystemSocket = null;
let deepgramSystemAudioContext = null;
let deepgramSystemProcessor = null;

const LIVE_TRANSCRIPT_THROTTLE_MS = 60;
let liveTranscriptPending = null;
let liveTranscriptTimer = null;
function setLiveTranscriptThrottled(opts) {
  if (!window.floatingAPI?.setLiveTranscript) return;
  if (opts.isFinal) {
    if (liveTranscriptTimer) {
      clearTimeout(liveTranscriptTimer);
      liveTranscriptTimer = null;
    }
    liveTranscriptPending = null;
    window.floatingAPI.setLiveTranscript(opts);
    return;
  }
  liveTranscriptPending = opts;
  if (liveTranscriptTimer) return;
  liveTranscriptTimer = setTimeout(() => {
    liveTranscriptTimer = null;
    if (liveTranscriptPending) {
      window.floatingAPI.setLiveTranscript(liveTranscriptPending);
      liveTranscriptPending = null;
    }
  }, LIVE_TRANSCRIPT_THROTTLE_MS);
}

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

/** Append to mic buffer and show combined phrase (buffer + live) before pause. Flush one entry after pause. */
function appendMicTranscript(transcript) {
  const t = (transcript || '').trim();
  if (!t || isNoiseTranscript(t)) return;
  micQuestionBuffer = (micQuestionBuffer ? micQuestionBuffer + ' ' : '') + t;
  if (micPauseTimer) clearTimeout(micPauseTimer);
  micPauseTimer = setTimeout(flushMicQuestion, SYSTEM_AUDIO_PAUSE_MS);
}

function flushMicQuestion() {
  if (micPauseTimer) {
    clearTimeout(micPauseTimer);
    micPauseTimer = null;
  }
  const q = (micQuestionBuffer || '').trim();
  micQuestionBuffer = '';
  micLiveBuffer = '';
  if (q) addTranscription(q, new Date(), 'mic');
  if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: '', isFinal: true });
}

/** Live text for mic = combined buffer + current interim (combined phrase before pause). */
function getMicLiveCombined() {
  const buf = (micQuestionBuffer || '').trim();
  const live = (micLiveBuffer || '').trim();
  return buf ? (live ? buf + ' ' + live : buf) : live;
}

/** Live text for system = combined buffer + current interim (combined phrase before pause). */
function getSystemLiveCombined() {
  const buf = (systemAudioQuestionBuffer || '').trim();
  const live = (systemAudioLiveBuffer || '').trim();
  return buf ? (live ? buf + ' ' + live : buf) : live;
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
  if (micPauseTimer) {
    clearTimeout(micPauseTimer);
    micPauseTimer = null;
  }
  if ((micQuestionBuffer || '').trim()) {
    addTranscription(micQuestionBuffer.trim(), new Date(), 'mic');
    micQuestionBuffer = '';
  }
  micLiveBuffer = '';
  if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: '', isFinal: true });
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
    if (!isMicRecording || !e.data?.size) return;
    const result = await transcribeChunk(e.data, mimeType);
    if (result?.text) appendMicTranscript(result.text);
    else if (result?.error && !result.error.includes('Empty')) {
      fallbackTranscribeErrorCount++;
      if (fallbackTranscribeErrorCount <= 2) addTranscription('[Transcribe: ' + result.error + ']', new Date());
    }
  };
  mediaRecorder.start(4000);
  isMicRecording = true;
  micVisualizerStream = audioStream;
  if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: '', isFinal: true });
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
    // Optimize for accuracy over speed
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000'); // Increased for better accuracy
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, 'Time');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '500'); // Increased for more accurate phrase detection
    speechConfig.setProperty(sdk.PropertyId.Speech_StartEventSensitivity, 'medium'); // Reduced false starts
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '3'); // More stable interim results
    const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    azureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    azureRecognizer.recognizing = (s, e) => {
      if (!isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        const t = (e.result.text || '').trim();
        if (t && window.floatingAPI?.setLiveTranscript) {
          micLiveBuffer = t;
          setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
        }
      }
    };
    azureRecognizer.recognized = (s, e) => {
      if (!isMicRecording) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        appendMicTranscript(e.result.text);
        micLiveBuffer = '';
        if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
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

function buildDeepgramStreamingUrl(language) {
  const lang = (language || 'en').trim().split('-')[0] || 'en';
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    language: lang,
    model: 'nova-2',
    interim_results: 'true',
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
    const len = Math.floor(float32.length / ratio);
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
    addTranscription('[Deepgram: ' + (e.message || 'WebSocket failed') + ']', new Date());
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
        try {
          const vizStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micVisualizerStream = vizStream;
          setVisualizerStream(getActiveVisualizerStreams());
        } catch (_) {}
        if (btnMic) btnMic.classList.add('mic-active');
        updateWaveHighlight();
      } catch (e) {
        addTranscription('[Deepgram mic: ' + (e && e.message ? e.message : 'Failed') + '] Using fallback.', new Date());
        useWhisperFallback = true;
        stopMic();
        startWhisperFallback();
      }
    })().catch(() => {
      addTranscription('[Deepgram mic: error] Using fallback.', new Date());
      useWhisperFallback = true;
      stopMic();
      startWhisperFallback();
    });
  };
  deepgramSocket.onmessage = (event) => {
    if (!isMicRecording) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'Results') return;
      const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript) return;
      if (msg.speech_final || msg.is_final) {
        appendMicTranscript(transcript);
        micLiveBuffer = '';
        if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
      } else if (window.floatingAPI?.setLiveTranscript) {
        micLiveBuffer = transcript;
        setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
      }
    } catch (_) {}
  };
  deepgramSocket.onerror = () => {
    addTranscription('[Deepgram: connection error] Trying Azure…', new Date());
    stopMic();
    (async () => {
      const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
      if (azureConfig?.region && (azureConfig.token || azureConfig.key)) {
        const ok = await startAzureSpeech(
          azureConfig.token || azureConfig.key,
          azureConfig.region,
          azureConfig.language,
          !!azureConfig.token
        );
        if (ok) return;
      }
      useWhisperFallback = true;
      startWhisperFallback();
    })();
  };
  deepgramSocket.onclose = () => {};
}

async function startMic() {
  if (isMicRecording) return;
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
    addTranscription('[Deepgram: no config] Using Azure.', new Date());
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
        if (t) appendMicTranscript(t);
        micLiveBuffer = '';
        if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
      } else if (t && window.floatingAPI?.setLiveTranscript) {
        micLiveBuffer = t;
        setLiveTranscriptThrottled({ source: 'mic', text: getMicLiveCombined(), isFinal: false });
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
  if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'system', text: '', isFinal: true });
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
  systemAudioLiveBuffer = '';
  systemAudioLastFlushTime = Date.now();
  if (q) {
    addTranscription(q, new Date(), 'system');
    if (window.floatingAPI?.requestAskQuestion) {
      window.floatingAPI.requestAskQuestion(q);
    }
  }
  if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'system', text: '', isFinal: true });
}

async function startDeepgramSystemAudio(apiKey, language) {
  const url = buildDeepgramStreamingUrl(language);
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
    deepgramSystemSocket = new WebSocket(url, ['token', apiKey]);
  } catch (e) {
    const msg = e.message || e.name || 'Permission denied or cancelled';
    addTranscription('[System audio: ' + msg + ']', new Date(), 'system');
    if (systemAudioStream) {
      systemAudioStream.getTracks().forEach((t) => t.stop());
      systemAudioStream = null;
    }
    return;
  }
  systemAudioStream.getTracks().forEach((t) => { t.onended = () => { stopSystemAudio(); }; });
  deepgramSystemSocket.onopen = async () => {
    try {
      const stream = new MediaStream(systemAudioStream.getAudioTracks());
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      deepgramSystemAudioContext = ctx;
      const sendPcm = createDeepgramPcmSender(deepgramSystemSocket, ctx.sampleRate);
      try {
        deepgramSystemProcessor = await connectDeepgramWithWorklet(ctx, stream, sendPcm, false);
      } catch (_) {
        deepgramSystemProcessor = connectDeepgramWithScriptProcessor(ctx, stream, sendPcm, false);
      }
      isSystemAudioCapturing = true;
      setVisualizerStream(getActiveVisualizerStreams());
      if (btnSystemAudio) btnSystemAudio.classList.add('system-audio-active');
      updateWaveHighlight();
    } catch (e) {
      addTranscription('[System audio: Deepgram ' + (e && e.message ? e.message : 'failed') + ']', new Date(), 'system');
      stopSystemAudio();
    }
  };
  deepgramSystemSocket.onmessage = (event) => {
    if (!isSystemAudioCapturing) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'Results') return;
      const transcript = msg.channel?.alternatives?.[0]?.transcript?.trim();
      if (!transcript || isNoiseTranscript(transcript)) return;
      if (msg.speech_final || msg.is_final) {
        if (Date.now() - systemAudioLastFlushTime < SYSTEM_AUDIO_FLUSH_COOLDOWN_MS) return;
        systemAudioQuestionBuffer = (systemAudioQuestionBuffer ? systemAudioQuestionBuffer + ' ' : '') + transcript;
        systemAudioLiveBuffer = '';
        if (systemAudioPauseTimer) clearTimeout(systemAudioPauseTimer);
        systemAudioPauseTimer = setTimeout(flushSystemAudioQuestion, SYSTEM_AUDIO_PAUSE_MS);
        if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'system', text: getSystemLiveCombined(), isFinal: false });
      } else if (window.floatingAPI?.setLiveTranscript) {
        systemAudioLiveBuffer = transcript;
        setLiveTranscriptThrottled({ source: 'system', text: getSystemLiveCombined(), isFinal: false });
      }
    } catch (_) {}
  };
  deepgramSystemSocket.onerror = () => {
    addTranscription('[System audio: Deepgram error]', new Date(), 'system');
  };
  deepgramSystemSocket.onclose = () => {};
}

async function startSystemAudio() {
  if (isSystemAudioCapturing) return;
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
    addTranscription('[System audio: Deepgram no config] Using Azure.', new Date(), 'system');
  }
  const azureConfig = await (window.floatingAPI?.getAzureSpeechConfig?.() || Promise.resolve(null));
  if (azureConfig?.code === 'FREE_SESSION_COOLDOWN') {
    if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
    return;
  }
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
    // Optimize for accuracy over speed
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000'); // Increased for better accuracy
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, 'Time');
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '500'); // Increased for more accurate phrase detection
    speechConfig.setProperty(sdk.PropertyId.Speech_StartEventSensitivity, 'medium'); // Reduced false starts
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, '3'); // More stable interim results
    const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
    systemAudioAzureRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    systemAudioQuestionBuffer = '';
    systemAudioAzureRecognizer.recognizing = (s, e) => {
      if (!isSystemAudioCapturing) return;
      if (e.result.reason === sdk.ResultReason.RecognizingSpeech && e.result.text) {
        const t = (e.result.text || '').trim();
        if (t && window.floatingAPI?.setLiveTranscript) {
          systemAudioLiveBuffer = t;
          setLiveTranscriptThrottled({ source: 'system', text: getSystemLiveCombined(), isFinal: false });
        }
      }
    };
    systemAudioAzureRecognizer.recognized = (s, e) => {
      if (!isSystemAudioCapturing) return;
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim();
        if (text && !isNoiseTranscript(text) && (Date.now() - systemAudioLastFlushTime >= SYSTEM_AUDIO_FLUSH_COOLDOWN_MS)) {
          systemAudioQuestionBuffer = (systemAudioQuestionBuffer ? systemAudioQuestionBuffer + ' ' : '') + text;
          systemAudioLiveBuffer = '';
          if (systemAudioPauseTimer) clearTimeout(systemAudioPauseTimer);
          systemAudioPauseTimer = setTimeout(flushSystemAudioQuestion, SYSTEM_AUDIO_PAUSE_MS);
        }
        if (window.floatingAPI?.setLiveTranscript) setLiveTranscriptThrottled({ source: 'system', text: getSystemLiveCombined(), isFinal: false });
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

const IMAGE_AUTO_INTERVAL_MIN_SEC = 15;
const IMAGE_AUTO_INTERVAL_MAX_SEC = 30;
const IMAGE_AUTO_INTERVAL_DEFAULT_MS = 30 * 1000;
let photoAnalysisInProgress = false;
let imageAutoIntervalId = null;

/** Shared logic: capture screenshot, analyze, show in right panel. No button state. */
async function doPhotoAnalysis() {
  if (!window.floatingAPI?.takeScreenshot || !window.floatingAPI?.analyzeImage) return;
  if (photoAnalysisInProgress) return;
  photoAnalysisInProgress = true;
  try {
    const shot = await window.floatingAPI.takeScreenshot();
    if (shot?.error || !shot?.imageBase64) {
      if (window.floatingAPI?.showAnalysisInRight) {
        window.floatingAPI.showAnalysisInRight({ question: 'Screen analysis', answer: 'Could not capture screen. ' + (shot?.error || 'Try again.') });
      }
      return;
    }
    let contextPrompt = '';
    try {
      const history = await (window.floatingAPI?.getConversationHistory?.() || Promise.resolve([]));
      const lastUser = history.filter((m) => m.role === 'user').pop();
      if (lastUser?.content) {
        contextPrompt = `\n\nCurrent or recent interview question (use as context for your answer): "${lastUser.content.trim().slice(0, 500)}". Provide an answer the candidate could give, in first person, based on what you see in the image and this question.`;
      }
    } catch (_) {}
    let sessionInstructions = '';
    try {
      const config = await (window.floatingAPI?.getSessionConfig?.() || Promise.resolve(null));
      if (config?.instructions && typeof config.instructions === 'string' && config.instructions.trim()) {
        sessionInstructions = `\n\nFollow these instructions from the session (apply to how you analyze and respond):\n${config.instructions.trim().slice(0, 1500)}`;
      }
    } catch (_) {}
    const prompt = `You are helping an interviewee during a job interview. This image is a screenshot of the interviewer's shared screen or something the candidate is looking at. Describe briefly what you see (e.g. a whiteboard, a question, code, or a blank screen).${sessionInstructions}${contextPrompt || ' If there is a question or task visible, suggest a concise answer or response the candidate could give, in first person. Be brief and use Markdown for lists if needed.'}`;
    const result = await window.floatingAPI.analyzeImage({ imageBase64: shot.imageBase64, prompt });
    const answer = result?.text?.trim() || result?.error || 'Analysis failed.';
    const questionLabel = 'Screen analysis';
    if (window.floatingAPI?.appendConversation) window.floatingAPI.appendConversation(questionLabel, answer);
    if (window.floatingAPI?.showAnalysisInRight) window.floatingAPI.showAnalysisInRight({ question: questionLabel, answer });
  } catch (e) {
    if (window.floatingAPI?.showAnalysisInRight) {
      window.floatingAPI.showAnalysisInRight({ question: 'Screen analysis', answer: 'Error: ' + (e?.message || 'Analysis failed') });
    }
  } finally {
    photoAnalysisInProgress = false;
  }
}

async function runPhotoAnalysis() {
  if (!btnPhotoAnalysis || !window.floatingAPI?.takeScreenshot || !window.floatingAPI?.analyzeImage) return;
  btnPhotoAnalysis.disabled = true;
  btnPhotoAnalysis.classList.add('photo-analysis-busy');
  try {
    await doPhotoAnalysis();
  } finally {
    btnPhotoAnalysis.disabled = false;
    btnPhotoAnalysis.classList.remove('photo-analysis-busy');
  }
}

function setImageAuto(enabled, intervalSeconds) {
  if (imageAutoIntervalId) {
    clearInterval(imageAutoIntervalId);
    imageAutoIntervalId = null;
  }
  if (enabled) {
    const sec = typeof intervalSeconds === 'number' && !isNaN(intervalSeconds)
      ? Math.max(IMAGE_AUTO_INTERVAL_MIN_SEC, Math.min(IMAGE_AUTO_INTERVAL_MAX_SEC, intervalSeconds))
      : IMAGE_AUTO_INTERVAL_MAX_SEC;
    const ms = sec * 1000;
    doPhotoAnalysis(); // run once immediately
    imageAutoIntervalId = setInterval(() => doPhotoAnalysis(), ms);
  }
}

if (btnManual) btnManual.addEventListener('click', toggleManualSection);
if (barBtnSend) barBtnSend.addEventListener('click', sendBarQuestion);
if (btnPhotoAnalysis) btnPhotoAnalysis.addEventListener('click', () => runPhotoAnalysis());
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
    setImageAuto(false);
    if (window.floatingAPI?.endSession) window.floatingAPI.endSession();
  });
}
if (window.floatingAPI?.onSessionEnded) {
  window.floatingAPI.onSessionEnded(() => setImageAuto(false));
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
      if (cfg.imageAuto) setImageAuto(true, cfg.imageAutoIntervalSeconds);
    }
    if (window.floatingAPI?.getTimer) {
      window.floatingAPI.getTimer().then(updateCreditDisplay);
    }
  });
}

// Poll getTimer() every second instead of receiving timer-tick from main (avoids main sending to a disposed bar frame)
if (window.floatingAPI?.getTimer) {
  setInterval(() => {
    window.floatingAPI.getTimer().then((seconds) => {
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
  }, 1000);
}

// Poll session minimized and history visibility so bar pulls state instead of main pushing events
if (window.floatingAPI?.getSessionMinimized || window.floatingAPI?.getHistoryVisible) {
  let lastSessionMinimized = null;
  let lastHistoryVisible = null;
  setInterval(() => {
    if (window.floatingAPI?.getSessionMinimized) {
      window.floatingAPI.getSessionMinimized().then((minimized) => {
        if (minimized === lastSessionMinimized) return;
        lastSessionMinimized = minimized;
        if (minimized) {
          if (waveLevelsIntervalId) return;
          waveLevelsIntervalId = setInterval(() => {
            if (!analyser) return;
            sampleWaveLevels();
            if (window.floatingAPI?.sendWaveLevels) window.floatingAPI.sendWaveLevels(waveLevels);
          }, 50);
        } else {
          if (waveLevelsIntervalId) {
            clearInterval(waveLevelsIntervalId);
            waveLevelsIntervalId = null;
          }
          if (window.floatingAPI?.sendManualState && barManualSection) {
            const expanded = !barManualSection.classList.contains('hidden');
            window.floatingAPI.sendManualState(expanded);
          }
        }
      });
    }
    if (window.floatingAPI?.getHistoryVisible) {
      window.floatingAPI.getHistoryVisible().then((visible) => {
        if (visible === lastHistoryVisible) return;
        lastHistoryVisible = visible;
        setTranscribeButtonState(visible);
      });
    }
  }, 400);
}

if (barWaveIndicator) barWaveIndicator.classList.add('idle');

// Auto-turn on system audio (speaker) when the session bar opens
setTimeout(() => {
  if (!isSystemAudioCapturing) startSystemAudio();
}, 800);
