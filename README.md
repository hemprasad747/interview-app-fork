# Interview App

A desktop interview app that:

- **Captures audio** via the microphone and shows live transcript (Azure Speech, Web Speech API, or Whisper fallback).
- **Sends the transcript to an AI** (OpenAI) for evaluation and tips.
- **Excludes the window from screen capture** on Windows and macOS (`setContentProtection(true)` → `SetWindowDisplayAffinity` / `NSWindowSharingNone`), so screenshots and recorders won’t show this window.

## Requirements

- Node.js 18+
- **OpenAI API key** (for “Get AI answer”)

## Setup

```bash
cd interview-app
npm install
```

Set your OpenAI API key:

- **Windows (PowerShell):**  
  `$env:OPENAI_API_KEY = "sk-..."`
- **Or create a `.env` file** in the project root and load it (e.g. with `dotenv`) before starting Electron — the main process reads `process.env.OPENAI_API_KEY`.

## Run

```bash
npm start
```

1. Optionally enter an **interview question** in the text area.
2. Click **Start recording** and speak; the transcript appears as you talk.
3. Click **Stop recording**, then **Get AI answer** to get an evaluation from the AI.

## Build installer (optional)

```bash
npm run dist
```

Output is in the `dist` folder (e.g. Windows `.exe` installer).

## Publish release (Hostinger – auto-updates)

The app checks **https://alphaviewai.com/releases/** for updates.

### Option A: GitHub Action (automated)

1. Add these **secrets** in GitHub → Settings → Secrets and variables → Actions:
   - `FTP_SERVER` – e.g. `ftp.alphaviewai.com` or your Hostinger FTP host
   - `FTP_USERNAME` – your Hostinger FTP username
   - `FTP_PASSWORD` – your Hostinger FTP password

2. To release:
   - Bump version in `package.json`
   - Commit and push
   - Either create a tag (e.g. `git tag v1.0.2 && git push origin v1.0.2`) or run the **Build and deploy to Hostinger** workflow manually from the Actions tab
3. The workflow builds and uploads `latest.yml` + the `.exe` to `public_html/releases/`.

### Option B: Manual upload

1. **Bump version** in `package.json` (e.g. `1.0.1` → `1.0.2`).
2. **Build:** `npm run dist`
3. **Upload to Hostinger** in the `releases/` folder:
   - `dist/latest.yml`
   - `dist/Interview App Setup X.X.X.exe`
4. Already-installed users get the update automatically on next app restart.

## How “invisible to capture” works

In `main.js`, after the window is ready we call:

```js
mainWindow.setContentProtection(true);
```

- **Windows:** Uses `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+).
- **macOS:** Sets the window’s sharing type so it’s excluded from capture.

The window is still visible to you; it just won’t appear in screenshots or in screen-recording software.
