import { BUILT_IN_VOICES, EMOTIONS, fetchVoices, HOSTS, MODELS, streamSpeech, TEXT_LIMIT } from '../lib/minimax-api.js';
import { splitText } from '../lib/text.js';
import { keyFieldsHtml, playbackFieldsHtml, StreamingProvider } from './streaming.js';

export const PROVIDER_NAME = 'MiniMax (Canary)';
const VOICE_MAP_MARKERS = ['[Default Voice]', 'disabled'];
const capitalize = text => text[0].toUpperCase() + text.slice(1);

export class MinimaxProvider extends StreamingProvider {
    constructor(host) {
        super(host, { service: 'MiniMax', voices: BUILT_IN_VOICES, defaultPreviewVoice: 'English_expressive_narrator', nativeSpeed: true });
        this.voiceLoad = null;
        this.voiceGeneration = 0;
    }

    get settingsHtml() {
        return `<div class="canary-settings">
            <p class="canary-help">Canary streams MiniMax speech directly to this browser.</p>
            <label for="canary-region">Region</label>
            <select id="canary-region" class="text_pole">
                <option value="global">Global · api.minimax.io</option>
                <option value="mainland">Mainland China · api.minimaxi.com</option>
            </select>
            <p class="canary-help">Choose the region where your key was issued. Keys do not work across regions.</p>
            ${keyFieldsHtml('MiniMax')}
            <label for="canary-model">Model</label>
            <select id="canary-model" class="text_pole">
                ${MODELS.map(model => `<option value="${model}">${model}</option>`).join('')}
            </select>
            <label for="canary-custom-model">Custom model ID (optional)</label>
            <input id="canary-custom-model" class="text_pole" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Overrides the model above, e.g. a newer release" />
            <label for="canary-emotion">Emotion</label>
            <select id="canary-emotion" class="text_pole">
                <option value="">Auto · chosen from the text</option>
                ${EMOTIONS.map(emotion => `<option value="${emotion}">${capitalize(emotion)}</option>`).join('')}
            </select>
            <p class="canary-help">Applies to every voice. Fluent and Whisper need a speech-2.6 model; speech-2.8 does not support Whisper. speech-2.8 models also perform tags such as (laughs) or (sighs) written in the text.</p>
            ${playbackFieldsHtml('After you save a key, voices load from your MiniMax account, including cloned voices. Without a key, built-in English, Chinese, Cantonese and Japanese voices are listed. SillyTavern’s Reload button refreshes the list.')}
        </div>`;
    }

    parseSettings(settings) {
        return {
            ...super.parseSettings(settings),
            region: Object.hasOwn(HOSTS, settings.region) ? settings.region : 'global',
            model: MODELS.includes(settings.model) ? settings.model : MODELS[0],
            customModel: typeof settings.customModel === 'string' ? settings.customModel.trim().slice(0, 64) : '',
            emotion: EMOTIONS.includes(settings.emotion) ? settings.emotion : '',
        };
    }

    bindSettings(get, on) {
        get('canary-region').value = this.settings.region;
        get('canary-model').value = this.settings.model;
        get('canary-custom-model').value = this.settings.customModel;
        get('canary-emotion').value = this.settings.emotion;
        on('canary-region', 'change', () => {
            this.stopFromUi();
            this.settings.region = get('canary-region').value;
            this.host.saveSettings();
            this.onKeyChanged();
        });
        on('canary-model', 'change', () => {
            this.settings.model = get('canary-model').value;
            this.host.saveSettings();
        });
        on('canary-custom-model', 'input', () => {
            this.settings.customModel = get('canary-custom-model').value.trim();
            this.host.saveSettings();
        });
        on('canary-emotion', 'change', () => {
            this.settings.emotion = get('canary-emotion').value;
            this.host.saveSettings();
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
        return [...this.voices, ...extra.map(id => ({ name: id, voice_id: id, preview_url: false }))].map(voice => ({ ...voice }));
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

    split(text) { return splitText(text, TEXT_LIMIT); }

    stream({ text, voice, signal, speed }) {
        return streamSpeech({
            text, voice, speed, signal,
            model: this.settings.customModel || this.settings.model,
            emotion: this.settings.emotion,
            key: this.host.keys.value,
            region: this.settings.region,
        });
    }
}
