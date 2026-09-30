import { streamSpeech, TEXT_LIMIT, VOICES } from '../lib/mimo-api.js';
import { splitText } from '../lib/text.js';
import { keyFieldsHtml, playbackFieldsHtml, StreamingProvider } from './streaming.js';

export const PROVIDER_NAME = 'Xiaomi MiMo (Canary)';

export class MimoProvider extends StreamingProvider {
    constructor(host) {
        super(host, { service: 'MiMo', voices: VOICES, defaultPreviewVoice: 'Mia' });
    }

    get settingsHtml() {
        return `<div class="canary-settings">
            <p class="canary-help">Canary streams MiMo speech directly to this browser.</p>
            ${keyFieldsHtml('MiMo')}
            <label for="canary-instructions">Voice delivery instructions (optional)</label>
            <textarea id="canary-instructions" class="text_pole" rows="3" maxlength="4000" placeholder="For example: Speak gently at a relaxed pace."></textarea>
            ${playbackFieldsHtml('Choose any of the eight voices for English, Chinese, or mixed text. Your selected voice stays the same across languages.')}
        </div>`;
    }

    parseSettings(settings) {
        return {
            ...super.parseSettings(settings),
            instructions: typeof settings.instructions === 'string' ? settings.instructions.slice(0, 4000) : '',
        };
    }

    bindSettings(get, on) {
        get('canary-instructions').value = this.settings.instructions;
        on('canary-instructions', 'input', () => {
            this.settings.instructions = get('canary-instructions').value;
            this.host.saveSettings();
        });
    }

    split(text) { return splitText(text, TEXT_LIMIT); }

    stream({ text, voice, signal }) {
        return streamSpeech({ text, voice, instructions: this.settings.instructions, key: this.host.keys.value, signal });
    }
}
