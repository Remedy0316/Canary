# Canary

Streaming TTS providers for [SillyTavern](https://github.com/SillyTavern/SillyTavern):

- **Xiaomi MiMo** (`mimo-v2.5-tts`), with eight preset voices and optional voice delivery instructions.
- **MiniMax** (`speech-2.8`, `speech-2.6` and `speech-02` models), with your account's system and cloned voices, a global emotion setting, and a region selector.

Canary starts playing incoming audio while the provider is still generating speech. PCM chunks are scheduled on a continuous Web Audio clock, with a small configurable buffer. SillyTavern continues to manage character voice assignments, text processing, narration jobs, and automatic reading.

## Install

Requires **SillyTavern 1.19.0 or newer**, its built-in **TTS** extension enabled, a browser with Web Audio support, and your own API key: a MiMo key with access to `mimo-v2.5-tts`, or a MiniMax key.

1. Open SillyTavern's **Extensions → Install extension**.
2. Paste `https://github.com/Remedy0316/Canary`.
3. Install and reload SillyTavern.
4. Open **TTS**, enable it, and select **Xiaomi MiMo (Canary)** or **MiniMax (Canary)**.
5. For MiniMax, first choose the **Region** where your key was issued. Enter your API key, tick **Remember for this SillyTavern account** if you want it kept across reloads and devices, and click **Save key**.
6. Assign a voice to **[Default Voice]** and/or individual characters in the native voice map.
7. Click **Preview** to check speech. Use SillyTavern's message narration or TTS playback controls to read a message.

There is no build step, companion server, server plugin, or extra Railway service to install.

### Railway

Choose **Install just for me** so Canary is installed under `data/<user-handle>/extensions`. Ensure your deployment's **data directory is on its persistent volume**. An extension installed into an ephemeral application directory can disappear on redeploy.

Railway serves the extension files. Speech requests travel from your browser directly to `https://api.xiaomimimo.com`, `https://api.minimax.io` or `https://api.minimaxi.com`, so the browser needs network access to the endpoint you use. Canary does not route audio through Railway.

## Using streaming

### Xiaomi MiMo

The MiMo panel uses the same sections: Connection, Voice (delivery instructions), Fine-tuning (streaming buffer) and Preview.

- **Voices:** 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe, Milo, Dean. All eight are available for English, Chinese, and mixed-language text. Canary preserves your selected voice across languages and sends the original text to MiMo without translation or a forced language parameter. Pronunciation and accent depend on MiMo.
- **Preview language:** Choose **English**, **中文**, or **English + 中文** (default) independently of the voice. This setting changes only the preview sample; narration follows the actual message text. Existing character voice assignments are preserved.
- **Voice delivery instructions:** Optional natural-language directions, such as speaking gently or using a particular emotion. Leave blank to let the model interpret the text.

### MiniMax

MiniMax (Canary) is an alternative to SillyTavern's built-in MiniMax provider when you want the current models or streaming. The built-in provider sends each passage through the SillyTavern server and plays it only after generation finishes. The two do not share a key (see [Keys and privacy](#keys-and-privacy)).

Settings are grouped into collapsible sections: Connection, Voice, Custom voices, Fine-tuning and Preview. **Connection** folds to a one-line summary (key status and region) once a key is saved; **Custom voices** and **Fine-tuning** start folded.

**Connection**

- **Region:** **Global** (`api.minimax.io`, default) or **Mainland China** (`api.minimaxi.com`). Keys are issued per region and do not work across regions.

**Voice**

- **Model:** `speech-2.8-hd` (default), `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`, `speech-02-hd` or `speech-02-turbo`. `speech-2.8` models perform interjection tags written in the text, such as `(laughs)` or `(sighs)`, and MiniMax reads `<#0.5#>` as a half-second pause.
- **Emotion:** **Auto** (default) lets the model choose from the text. Happy, sad, angry, fearful, disgusted, surprised, calm, fluent or whisper applies to every voice. MiniMax lists fluent and whisper only for `speech-2.6` models; Canary shows a warning if you pick them with another listed model.
- **Language:** **Auto-detect** (default) or one of the 40 languages MiniMax supports (`language_boost`). Set one if auto-detection misreads short or mixed lines, for example Cantonese read as Mandarin. Applies to every voice.
- **Speed:** Type a value from 0.5 to 2 (default 1.00); values outside that range are limited to it, and an empty entry keeps the previous value. Sent to MiniMax as its speed parameter, so speech changes pace without changing pitch. While MiniMax (Canary) is selected, SillyTavern's **Audio Playback Speed** slider is hidden and not used; it returns for other providers.

**Fine-tuning**

- **Volume:** 0.1–10 (default 1). **Pitch:** −12 to +12 semitones (default 0).
- **Read numbers and dates naturally:** MiniMax text normalization for Chinese and English, at a slightly slower start. Off by default.
- **Custom model ID:** overrides **Model**, for a model released after this version of Canary.
- **Streaming buffer**, and **Reset fine-tuning** to restore all of the above to defaults.

Only changed values are sent; defaults leave MiniMax's own behavior untouched.

**Voices**

After you save a key, Canary loads your account's voices: cloned and designed voices under **Your voices**, then system voices grouped by language. Without a key, or if loading fails, a built-in list of English, Chinese, Cantonese and Japanese system voices is shown. SillyTavern's **Reload** button reloads the list.

- **Names:** Voices appear as a readable name plus the voice ID, such as `Expressive Narrator · English_expressive_narrator`, in Canary's list and in SillyTavern's voice map. Voices without a name (usually clones) appear by ID. Assignments saved by earlier versions as bare IDs are relabelled automatically and keep working.
- **Search:** Canary's preview list (when long) and a box above SillyTavern's voice map both filter by every word you type, matching names, nicknames and IDs, such as `calm japanese`. The voice-map search never hides `[Default Voice]`, `disabled` or a dropdown's current choice. It hides options through the browser's dropdown; a browser that ignores hidden options shows them greyed out instead.
- **Custom voices:** Add any voice ID from your MiniMax account, such as a voice cloned on the MiniMax website, with an optional nickname. Custom voices are listed first under **Your voices** and appear in the voice map. Adding the ID of a voice that is already listed gives it a nickname. Adding an existing custom ID again updates its nickname, and assignments follow the new name. Removing a custom voice that is still assigned keeps that assignment working by ID. Canary does not check that a hand-added ID exists; MiniMax reports an error when it is used if it does not.
- Voices already assigned in the voice map stay selectable even if the list could not be loaded.

Long passages are split at a client policy of 3,000 Unicode code points per request (MiniMax accepts under 10,000).

### Both providers

- **Streaming buffer:** 80, 120 (default), or 250 ms. This is the local playback buffer, not a promise about the provider's server latency. A larger buffer can absorb small network delays.
- **Playback speed (MiMo):** Uses SillyTavern's **Audio Playback Speed** slider when each speech job starts, clamped to 0.5–2×. MiMo audio is played faster or slower, which also shifts pitch. MiniMax uses its own **Speed** setting instead.
- **Enable audio:** Click once if the browser blocks automatic audio. Preview and native narration clicks also attempt to enable it, and while automatic narration is on (or audio is playing), any tap or key press on the page does too.
- **Stop:** Canary's Stop button and SillyTavern's native TTS Stop cancel both playback and the HTTP stream. Chat changes, swipes, provider changes, and disabling TTS also stop playback.
- **Automatic narration:** Uses SillyTavern's existing settings. To start narrating paragraphs while a chat response is still being written, enable its **Auto Generation** and **Narrate by paragraphs (when streaming)** options. This is separate from streaming the audio of each passage.

Long passages are split near sentence/clause/word boundaries (at 1,200 Unicode code points per MiMo request). Requests run sequentially. A new request between passages may introduce a pause. Within a request, audio buffers share a continuous clock; network starvation can still cause pauses.

Canary aborts after 45 seconds without new audio, or after ten minutes for a single narration job. It does not automatically retry partially spoken passages or silently switch to non-streaming generation.

## Keys and privacy

Each provider has its own key field. SillyTavern keeps its built-in MiniMax key on the server and deliberately never sends it to the browser, while Canary calls the provider from the browser, so Canary needs its own copy of the key.

Keys are kept in memory for the current page session by default. Switching providers preserves the session key; reloading or closing the page clears it.

**Remember for this SillyTavern account** saves the key in that account's SillyTavern settings on the server (`data/<user-handle>/settings.json`), so it works on any device you sign in from. **Forget key** removes it. Keys remembered on the browser by earlier Canary versions are moved into the account settings on first load, then deleted from the browser.

The saved key is protected only by SillyTavern's own access control: anyone who can sign in to that account (basic auth or user-account login) can retrieve it, and so can scripts and extensions running in SillyTavern. It is stored unencrypted, and also appears in SillyTavern's automatic settings backups (`data/<user-handle>/backups`) and in anything with access to your server's data volume.

Keys are kept in a separate `canary` settings entry (`mimoKey`, `minimaxKey`), never in the TTS provider settings object, which SillyTavern logs to the browser console on save. Canary does not embed shared credentials, send your browser cookies to either provider, or save generated audio files. MiMo receives the text being narrated, the optional delivery instructions, and your API key. MiniMax receives the text being narrated, your voice, model and emotion choices, and your API key; Canary also asks it for your account's voice list when the provider loads, a key is saved, or the region changes. Each provider's service terms and usage limits apply.

## Compatibility and limits

- The extension adds its providers using `registerTtsProvider`; it does not edit SillyTavern core files or chat messages.
- Continuous playback uses Web Audio. SillyTavern's narration job remains active until audio finishes, using its supported async-iterable provider interface.
- **RVC, native blob-based VRM lip sync, and extensions depending on `TTS_AUDIO_READY` audio blobs are not supported by this playback path.** Native TTS job start/complete events still run; completion can also follow cancellation, as in the host.
- Canary observes the native `#tts_audio` source reset to catch programmatic cancellation such as `/speak`. This integration depends on SillyTavern's current TTS implementation and is covered by the upstream integration harness.
- The providers register before native TTS activation to support restoring a saved Canary selection after reload. The manifest's loading order and activation hook are intentional.
- Browser background playback and mobile audio activation depend on the browser/OS. Installed iPhone/PWA behavior needs physical-device confirmation.
- **iPhone and iPad:** Canary declares its audio as media playback (iOS 16.4+), so it plays with the silent switch on and pauses other apps' audio while it speaks, like a podcast. iOS pauses Web Audio when the screen locks or the app goes to the background; tap the page on return to resume. After 45 seconds paused, Canary stops that narration and reports the interruption.
- This release supports preset-voice `mimo-v2.5-tts`. MiMo voice design and voice cloning are not included.
- MiniMax cloned and designed voices can be used once created on the MiniMax platform; Canary does not create them. Pronunciation dictionaries, voice mixing and subtitles are not included.
- If MiMo or MiniMax changes its browser CORS policy, direct requests may stop working. Canary reports connection failures rather than sending keys through a third-party proxy.

## Development and verification

The runtime is plain JavaScript with no external package dependencies. Node.js 20+ is needed only for development tests.

```sh
npm test
npm run check
```

Browser integration tests require Playwright and Chromium:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/prepare-upstream.cjs
npm run test:browser
```

If Playwright is already installed globally (`npm install -g playwright`), skip the first two commands and point Node at it instead: `NODE_PATH="$(npm root -g)" node tests/browser.cjs`.

The preparation script downloads official SillyTavern 1.19.0 TTS source, its settings template, and jQuery into the ignored `.qa/upstream` directory. The browser harness runs that native TTS implementation with mocked surrounding application services and local streaming MiMo and MiniMax endpoints. No live API key is used. Each browser test has finite timeouts and closes pages, context, browser, streams, and its local server in `finally`.

Before running browser tests, record existing browser/Node PIDs. Afterward verify every test-owned process has exited, leaving pre-existing processes untouched. On Windows, `Get-CimInstance Win32_Process` provides PID and parent PID information; if unavailable, use an authorized process inspector before launching the test.

Verified in the development harness (MiMo): first playback before stream completion, PCM continuity, native Stop, cancellation before first audio, chat/provider changes, completed previews, programmatic narration replacement, key storage/removal, restoring the selected provider, and narrow viewport layout. Unit tests exercise fragmented SSE/UTF-8, odd PCM bytes, malformed/truncated streams, HTTP errors, text splitting, and key isolation.

MiniMax unit tests cover the request format (including language, volume, pitch and normalization), voice grouping, hex PCM streaming, skipping the aggregated final chunk, errors reported inside HTTP 200 responses, voice listing, region hosts and separate key storage. The browser harness adds MiniMax scenarios for collapsible sections and the connection summary, grouped voices and voice search, the emotion warning, fine-tuning and its reset, account voices in the voice map, streaming before completion, native Stop, emotion/custom model/native speed, region switching, redacted errors, and switching between Canary providers.

**Not yet verified:** live authenticated MiMo or MiniMax synthesis, real-world time to first audio, your deployed Railway instance, and physical iPhone/PWA playback. Mocked audio tests verify integration and scheduling, not MiMo voice quality or account access.

## Structure

```text
index.js                 Provider registration and SillyTavern integration
providers/streaming.js   Shared settings markup, voice mapping contract, playback lifecycle
providers/mimo.js        MiMo settings and request options
providers/minimax.js     MiniMax settings, region, account voice loading
lib/mimo-api.js          MiMo request format and stream validation
lib/minimax-api.js       MiniMax request format, stream validation, voice listing
lib/minimax-voices.js    Built-in MiniMax voice IDs used without a key
lib/text.js              Text splitting near sentence boundaries
lib/sse.js               Incremental server-sent event parser
lib/pcm-player.js        PCM conversion and continuous Web Audio scheduling
lib/key-store.js         Session and optional account-settings key storage
```

New providers can extend `StreamingProvider` with their own settings and stream adapter, and be registered from `index.js`.

## References

- [MiMo speech synthesis documentation](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)
- [MiniMax text-to-speech HTTP API](https://platform.minimax.io/docs/api-reference/speech-t2a-http) and [Get Voice API](https://platform.minimax.io/docs/api-reference/voice-management-get)
- [SillyTavern extension development](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [SillyTavern TTS implementation](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/tts/index.js)
