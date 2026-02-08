const viewOnboarding = document.getElementById('view-onboarding');
const viewMinimized = document.getElementById('view-minimized');
const step0 = document.getElementById('step0');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
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
const authSignedOut = document.getElementById('auth-signed-out');
const authSignedIn = document.getElementById('auth-signed-in');
const authEmail = document.getElementById('auth-email');
const btnSignin = document.getElementById('btn-signin');
const btnSignout = document.getElementById('btn-signout');
const btnNextFromLogin = document.getElementById('btn-next-from-login');
const btnBack1 = document.getElementById('btn-back-1');
const btnBack2 = document.getElementById('btn-back-2');
const btnBack3 = document.getElementById('btn-back-3');
const btnNextToSessionType = document.getElementById('btn-next-to-session-type');
const btnCheckUpdates = document.getElementById('btn-check-updates');
const updateBanner = document.getElementById('update-banner');
const updateBannerText = document.getElementById('update-banner-text');
const btnRestartForUpdate = document.getElementById('btn-restart-for-update');
const creditsBadgeText = document.getElementById('credits-badge-text');
const btnBuyCredits = document.getElementById('btn-buy-credits');

let currentStep = 0;
let sessionMinimized = false;
let windowMinimized = false;
let suppressClick = false;

function updateAuthUI(data, skipToStep1) {
  const signedIn = !!data?.email || !!data?.token;
  if (authSignedOut) authSignedOut.classList.toggle('hidden', signedIn);
  if (authSignedIn) authSignedIn.classList.toggle('hidden', !signedIn);
  if (authEmail) authEmail.textContent = data?.email || 'Signed in';
  if (btnNextFromLogin) btnNextFromLogin.disabled = !signedIn;
  if (signedIn && skipToStep1) showStep(1);
}

async function setVersionTooltip() {
  const el = document.getElementById('launcher-brand');
  if (el && window.floatingAPI?.getAppVersion) {
    try {
      const v = await window.floatingAPI.getAppVersion();
      if (v) el.title = 'Version ' + v;
    } catch (_) {}
  }
}

async function initAuth() {
  setVersionTooltip();
  try {
    const data = await window.floatingAPI?.getAuthData?.();
    if (data?.email || data?.token) {
      updateAuthUI(data, true);
      await refreshCredits();
    }
  } catch (_) {}
}

if (btnSignin && window.floatingAPI?.openAuthUrl) {
  btnSignin.addEventListener('click', () => window.floatingAPI.openAuthUrl());
}
if (btnSignout && window.floatingAPI?.signOutAuth) {
  btnSignout.addEventListener('click', async () => {
    await window.floatingAPI.signOutAuth();
    userCreditsMinutes = 0;
    if (creditsBadgeText) creditsBadgeText.textContent = '0 min';
    updateAuthUI(null, false);
    showStep(0);
  });
}
if (window.floatingAPI?.onAuthTokenReceived) {
  window.floatingAPI.onAuthTokenReceived(async (data) => {
    updateAuthUI(data, true);
    await refreshCredits();
  });
}

function showOnboarding() {
  windowMinimized = false;
  if (viewMinimized) viewMinimized.classList.add('hidden');
  if (viewOnboarding) viewOnboarding.classList.remove('hidden');
  if (document.body) document.body.classList.remove('launcher-window-minimized');
  if (document.documentElement) document.documentElement.classList.remove('launcher-window-minimized');
  const root = document.getElementById('root');
  if (root) root.classList.remove('launcher-window-minimized');
  showStep(0);
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
  currentStep = step;
  if (step0) step0.classList.toggle('active', step === 0);
  if (step1) step1.classList.toggle('active', step === 1);
  if (step2) step2.classList.toggle('active', step === 2);
  if (step3) step3.classList.toggle('active', step === 3);
  if (step === 3) updateStartSessionButton();
  if (window.floatingAPI?.launcherSetStepSize) window.floatingAPI.launcherSetStepSize(step);
}

if (btnNextFromLogin) btnNextFromLogin.addEventListener('click', () => showStep(1));
if (btnNext) btnNext.addEventListener('click', () => showStep(2));
if (btnNextToSessionType) btnNextToSessionType.addEventListener('click', () => showStep(3));
if (btnBack1) btnBack1.addEventListener('click', () => showStep(0));
if (btnBack2) btnBack2.addEventListener('click', () => showStep(1));
if (btnBack3) btnBack3.addEventListener('click', () => showStep(2));

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

const FULL_CREDITS_MIN_REQUIRED = 1;
let userCreditsMinutes = 0;

async function refreshCredits() {
  try {
    const data = await window.floatingAPI?.getCredits?.();
    userCreditsMinutes = Math.max(0, Number(data?.creditsMinutes) || 0);
    if (creditsBadgeText) creditsBadgeText.textContent = userCreditsMinutes + ' min';
    updateStartSessionButton();
  } catch (_) {}
}

