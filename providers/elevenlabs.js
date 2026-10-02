import { fetchVoices, groupVoices, MODELS, STABILITY, streamSpeech, TEXT_LIMIT, YOUR_VOICES } from '../lib/elevenlabs-api.js';
import { voiceIdOf } from '../lib/voice-names.js';
import { makeSearchable, removeSearchable, searchVoiceMap } from '../lib/searchable.js';
import { splitText } from '../lib/text.js';
import { bufferFieldHtml, keyFieldsHtml, previewFieldsHtml, sectionHtml, STATUS_HTML, StreamingProvider } from './streaming.js';

export const PROVIDER_NAME = 'ElevenLabs (Canary)';
const VOICE_MAP_MARKERS = ['[Default Voice]', 'disabled'];

export class ElevenLabsProvider extends StreamingProvider {
    constructor(host) {
        // ElevenLabs voices belong to the account, so the list stays empty until a key loads it.
        super(host, { service: 'ElevenLabs', voices: [], defaultPreviewVoice: '' });
        this.voiceLoad = null;
        this.voiceGeneration = 0;
        this.stopVoiceMapSearch = null;
    }

    get settingsHtml() {
        const voice = `<div class="canary-row">
                <div><label for="canary-model">Model</label>
                    <select id="canary-model" class="text_pole">
                        ${MODELS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('')}
                    </select></div>
                <div><label for="canary-stability">Stability</label>
                    <select id="canary-stability" class="text_pole">
                        ${STABILITY.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('')}
                    </select></div>
            </div>
            <p class="canary-help">Creative is the most expressive, Robust the most consistent. Eleven v4 and v3 perform audio tags written in the text, such as [whispers] or [laughs].</p>
            <p class="canary-help">Speed follows SillyTavern’s Audio Playback Speed above.</p>`;
        const tuning = `<label for="canary-custom-model">Custom model ID</label>
            <input id="canary-custom-model" class="text_pole" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Overrides Model, e.g. a newer release" />
            ${bufferFieldHtml()}`;
        return `<div class="canary-settings">
            <p class="canary-help">Canary streams ElevenLabs speech directly to this browser.</p>
            ${sectionHtml('connection', 'Connection', keyFieldsHtml('ElevenLabs'), { open: !this.host.keys.value, summary: true })}
            ${sectionHtml('voice', 'Voice', voice, { open: true })}
            ${sectionHtml('tuning', 'Fine-tuning', tuning)}
            ${sectionHtml('preview', 'Preview', previewFieldsHtml('Voices load from My Voices in your ElevenLabs account once a key is saved. SillyTavern’s Reload button refreshes them.'), { open: true })}
            ${STATUS_HTML}
        </div>`;
    }

    parseSettings(settings) {
        return {
            ...super.parseSettings(settings),
            model: MODELS.some(({ id }) => id === settings.model) ? settings.model : MODELS[0].id,
            customModel: typeof settings.customModel === 'string' ? settings.customModel.trim().slice(0, 64) : '',
            stability: STABILITY.some(({ value }) => value === Number(settings.stability)) ? Number(settings.stability) : 0.5,
        };
    }

    groupVoices(voices) { return groupVoices(voices); }

    bindSettings(get, on) {
        const save = () => this.host.saveSettings();
        get('canary-model').value = this.settings.model;
        get('canary-stability').value = String(this.settings.stability);
        get('canary-custom-model').value = this.settings.customModel;
        on('canary-model', 'change', () => { this.settings.model = get('canary-model').value; save(); });
        on('canary-stability', 'change', () => { this.settings.stability = Number(get('canary-stability').value); save(); });
        on('canary-custom-model', 'input', () => { this.settings.customModel = get('canary-custom-model').value.trim(); save(); });
        makeSearchable(get('canary-preview-voice'), { placeholder: 'Search voices', nativeChange: true });
        this.stopVoiceMapSearch ??= searchVoiceMap();
    }

    onKeyChanged() {
        void this.reloadVoices().then(() => this.host.refreshVoiceMap());
    }

    // ST asks for voices on every chat change: load the account list once per provider instance.
    loadVoices() {
        if (this.voiceLoad) return this.voiceLoad;
        const generation = ++this.voiceGeneration;
        const apply = voices => {
            if (generation !== this.voiceGeneration || this.disposed) return;
            this.voices = voices;
            this.renderPreviewVoices();
        };
        this.voiceLoad = (async () => {
            if (!this.host.keys.value) { apply([]); return null; }
            try {
                apply(await fetchVoices({ key: this.host.keys.value, signal: AbortSignal.timeout(15000) }));
                return null;
            } catch (error) {
                apply([]);
                if (generation === this.voiceGeneration) this.status(`Could not load your ElevenLabs voices: ${error.message}`, 'error');
                return error;
            }
        })();
        return this.voiceLoad;
    }

    reloadVoices() {
        this.voiceLoad = null;
        return this.loadVoices();
    }

    async fetchTtsVoiceObjects() {
        await this.loadVoices();
        const names = new Set(this.voices.map(voice => voice.name));
        const map = this.settings.voiceMap && typeof this.settings.voiceMap === 'object' ? this.settings.voiceMap : {};
        // Keep mapped voices selectable while the account list is unavailable.
        const extra = new Set(Object.values(map).filter(value => typeof value === 'string' && value && !VOICE_MAP_MARKERS.includes(value) && !names.has(value)));
        return [...this.voices, ...[...extra].map(name => ({ name, voice_id: voiceIdOf(name), group: YOUR_VOICES, preview_url: false }))].map(voice => ({ ...voice }));
    }

    // An unlisted voice is sent by the ID in its label.
    async getVoice(name) {
        if (typeof name !== 'string' || !name.trim()) throw new Error('Select an ElevenLabs voice in the voice map.');
        const voice = this.voices.find(item => item.name === name);
        return voice ? { ...voice } : { name, voice_id: voiceIdOf(name), preview_url: false };
    }

    async onRefreshClick() {
        await super.onRefreshClick();
        const error = await this.reloadVoices();
        if (error) throw error;
    }

    dispose() {
        this.stopVoiceMapSearch?.();
        const preview = document.getElementById?.('canary-preview-voice');
        if (preview) removeSearchable(preview);
        super.dispose();
    }

    split(text) { return splitText(text, TEXT_LIMIT); }

    stream({ text, voice, signal, previousText, nextText }) {
        const { customModel, model, stability } = this.settings;
        return streamSpeech({ text, voice, signal, stability, previousText, nextText, model: customModel || model, key: this.host.keys.value });
    }
}
