import { BUILT_IN_VOICES, EMOTIONS, emotionWarning, fetchVoices, groupVoices, HOSTS, LANGUAGES, MODELS, streamSpeech, TEXT_LIMIT, voiceIdOf, voiceObject, YOUR_VOICES } from '../lib/minimax-api.js';
import { splitText } from '../lib/text.js';
import { bufferFieldHtml, keyFieldsHtml, previewFieldsHtml, sectionHtml, STATUS_HTML, StreamingProvider } from './streaming.js';

export const PROVIDER_NAME = 'MiniMax (Canary)';
const VOICE_MAP_MARKERS = ['[Default Voice]', 'disabled'];
const REGION_LABELS = Object.freeze({ global: 'Global', mainland: 'Mainland China' });
const capitalize = text => text[0].toUpperCase() + text.slice(1);
const MAX_CUSTOM_VOICES = 200;
const matches = (text, query) => query.toLowerCase().split(/\s+/).filter(Boolean).every(term => text.toLowerCase().includes(term));

// Hand-added voices: [{ id, nickname }], unique by ID. IDs cannot contain the label separator.
export function parseCustomVoices(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).flatMap(item => {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        if (!id || id.length > 256 || id.includes('·') || seen.has(id)) return [];
        seen.add(id);
        return [{ id, nickname: typeof item.nickname === 'string' ? item.nickname.trim().slice(0, 60) : '' }];
    }).slice(0, MAX_CUSTOM_VOICES);
}

