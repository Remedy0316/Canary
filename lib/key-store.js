// Remembered keys live in ST's per-user extension settings (data/<user>/settings.json),
// under their own `canary` entry. Never in extension_settings.tts[provider]: ST logs
// that object to the console on every save.
export class KeyStore {
    constructor({ settings, save, account, storage }) {
        this.settings = settings;
        this.save = save;
        this.value = '';
        this.remember = false;
        const saved = settings.canary?.mimoKey;
        if (typeof saved === 'string' && saved) {
            this.value = saved;
            this.remember = true;
        }
        this.migrateBrowserKey(account, storage);
    }
    // Earlier versions remembered keys in browser local storage. Move one into
    // the account settings (unless a server key already exists), then remove it.
    migrateBrowserKey(account, storage) {
        try {
            storage ??= globalThis.localStorage;
            const legacyKey = `canary:mimo:key:${encodeURIComponent(account)}`;
            const legacy = storage.getItem(legacyKey);
            if (!legacy) return;
            if (!this.value) this.set(legacy, true);
            storage.removeItem(legacyKey);
        } catch { /* Browser storage unavailable: nothing to migrate. */ }
    }
    set(value, remember) {
        this.value = value.trim();
        this.remember = Boolean(remember && this.value);
        const canary = { ...this.settings.canary };
        if (this.remember) canary.mimoKey = this.value;
        else delete canary.mimoKey;
        this.settings.canary = canary;
        this.save();
    }
    clear() { this.set('', false); }
}
