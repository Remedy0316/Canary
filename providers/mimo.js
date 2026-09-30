import { splitText, streamSpeech, VOICES } from '../lib/mimo-api.js';
import { PcmPlayer } from '../lib/pcm-player.js';

export const PROVIDER_NAME = 'Xiaomi MiMo (Canary)';
const PREVIEW_TEXT = Object.freeze({
    en: 'Hello. This is Canary, ready to bring your next story to life.',
    zh: '你好，我是你的语音助手。很高兴与你一起开始新的故事。',
    bilingual: 'Hello. This is Canary, ready for our next story. 你好，很高兴与你一起开始新的故事。',
});

export class MimoProvider {
    constructor(host) {
        this.host = host;
        this.settings = { voiceMap: {}, instructions: '', bufferMs: 120, previewLanguage: 'bilingual' };
        this.voices = VOICES;
        this.separator = ' ';
        this.run = null;
        this.context = null;
        this.disposed = false;
        this.listeners = new AbortController();
        this.eventHandlers = [];
    }

    get settingsHtml() {
        return `<div class="canary-settings">
            <p class="canary-help">Canary streams MiMo speech directly to this browser.</p>
            <label for="canary-key">MiMo API key</label>
            <input id="canary-key" class="text_pole" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your MiMo API key" />
            <label class="canary-remember"><input id="canary-remember" type="checkbox" /> Remember for this SillyTavern account</label>
            <p class="canary-help">Otherwise the key lasts until this page closes or reloads. Remembered keys are saved unencrypted in this account’s SillyTavern settings on the server and work on any device you sign in from.</p>
            <div class="canary-actions">
                <button id="canary-save-key" class="menu_button" type="button">Save key</button>
                <button id="canary-forget-key" class="menu_button" type="button">Forget key</button>
            </div>
            <label for="canary-instructions">Voice delivery instructions (optional)</label>
            <textarea id="canary-instructions" class="text_pole" rows="3" maxlength="4000" placeholder="For example: Speak gently at a relaxed pace."></textarea>
            <label for="canary-buffer">Streaming buffer</label>
            <select id="canary-buffer" class="text_pole">
                <option value="80">80 ms · Faster start</option>
                <option value="120">120 ms · Balanced</option>
                <option value="250">250 ms · More buffering</option>
            </select>
            <label for="canary-preview-voice">Preview voice</label>
            <select id="canary-preview-voice" class="text_pole"></select>
            <p class="canary-help">Choose any of the eight voices for English, Chinese, or mixed text. Your selected voice stays the same across languages.</p>
            <label for="canary-preview-language">Preview language / 试听语言</label>
            <select id="canary-preview-language" class="text_pole">
                <option value="bilingual">English + 中文</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
            </select>
            <div class="canary-actions">
                <button id="canary-preview" class="menu_button" type="button">Preview</button>
                <button id="canary-unlock" class="menu_button" type="button">Enable audio</button>
                <button id="canary-stop" class="menu_button" type="button">Stop</button>
            </div>
            <p class="canary-help">Assign character voices using SillyTavern’s voice map. Enable audio once if your browser blocks automatic playback.</p>
            <p id="canary-status" class="canary-status" role="status" aria-live="polite"></p>
        </div>`;
    }

    status(message, state = 'idle') {
        if (this.disposed) return;
        const el = document.getElementById('canary-status');
        if (el) { el.textContent = message; el.dataset.state = state; }
    }

