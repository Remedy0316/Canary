// Deliberately separate from ST settings/accountStorage, which sync to the server.
export class KeyStore {
    constructor(account, storage) {
        this.storageKey = `canary:mimo:key:${encodeURIComponent(account)}`;
        this.value = '';
        this.remember = false;
        try {
            this.storage = storage ?? globalThis.localStorage;
            this.value = this.storage.getItem(this.storageKey) || '';
            this.remember = Boolean(this.value);
        } catch { /* Session-only mode still works if browser storage is unavailable. */ }
    }
    set(value, remember) {
        this.value = value.trim();
        this.remember = false;
        // First remove any older saved key, including when replacing it with a session key.
        this.storage?.removeItem(this.storageKey);
        if (remember && this.value) {
            if (!this.storage) throw new Error('Browser storage is unavailable.');
            this.storage.setItem(this.storageKey, this.value);
            this.remember = true;
        }
    }
    clear() { this.set('', false); }
}