function updateStartSessionButton() {
  if (!btnStartSession) return;
  const sessionTypeRadio = document.querySelector('input[name="session-type"]:checked');
  const isFull = sessionTypeRadio?.value === 'full';
  const canStart = isFull ? userCreditsMinutes >= FULL_CREDITS_MIN_REQUIRED : true;
  btnStartSession.disabled = !canStart;
  btnStartSession.title = isFull && !canStart ? 'Full interview requires at least 1 min of credits' : '';
}

if (document.querySelectorAll('input[name="session-type"]').length) {
  document.querySelectorAll('input[name="session-type"]').forEach((r) => {
    r.addEventListener('change', updateStartSessionButton);
  });
}

btnStartSession.addEventListener('click', () => {
  if (!window.floatingAPI?.startSession || btnStartSession.disabled) return;
  const sessionTypeRadio = document.querySelector('input[name="session-type"]:checked');
  const sessionType = sessionTypeRadio?.value === 'full' ? 'full' : 'free';
  const creditsMinutes = sessionType === 'free' ? 10 : Math.max(0, userCreditsMinutes);
  const config = {
    company: (inputCompany && inputCompany.value) ? inputCompany.value.trim() : '',
    position: (inputPosition && inputPosition.value) ? inputPosition.value.trim() : '',
    resume: (inputResume && inputResume.value) ? inputResume.value.trim() : '',
    language: (inputLanguage && inputLanguage.value) ? inputLanguage.value : 'en-US',
    instructions: (inputInstructions && inputInstructions.value) ? inputInstructions.value.trim() : '',
    sessionType,
    creditsMinutes,
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
if (window.floatingAPI?.onCreditsChanged) {
  window.floatingAPI.onCreditsChanged(() => refreshCredits());
}
// Refresh credits when launcher gets focus (e.g. after returning from buy-credits in browser)
let lastCreditsRefreshOnFocus = 0;
window.addEventListener('focus', () => {
  if (Date.now() - lastCreditsRefreshOnFocus < 2000) return;
  lastCreditsRefreshOnFocus = Date.now();
  refreshCredits();
});

// 30-minute inactivity timeout: sign out if no activity for 30 min
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivityTime = Date.now();

function resetInactivityTimer() {
  lastActivityTime = Date.now();
}

async function checkInactivityAndSignOut() {
  try {
    const data = await window.floatingAPI?.getAuthData?.();
    if (!data?.token) return;
    const sessionActive = await window.floatingAPI?.isSessionActive?.();
    if (sessionActive) return;
    if (Date.now() - lastActivityTime >= INACTIVITY_TIMEOUT_MS) {
      await window.floatingAPI?.signOutAuth?.();
      userCreditsMinutes = 0;
      if (creditsBadgeText) creditsBadgeText.textContent = '0 min';
      updateAuthUI(null, false);
      showStep(0);
    }
  } catch (_) {}
}

['mousedown', 'keydown', 'click', 'scroll'].forEach((ev) => {
  window.addEventListener(ev, resetInactivityTimer);
});
window.addEventListener('focus', resetInactivityTimer);

if (window.floatingAPI?.onSessionEnded) {
  window.floatingAPI.onSessionEnded(() => {
    resetInactivityTimer();
    sessionMinimized = false;
    showOnboarding();
    refreshCredits();
  });
}

setInterval(checkInactivityAndSignOut, 60000);
if (btnBuyCredits && window.floatingAPI?.openBuyCreditsUrl) {
  btnBuyCredits.addEventListener('click', () => window.floatingAPI.openBuyCreditsUrl());
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

function showUpdateBanner(text, showRestart) {
  if (!updateBanner || !updateBannerText) return;
  updateBannerText.textContent = text;
  if (btnRestartForUpdate) btnRestartForUpdate.classList.toggle('hidden', !showRestart);
  updateBanner.classList.remove('hidden');
}

if (window.floatingAPI?.onUpdateAvailable) {
  window.floatingAPI.onUpdateAvailable((version) => showUpdateBanner(`Update ${version || ''} available – downloading…`, false));
}
if (window.floatingAPI?.onUpdateDownloaded) {
  window.floatingAPI.onUpdateDownloaded(() => showUpdateBanner('Update ready – restarting in 3 seconds…', false));
}
if (btnRestartForUpdate && window.floatingAPI?.quitAndInstall) {
  btnRestartForUpdate.addEventListener('click', () => window.floatingAPI.quitAndInstall());
}
if (btnCheckUpdates && window.floatingAPI?.checkForUpdates) {
  btnCheckUpdates.addEventListener('click', async () => {
    btnCheckUpdates.disabled = true;
    try {
      await window.floatingAPI.checkForUpdates();
    } catch (_) {}
    btnCheckUpdates.disabled = false;
  });
}

showOnboarding();
showStep(0);
initAuth();
