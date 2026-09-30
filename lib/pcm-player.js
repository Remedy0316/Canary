export class PcmDecoder {
    tail = null;
    decode(bytes) {
        let input = bytes;
        if (this.tail !== null) {
            input = new Uint8Array(bytes.length + 1);
            input[0] = this.tail;
            input.set(bytes, 1);
        }
        const length = input.length - input.length % 2;
        const samples = new Float32Array(length / 2);
        const view = new DataView(input.buffer, input.byteOffset, length);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        this.tail = input.length % 2 ? input[input.length - 1] : null;
        return samples;
    }
    finish() {
        if (this.tail !== null) throw new Error('MiMo returned an incomplete PCM sample.');
    }
}

export function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

// Use one AudioContext clock; adjacent buffers share exact sample boundaries.
export class PcmPlayer {
    constructor(context, { rate = 1, bufferMs = 120, onStart = () => {} } = {}) {
        this.context = context;
        this.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
        this.bufferSeconds = bufferMs / 1000;
        this.onStart = onStart;
        this.decoder = new PcmDecoder();
        this.sources = new Set();
        this.endTime = 0;
        this.stopped = false;
        this.started = false;
    }
    get queuedSeconds() { return Math.max(0, this.endTime - this.context.currentTime); }
    async push(bytes, signal) {
        signal?.throwIfAborted();
        if (this.stopped) throw new DOMException('Playback stopped', 'AbortError');
        // Bound decoded/scheduled audio rather than scheduling an entire long reply.
        while (this.queuedSeconds > 8) await wait(40, signal);
        const samples = this.decoder.decode(bytes);
        // Subdivide a large provider event, keeping pending sources bounded.
        for (let offset = 0; offset < samples.length; offset += 24000) {
            while (this.queuedSeconds > 8) await wait(40, signal);
            signal?.throwIfAborted();
            if (this.stopped) throw new DOMException('Playback stopped', 'AbortError');
            const part = samples.subarray(offset, offset + 24000);
            const buffer = this.context.createBuffer(1, part.length, 24000);
            buffer.copyToChannel(part, 0);
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = this.rate;
            source.connect(this.context.destination);
            const now = this.context.currentTime;
            const start = this.endTime > now ? this.endTime : now + this.bufferSeconds;
            this.endTime = start + buffer.duration / this.rate;
            this.sources.add(source);
            source.onended = () => { source.disconnect(); this.sources.delete(source); };
            source.start(start);
            if (!this.started) { this.started = true; this.onStart(); }
        }
    }
    async finish(signal) {
        this.decoder.finish();
        while (this.sources.size && !this.stopped) await wait(30, signal);
        signal?.throwIfAborted();
    }
    stop() {
        this.stopped = true;
        for (const source of this.sources) {
            source.onended = null;
            try { source.stop(); } catch { /* Already ended. */ }
            source.disconnect();
        }
        this.sources.clear();
    }
}
