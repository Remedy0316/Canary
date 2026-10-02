import { voiceName } from './voice-names.js';

const HOST = 'https://api.elevenlabs.io';
// Text-to-speech models. eleven_v4_turbo is offered only over WebSocket.
export const MODELS = Object.freeze([
    ['eleven_v4', 'Eleven v4'],
    ['eleven_v3', 'Eleven v3'],
    ['eleven_multilingual_v2', 'Multilingual v2'],
    ['eleven_flash_v2_5', 'Flash v2.5'],
].map(([id, label]) => Object.freeze({ id, label })));
// Eleven v3 accepts only these three; the other models take any value in between.
export const STABILITY = Object.freeze([
    [0, 'Creative'],
    [0.5, 'Natural'],
    [1, 'Robust'],
].map(([value, label]) => Object.freeze({ value, label })));
const MODEL_ID = /^[\w.-]{1,64}$/;
// PcmPlayer schedules 24 kHz mono PCM; ElevenLabs streams that as raw 16-bit samples.
const OUTPUT_FORMAT = 'pcm_24000';
// Client batching policy for splitText; Eleven v3 accepts up to 5,000 characters.
export const TEXT_LIMIT = 3000;
// ElevenLabs reads up to this much neighbouring text to keep split passages flowing.
const CONTEXT_LIMIT = 300;

export const YOUR_VOICES = 'Your voices';
const DEFAULT_VOICES = 'Default voices';

export function voiceObject(voice_id, { label, group = YOUR_VOICES } = {}) {
    return Object.freeze({ name: voiceName(voice_id, label), voice_id, label, group, preview_url: false });
}

export function groupVoices(voices) {
    const groups = new Map([[YOUR_VOICES, []], [DEFAULT_VOICES, []]]);
    for (const voice of voices) groups.get(voice.group === DEFAULT_VOICES ? DEFAULT_VOICES : YOUR_VOICES).push(voice);
    return [...groups].filter(([, list]) => list.length).map(([label, list]) => ({ label, voices: list }));
}

export function isModelId(model) { return MODEL_ID.test(model); }

// One streaming endpoint serves every model, Eleven v4 included. Text around a
// split passage is context only: ElevenLabs does not read it aloud.
export function buildRequest({ text, voice, model, stability = 0.5, previousText = '', nextText = '' }) {
    if (!text.trim()) throw new Error('There is no text to read.');
    if (typeof voice !== 'string' || !voice.trim()) throw new Error('Select an ElevenLabs voice.');
    if (!isModelId(model)) throw new Error('Enter a valid ElevenLabs model ID.');
    const value = Number(stability);
    const body = { model_id: model, text, voice_settings: { stability: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5 } };
    if (previousText) body.previous_text = Array.from(previousText).slice(-CONTEXT_LIMIT).join('');
    if (nextText) body.next_text = Array.from(nextText).slice(0, CONTEXT_LIMIT).join('');
    return { path: `/v1/text-to-speech/${encodeURIComponent(voice.trim())}/stream`, body };
}

// ElevenLabs errors look like { detail: { status | code, message } }. Map known
// codes; never echo the message or a 422 body, which can repeat the submitted text.
async function apiError(response) {
    let detail;
    try { detail = (await response.json())?.detail; } catch { /* Not JSON. */ }
    const code = [detail?.status, detail?.code].find(value => typeof value === 'string' && /^[a-z_]{1,64}$/.test(value)) ?? '';
    const { status } = response;
    // Specific codes first: ElevenLabs reports exhausted credits as HTTP 401 too.
    if (code === 'quota_exceeded' || code === 'insufficient_credits') return 'Your ElevenLabs credits or this key’s credit limit are used up.';
    if (code === 'missing_permissions') return 'This ElevenLabs key lacks a needed permission. Allow Text to Speech and Voices (read) for the key.';
    if (status === 401 || code === 'invalid_api_key') return 'ElevenLabs rejected the API key. Check the key.';
    if (status === 429 || code === 'too_many_concurrent_requests' || code === 'system_busy') return 'ElevenLabs is busy or the rate limit was reached. Wait before trying again.';
    if (code === 'voice_not_found' || status === 404) return 'ElevenLabs could not find this voice. Reload voices or reassign it in the voice map.';
    if (code === 'model_not_found' || code === 'invalid_model') return 'ElevenLabs does not offer this model for speech. Check the model ID.';
    if (status === 422) return 'ElevenLabs rejected the request. Check the model ID and voice.';
    return `ElevenLabs request failed (HTTP ${status}${code ? `, ${code}` : ''}).`;
}

async function request({ path, method = 'GET', body, key, signal, fetchImpl }) {
    if (!key?.trim()) throw new Error('Enter your ElevenLabs API key in Canary settings.');
    try {
        return await fetchImpl(`${HOST}${path}`, {
            method,
            headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'xi-api-key': key.trim() },
            body: body ? JSON.stringify(body) : undefined,
            signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error('Could not connect to ElevenLabs. Check your connection and browser access to the API.', { cause: error });
    }
}

export async function* streamSpeech({ key, signal, fetchImpl = fetch, ...options }) {
    const { path, body } = buildRequest(options);
    const response = await request({ path: `${path}?output_format=${OUTPUT_FORMAT}`, method: 'POST', body, key, signal, fetchImpl });
    if (!response.ok) throw new Error(await apiError(response));
    if ((response.headers.get('content-type') || '').includes('application/json')) {
        await response.body?.cancel().catch(() => {});
        throw new Error('ElevenLabs did not return an audio stream.');
    }
    if (!response.body) throw new Error('ElevenLabs returned an empty response body.');
    // Raw PCM has no end marker: a clean end of the body is the end of the speech.
    const reader = response.body.getReader();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    let received = false;
    try {
        while (true) {
            signal?.throwIfAborted();
            let chunk;
            try { chunk = await reader.read(); }
            catch (error) {
                signal?.throwIfAborted();
                throw new Error('The connection to ElevenLabs dropped before the speech finished. Try again.', { cause: error });
            }
            signal?.throwIfAborted();
            if (chunk.done) break;
            if (chunk.value?.length) {
                received = true;
                yield chunk.value;
            }
        }
    } finally {
        signal?.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (!received) throw new Error('ElevenLabs returned no audio.');
}

// Listing voices is free. Cloned, designed and library voices come before the defaults.
export async function fetchVoices({ key, signal, fetchImpl = fetch }) {
    const voices = new Map();
    let token = '';
    // A page holds up to 100 voices; stop at 20 pages rather than loop on a bad token.
    for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
        if (token) query.set('next_page_token', token);
        const response = await request({ path: `/v2/voices?${query}`, key, signal, fetchImpl });
        if (!response.ok) throw new Error(await apiError(response));
        let body;
        try { body = await response.json(); }
        catch { throw new Error('ElevenLabs returned a malformed response.'); }
        for (const item of Array.isArray(body?.voices) ? body.voices : []) {
            const id = typeof item?.voice_id === 'string' ? item.voice_id.trim() : '';
            if (!id || voices.has(id)) continue;
            voices.set(id, voiceObject(id, { label: typeof item.name === 'string' ? item.name : '', group: item.category === 'premade' ? DEFAULT_VOICES : YOUR_VOICES }));
        }
        token = body?.has_more && typeof body.next_page_token === 'string' ? body.next_page_token : '';
        if (!token) break;
    }
    if (!voices.size) throw new Error('ElevenLabs returned no voices. Add voices to My Voices on the ElevenLabs website.');
    return groupVoices([...voices.values()]).flatMap(group => group.voices);
}
