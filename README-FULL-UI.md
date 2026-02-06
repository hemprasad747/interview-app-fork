# Interview App – Full UI Code Reference

All **full UI source code** extracted from the app is in the **`sources/`** folder (2,465 files from the app’s source map). This document maps the UI structure and where each part lives.

---

## Entry & app shell

| File | Role |
|------|------|
| `sources/index.tsx` | React entry: mounts `App`, `QueryClient`, `TRPCReactProvider`, `LocationOnScreenProvider`, `Mixpanel` |
| `sources/App.tsx` | Root UI: login vs main layout, tabs (Create / Past Sessions), `LiveCallSessionScreen`, `MinimizedIcon`, `UpdateScreen`, `Toaster` |

---

## Screens (main views)

| Screen | File | Description |
|--------|------|-------------|
| Login | `LoginScreen.tsx` | Login screen; manual auth token (Ctrl/Cmd+click); link to web auth |
| Create session | `CreateCallSessionScreen.tsx` | Multi-step form: session type (free/full), company/job/resume, language & AI options, create |
| Past sessions | `CallSessionsList.tsx` | List of call sessions; click to open; “View All” link |
| Live session | `LiveCallSessionScreen.tsx` | Main call UI: transcript, AI messages, audio toggles, timer, prompt buttons, move/hide |
| Activate session | `ActivateCallSessionScreen.tsx` | Confirm activate (free vs credit); back/activate |
| Expired session | `ExpiredCallSessionScreen.tsx` | Expired state; back, extend or buy credits |
| AI messages | `AiMessagesScreen.tsx` | AI chat panel: prev/next, clear, resize; renders `AiMessage` list |
| Combined transcript | `CombinedTranscriptScreen.tsx` | Live transcript; auto-scroll, clear, minimize, hide |
| Minimized transcript | `MinimizedCombinedTranscriptScreen.tsx` | Small transcript bar when minimized |
| Location selector | `LocationSelectorScreen.tsx` | Choose window position (top/bottom, left/center/right) |
| Update | `UpdateScreen.tsx` | App update: check, download, install |

---

## Top bar & global UI

| Component | File | Description |
|-----------|------|-------------|
| Top bar | `TopBar.tsx` | Logo, version tooltip, Credits, MoreSelect, Move, Hide, Close |
| More menu | `MoreSelect.tsx` | Dropdown menu (settings, exit, etc.) |
| Live more menu | `LiveMoreSelect.tsx` | Same for live session (settings, auto-generate, exit) |
| Minimized icon | `MinimizedIcon.tsx` | Floating icon when app is minimized; click to restore |
| Credits | `CreditsButton.tsx` | Opens credits/account UI |

---

## Live session UI components

| Component | File | Description |
|-----------|------|-------------|
| Animated listening | `AnimatedListeningIcon.tsx` | Listening indicator / logo when minimized |
| Session timer | `SessionTimer.tsx` | Session duration / time left |
| Prompt buttons | `PromptButton.tsx`, `PromptButtonTitle.tsx` | “AI Answer”, “Analyze Screen”, etc. |
| Windows audio tap | `WindowsAudioTapDialog.tsx` | Permission dialog for system audio capture |
| Hide icon | `HideIcon.tsx` | Hide-window icon (light/dark) |
| Shortcut key | `ShortcutKey.tsx` | Renders Ctrl/Cmd for shortcuts |
| Resize | `ResizeButton.tsx` | Resize AI messages panel |

---

## Create-session form components

| Component | File | Description |
|-----------|------|-------------|
| Label + tooltip | `LabelWithTooltip.tsx` | Form label with tooltip |
| Language selector | `LanguageSelector.tsx` | Transcription language dropdown |
| AI model selector | `AIModelSelector.tsx` | AI model dropdown |
| Resume selector | `ResumeSelector.tsx` | Resume file/list for interview mode |

---

## AI & transcript UI

| Component | File | Description |
|-----------|------|-------------|
| Single AI message | `AiMessage.tsx` | One AI message (markdown, code blocks) |
| Code block | `CodeBlock.tsx` | Code block with highlight |
| Markdown | `markdownComponents.tsx`, `renderParts.tsx`, `renderMetadata.tsx` | Markdown and metadata rendering |
| Parts to content | `partsToContent.ts` | Build content from message parts |

---

## Shared UI primitives (in `sources/`)

These are the building blocks used across screens (paths in `sources/`):

