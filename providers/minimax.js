import { BUILT_IN_VOICES, EMOTIONS, emotionWarning, fetchVoices, groupVoices, HOSTS, LANGUAGES, MODELS, streamSpeech, TEXT_LIMIT, YOUR_VOICES } from '../lib/minimax-api.js';
import { splitText } from '../lib/text.js';
import { bufferFieldHtml, keyFieldsHtml, previewFieldsHtml, sectionHtml, STATUS_HTML, StreamingProvider } from './streaming.js';

export const PROVIDER_NAME = 'MiniMax (Canary)';
const VOICE_MAP_MARKERS = ['[Default Voice]', 'disabled'];
const REGION_LABELS = Object.freeze({ global: 'Global', mainland: 'Mainland China' });
const capitalize = text => text[0].toUpperCase() + text.slice(1);
function clamp(value, min, max, fallback) {
    const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export class MinimaxProvider extends StreamingProvider {
    constructor(host) {
        super(host, { service: 'MiniMax', voices: BUILT_IN_VOICES, defaultPreviewVoice: 'English_expressive_narrator', nativeSpeed: true });
        this.voiceLoad = null;
        this.voiceGeneration = 0;
    }

    get settingsHtml() {
        const connection = `<label for="canary-region">Region</label>
            <select id="canary-region" class="text_pole">
                <option value="global">Global · api.minimax.io</option>
                <option value="mainland">Mainland China · api.minimaxi.com</option>
            </select>
            <p class="canary-help">Keys only work in the region where they were issued.</p>
            ${keyFieldsHtml('MiniMax')}`;
        const voice = `<div class="canary-row">
                <div><label for="canary-model">Model</label>
                    <select id="canary-model" class="text_pole">
                        ${MODELS.map(model => `<option value="${model}">${model}</option>`).join('')}
                    </select></div>
                <div><label for="canary-speed">Speed (0.5–2×)</label>
                    <input id="canary-speed" class="text_pole" type="number" min="0.5" max="2" step="0.05" inputmode="decimal" /></div>
            </div>
            <p class="canary-help">Speed changes the pace without changing pitch. speech-2.8 models perform tags such as (laughs) or (sighs) written in the text.</p>
            <div class="canary-row">
                <div><label for="canary-emotion">Emotion</label>
                    <select id="canary-emotion" class="text_pole">
                        <option value="">Auto · from the text</option>
                        ${EMOTIONS.map(emotion => `<option value="${emotion}">${capitalize(emotion)}</option>`).join('')}
                    </select></div>
                <div><label for="canary-language">Language</label>
                    <select id="canary-language" class="text_pole">
                        <option value="auto">Auto-detect</option>
                        ${LANGUAGES.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('')}
                    </select></div>
            </div>
            <p id="canary-emotion-warning" class="canary-help canary-warning" hidden></p>
            <p class="canary-help">Emotion and language apply to every voice. Set a language if auto-detect misreads short or mixed lines.</p>`;
        const tuning = `<div class="canary-row">
                <div><label for="canary-volume">Volume <span id="canary-volume-value" class="canary-value"></span></label>
                    <input id="canary-volume" type="range" min="0.1" max="10" step="0.1" /></div>
                <div><label for="canary-pitch">Pitch <span id="canary-pitch-value" class="canary-value"></span></label>
                    <input id="canary-pitch" type="range" min="-12" max="12" step="1" /></div>
            </div>
            <label class="canary-remember"><input id="canary-normalize" type="checkbox" /> Read numbers and dates naturally</label>
            <p class="canary-help">Text normalization for Chinese and English, at a slightly slower start.</p>
            <label for="canary-custom-model">Custom model ID</label>
            <input id="canary-custom-model" class="text_pole" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Overrides Model, e.g. a newer release" />
            ${bufferFieldHtml()}
            <div class="canary-actions"><button id="canary-reset-tuning" class="menu_button" type="button">Reset fine-tuning</button></div>`;
        return `<div class="canary-settings">
            ${sectionHtml('connection', 'Connection', connection, { open: !this.host.keys.value, summary: true })}
            ${sectionHtml('voice', 'Voice', voice, { open: true })}
            ${sectionHtml('tuning', 'Fine-tuning', tuning)}
            ${sectionHtml('preview', 'Preview', previewFieldsHtml('Voices load from your MiniMax account once a key is saved, cloned voices first. SillyTavern’s Reload button refreshes them.'), { open: true })}
            ${STATUS_HTML}
        </div>`;
    }

    parseSettings(settings) {
        return {
            ...super.parseSettings(settings),
            region: Object.hasOwn(HOSTS, settings.region) ? settings.region : 'global',
            model: MODELS.includes(settings.model) ? settings.model : MODELS[0],
            customModel: typeof settings.customModel === 'string' ? settings.customModel.trim().slice(0, 64) : '',
            emotion: EMOTIONS.includes(settings.emotion) ? settings.emotion : '',
            language: LANGUAGES.some(item => item.value === settings.language) ? settings.language : 'auto',
            speed: Math.round(clamp(settings.speed, 0.5, 2, 1) * 100) / 100,
            volume: Math.round(clamp(settings.volume, 0.1, 10, 1) * 10) / 10,
            pitch: Math.round(clamp(settings.pitch, -12, 12, 0)),
            normalize: settings.normalize === true,
        };
    }

    summaryParts() { return [REGION_LABELS[this.settings.region]]; }
    // MiniMax has its own speed setting; SillyTavern's slider is hidden while it is active.
    playbackSpeed() { return this.settings.speed; }
    groupVoices(voices) { return groupVoices(voices); }

    bindSettings(get, on) {
        const save = () => this.host.saveSettings();
        const showTuning = () => {
            get('canary-volume').value = String(this.settings.volume);
            get('canary-volume-value').textContent = this.settings.volume.toFixed(1);
            get('canary-pitch').value = String(this.settings.pitch);
            get('canary-pitch-value').textContent = this.settings.pitch > 0 ? `+${this.settings.pitch}` : String(this.settings.pitch);
            get('canary-normalize').checked = this.settings.normalize;
            get('canary-custom-model').value = this.settings.customModel;
            get('canary-buffer').value = String(this.settings.bufferMs);
        };
        const showWarning = () => {
            const warning = emotionWarning(this.settings.emotion, this.settings.customModel || this.settings.model);
            get('canary-emotion-warning').textContent = warning;
            get('canary-emotion-warning').hidden = !warning;
        };
        get('canary-region').value = this.settings.region;
        get('canary-model').value = this.settings.model;
        get('canary-emotion').value = this.settings.emotion;
        get('canary-language').value = this.settings.language;
        get('canary-speed').value = this.settings.speed.toFixed(2);
        // SillyTavern re-shows its slider on provider changes; a stylesheet rule outranks that.
        document.body.classList.add('canary-own-speed');
        showTuning();
        showWarning();
        on('canary-region', 'change', () => {
            this.stopFromUi();
            this.settings.region = get('canary-region').value;
            save();
            this.updateConnectionSummary();
            this.onKeyChanged();
        });
        on('canary-model', 'change', () => { this.settings.model = get('canary-model').value; save(); showWarning(); });
        on('canary-emotion', 'change', () => { this.settings.emotion = get('canary-emotion').value; save(); showWarning(); });
        on('canary-language', 'change', () => { this.settings.language = get('canary-language').value; save(); });
        // Commit on change (Enter or leaving the box); empty or invalid input restores the last value.
        on('canary-speed', 'change', () => {
            this.settings.speed = this.parseSettings({ speed: get('canary-speed').value.trim() || this.settings.speed }).speed;
            get('canary-speed').value = this.settings.speed.toFixed(2);
            save();
        });
        on('canary-custom-model', 'input', () => { this.settings.customModel = get('canary-custom-model').value.trim(); save(); showWarning(); });
        on('canary-volume', 'input', () => { this.settings.volume = Number(get('canary-volume').value); showTuning(); save(); });
        on('canary-pitch', 'input', () => { this.settings.pitch = Number(get('canary-pitch').value); showTuning(); save(); });
        on('canary-normalize', 'change', () => { this.settings.normalize = get('canary-normalize').checked; save(); });
        on('canary-reset-tuning', 'click', () => {
            Object.assign(this.settings, { volume: 1, pitch: 0, normalize: false, customModel: '', bufferMs: 120 });
            showTuning();
            showWarning();
            save();
        });
    }

    // The account's voices depend on both the key and its region.
    onKeyChanged() {
        void this.reloadVoices().then(() => this.host.refreshVoiceMap());
    }

    // ST asks for voices on every chat change: load the account list once per
    // provider instance. Failures fall back to the built-in list.
    loadVoices() {
        if (this.voiceLoad) return this.voiceLoad;
        const generation = ++this.voiceGeneration;
        const apply = voices => {
            if (generation !== this.voiceGeneration || this.disposed) return;
            this.voices = voices;
            this.renderPreviewVoices();
        };
        this.voiceLoad = (async () => {
            if (!this.host.keys.value) { apply(BUILT_IN_VOICES); return null; }
            try {
                apply(await fetchVoices({ key: this.host.keys.value, region: this.settings.region, signal: AbortSignal.timeout(15000) }));
                return null;
            } catch (error) {
                apply(BUILT_IN_VOICES);
                if (generation === this.voiceGeneration) this.status(`Showing built-in voices. Could not load your MiniMax voices: ${error.message}`, 'error');
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
        // Keep mapped voices selectable when the current list lacks them, for
        // example a cloned voice while the account list could not be loaded.
        const known = new Set(this.voices.map(voice => voice.voice_id));
        const mapped = this.settings.voiceMap && typeof this.settings.voiceMap === 'object' ? Object.values(this.settings.voiceMap) : [];
        const extra = [...new Set(mapped)].filter(id => typeof id === 'string' && id && !known.has(id) && !VOICE_MAP_MARKERS.includes(id));
        return [...this.voices, ...extra.map(id => ({ name: id, voice_id: id, group: YOUR_VOICES, preview_url: false }))].map(voice => ({ ...voice }));
    }

    // Voice names are voice IDs, so an unlisted mapping can still be sent to MiniMax.
    async getVoice(name) {
        if (typeof name !== 'string' || !name.trim()) throw new Error('Select a MiniMax voice in the voice map.');
        const voice = this.voices.find(item => item.name === name);
        return voice ? { ...voice } : { name, voice_id: name, preview_url: false };
    }

    async onRefreshClick() {
        await super.onRefreshClick();
        const error = await this.reloadVoices();
        if (error) throw error;
    }

    dispose() {
        document.body?.classList.remove('canary-own-speed');
        super.dispose();
    }

    split(text) { return splitText(text, TEXT_LIMIT); }

    stream({ text, voice, signal, speed }) {
        const { customModel, model, emotion, language, volume, pitch, normalize, region } = this.settings;
        return streamSpeech({
            text, voice, speed, signal, emotion, language, volume, pitch, normalize, region,
            model: customModel || model,
            key: this.host.keys.value,
        });
    }
}
