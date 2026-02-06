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

## How “invisible to capture” works

In `main.js`, after the window is ready we call:

```js
mainWindow.setContentProtection(true);
```

- **Windows:** Uses `SetWindowDisplayAffinity` with `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+).
- **macOS:** Sets the window’s sharing type so it’s excluded from capture.

The window is still visible to you; it just won’t appear in screenshots or in screen-recording software.
