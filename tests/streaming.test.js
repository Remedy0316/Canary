import test from 'node:test';
import assert from 'node:assert/strict';
import { readSse } from '../lib/sse.js';
import { buildRequest, splitText, streamSpeech } from '../lib/mimo-api.js';
import { PcmDecoder, PcmPlayer } from '../lib/pcm-player.js';
import { KeyStore } from '../lib/key-store.js';

const encode = text => new TextEncoder().encode(text);
const body = chunks => new ReadableStream({ start(c) { chunks.forEach(chunk => c.enqueue(typeof chunk === 'string' ? encode(chunk) : chunk)); c.close(); } });
const response = chunks => new Response(body(chunks), { headers: { 'content-type': 'text/event-stream' } });
const event = bytes => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(bytes).toString('base64') } } }] })}\n\n`;
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

test('SSE preserves fragmented UTF-8, CRLF, multiline data and final events', async () => {
    const text = ':keepalive\r\ndata: 冰糖\r\ndata: second\r\n\r\ndata: [DONE]';
    const chunks = [...encode(text)].map(byte => Uint8Array.of(byte));
    assert.deepEqual(await collect(readSse(body(chunks))), ['冰糖\nsecond', '[DONE]']);
});

test('SSE cancels a stalled reader on abort', { timeout: 1000 }, async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const task = collect(readSse(stream, controller.signal));
    controller.abort();
    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(cancelled, true);
});

test('MiMo request uses assistant text, separate instructions and PCM streaming', () => {
    const req = buildRequest('Hello', 'Mia', 'Speak softly');
    assert.deepEqual(req.messages, [{ role: 'user', content: 'Speak softly' }, { role: 'assistant', content: 'Hello' }]);
    assert.deepEqual(req.audio, { voice: 'Mia', format: 'pcm16' });
    assert.equal(req.stream, true);
    assert.throws(() => buildRequest('Hello', 'invented'));
});

test('audio reaches consumer before upstream finishes; request omits cookies', async () => {
    let streamController;
    let cancelled = false;
    let request;
    const stream = new ReadableStream({ start(c) { streamController = c; }, cancel() { cancelled = true; } });
    const iterator = streamSpeech({ text: 'Hello', voice: 'Mia', key: 'test-key', fetchImpl: async (url, options) => {
        request = { url, ...options };
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    } });
    streamController.enqueue(encode(event([0, 0, 255, 127])));
    const first = await iterator.next();
    assert.deepEqual([...first.value], [0, 0, 255, 127]);
    assert.equal(request.credentials, 'omit');
    assert.equal(request.referrerPolicy, 'no-referrer');
    await iterator.return();
    assert.equal(cancelled, true);
});

test('stream parses usage-only events, audio and completion', async () => {
    const chunks = ['data: {"choices":[]}\n\n', event([1, 2]), 'data: [DONE]\n\n'];
    const result = await collect(streamSpeech({ text: 'Hello', voice: 'Mia', key: 'test', fetchImpl: async () => response(chunks) }));
    assert.deepEqual([...result[0]], [1, 2]);
});

test('truncated, empty, malformed and upstream error streams fail clearly', async () => {
    for (const [chunks, message] of [
        [[event([0, 0])], /disconnected/],
        [['data: [DONE]\n\n'], /no audio/],
        [['data: {oops}\n\n'], /malformed/],
        [['data: {"error":{"message":"private input"}}\n\n'], /reported an error/],
    ]) {
        await assert.rejects(collect(streamSpeech({ text: 'Hello', voice: 'Mia', key: 'test', fetchImpl: async () => response(chunks) })), message);
    }
});

test('HTTP errors do not echo upstream secrets or automatically retry', async () => {
    let calls = 0;
    await assert.rejects(collect(streamSpeech({ text: 'Hello', voice: 'Mia', key: 'test', fetchImpl: async () => {
        calls++;
        return new Response('secret and private text', { status: 401 });
    } })), error => /API key/.test(error.message) && !error.message.includes('private'));
    assert.equal(calls, 1);
});

test('PCM keeps signed little-endian samples across odd byte boundaries', () => {
    const decoder = new PcmDecoder();
    assert.deepEqual([...decoder.decode(Uint8Array.of(0))], []);
    assert.deepEqual([...decoder.decode(Uint8Array.of(128, 255, 127, 0, 0))], [-1, 32767 / 32768, 0]);
    decoder.finish();
    decoder.decode(Uint8Array.of(1));
    assert.throws(() => decoder.finish(), /incomplete/);
});

test('large PCM event following an odd byte does not overflow JS argument limits', () => {
    const decoder = new PcmDecoder();
    decoder.decode(Uint8Array.of(0));
    assert.equal(decoder.decode(new Uint8Array(300001)).length, 150001);
    decoder.finish();
});

test('Web Audio schedules contiguous buffers and Stop terminates every source', async () => {
    const starts = [];
    let stops = 0;
    const ctx = {
        currentTime: 10, destination: {},
        createBuffer(channels, length, rate) { return { duration: length / rate, copyToChannel() {} }; },
        createBufferSource() { return { playbackRate: {}, connect() {}, disconnect() {}, start(t) { starts.push(t); }, stop() { stops++; } }; },
    };
    const player = new PcmPlayer(ctx, { bufferMs: 120 });
    await player.push(new Uint8Array(4800));
    await player.push(new Uint8Array(4800));
    assert.equal(starts[0], 10.12);
    assert.ok(Math.abs(starts[1] - starts[0] - 0.1) < 0.000001);
    player.stop();
    assert.equal(stops, 2);
    assert.equal(player.sources.size, 0);
});

test('long text splitting preserves content and Unicode without exceeding policy limit', () => {
    const text = ('Hello world. 你好！🙂 More words, another clause; '.repeat(150)).trim();
    const pieces = splitText(text);
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every(piece => Array.from(piece).length <= 1200));
    assert.equal(pieces.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    assert.ok(!pieces.join('').includes('\uFFFD'));
});

test('keys are account-scoped, session-only by default, and removed when remembering is disabled', () => {
    const map = new Map();
    const storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
    const a = new KeyStore('alice', storage);
    a.set('session', false);
    assert.equal(map.size, 0);
    a.set('remembered', true);
    assert.equal(new KeyStore('alice', storage).value, 'remembered');
    assert.equal(new KeyStore('bob', storage).value, '');
    a.set('replacement', false);
    assert.equal(map.size, 0);
    a.clear();
    assert.equal(a.value, '');
});
