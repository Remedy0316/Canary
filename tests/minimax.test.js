import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_IN_VOICES, buildRequest, emotionWarning, fetchVoices, groupVoices, streamSpeech } from '../lib/minimax-api.js';
import { KeyStore } from '../lib/key-store.js';
import { MinimaxProvider } from '../providers/minimax.js';

const encode = text => new TextEncoder().encode(text);
const body = chunks => new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(encode(chunk))); c.close(); } });
const sse = chunks => new Response(body(chunks), { headers: { 'content-type': 'text/event-stream' } });
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
const ok = { status_code: 0, status_msg: '' };
const chunk = bytes => `data: ${JSON.stringify({ data: { audio: Buffer.from(bytes).toString('hex'), status: 1 }, base_resp: ok })}\n\n`;
const final = bytes => `data: ${JSON.stringify({ data: { audio: Buffer.from(bytes).toString('hex'), status: 2 }, extra_info: { audio_length: 1 }, base_resp: { status_code: 0, status_msg: 'success' } })}\n\n`;
const speech = (fetchImpl, options = {}) => streamSpeech({ text: 'Hello', voice: 'English_expressive_narrator', model: 'speech-2.8-hd', key: 'test', region: 'global', fetchImpl, ...options });
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

test('MiniMax request streams 24 kHz PCM as hex without aggregated audio', () => {
    const req = buildRequest({ text: 'Hello', voice: 'English_expressive_narrator', model: 'speech-2.8-hd' });
    assert.equal(req.stream, true);
    assert.equal(req.output_format, 'hex');
    assert.deepEqual(req.stream_options, { exclude_aggregated_audio: true });
    assert.deepEqual(req.audio_setting, { sample_rate: 24000, format: 'pcm', channel: 1 });
    assert.deepEqual(req.voice_setting, { voice_id: 'English_expressive_narrator', speed: 1 });
    assert.equal(req.language_boost, 'auto');
});

test('MiniMax emotion is optional, speed is clamped, and invalid options fail', () => {
    const req = buildRequest({ text: 'Hi', voice: 'v', model: 'speech-2.6-hd', emotion: 'whisper', speed: 3 });
    assert.equal(req.voice_setting.emotion, 'whisper');
    assert.equal(req.voice_setting.speed, 2);
    assert.equal(buildRequest({ text: 'Hi', voice: 'v', model: 'speech-9-future', speed: 0.1234 }).voice_setting.speed, 0.5);
    assert.throws(() => buildRequest({ text: 'Hi', voice: 'v', model: 'speech 2.8' }), /model ID/);
    assert.throws(() => buildRequest({ text: 'Hi', voice: 'v', model: 'speech-2.8-hd', emotion: 'ecstatic' }), /emotion/);
    assert.throws(() => buildRequest({ text: 'Hi', voice: ' ', model: 'speech-2.8-hd' }), /voice/);
});

test('MiniMax audio reaches the consumer before completion; region selects the host', async () => {
    let controller;
    let request;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    const iterator = speech(async (url, options) => {
        request = { url, ...options };
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }, { region: 'mainland' });
    controller.enqueue(encode(chunk([0, 0, 255, 127])));
    const first = await iterator.next();
    assert.deepEqual([...first.value], [0, 0, 255, 127]);
    assert.equal(request.url, 'https://api.minimaxi.com/v1/t2a_v2');
    assert.equal(request.headers.Authorization, 'Bearer test');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.referrerPolicy, 'no-referrer');
    await iterator.return();
});

test('MiniMax final aggregated audio is never played twice', async () => {
    const result = await collect(speech(async () => sse([chunk([1, 2]), chunk([3, 4]), final([1, 2, 3, 4])])));
    assert.deepEqual(result.map(bytes => [...bytes]), [[1, 2], [3, 4]]);
});

