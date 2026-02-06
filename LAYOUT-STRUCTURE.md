# Interview App – Layout Structure & Code

## 1. Layout structure (DOM hierarchy)

```
#root
├── #view-icon.view                    ← Collapsed: floating mic only
│   └── #btn-icon.floating-icon
│
├── #view-menu.view.hidden              ← Menu: mic + "Start Session"
│   ├── #btn-icon-menu.floating-icon
│   └── .floating-menu
│       └── #btn-start-session.menu-item
│
└── #view-bar.view.hidden               ← Full app: bar + panels
    ├── .app-header                     ← Session bar (fixed 48px, never resized)
    │   ├── #btn-mic.header-btn.icon-btn
    │   ├── #btn-system-audio.header-btn.icon-btn
    │   ├── .header-btn (AI Answer, Analyze Screen, Chat)
    │   ├── #btn-end-session.header-btn.bar-btn
    │   ├── .header-spacer
    │   ├── #bar-timer.header-timer
    │   ├── #header-clock.header-clock
    │   └── #btn-collapse.collapse-btn
    │
    └── .floating-panels                ← Two panels side by side
        ├── .panel.panel-left           ← History (fixed width, scroll inside)
        │   ├── .panel-header
        │   │   └── #btn-clear-history.panel-header-btn
        │   └── #history-list.panel-content.history-list   ← scrollable
        │
        └── .panel.panel-right          ← Response panel (only resizable area)
            ├── .panel-header.panel-header-qa
            │   ├── #question-input.question-tube
            │   └── #btn-ask-ai.ask-ai-btn
            └── .panel-body
                ├── .qa-section
                │   ├── .qa-label "Answer:"
                │   └── #ai-response-wrap
                │       ├── #ai-response-placeholder
                │       ├── #ai-response-loading
                │       ├── #ai-response-text        ← resizable height (drag)
                │       └── #ai-response-error
                ├── #ai-answer-footer
                └── #response-resize-corner         ← ONLY resize handle
```

## 2. Layout rules (summary)

| Area              | Behavior |
|-------------------|----------|
| **Session bar**    | Fixed height 48px, no resize, drag region for window move. |
| **History panel** | Fixed width (220px, min 180px). No resize. Only `#history-list` scrolls. |
| **Response panel**| Fills remaining width. Only `#response-resize-corner` resizes (Answer block height 80–400px). No window/layout resize. |
| **Scrolling**     | No page scroll. Only `.panel-content` (history) and `#ai-response-text` (answer) scroll. |

## 3. Full HTML (`renderer/index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Interview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
  <script src="https://aka.ms/csspeech/jsbrowserpackageraw" crossorigin="anonymous"></script>
</head>
<body>
  <div id="root">
    <!-- State: icon only -->
    <div id="view-icon" class="view">
      <button type="button" id="btn-icon" class="floating-icon" title="Open menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
      </button>
    </div>

    <!-- State: icon + menu -->
    <div id="view-menu" class="view hidden">
      <button type="button" id="btn-icon-menu" class="floating-icon" title="Open menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
      </button>
      <div class="floating-menu">
        <button type="button" id="btn-start-session" class="menu-item">Start Session</button>
      </div>
    </div>

    <!-- State: floating app – top bar + two independent panels (no window resize; only Response panel is resizable) -->
    <div id="view-bar" class="view hidden">
      <!-- Top control bar: fixed size, never resized -->
      <header class="app-header">
        <button type="button" class="header-btn icon-btn" id="btn-mic" title="Microphone (toggle to record)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
        </button>
        <button type="button" class="header-btn icon-btn" id="btn-system-audio" title="Capture and transcribe system audio">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        </button>
        <button type="button" class="header-btn">AI Answer</button>
        <button type="button" class="header-btn">Analyze Screen</button>
        <button type="button" class="header-btn">Chat</button>
        <button type="button" class="header-btn bar-btn" id="btn-end-session">End Session</button>
        <span class="header-spacer"></span>
        <span id="bar-timer" class="header-timer">0:00</span>
        <span id="header-clock" class="header-clock">8:28</span>
        <button type="button" class="header-btn collapse-btn" id="btn-collapse" title="Collapse to mic">⌃</button>
      </header>
      <!-- Two floating panels side by side -->
      <div class="floating-panels">
        <!-- Left panel: Chat / History -->
        <div class="panel panel-left">
          <div class="panel-header">
            <button type="button" class="panel-header-btn" id="btn-clear-history" title="Delete all">🗑</button>
          </div>
          <div id="history-list" class="panel-content history-list"></div>
        </div>
        <!-- Right panel: AI Question / Answer -->
        <div class="panel panel-right">
          <div class="panel-header panel-header-qa">
            <input type="text" id="question-input" class="question-tube" autocomplete="off" />
            <button type="button" id="btn-ask-ai" class="ask-ai-btn" title="Send">Send</button>
          </div>
          <div class="panel-body">
            <div class="qa-section">
              <div class="qa-label">Answer:</div>
              <div id="ai-response-wrap" class="ai-response-wrap">
                <div id="ai-response-placeholder" class="ai-response-placeholder"></div>
                <div id="ai-response-loading" class="ai-response-loading hidden">Thinking…</div>
                <div id="ai-response-text" class="ai-response-text hidden"></div>
                <div id="ai-response-error" class="ai-response-error hidden"></div>
              </div>
            </div>
            <div id="ai-answer-footer" class="ai-answer-footer">AI Answer (auto) – <span id="ai-answer-time">06:56 PM</span></div>
            <div id="response-resize-corner" class="response-resize-corner" title="Drag to resize">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M9 21H3v-6"/><path d="M14 10L3 21"/></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

## 4. Full CSS (`renderer/styles.css`)

Key layout rules:

- **`:root`** – Design tokens (accent, surfaces, border, text, radius, shadow).
- **`html, body`** – `overflow: hidden`, transparent background, font.
- **`#root`** – `width/height 100%`, `overflow: hidden`.
- **`.view`** – Full size flex column; `.view.hidden` → `display: none`.
- **`#view-bar`** – `height: 100%`, `min-height: 0`, `overflow: hidden` (fixed block, no page scroll).
- **`.app-header`** – `flex-shrink: 0`, `height: 48px` (session bar fixed).
- **`.floating-panels`** – `flex: 1`, `min-height: 0`, row with `gap: 10px`.
- **`.panel`** – Column, `min-height: 0`, `overflow: hidden`.
- **`.panel-left`** – `width: 220px`, `min-width: 180px`, `flex-shrink: 0`, `min-height: 0`.
- **`.panel-right`** – `flex: 1`, `min-width: 0`, `min-height: 200px`.
- **`.panel-content`** – `flex: 1`, `min-height: 0`, `overflow-y: auto` (scroll).
- **`.panel-body`** – `flex: 1`, `min-height: 0`, `position: relative`.
- **`.history-list`** – Column, gap 8px; items `.history-item-left` / `.history-item-right` for chat bubbles.
- **`.response-resize-corner`** – Absolute bottom-right in `.panel-body`; only resize handle.
- **`.ai-response-text`** – Scrollable answer area; height set by JS (80–400px) when dragging resize corner.

The complete stylesheet is in **`renderer/styles.css`** in the project (design tokens, reset, icon/menu/bar views, header, panels, history bubbles, response area, resize corner, bar button). No window/layout resize handles; only `.response-resize-corner` resizes the Answer block.
