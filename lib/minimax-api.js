import { readSse } from './sse.js';
import { BUILT_IN_VOICE_IDS } from './minimax-voices.js';

// Keys are issued per region and are not interchangeable.
export const HOSTS = Object.freeze({
    global: 'https://api.minimax.io',
    mainland: 'https://api.minimaxi.com',
});
export const MODELS = Object.freeze(['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo']);
export const EMOTIONS = Object.freeze(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper']);
const MODEL_ID = /^[\w.-]{1,64}$/;
// PcmPlayer schedules 24 kHz mono PCM; MiniMax supports that rate directly.
const SAMPLE_RATE = 24000;
// Client batching policy for splitText; MiniMax accepts under 10,000 characters.
export const TEXT_LIMIT = 3000;

// Voice names are the voice IDs: they are unique, stable across the built-in and
// account lists, and are what ST stores in the voice map.
const voiceObject = (voice_id, lang) => Object.freeze({ name: voice_id, voice_id, lang, preview_url: false });
export const BUILT_IN_VOICES = Object.freeze(
    Object.entries(BUILT_IN_VOICE_IDS).flatMap(([lang, ids]) => ids.map(id => voiceObject(id, lang))),
);

export function isModelId(model) { return MODEL_ID.test(model); }

export function buildRequest({ text, voice, model, emotion = '', speed = 1 }) {
    if (!text.trim()) throw new Error('There is no text to read.');
    if (typeof voice !== 'string' || !voice.trim()) throw new Error('Select a MiniMax voice.');
    if (!isModelId(model)) throw new Error('Enter a valid MiniMax model ID.');
    const voice_setting = { voice_id: voice.trim(), speed: Math.round(Math.min(2, Math.max(0.5, Number(speed) || 1)) * 100) / 100 };
    if (emotion) {
        if (!EMOTIONS.includes(emotion)) throw new Error('Select a valid MiniMax emotion.');
        voice_setting.emotion = emotion;
    }
    return {
        model,
        text,
        stream: true,
        // Otherwise the final event repeats the whole passage as one aggregated clip.
        stream_options: { exclude_aggregated_audio: true },
        language_boost: 'auto',
        output_format: 'hex',
        voice_setting,
        audio_setting: { sample_rate: SAMPLE_RATE, format: 'pcm', channel: 1 },
    };
}

function httpError(status) {
    if (status === 401 || status === 403) return 'MiniMax rejected the API key. Check the key and that the region matches where it was issued.';
    if (status === 429) return 'MiniMax rate limit reached. Wait before trying again.';
    return `MiniMax request failed (HTTP ${status}).`;
}

// MiniMax reports most failures as HTTP 200 with a nonzero base_resp.status_code.
// Do not echo status_msg: it may contain submitted text.
function apiError(code) {
    if (code === 1004 || code === 2049) return httpError(401);
    if ([1002, 1039, 1041, 2045].includes(code)) return httpError(429);
    if (code === 1008) return 'Your MiniMax account balance is insufficient.';
    if (code === 2056) return 'MiniMax usage limit reached. Wait for the next usage window.';
    if (code === 1026 || code === 1027) return 'MiniMax declined this text as sensitive content.';
    if (code === 1042) return 'The text contains too many invisible or unsupported characters.';
    if (code === 20132 || code === 2042) return 'MiniMax could not use this voice. Check the voice ID and region.';
    if (code === 2013) return 'MiniMax rejected the request. Check the model ID and voice.';
    return `MiniMax reported an error (code ${code}).`;
}

function statusCode(body) {
    const code = body?.base_resp?.status_code;
    return typeof code === 'number' ? code : 0;
}

function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('MiniMax returned invalid audio data.');
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

async function post({ path, body, key, region, signal, fetchImpl }) {
    if (!key?.trim()) throw new Error('Enter your MiniMax API key in Canary settings.');
    if (!Object.hasOwn(HOSTS, region)) throw new Error('Select a MiniMax region.');
    try {
        return await fetchImpl(`${HOSTS[region]}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
            body: JSON.stringify(body),
            signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    } catch (error) {
        signal?.throwIfAborted();
        throw new Error('Could not connect to MiniMax. Check your connection and browser access to the API.', { cause: error });
    }
}

async function readJson(response) {
    try { return await response.json(); }
    catch { throw new Error('MiniMax returned a malformed response.'); }
}

export async function* streamSpeech({ text, voice, model, emotion, speed, key, region, signal, fetchImpl = fetch }) {
    const request = buildRequest({ text, voice, model, emotion, speed });
    const response = await post({ path: '/v1/t2a_v2', body: request, key, region, signal, fetchImpl });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(httpError(response.status));
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/event-stream')) {
        const code = type.includes('application/json') ? statusCode(await readJson(response).catch(() => null)) : 0;
        await response.body?.cancel().catch(() => {});
        throw new Error(code ? apiError(code) : 'MiniMax did not return a streaming audio response.');
    }
    let received = false;
    let completed = false;
    for await (const data of readSse(response.body, signal, 'MiniMax')) {
        if (data.trim() === '[DONE]') break;
        let event;
        try { event = JSON.parse(data); }
        catch { throw new Error('MiniMax returned a malformed streaming event.'); }
        const code = statusCode(event);
        if (code) throw new Error(apiError(code));
        // status 2 closes the stream and may still carry the aggregated passage:
        // never play its audio, or the whole passage would repeat.
        if (event.data?.status === 2 || event.extra_info) { completed = true; break; }
        const encoded = event.data?.audio;
        if (encoded == null || encoded === '') continue;
        const bytes = hexToBytes(encoded);
        if (bytes.length) {
            received = true;
            yield bytes;
        }
    }
    signal?.throwIfAborted();
    if (!received) throw new Error('MiniMax returned no audio.');
    if (!completed) throw new Error('MiniMax disconnected before the speech finished.');
}

// Listing voices is free. Cloned and designed voices come first, then system voices.
export async function fetchVoices({ key, region, signal, fetchImpl = fetch }) {
    const response = await post({ path: '/v1/get_voice', body: { voice_type: 'all' }, key, region, signal, fetchImpl });
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(httpError(response.status));
    }
    const body = await readJson(response);
    const code = statusCode(body);
    if (code) throw new Error(apiError(code));
    const ids = [body?.voice_cloning, body?.voice_generation, body?.system_voice]
        .flatMap(list => Array.isArray(list) ? list : [])
        .map(item => typeof item?.voice_id === 'string' ? item.voice_id.trim() : '')
        .filter(Boolean);
    const voices = [...new Set(ids)].map(id => voiceObject(id));
    if (!voices.length) throw new Error('MiniMax returned no voices.');
    return voices;
}