    async loadSettings(settings = {}) {
        // Only copy non-secret settings. ST logs the provider settings object on save.
        this.settings = {
            voiceMap: typeof settings.voiceMap === 'string' || (settings.voiceMap && typeof settings.voiceMap === 'object') ? settings.voiceMap : {},
            instructions: typeof settings.instructions === 'string' ? settings.instructions.slice(0, 4000) : '',
            bufferMs: [80, 120, 250].includes(Number(settings.bufferMs)) ? Number(settings.bufferMs) : 120,
            previewLanguage: Object.hasOwn(PREVIEW_TEXT, settings.previewLanguage) ? settings.previewLanguage : 'bilingual',
        };
        const get = id => document.getElementById(id);
        const on = (id, type, fn) => get(id)?.addEventListener(type, fn, { signal: this.listeners.signal });
        get('canary-key').value = this.host.keys.value;
        get('canary-remember').checked = this.host.keys.remember;
        get('canary-instructions').value = this.settings.instructions;
        get('canary-buffer').value = String(this.settings.bufferMs);
        get('canary-preview-language').value = this.settings.previewLanguage;
        for (const voice of VOICES) {
            const option = document.createElement('option');
            option.value = voice.voice_id;
            option.textContent = voice.name;
            get('canary-preview-voice').append(option);
        }
        get('canary-preview-voice').value = 'Mia';
        on('canary-save-key', 'click', () => {
            this.stopFromUi();
            this.host.keys.set(get('canary-key').value, get('canary-remember').checked);
            get('canary-remember').checked = this.host.keys.remember;
            if (!this.host.keys.value) {
                this.status('Enter a MiMo API key.');
                this.host.notify('Enter a MiMo API key before saving.');
                return;
            }
            this.status('Key saved. Ready to stream.');
            this.host.notifySuccess(this.host.keys.remember ? 'Key saved to this SillyTavern account.' : 'Key saved until this page closes or reloads.');
        });
        on('canary-forget-key', 'click', () => {
            this.stopFromUi();
            get('canary-key').value = '';
            get('canary-remember').checked = false;
            this.host.keys.clear();
            this.status('Key removed.');
            this.host.notifySuccess('Key removed.');
        });
        on('canary-instructions', 'input', () => {
            this.settings.instructions = get('canary-instructions').value;
            this.host.saveSettings();
        });
        on('canary-buffer', 'change', () => {
            this.settings.bufferMs = Number(get('canary-buffer').value);
            this.host.saveSettings();
        });
        on('canary-preview-language', 'change', () => {
            this.settings.previewLanguage = get('canary-preview-language').value;
            this.host.saveSettings();
        });
        on('canary-preview', 'click', () => { void this.previewTtsVoice(get('canary-preview-voice').value); });
        on('canary-unlock', 'click', () => {
            void this.unlockAudio().then(() => this.status('Audio enabled. Ready to stream.')).catch(error => this.status(error.message, 'error'));
        });
        on('canary-stop', 'click', () => this.stopFromUi());
        this.installCancellation();
        this.status(this.host.keys.value ? 'Ready to stream.' : 'Enter and save your MiMo API key.');
    }

