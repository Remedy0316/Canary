import { MimoProvider, PROVIDER_NAME } from './providers/mimo.js';
import { KeyStore } from './lib/key-store.js';

const context = SillyTavern.getContext();
let initialized = false;

export async function initialize() {
    if (initialized) return;
    initialized = true;
    try {
        const tts = await import('/scripts/extensions/tts/index.js');
        const { getCurrentUserHandle } = await import('/scripts/user.js');
        if (typeof tts.registerTtsProvider !== 'function') throw new Error('Canary requires SillyTavern 1.19.0 or newer with the TTS extension enabled.');
        const keys = new KeyStore({
            settings: context.extensionSettings,
            save: () => context.saveSettingsDebounced(),
            account: getCurrentUserHandle(),
        });
        let activeProvider;
        const Provider = class extends MimoProvider {
            constructor() {
                activeProvider?.dispose();
                super({
                    keys,
                    eventSource: context.eventSource,
                    event_types: context.event_types,
                    saveSettings: () => tts.saveTtsProviderSettings(),
                    getPlaybackRate: () => context.extensionSettings.tts?.playback_rate || 1,
                    notify: message => toastr.error(message, 'Canary'),
                });
                activeProvider = this;
            }
        };
        // Register before native TTS activation (loading order 10), so restoring
        // a saved Canary selection never tries to instantiate an unknown class.
        // The registry eagerly loads a selected provider; defer that UI work
        // until TTS has built its controls. Restore the preference synchronously.
        const settings = context.extensionSettings.tts;
        const selected = settings?.currentProvider;
        const deferUi = !document.getElementById('tts_provider');
        if (deferUi && selected === PROVIDER_NAME) settings.currentProvider = '';
        try { tts.registerTtsProvider(PROVIDER_NAME, Provider); }
        finally { if (deferUi && selected === PROVIDER_NAME) settings.currentProvider = selected; }
        console.info('[Canary] MiMo streaming provider registered.');
    } catch (error) {
        console.error('[Canary] Initialization failed:', error.message);
        toastr.error(error.message, 'Canary');
    }
}

// Called by the manifest's activate hook before the built-in TTS activate hook.
