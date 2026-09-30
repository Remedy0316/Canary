// Remembered keys live in ST's per-user extension settings (data/<user>/settings.json),
// under their own `canary` entry, one field per provider. Never in
// extension_settings.tts[provider]: ST logs that object to the console on every save.
export class KeyStore {
    constructor({ settings, save, field, account, storage, legacyPrefix }) {
        this.settings = settings;
        this.save = save;
        this.field = field;
        this.value = '';
        this.remember = false;
        const saved = settings.canary?.[field];
        if (typeof saved === 'string' && saved) {
            this.value = saved;
            this.remember = true;
        }
        if (legacyPrefix) this.migrateBrowserKey(`${legacyPrefix}${encodeURIComponent(account)}`, storage);
    }
    // Earlier versions remembered keys in browser local storage. Move one into
    // the account settings (unless a server key already exists), then remove it.
    migrateBrowserKey(legacyKey, storage) {
        try {
            storage ??= globalThis.localStorage;
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
        if (this.remember) canary[this.field] = this.value;
        else delete canary[this.field];
        this.settings.canary = canary;
        this.save();
    }
    clear() { this.set('', false); }
}
