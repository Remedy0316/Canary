import { readSse } from './sse.js';

export const MIMO_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
// Voices are selected independently of the spoken text's language. Keep IDs and
// names stable for existing character mappings; omit the optional single-language tag.
export const VOICES = Object.freeze(
    ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean']
        .map(name => Object.freeze({ name, voice_id: name, preview_url: false })),
);

export function buildRequest(text, voice, instructions = '') {
    if (!text.trim()) throw new Error('There is no text to read.');
    if (!VOICES.some(v => v.voice_id === voice)) throw new Error('Select a valid MiMo voice.');
    const messages = [];
    if (instructions.trim()) messages.push({ role: 'user', content: instructions.trim() });
    messages.push({ role: 'assistant', content: text });
    return { model: 'mimo-v2.5-tts', messages, audio: { format: 'pcm16', voice }, stream: true };
}

// This is a client batching policy, not a claimed provider input limit.
export function splitText(text, limit = 1200) {
    const chars = Array.from(text.trim());
    const pieces = [];
    while (chars.length > limit) {
        const candidate = chars.slice(0, limit).join('');
        const boundaries = [...candidate.matchAll(/[.!?。！？\n](?:\s|$)|[。！？\n]/gu)];
        const clauses = [...candidate.matchAll(/[,;:，；：]\s*/gu)];
        const words = [...candidate.matchAll(/\s+/gu)];
        const boundary = [boundaries, clauses, words]
            .map(list => list.at(-1)).find(match => match && match.index > candidate.length / 3);
        const cut = boundary ? Array.from(candidate.slice(0, boundary.index + boundary[0].length)).length : limit;
        pieces.push(chars.splice(0, cut).join('').trim());
    }
    if (chars.length) pieces.push(chars.join('').trim());
    return pieces.filter(Boolean);
}

function httpError(status) {
    if (status === 401 || status === 403) return 'MiMo rejected the API key or account access. Check your key and model access.';
    if (status === 429) return 'MiMo rate limit or quota reached. Wait before trying again.';
    return `MiMo request failed (HTTP ${status}).`;
}

export async function* streamSpeech({ text, voice, instructions, key, signal, fetchImpl = fetch }) {
    if (!key?.trim()) throw new Error('Enter your MiMo API key in Canary settings.');
    let response;
    try {
        response = await fetchImpl(MIMO_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
            body: JSON.stringify(buildRequest(text, voice, instructions)),
            signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error('Could not connect to MiMo. Check your connection and browser access to the API.', { cause: error });
    }
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(httpError(response.status));
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel().catch(() => {});
        throw new Error('MiMo did not return a streaming audio response.');
    }
    let received = false;
    let completed = false;
    for await (const data of readSse(response.body, signal)) {
        if (data.trim() === '[DONE]') { completed = true; break; }
        let event;
        try { event = JSON.parse(data); }
        catch { throw new Error('MiMo returned a malformed streaming event.'); }
        // Do not echo upstream messages: they may contain submitted text or credentials.
        if (event.error) throw new Error('MiMo reported an error while generating speech.');
        const choice = event.choices?.[0];
        if (choice?.finish_reason === 'stop') completed = true;
        else if (choice?.finish_reason) throw new Error('MiMo ended the speech early. Try a shorter passage.');
        const encoded = choice?.delta?.audio?.data;
        if (encoded == null || encoded === '') continue;
        if (typeof encoded !== 'string') throw new Error('MiMo returned invalid audio data.');
        let binary;
        try { binary = atob(encoded); }
        catch { throw new Error('MiMo returned invalid base64 audio.'); }
        if (binary.length) {
            received = true;
            yield Uint8Array.from(binary, c => c.charCodeAt(0));
        }
    }
    signal?.throwIfAborted();
    if (!received) throw new Error('MiMo returned no audio.');
    if (!completed) throw new Error('MiMo disconnected before the speech finished.');
}