- `button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`
- `switch.tsx`, `select.tsx`, `tabs.tsx`, `dialog.tsx`
- `tooltip.tsx`, `badge.tsx`

Use the version **without** the `_xxxx` suffix (e.g. `button.tsx`, not `button.tsx_900f`) as the main one.

---

## Context & hooks (UI-related)

| File | Purpose |
|------|--------|
| `locationOnScreenContext.tsx` | Window position (top/bottom, left/center/right); `LocationOnScreenProvider`, `useLocationOnScreen`, location selector |
| `usePointerPassThrough.ts` | Pointer events for transparent window |
| `useVersion.ts` | App version / OS for UI and activation |
| `useRealtimeSupport.tsx` | Live session: transcript, AI, share/mic, activate, extend |
| `useCombinedTranscript.tsx` | Combined transcript state |
| `useMicrophoneTranscription.tsx` | Mic transcription start/stop |
| `useShareTranscription.ts` | Share (system audio) transcription |
| `useTranscriptionLanguages.ts` | Language list/labels for dropdowns |
| `useAiMessages.ts` | AI messages list and actions |
| `useAutoExtend.ts` | Session auto-extend logic |

---

## Assets (from extracted app)

In the extracted original app bundle, assets are under:

- `extracted-app/resources/app-unpacked/dist/renderer/`: `index.html`, `style.css`, `renderer.js`, images (e.g. `69d05ba8503dde880b6f.png`)
- `extracted-app/resources/assets/`: `logo.png`, `icon.png`, `iconTransparent.png`, `trayIcon/`, etc.

Imports use `@assets/` (e.g. `logo.png`, `iconTransparent.png`).

---

## Styling

- **Global styles:** `index.tsx` imports `./styles.css` (not in extracted sources; build output is in `style.css` in the renderer folder).
- **Tailwind:** App uses Tailwind v4 (in `style.css`: theme, utilities, components).
- **Themes:** CSS variables for light/dark (`:root`, `.dark`) and custom colors (e.g. green, red, neutral).

---

## How to use this as “full UI code”

1. **Browse by screen:** Use the “Screens” and “Top bar & global UI” tables to find the TSX file for each part of the UI.
2. **Open files:** All of these files exist under **`sources/`** (e.g. `sources/App.tsx`, `sources/LoginScreen.tsx`).
3. **Imports:** Original paths use `@/renderer/`, `@/main/`, `@assets/`. In `sources/` the structure is flat, so you may need to adjust imports if you re-run the app.
4. **Full bundle:** The complete UI (and deps) is the **`sources/`** folder; the app UI is the **.tsx** and **.ts** files listed above; the rest are libraries (React, TanStack, Radix, Lucide, etc.).

---

## Quick file list (app UI only)

```
sources/index.tsx
sources/App.tsx
sources/LoginScreen.tsx
sources/CreateCallSessionScreen.tsx
sources/CallSessionsList.tsx
sources/LiveCallSessionScreen.tsx
sources/ActivateCallSessionScreen.tsx
sources/ExpiredCallSessionScreen.tsx
sources/AiMessagesScreen.tsx
sources/CombinedTranscriptScreen.tsx
sources/MinimizedCombinedTranscriptScreen.tsx
sources/LocationSelectorScreen.tsx
sources/UpdateScreen.tsx
sources/TopBar.tsx
sources/MoreSelect.tsx
sources/LiveMoreSelect.tsx
sources/MinimizedIcon.tsx
sources/CreditsButton.tsx
sources/AnimatedListeningIcon.tsx
sources/SessionTimer.tsx
sources/PromptButton.tsx
sources/PromptButtonTitle.tsx
sources/WindowsAudioTapDialog.tsx
sources/HideIcon.tsx
sources/ShortcutKey.tsx
sources/ResizeButton.tsx
sources/LabelWithTooltip.tsx
sources/LanguageSelector.tsx
sources/AIModelSelector.tsx
sources/ResumeSelector.tsx
sources/AiMessage.tsx
sources/CodeBlock.tsx
sources/markdownComponents.tsx
sources/renderParts.tsx
sources/renderMetadata.tsx
sources/locationOnScreenContext.tsx
sources/MockVideo.tsx
sources/button.tsx
sources/input.tsx
sources/textarea.tsx
sources/label.tsx
sources/switch.tsx
sources/select.tsx
sources/tabs.tsx
sources/dialog.tsx
sources/tooltip.tsx
sources/badge.tsx
```

The **full code of the UI** is these files plus everything they import (hooks, utils, types) in **`sources/`**.