    installCancellation() {
        const options = { capture: true, signal: this.listeners.signal };
        document.addEventListener('click', event => {
            if (!(event.target instanceof Element)) return;
            const target = event.target.closest('#tts_media_control, .mes_narrate, #ttsExtensionNarrateAll, #tts_enabled');
            if (!target) return;
            // Resume synchronously within the user gesture before the API request starts.
            void this.unlockAudio().catch(() => {});
            if (target.id === 'tts_enabled' && !target.checked) {
                this.stopFromUi();
                return;
            }
            if (target.id === 'tts_media_control' && this.run?.preview) {
                this.cancel();
                event.stopImmediatePropagation();
                event.preventDefault();
                return;
            }
            if (target.id !== 'tts_enabled' || !target.checked) this.cancel();
        }, options);
        document.addEventListener('change', event => {
            if (event.target?.id === 'tts_provider' || (event.target?.id === 'tts_enabled' && !event.target.checked)) this.stopFromUi();
        }, options);
        window.addEventListener('pagehide', () => this.cancel(), { signal: this.listeners.signal });
        const { eventSource, event_types } = this.host;
        for (const name of ['CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'GROUP_UPDATED']) {
            if (!event_types[name]) continue;
            const handler = () => this.cancel();
            eventSource.on(event_types[name], handler);
            this.eventHandlers.push([event_types[name], handler]);
        }
        // ST has no provider AbortSignal. Its native reset clears #tts_audio.src,
        // including resets triggered by /speak. Observe that narrow boundary.
        const observeAudio = () => {
            const audio = document.getElementById('tts_audio');
            if (!audio || this.disposed || this.audioObserver) return;
            this.audioObserver = new MutationObserver(() => { if (this.run && !this.run.preview) this.cancel(); });
            this.audioObserver.observe(audio, { attributes: true, attributeFilter: ['src'] });
        };
        observeAudio();
        eventSource.on(event_types.APP_READY, observeAudio);
        this.eventHandlers.push([event_types.APP_READY, observeAudio]);
    }

    async unlockAudio() {
        if (this.disposed) throw new Error('Canary provider is no longer active.');
        if (!this.context || this.context.state === 'closed') {
            const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
            if (!Context) throw new Error('This browser does not support streaming audio.');
            this.context = new Context({ latencyHint: 'interactive' });
        }
        if (this.context.state !== 'running') {
            // A suspended context can leave resume() pending until a gesture.
            // Do not hold the TTS queue or send an API request in that state.
            const resume = this.context.resume();
            let timer;
            try {
                await Promise.race([resume, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Click Enable audio in Canary settings, then try again.')), 1500);
                })]);
            } finally { clearTimeout(timer); }
        }
        if (this.context.state !== 'running') throw new Error('Click Enable audio in Canary settings, then try again.');
        return this.context;
    }

    cancel() {
        const run = this.run;
        if (!run) return;
        run.controller.abort(new DOMException('Playback stopped', 'AbortError'));
        run.player?.stop();
        this.status('Stopped.');
    }

    stopFromUi() {
        const narration = this.run && !this.run.preview;
        this.cancel();
        if (narration) document.getElementById('tts_media_control')?.click();
    }

    async speak(text, voice, preview = false) {
        if (this.disposed) throw new Error('Canary provider is no longer active.');
        // Serialize runs so old cancellation cannot interrupt a newer player.
        if (this.run) throw new Error('Canary is still finishing playback. Stop it and try again.');
        if (!this.host.keys.value) throw new Error('Enter and save your MiMo API key in Canary settings.');
        const run = { controller: new AbortController(), player: null, preview };
        this.audioObserver?.takeRecords();
        this.run = run;
        const { signal } = run.controller;
        let idleTimer;
        const heartbeat = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => run.controller.abort(new Error('MiMo stopped sending audio for 45 seconds. Try again.')), 45000);
        };
        const totalTimer = setTimeout(() => run.controller.abort(new Error('Canary reached the ten-minute playback limit. Read a shorter passage.')), 600000);
        const stopPlayer = () => run.player?.stop();
        signal.addEventListener('abort', stopPlayer, { once: true });
        try {
            const context = await this.unlockAudio();
            signal.throwIfAborted();
            run.player = new PcmPlayer(context, {
                bufferMs: this.settings.bufferMs,
                rate: this.host.getPlaybackRate(),
                onStart: () => this.status('Playing streamed audio…', 'playing'),
            });
            this.status('Waiting for MiMo’s first audio…', 'waiting');
            for (const part of splitText(text)) {
                heartbeat();
                for await (const bytes of streamSpeech({
                    text: part, voice, instructions: this.settings.instructions,
                    key: this.host.keys.value, signal,
                })) {
                    heartbeat();
                    await run.player.push(bytes, signal);
                }
                run.player.decoder.finish();
            }
            clearTimeout(idleTimer);
            await run.player.finish(signal);
            this.status('Finished. Ready to stream.');
        } catch (error) {
            if (signal.aborted && signal.reason?.name === 'AbortError') return;
            const failure = signal.aborted ? signal.reason : error;
            this.status(failure.message || 'Speech generation failed.', 'error');
            throw failure;
        } finally {
            clearTimeout(idleTimer);
            clearTimeout(totalTimer);
            signal.removeEventListener('abort', stopPlayer);
            run.player?.stop();
            if (this.run === run) this.run = null;
        }
    }

    // ST supports async-iterable providers. Keep its job busy through playback,
    // yielding no blobs: PCM is already played on the continuous Web Audio clock.
    // Consequently blob-based RVC / VRM lip sync / TTS_AUDIO_READY are not supported.
    async *generateTts(text, voiceId) {
        await this.speak(text, voiceId);
    }
    async fetchTtsVoiceObjects() { return VOICES.map(voice => ({ ...voice })); }
    async getVoice(name) {
        const voice = VOICES.find(item => item.name === name);
        if (!voice) throw new Error('The selected MiMo voice is unavailable. Reassign it in the voice map.');
        return { ...voice };
    }
    async checkReady() { /* Voices are local; no paid probe during initialization. */ }
    async onRefreshClick() { this.stopFromUi(); }
    async previewTtsVoice(voiceId) {
        if (this.run) { this.status('Stop the current playback before previewing a voice.'); return; }
        const voice = VOICES.find(item => item.voice_id === voiceId);
        if (!voice) return;
        const text = PREVIEW_TEXT[this.settings.previewLanguage] || PREVIEW_TEXT.bilingual;
        try { await this.speak(text, voiceId, true); }
        catch (error) { this.host.notify(error.message || 'Voice preview failed.'); }
    }
    dispose() {
        this.stopFromUi();
        this.disposed = true;
        this.listeners.abort();
        this.audioObserver?.disconnect();
        for (const [name, handler] of this.eventHandlers) this.host.eventSource.removeListener(name, handler);
        this.eventHandlers.length = 0;
        if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    }
}