function clamp(value, min, max, fallback) {
    const number = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export class MinimaxProvider extends StreamingProvider {
    constructor(host) {
        super(host, { service: 'MiniMax', voices: BUILT_IN_VOICES, defaultPreviewVoice: 'English_expressive_narrator', nativeSpeed: true });
        // The account (or built-in) list; this.voices adds custom voices on top.
        this.accountVoices = BUILT_IN_VOICES;
        this.voices = this.composeVoices();
        this.voiceLoad = null;
        this.voiceGeneration = 0;
        this.voiceMapObserver = null;
        // Each voice map dropdown's full option list, in SillyTavern's order.
        this.voiceMapOptions = new WeakMap();
    }

    // Custom voices come first under Your voices; a nickname also relabels a listed voice.
    composeVoices() {
        const custom = this.settings.customVoices;
        const ids = new Set(custom.map(item => item.id));
        const listed = new Map(this.accountVoices.map(voice => [voice.voice_id, voice]));
        return [
            ...custom.map(({ id, nickname }) => voiceObject(id, { group: YOUR_VOICES, label: nickname || listed.get(id)?.label })),
            ...this.accountVoices.filter(voice => !ids.has(voice.voice_id)),
        ];
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
        const custom = `<div class="canary-row">
                <div><label for="canary-custom-voice-id">Voice ID</label>
                    <input id="canary-custom-voice-id" class="text_pole" type="text" maxlength="256" autocomplete="off" spellcheck="false" placeholder="e.g. a cloned voice ID" /></div>
                <div><label for="canary-custom-voice-nickname">Nickname (optional)</label>
                    <input id="canary-custom-voice-nickname" class="text_pole" type="text" maxlength="60" autocomplete="off" placeholder="Shown in voice lists" /></div>
            </div>
            <div class="canary-actions"><button id="canary-add-voice" class="menu_button" type="button">Add voice</button></div>
            <p class="canary-help">Add any voice ID from your MiniMax account, such as one cloned on the MiniMax website. Adding a listed voice’s ID gives it a nickname.</p>
            <ul id="canary-custom-voice-list" class="canary-voice-list"></ul>`;
        return `<div class="canary-settings">
            ${sectionHtml('connection', 'Connection', connection, { open: !this.host.keys.value, summary: true })}
            ${sectionHtml('voice', 'Voice', voice, { open: true })}
            ${sectionHtml('custom', 'Custom voices', custom, { summary: true })}
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
            customVoices: parseCustomVoices(settings.customVoices),
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
        const addVoice = () => {
            const id = get('canary-custom-voice-id').value.trim();
            const nickname = get('canary-custom-voice-nickname').value.trim();
            const error = !id ? 'Enter a voice ID to add.'
                : id.includes('·') ? 'Voice IDs cannot contain “·”.'
                : this.settings.customVoices.length >= MAX_CUSTOM_VOICES && !this.settings.customVoices.some(item => item.id === id) ? `Canary keeps up to ${MAX_CUSTOM_VOICES} custom voices.`
                : '';
            if (error) { this.status(error, 'error'); return; }
            const existing = this.settings.customVoices.findIndex(item => item.id === id);
            if (existing === -1) this.settings.customVoices.unshift({ id, nickname });
            else this.settings.customVoices[existing] = { id, nickname };
            this.settings.customVoices = parseCustomVoices(this.settings.customVoices);
            get('canary-custom-voice-id').value = '';
            get('canary-custom-voice-nickname').value = '';
            this.previewVoice = id;
            this.onCustomVoicesChanged();
            this.status(existing === -1 ? 'Voice added.' : 'Voice updated.');
        };
        on('canary-add-voice', 'click', addVoice);
        for (const id of ['canary-custom-voice-id', 'canary-custom-voice-nickname']) {
            on(id, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addVoice(); } });
        }
        on('canary-custom-voice-list', 'click', event => {
            const button = event.target instanceof Element ? event.target.closest('button[data-voice-id]') : null;
            if (!button) return;
            this.settings.customVoices = this.settings.customVoices.filter(item => item.id !== button.dataset.voiceId);
            this.onCustomVoicesChanged();
            this.status('Voice removed.');
        });
        this.voices = this.composeVoices();
        this.renderPreviewVoices();
        this.renderCustomVoices();
        this.installVoiceMapSearch();
        on('canary-reset-tuning', 'click', () => {
            Object.assign(this.settings, { volume: 1, pitch: 0, normalize: false, customModel: '', bufferMs: 120 });
            showTuning();
            showWarning();
            save();
        });
    }

    onCustomVoicesChanged() {
        this.voices = this.composeVoices();
        this.host.saveSettings();
        this.renderPreviewVoices();
        this.renderCustomVoices();
        this.host.refreshVoiceMap();
    }

    renderCustomVoices() {
        const list = document.getElementById('canary-custom-voice-list');
        if (!list || this.disposed) return;
        const listed = new Map(this.accountVoices.map(voice => [voice.voice_id, voice]));
        list.replaceChildren(...this.settings.customVoices.map(({ id, nickname }) => {
            const item = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = this.voices.find(voice => voice.voice_id === id)?.name ?? id;
            if (!listed.has(id)) label.title = 'Not in the loaded voice list; MiniMax will be asked for this ID as entered.';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'menu_button';
            remove.textContent = 'Remove';
            remove.dataset.voiceId = id;
            remove.setAttribute('aria-label', `Remove ${id}`);
            item.append(label, remove);
            return item;
        }));
        const summary = document.getElementById('canary-custom-summary');
        if (summary) summary.textContent = this.settings.customVoices.length ? `${this.settings.customVoices.length} added` : 'None';
    }

    // A filter box above SillyTavern's voice map. ST rebuilds the map's dropdowns on
    // chat changes, so reapply the filter whenever its entries change.
    installVoiceMapSearch() {
        const block = document.getElementById('tts_voicemap_block');
        if (!block || document.getElementById('canary-voicemap-search')) return;
        const row = document.createElement('div');
        row.id = 'canary-voicemap-search-row';
        row.className = 'canary-voicemap-search';
        const input = document.createElement('input');
        input.id = 'canary-voicemap-search';
        input.type = 'search';
        input.className = 'text_pole';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'Search voices in the voice map';
        input.setAttribute('aria-label', 'Search voices in the voice map');
        row.append(input);
        block.before(row);
        input.addEventListener('input', () => this.filterVoiceMap(), { signal: this.listeners.signal });
        this.voiceMapObserver = new MutationObserver(() => this.filterVoiceMap());
        this.voiceMapObserver.observe(block, { childList: true, subtree: true });
    }

    // Non-matching options are detached, not hidden: iOS pickers ignore hidden options.
    // Markers and each dropdown's current choice always stay.
    filterVoiceMap() {
        const query = document.getElementById('canary-voicemap-search')?.value ?? '';
        for (const select of document.querySelectorAll('#tts_voicemap_block select')) {
            if (!this.voiceMapOptions.has(select)) this.voiceMapOptions.set(select, [...select.options]);
            const value = select.value;
            const keep = option => !query.trim() || option.value === value || VOICE_MAP_MARKERS.includes(option.value) || matches(option.textContent, query);
            select.replaceChildren(...this.voiceMapOptions.get(select).filter(keep));
            select.value = value;
        }
        // Our own edits are not SillyTavern rebuilds.
        this.voiceMapObserver?.takeRecords();
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
            this.accountVoices = voices;
            this.voices = this.composeVoices();
            this.renderPreviewVoices();
            this.renderCustomVoices();
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
        const byName = new Map(this.voices.map(voice => [voice.name, voice]));
        const byId = new Map(this.voices.map(voice => [voice.voice_id, voice]));
        const map = this.settings.voiceMap && typeof this.settings.voiceMap === 'object' ? this.settings.voiceMap : {};
        const extra = new Set();
        for (const [character, value] of Object.entries(map)) {
            if (typeof value !== 'string' || !value || VOICE_MAP_MARKERS.includes(value) || byName.has(value)) continue;
            // Relabel entries saved as bare IDs (earlier versions) or under an older
            // label. ST reads this same object while building the map, then saves it.
            const voice = byId.get(voiceIdOf(value));
            if (voice) map[character] = voice.name;
            // Keep unlisted voices selectable, e.g. a clone while the account list failed to load.
            else extra.add(value);
        }
        return [...this.voices, ...[...extra].map(name => ({ name, voice_id: voiceIdOf(name), group: YOUR_VOICES, preview_url: false }))].map(voice => ({ ...voice }));
    }

    // Accepts current labels, older labels and bare IDs; an unlisted ID is sent as entered.
    async getVoice(name) {
        if (typeof name !== 'string' || !name.trim()) throw new Error('Select a MiniMax voice in the voice map.');
        const voice = this.voices.find(item => item.name === name) ?? this.voices.find(item => item.voice_id === voiceIdOf(name));
        return voice ? { ...voice } : { name, voice_id: voiceIdOf(name), preview_url: false };
    }

    async onRefreshClick() {
        await super.onRefreshClick();
        const error = await this.reloadVoices();
        if (error) throw error;
    }

    dispose() {
        document.body?.classList.remove('canary-own-speed');
        this.voiceMapObserver?.disconnect();
        const search = document.getElementById('canary-voicemap-search');
        if (search) { search.value = ''; this.filterVoiceMap(); }
        document.getElementById('canary-voicemap-search-row')?.remove();
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
