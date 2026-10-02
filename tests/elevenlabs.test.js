import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, fetchVoices, streamSpeech } from '../lib/elevenlabs-api.js';
import { ElevenLabsProvider } from '../providers/elevenlabs.js';

const pcm = chunks => new Response(new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(new Uint8Array(chunk))); c.close(); } }), { headers: { 'content-type': 'audio/pcm' } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const speech = (fetchImpl, options = {}) => streamSpeech({ text: 'Hello', voice: 'voice1', model: 'eleven_v4', key: 'test', fetchImpl, ...options });
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

test('ElevenLabs request streams 24 kHz PCM from the speech endpoint for every model', async () => {
    let request;
    const result = await collect(speech(async (url, options) => { request = { url, ...options, body: JSON.parse(options.body) }; return pcm([[1, 2], [3, 4]]); }));
    assert.deepEqual(result.map(bytes => [...bytes]), [[1, 2], [3, 4]]);
    assert.equal(request.url, 'https://api.elevenlabs.io/v1/text-to-speech/voice1/stream?output_format=pcm_24000');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['xi-api-key'], 'test');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.referrerPolicy, 'no-referrer');
    assert.deepEqual(request.body, { model_id: 'eleven_v4', text: 'Hello', voice_settings: { stability: 0.5 } });
});

test('ElevenLabs stability is clamped, context is trimmed and invalid options fail', () => {
    const { path, body } = buildRequest({ text: 'Hi', voice: ' a/b ', model: 'eleven_v3', stability: 7, previousText: 'x'.repeat(500), nextText: 'y'.repeat(500) });
    assert.equal(path, '/v1/text-to-speech/a%2Fb/stream');
    assert.equal(body.voice_settings.stability, 1);
    assert.equal(body.previous_text, 'x'.repeat(300));
    assert.equal(body.next_text, 'y'.repeat(300));
    assert.ok(!('previous_text' in buildRequest({ text: 'Hi', voice: 'v', model: 'eleven_v4' }).body));
    assert.throws(() => buildRequest({ text: 'Hi', voice: 'v', model: 'eleven v4' }), /model ID/);
    assert.throws(() => buildRequest({ text: 'Hi', voice: ' ', model: 'eleven_v4' }), /voice/);
    assert.throws(() => buildRequest({ text: '  ', voice: 'v', model: 'eleven_v4' }), /no text/);
});

test('ElevenLabs audio reaches the consumer before the stream completes', async () => {
    let controller;
    const iterator = speech(async () => new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'content-type': 'audio/pcm' } }));
    const pending = iterator.next();
    controller.enqueue(new Uint8Array([0, 0, 255, 127]));
    assert.deepEqual([...(await pending).value], [0, 0, 255, 127]);
    await iterator.return();
});

test('ElevenLabs errors are mapped without echoing upstream text', async () => {
    for (const [response, message] of [
        [json({ detail: { type: 'authentication_error', code: 'unauthorized', message: 'Invalid API key', status: 'invalid_api_key' } }, 401), /rejected the API key/],
        [json({ detail: { code: 'voice_not_found', status: 'voice_not_found', message: 'private' } }, 404), /could not find this voice/],
        [json({ detail: { status: 'model_not_found', message: 'private' } }, 400), /model ID/],
        [json({ detail: { status: 'quota_exceeded', message: 'private' } }, 401), /credits/],
        [json({ detail: { status: 'missing_permissions', message: 'private' } }, 401), /permission/],
        [json({ detail: { status: 'too_many_concurrent_requests' } }, 429), /busy/],
        [json({ detail: [{ msg: 'bad', input: 'private input text' }] }, 422), /rejected the request/],
        [json({ detail: { status: 'Weird Status!', message: 'private' } }, 500), /HTTP 500\)/],
        [new Response('private', { status: 503 }), /HTTP 503/],
    ]) {
        await assert.rejects(collect(speech(async () => response)), error => message.test(error.message) && !error.message.includes('private'));
    }
});

test('ElevenLabs JSON, empty and dropped streams fail clearly', async () => {
    await assert.rejects(collect(speech(async () => json({ ok: true }))), /did not return an audio stream/);
    await assert.rejects(collect(speech(async () => pcm([]))), /no audio/);
    const dropped = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.error(new TypeError('network error')); } }), { headers: { 'content-type': 'audio/pcm' } });
    await assert.rejects(collect(speech(async () => dropped)), /dropped/);
    await assert.rejects(collect(speech(async () => { throw new TypeError('Failed to fetch'); })), /Could not connect/);
    await assert.rejects(collect(speech(async () => pcm([[1]]), { key: ' ' })), /Enter your ElevenLabs API key/);
});

test('ElevenLabs voice list follows pages, removes duplicates and lists your voices first', async () => {
    const urls = [];
    const pages = [
        { voices: [{ voice_id: 'p1', name: 'Rachel', category: 'premade' }, { voice_id: 'c1', name: 'My Clone', category: 'cloned' }], has_more: true, next_page_token: 'next' },
        { voices: [{ voice_id: 'c1', name: 'My Clone', category: 'cloned' }, { voice_id: 'l1', name: 'Library', category: 'professional' }, { name: 'no id' }], has_more: false },
    ];
    const voices = await fetchVoices({ key: 'k', fetchImpl: async url => { urls.push(url); return json(pages[urls.length - 1]); } });
    assert.equal(urls[0], 'https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false');
    assert.ok(urls[1].endsWith('&next_page_token=next'));
    assert.deepEqual(voices.map(voice => [voice.name, voice.group]), [['My Clone · c1', 'Your voices'], ['Library · l1', 'Your voices'], ['Rachel · p1', 'Default voices']]);
    await assert.rejects(fetchVoices({ key: 'k', fetchImpl: async () => json({ voices: [], has_more: false }) }), /no voices/);
    await assert.rejects(fetchVoices({ key: 'k', fetchImpl: async () => json({ detail: { status: 'invalid_api_key' } }, 401) }), /API key/);
});

test('ElevenLabs provider settings, mapped voices and custom model', async () => {
    globalThis.document ??= { getElementById: () => null };
    const provider = new ElevenLabsProvider({ keys: { value: '' } });
    assert.deepEqual([provider.settings.model, provider.settings.stability, provider.settings.customModel], ['eleven_v4', 0.5, '']);
    assert.equal(provider.nativeSpeed, false);
    provider.settings = provider.parseSettings({ voiceMap: { '[Default Voice]': 'disabled', Alice: 'Old Name · c1' }, model: 'eleven_v3', stability: '1', customModel: ' eleven_v5 ' });
    assert.deepEqual([provider.settings.model, provider.settings.stability, provider.settings.customModel], ['eleven_v3', 1, 'eleven_v5']);
    assert.deepEqual(provider.parseSettings({ model: 'x', stability: 0.3 }), { ...provider.parseSettings({}) });
    // Without a key the account list is empty, but mapped voices stay selectable.
    assert.deepEqual((await provider.fetchTtsVoiceObjects()).map(voice => voice.name), ['Old Name · c1']);
    assert.equal((await provider.getVoice('Old Name · c1')).voice_id, 'c1');
    let request;
    provider.host.keys.value = 'k';
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => { request = { url, body: JSON.parse(options.body) }; return pcm([[1, 2]]); };
    try { await collect(provider.stream({ text: 'Hi', voice: 'c1', previousText: 'Before.', nextText: '' })); }
    finally { globalThis.fetch = original; }
    assert.deepEqual(request.body, { model_id: 'eleven_v5', text: 'Hi', voice_settings: { stability: 1 }, previous_text: 'Before.' });
});
