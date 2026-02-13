## Adding a new AI model to the desktop app

This guide explains how to wire a new Azure AI Foundry deployment (for example, a new GPT variant) into the AlphaViewAI desktop app.

The app is already configured so that the **frontend chooses a model name** and the **backend forwards that name directly to Azure Foundry**. Adding a model is mostly a UI + configuration change.

---

### 1. Create or identify the deployment in Azure Foundry

1. Go to your Foundry project (for example `proj-default`) in the Azure portal.
2. Open **Model catalog** → pick the base model you want (e.g. a new GPT version).
3. Click **Deploy** and create a deployment.
4. Choose a clear **deployment name** – this is exactly what the app will send in the `model` field (for example: `gpt-4.2-mini`).
5. Confirm the deployment is created under the same resource you use today (for example `alphaviewgpt4mini`), so it shares the existing endpoint and key.

You don’t need to change any Azure keys or endpoints as long as the deployment lives in the same Foundry resource.

---

### 2. Expose the model in the launcher UI

The launcher step 2 (language + model) controls which model the user selects.

- **File**: `renderer/launcher.html`

1. Find the AI model `<select>`:

```html
<select id="select-ai-model">
  <option value="gpt-4.1">GPT-4.1</option>
  <option value="gpt-4o-mini">GPT-4o Mini</option>
  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
</select>
```

2. Add a new `<option>` for your deployment name:

```html
  <option value="gpt-4.2-mini">GPT-4.2 Mini</option>
```

> The `value` attribute **must match** the Foundry deployment name exactly.

---

### 3. Validate the model value in the launcher script

The launcher JavaScript validates that the selected value is one of the known models before saving it into the session config.

- **File**: `renderer/launcher.js`

1. Locate the code that computes `aiModel` when starting a session:

```js
const selectAiModel = document.getElementById('select-ai-model');
const aiModel = (
  selectAiModel?.value === 'gpt-4o-mini' ||
  selectAiModel?.value === 'gpt-4.1' ||
  selectAiModel?.value === 'gpt-4.1-mini'
) ? selectAiModel.value : 'gpt-4o-mini';
```

2. Add your new model to this list:

```js
const aiModel = (
  selectAiModel?.value === 'gpt-4o-mini' ||
  selectAiModel?.value === 'gpt-4.1' ||
  selectAiModel?.value === 'gpt-4.1-mini' ||
  selectAiModel?.value === 'gpt-4.2-mini'   // NEW
) ? selectAiModel.value : 'gpt-4o-mini';
```

Now the selected model will be stored in `config.aiModel` when a session starts.

---

### 4. How the model flows through the app

Once the session starts, the selected model is passed automatically:

1. **Launcher** (`launcher.js`) saves `aiModel` in the session config sent to the main process:
   - `window.floatingAPI.startSession(config)`
2. **Renderer** (`app.js` / `right.js`) fetches the session config:
   - `const config = await window.floatingAPI.getSessionConfig()`
   - Reads `config.aiModel` and calls:
     - `window.floatingAPI.callAIStream({ messages, model: config.aiModel })`
3. **Electron main** (`main.js`) receives `{ messages, model }` and forwards to the backend:
   - `ipcMain.handle('call-ai-stream', async (event, { messages, model }) => { ... })`
   - Includes `model` field in the HTTP body sent to Firebase Functions.
4. **Firebase Functions** (`alphaviewai-website/functions/index.js`) reads `req.body.model` and forwards it to Azure Foundry:
   - Uses the Azure AI inference endpoint:
     - `https://<resource>.services.ai.azure.com/models/chat/completions?api-version=...`
   - Sends the deployment name in the JSON body: `{ ..., model: "<your-deployment-name>" }`

Because this pipeline is already generic, **no backend code changes are required** for each new model, as long as you pass the deployment name from the UI.

---

### 5. Optional: make a model the default

If you want a particular model to be the default when nothing is selected or when running in fallback mode, update the environment configuration.

- **Desktop app env**: `.env` (see `.env.example`)

```env
AZURE_FOUNDRY_MODEL=gpt-4.1       # or your new deployment name
```

This value is used by the Electron fallback path (`getAzureFoundryConfig`) when it has to call Foundry directly.

You can also reorder the `<option>` elements in `launcher.html` so that your preferred model appears first in the dropdown.

---

### 6. Summary checklist for adding a model

1. **Deploy in Foundry** with a clear deployment name (`gpt-4.2-mini`).
2. **Add `<option>`** to `renderer/launcher.html` with that deployment name as the `value`.
3. **Add the value** to the validation list in `renderer/launcher.js` so it’s accepted as `aiModel`.
4. (Optional) Update `AZURE_FOUNDRY_MODEL` in `.env` and/or reorder options to make it the default.
5. Restart the app, start a session, pick the new model, and send a test question.

