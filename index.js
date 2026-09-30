import { MimoProvider, PROVIDER_NAME as MIMO_NAME } from './providers/mimo.js';
import { MinimaxProvider, PROVIDER_NAME as MINIMAX_NAME } from './providers/minimax.js';
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
        const account = getCurrentUserHandle();
        const keyStore = options => new KeyStore({ settings: context.extensionSettings, save: () => context.saveSettingsDebounced(), account, ...options });
        const providers = [
            [MIMO_NAME, MimoProvider, keyStore({ field: 'mimoKey', legacyPrefix: 'canary:mimo:key:' })],
            [MINIMAX_NAME, MinimaxProvider, keyStore({ field: 'minimaxKey' })],
        ];
        // At most one Canary provider owns the page's audio and listeners.
        let activeProvider;
        const settings = context.extensionSettings.tts;
        const selected = settings?.currentProvider;
        const deferUi = !document.getElementById('tts_provider');
        for (const [name, Base, keys] of providers) {
            const Provider = class extends Base {
                constructor() {
                    activeProvider?.dispose();
                    super({
                        keys,
                        eventSource: context.eventSource,
                        event_types: context.event_types,
                        saveSettings: () => tts.saveTtsProviderSettings(),
                        refreshVoiceMap: () => tts.initVoiceMap?.().catch(() => {}),
                        getPlaybackRate: () => context.extensionSettings.tts?.playback_rate || 1,
                        notify: message => toastr.error(message, 'Canary'),
                        notifySuccess: message => toastr.success(message, 'Canary'),
                    });
                    activeProvider = this;
                }
            };
            // Register before native TTS activation (loading order 10), so restoring
            // a saved Canary selection never tries to instantiate an unknown class.
            // The registry eagerly loads a selected provider; defer that UI work
            // until TTS has built its controls. Restore the preference synchronously.
            if (deferUi && selected === name) settings.currentProvider = '';
            try { tts.registerTtsProvider(name, Provider); }
            finally { if (deferUi && selected === name) settings.currentProvider = selected; }
        }
        console.info('[Canary] MiMo and MiniMax streaming providers registered.');
    } catch (error) {
        console.error('[Canary] Initialization failed:', error.message);
        toastr.error(error.message, 'Canary');
    }
}

// Called by the manifest's activate hook before the built-in TTS activate hook.
