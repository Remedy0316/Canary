// SSE events can span arbitrary network chunks, including inside UTF-8 characters.
export async function* readSse(body, signal, service = 'The speech service') {
    if (!body) throw new Error(`${service} returned an empty response body.`);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    let eventSize = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    function line(value) {
        if (value === '') {
            const event = data.length ? data.join('\n') : null;
            data = [];
            eventSize = 0;
            return event;
        }
        if (value.startsWith('data:')) {
            const part = value.slice(5).replace(/^ /, '');
            eventSize += part.length;
            if (eventSize > 8 * 1024 * 1024) throw new Error(`${service} sent an oversized streaming event.`);
            data.push(part);
        }
        return null;
    }
    try {
        while (true) {
            signal?.throwIfAborted();
            let chunk;
            try { chunk = await reader.read(); }
            catch (error) {
                signal?.throwIfAborted();
                // Browsers report a dropped connection as a bare "TypeError: network error".
                throw new Error(`The connection to ${service} dropped before the speech finished. Try again.`, { cause: error });
            }
            const { value, done } = chunk;
            signal?.throwIfAborted();
            buffer += decoder.decode(value, { stream: !done });
            let end;
            while ((end = buffer.search(/[\r\n]/)) !== -1) {
                if (!done && buffer[end] === '\r' && end === buffer.length - 1) break;
                const width = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
                const event = line(buffer.slice(0, end));
                buffer = buffer.slice(end + width);
                if (event !== null) yield event;
            }
            if (buffer.length > 8 * 1024 * 1024) throw new Error(`${service} sent an oversized streaming line.`);
            if (done) {
                if (buffer) line(buffer);
                const finalEvent = line('');
                if (finalEvent !== null) yield finalEvent;
                break;
            }
        }
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

// Pull a stream as fast as it arrives and buffer it for a slower consumer. A consumer
// that waits on playback would otherwise stop reading, and the server closes a
// connection it cannot write to. Items read before a failure are yielded first.
export async function* prefetch(source) {
    const items = [];
    let done = false;
    let failed = false;
    let failure;
    let wake = () => {};
    void (async () => {
        try { for await (const item of source) { items.push(item); wake(); } }
        catch (error) { failed = true; failure = error; }
        finally { done = true; wake(); }
    })();
    while (true) {
        if (items.length) { yield items.shift(); continue; }
        if (done) break;
        await new Promise(resolve => { wake = resolve; });
    }
    if (failed) throw failure;
}
