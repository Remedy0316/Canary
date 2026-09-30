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
            const { value, done } = await reader.read();
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
