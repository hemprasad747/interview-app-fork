const viewOnboarding = document.getElementById('view-onboarding');
const viewMinimized = document.getElementById('view-minimized');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const inputCompany = document.getElementById('input-company');
const inputPosition = document.getElementById('input-position');
const inputResume = document.getElementById('input-resume');
const inputLanguage = document.getElementById('input-language');
const inputInstructions = document.getElementById('input-instructions');
const btnNext = document.getElementById('btn-next');
const btnBack = document.getElementById('btn-back');
const btnStartSession = document.getElementById('btn-start-session');
const btnIconWave = document.getElementById('btn-icon-wave');
const btnIconLogo = document.getElementById('btn-icon-logo');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

let sessionMinimized = false;
let windowMinimized = false;
let suppressClick = false;

function showOnboarding() {
  windowMinimized = false;
  if (viewMinimized) viewMinimized.classList.add('hidden');
  if (viewOnboarding) viewOnboarding.classList.remove('hidden');
  if (document.body) document.body.classList.remove('launcher-window-minimized');
  if (document.documentElement) document.documentElement.classList.remove('launcher-window-minimized');
  const root = document.getElementById('root');
  if (root) root.classList.remove('launcher-window-minimized');
  showStep(1);
}

function showMinimized() {
  if (viewOnboarding) viewOnboarding.classList.add('hidden');
  if (viewMinimized) viewMinimized.classList.remove('hidden');
  if (btnIconLogo) btnIconLogo.classList.toggle('hidden', !windowMinimized);
  if (btnIconWave) btnIconWave.classList.toggle('hidden', windowMinimized);
  const isIconMode = windowMinimized || sessionMinimized;
  if (document.body) document.body.classList.toggle('launcher-window-minimized', isIconMode);
  if (document.documentElement) document.documentElement.classList.toggle('launcher-window-minimized', isIconMode);
  const root = document.getElementById('root');
  if (root) root.classList.toggle('launcher-window-minimized', isIconMode);
}

function showStep(step) {
  if (step1) step1.classList.toggle('active', step === 1);
  if (step2) step2.classList.toggle('active', step === 2);
  if (window.floatingAPI?.launcherSetStepSize) window.floatingAPI.launcherSetStepSize(step);
}

btnNext.addEventListener('click', () => {
  showStep(2);
});

btnBack.addEventListener('click', () => {
  showStep(1);
});

if (btnMinimize && window.floatingAPI?.launcherMinimizeToIcon) {
  btnMinimize.addEventListener('click', async () => {
    await window.floatingAPI.launcherMinimizeToIcon();
    windowMinimized = true;
    showMinimized();
  });
}
if (btnClose && window.floatingAPI?.windowClose) {
  btnClose.addEventListener('click', () => window.floatingAPI.windowClose());
}

btnStartSession.addEventListener('click', () => {
  if (!window.floatingAPI?.startSession) return;
  const config = {
    company: (inputCompany && inputCompany.value) ? inputCompany.value.trim() : '',
    position: (inputPosition && inputPosition.value) ? inputPosition.value.trim() : '',
    resume: (inputResume && inputResume.value) ? inputResume.value.trim() : '',
    language: (inputLanguage && inputLanguage.value) ? inputLanguage.value : 'en-US',
    instructions: (inputInstructions && inputInstructions.value) ? inputInstructions.value.trim() : '',
  };
  window.floatingAPI.startSession(config);
});

if (inputInstructions) {
  function autoResizeTextarea() {
    inputInstructions.style.height = 'auto';
    inputInstructions.style.height = Math.min(200, Math.max(56, inputInstructions.scrollHeight)) + 'px';
  }
  inputInstructions.addEventListener('input', autoResizeTextarea);
  inputInstructions.addEventListener('focus', autoResizeTextarea);
}

if (btnIconLogo && window.floatingAPI?.launcherRestoreFromIcon) {
  btnIconLogo.addEventListener('click', async () => {
    await window.floatingAPI.launcherRestoreFromIcon();
    windowMinimized = false;
    showOnboarding();
  });
}
if (btnIconWave) {
  btnIconWave.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    e.preventDefault();
    if (sessionMinimized && window.floatingAPI?.expandSession) window.floatingAPI.expandSession();
  });
}

if (window.floatingAPI?.onSessionMinimized) {
  window.floatingAPI.onSessionMinimized(() => {
    sessionMinimized = true;
    showMinimized();
  });
}
if (window.floatingAPI?.onSessionEnded) {
  window.floatingAPI.onSessionEnded(() => {
    sessionMinimized = false;
    showOnboarding();
  });
}

const LAUNCHER_WAVE_MIN = 0.2;
const LAUNCHER_WAVE_MAX = 1.9;
if (window.floatingAPI?.onWaveLevels) {
  window.floatingAPI.onWaveLevels((levels) => {
    const bars = document.querySelectorAll('.launcher-wave-bar');
    if (!bars.length || bars.length !== (levels?.length || 0)) return;
    for (let i = 0; i < bars.length; i++) {
      const level = Math.max(0, Math.min(1, Number(levels[i]) || 0));
      const scale = LAUNCHER_WAVE_MIN + level * (LAUNCHER_WAVE_MAX - LAUNCHER_WAVE_MIN);
      bars[i].style.transform = `scaleY(${scale})`;
    }
  });
}

showOnboarding();