test('MiniMax errors reported inside HTTP 200 responses are mapped without echoing upstream text', async () => {
    const secret = { base_resp: { status_code: 1004, status_msg: 'private input text' } };
    await assert.rejects(collect(speech(async () => json(secret))), error => /API key/.test(error.message) && !error.message.includes('private'));
    await assert.rejects(collect(speech(async () => sse([chunk([1, 2]), `data: ${JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'private' } })}\n\n`]))), /balance/);
    await assert.rejects(collect(speech(async () => new Response('private', { status: 401 }))), /API key/);
});

test('MiniMax truncated, empty, malformed and invalid-audio streams fail clearly', async () => {
    for (const [chunks, message] of [
        [[chunk([0, 0])], /disconnected/],
        [[final([])], /no audio/],
        [['data: {oops}\n\n'], /malformed/],
        [[`data: ${JSON.stringify({ data: { audio: 'zz', status: 1 }, base_resp: ok })}\n\n`], /invalid audio/],
    ]) {
        await assert.rejects(collect(speech(async () => sse(chunks))), message);
    }
    await assert.rejects(collect(speech(async () => sse([]), { key: ' ' })), /Enter your MiniMax API key/);
});

test('MiniMax voice list puts cloned voices first and removes duplicates', async () => {
    let request;
    const voices = await fetchVoices({ key: 'k', region: 'global', fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return json({
            system_voice: [{ voice_id: 'English_expressive_narrator', voice_name: 'Expressive Narrator' }, { voice_id: 'my-clone' }],
            voice_cloning: [{ voice_id: 'my-clone', description: [] }],
            voice_generation: null,
            base_resp: ok,
        });
    } });
    assert.equal(request.url, 'https://api.minimax.io/v1/get_voice');
    assert.deepEqual(request.body, { voice_type: 'all' });
    assert.deepEqual(voices.map(voice => voice.name), ['my-clone', 'English_expressive_narrator']);
    await assert.rejects(fetchVoices({ key: 'k', region: 'global', fetchImpl: async () => json({ base_resp: { status_code: 2049, status_msg: 'x' } }) }), /API key/);
});

