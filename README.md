# Canary

Streaming TTS providers for [SillyTavern](https://github.com/SillyTavern/SillyTavern). The first provider is **Xiaomi MiMo**, with eight preset voices and optional voice delivery instructions.

Canary starts playing incoming audio while MiMo is still generating speech. PCM chunks are scheduled on a continuous Web Audio clock, with a small configurable buffer. SillyTavern continues to manage character voice assignments, text processing, narration jobs, and automatic reading.

## Install

Requires **SillyTavern 1.19.0 or newer**, its built-in **TTS** extension enabled, a browser with Web Audio support, and your own MiMo API key with access to `mimo-v2.5-tts`.

1. Open SillyTavern's **Extensions → Install extension**.
2. Paste `https://github.com/Remedy0316/Canary`.
3. Install and reload SillyTavern.
4. Open **TTS**, enable it, and select **Xiaomi MiMo (Canary)**.
5. Enter your MiMo API key and click **Save key**.
6. Assign a voice to **[Default Voice]** and/or individual characters in the native voice map.
7. Click **Preview** to check speech. Use SillyTavern's message narration or TTS playback controls to read a message.

There is no build step, companion server, server plugin, or extra Railway service to install.

### Railway

Choose **Install just for me** so Canary is installed under `data/<user-handle>/extensions`. Ensure your deployment's **data directory is on its persistent volume**. An extension installed into an ephemeral application directory can disappear on redeploy.

Railway serves the extension files. Speech requests travel from your browser directly to `https://api.xiaomimimo.com`, so the browser needs network access to that endpoint. Canary does not route audio through Railway.

## Using streaming

- **Voices:** 冰糖, 茉莉, 苏打, 白桦, Mia, Chloe, Milo, Dean.
- **Voice delivery instructions:** Optional natural-language directions, such as speaking gently or using a particular emotion. Leave blank to let the model interpret the text.
- **Streaming buffer:** 80, 120 (default), or 250 ms. This is the local playback buffer, not a promise about MiMo's server latency. A larger buffer can absorb small network delays.
- **Playback speed:** Uses SillyTavern's playback-speed setting when each speech job starts, clamped to 0.5–2×.
- **Enable audio:** Click once if the browser blocks automatic audio. Preview and native narration clicks also attempt to enable it.
- **Stop:** Canary's Stop button and SillyTavern's native TTS Stop cancel both playback and the HTTP stream. Chat changes, swipes, provider changes, and disabling TTS also stop playback.
- **Automatic narration:** Uses SillyTavern's existing settings. To start narrating paragraphs while a chat response is still being written, enable its **Auto Generation** and **Narrate by paragraphs (when streaming)** options. This is separate from streaming the audio of each passage.

Long passages are split near sentence/clause/word boundaries at a client policy of 1,200 Unicode code points per request. Requests run sequentially. A new request between passages may introduce a pause. Within a request, audio buffers share a continuous clock; network starvation can still cause pauses.

Canary aborts after 45 seconds without new audio, or after ten minutes for a single narration job. It does not automatically retry partially spoken passages or silently switch to non-streaming generation.

## Keys and privacy

Keys are kept in memory for the current page session by default. Switching providers preserves the session key; reloading or closing the page clears it.

**Remember on this browser** optionally stores the key in browser local storage, separated by SillyTavern account handle. **Forget key** removes it. This storage is not encrypted and is accessible to scripts and extensions running on the same site. Browser storage failures are reported in the UI.

Keys are excluded from Canary's SillyTavern provider settings, which SillyTavern can save and log. Canary does not embed shared credentials, send your browser cookies to MiMo, or save generated audio files. MiMo receives the text being narrated, the optional delivery instructions, and your API key. Its service terms and usage limits apply.

## Compatibility and limits

- The extension adds a provider using `registerTtsProvider`; it does not edit SillyTavern core files or chat messages.
- Continuous playback uses Web Audio. SillyTavern's narration job remains active until audio finishes, using its supported async-iterable provider interface.
- **RVC, native blob-based VRM lip sync, and extensions depending on `TTS_AUDIO_READY` audio blobs are not supported by this playback path.** Native TTS job start/complete events still run; completion can also follow cancellation, as in the host.
- Canary observes the native `#tts_audio` source reset to catch programmatic cancellation such as `/speak`. This integration depends on SillyTavern's current TTS implementation and is covered by the upstream integration harness.
- The provider registers before native TTS activation to support restoring a saved Canary selection after reload. The manifest's loading order and activation hook are intentional.
- Browser background playback and mobile audio activation depend on the browser/OS. Installed iPhone/PWA behavior needs physical-device confirmation.
- This release supports preset-voice `mimo-v2.5-tts`. Voice design and voice cloning are not included.
- If MiMo changes its browser CORS policy, direct requests may stop working. Canary reports connection failures rather than sending keys through a third-party proxy.

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

The preparation script downloads official SillyTavern 1.19.0 TTS source, its settings template, and jQuery into the ignored `.qa/upstream` directory. The browser harness runs that native TTS implementation with mocked surrounding application services and a local streaming MiMo endpoint. No live API key is used. Each browser test has finite timeouts and closes pages, context, browser, streams, and its local server in `finally`.

Before running browser tests, record existing browser/Node PIDs. Afterward verify every test-owned process has exited, leaving pre-existing processes untouched. On Windows, `Get-CimInstance Win32_Process` provides PID and parent PID information; if unavailable, use an authorized process inspector before launching the test.

Verified in the development harness: first playback before stream completion, PCM continuity, native Stop, cancellation before first audio, chat/provider changes, completed previews, programmatic narration replacement, key storage/removal, restoring the selected provider, and narrow viewport layout. Unit tests exercise fragmented SSE/UTF-8, odd PCM bytes, malformed/truncated streams, HTTP errors, text splitting, and key isolation.

**Not yet verified:** live authenticated MiMo synthesis, real-world time to first audio, your deployed Railway instance, and physical iPhone/PWA playback. Mocked audio tests verify integration and scheduling, not MiMo voice quality or account access.

## Structure

```text
index.js                 Provider registration and SillyTavern integration
providers/mimo.js        Settings, voice mapping contract, playback lifecycle
lib/mimo-api.js          MiMo request format, stream validation, text splitting
lib/sse.js               Incremental server-sent event parser
lib/pcm-player.js        PCM conversion and continuous Web Audio scheduling
lib/key-store.js         Session and optional browser key storage
```

New providers can be added as independent adapters and registered from `index.js`.

## References

- [MiMo speech synthesis documentation](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)
- [SillyTavern extension development](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [SillyTavern TTS implementation](https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/tts/index.js)