test('built-in voices use stable, unique voice IDs as names', () => {
    const ids = BUILT_IN_VOICES.map(voice => voice.voice_id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(BUILT_IN_VOICES.every(voice => voice.name === voice.voice_id));
    assert.ok(ids.includes('English_expressive_narrator') && ids.includes('Chinese (Mandarin)_News_Anchor'));
});

test('MiMo and MiniMax keys are remembered independently', () => {
    const settings = {};
    const save = () => {};
    const mimo = new KeyStore({ settings, save, field: 'mimoKey' });
    const minimax = new KeyStore({ settings, save, field: 'minimaxKey' });
    mimo.set('mimo-secret', true);
    minimax.set('minimax-secret', true);
    assert.deepEqual(settings.canary, { mimoKey: 'mimo-secret', minimaxKey: 'minimax-secret' });
    minimax.clear();
    assert.deepEqual(settings.canary, { mimoKey: 'mimo-secret' });
    assert.equal(new KeyStore({ settings, save, field: 'minimaxKey' }).value, '');
});

test('MiniMax provider keeps mapped voices, passes speed natively and uses the custom model', async () => {
    globalThis.document ??= { getElementById: () => null };
    const provider = new MinimaxProvider({ keys: { value: '' } });
    provider.settings = provider.parseSettings({
        voiceMap: { '[Default Voice]': 'disabled', Alice: 'my-clone', Bob: 'English_CalmWoman' },
        model: 'speech-2.6-turbo', customModel: ' speech-3-hd ', emotion: 'calm', region: 'mainland',
    });
    const names = (await provider.fetchTtsVoiceObjects()).map(voice => voice.name);
    assert.equal(names.at(-1), 'my-clone');
    assert.ok(!names.includes('disabled') && !names.includes('[Default Voice]'));
    assert.deepEqual(await provider.getVoice('my-clone'), { name: 'my-clone', voice_id: 'my-clone', preview_url: false });
    assert.equal(provider.nativeSpeed, true);
    assert.equal(provider.settings.customModel, 'speech-3-hd');
    assert.equal(provider.parseSettings({ emotion: 'ecstatic', region: 'mars', model: 'x' }).region, 'global');
    let request;
    provider.host.keys.value = 'k';
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => { request = { url, body: JSON.parse(options.body) }; return sse([chunk([1, 2]), final([1, 2])]); };
    try { await collect(provider.stream({ text: 'Hi', voice: 'my-clone', speed: 1.5 })); }
    finally { globalThis.fetch = original; }
    assert.equal(request.url, 'https://api.minimaxi.com/v1/t2a_v2');
    assert.equal(request.body.model, 'speech-3-hd');
    assert.deepEqual(request.body.voice_setting, { voice_id: 'my-clone', speed: 1.5, emotion: 'calm' });
});

test('MiniMax language, volume, pitch and normalization are sent only when changed', () => {
    const base = { text: 'Hi', voice: 'v', model: 'speech-2.8-hd' };
    assert.deepEqual(buildRequest(base).voice_setting, { voice_id: 'v', speed: 1 });
    const req = buildRequest({ ...base, language: 'Chinese,Yue', volume: 2.54, pitch: -3.6, normalize: true });
    assert.equal(req.language_boost, 'Chinese,Yue');
    assert.deepEqual(req.voice_setting, { voice_id: 'v', speed: 1, vol: 2.5, pitch: -4, text_normalization: true });
    assert.deepEqual(buildRequest({ ...base, volume: 50, pitch: 40 }).voice_setting, { voice_id: 'v', speed: 1, vol: 10, pitch: 12 });
    assert.throws(() => buildRequest({ ...base, language: 'Klingon' }), /language/);
});

test('MiniMax voices are grouped: your voices first, then languages, unknown last', async () => {
    const voices = await fetchVoices({ key: 'k', region: 'global', fetchImpl: async () => json({
        system_voice: ['Mystery_Voice', 'czech_calm_woman', 'Arrogant_Miss', 'Japanese_KindLady', 'English_CalmWoman'].map(voice_id => ({ voice_id })),
        voice_generation: [{ voice_id: 'designed-1' }],
        voice_cloning: [{ voice_id: 'clone-1' }],
        base_resp: ok,
    }) });
    assert.deepEqual(groupVoices(voices).map(group => [group.label, group.voices.map(voice => voice.voice_id)]), [
        ['Your voices', ['clone-1', 'designed-1']],
        ['English', ['English_CalmWoman']],
        ['Chinese (Mandarin)', ['Arrogant_Miss']],
        ['Japanese', ['Japanese_KindLady']],
        ['Czech', ['czech_calm_woman']],
        ['Other voices', ['Mystery_Voice']],
    ]);
});

test('emotion warning follows MiniMax model support and ignores unknown custom models', () => {
    assert.match(emotionWarning('whisper', 'speech-2.8-hd'), /speech-2\.6/);
    assert.match(emotionWarning('fluent', 'speech-02-turbo'), /Fluent/);
    assert.equal(emotionWarning('whisper', 'speech-2.6-turbo'), '');
    assert.equal(emotionWarning('calm', 'speech-2.8-hd'), '');
    assert.equal(emotionWarning('whisper', 'speech-9-future'), '');
});

test('MiniMax provider settings clamp fine-tuning and reject unknown languages', () => {
    const provider = new MinimaxProvider({ keys: { value: '' } });
    const parsed = provider.parseSettings({ volume: '99', pitch: -20.4, normalize: 'yes', language: 'Klingon' });
    assert.deepEqual([parsed.volume, parsed.pitch, parsed.normalize, parsed.language], [10, -12, false, 'auto']);
    assert.deepEqual(provider.parseSettings({ volume: '', pitch: null }).volume, 1);
    assert.equal(provider.summaryParts()[0], 'Global');
});
