const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const upstream = path.join(root, '.qa', 'upstream');
const tts = fs.readFileSync(path.join(upstream, 'tts.js'), 'utf8');
const stubs = new Map();
const dummy = `class Dummy {
 settings={voiceMap:{}}; settingsHtml='';
 async loadSettings(settings){this.settings=settings;}
 async checkReady(){} async fetchTtsVoiceObjects(){return [];}
 async onRefreshClick(){} dispose(){}
}`;
for (const match of tts.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const url = new URL(match[2], 'http://localhost/scripts/extensions/tts/index.js').pathname;
    const exports = match[1].split(',').map(name => name.trim()).filter(Boolean);
    stubs.set(url, dummy + '\n' + exports.map(name => `export const ${name}=Dummy;`).join('\n'));
}
stubs.set('/script.js', `
export const eventSource=window.bus, event_types=window.events, name2='Alice';
export const cancelTtsPlay=()=>{}, getCurrentChatId=()=>window.ctx.chatId, isStreamingEnabled=()=>false;
export const saveSettingsDebounced=()=>{}, substituteParams=text=>text;
`);
stubs.set('/scripts/extensions.js', `
export const extension_settings=window.settings, getContext=()=>window.ctx;
export const renderExtensionTemplateAsync=()=>fetch('/upstream-settings').then(r=>r.text());
export class ModuleWorkerWrapper {constructor(fn){this.fn=fn} update(){return this.fn()}}
`);
stubs.set('/scripts/utils.js', `
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export const escapeRegex=s=>s.replace(/[.*+?^$()|[\]\\\\]/g,'\\\\$&');
export const getBase64Async=async()=>'',getStringHash=s=>s,onlyUnique=(v,i,a)=>a.indexOf(v)===i;
export const regexFromString=s=>new RegExp(s);
`);
stubs.set('/scripts/util/AccountStorage.js', 'export const accountStorage={getItem:()=>null,setItem:()=>{}};');
stubs.set('/scripts/power-user.js', 'export const power_user={allow_name2_display:true};');
stubs.set('/scripts/constants.js', 'export const debounce_timeout={relaxed:10};');
stubs.set('/scripts/i18n.js', 'export const applyLocale=s=>s,t=(s,...v)=>String.raw({raw:s},...v);');
stubs.set('/scripts/user.js', 'export const getCurrentUserHandle=()=>"qa-user";');
stubs.set('/scripts/slash-commands/SlashCommandParser.js', 'export const SlashCommandParser={addCommandObject:cmd=>window.speakCommand=cmd.callback};');
stubs.set('/scripts/slash-commands/SlashCommand.js', 'export const SlashCommand={fromProps:obj=>obj};');
stubs.set('/scripts/slash-commands/SlashCommandArgument.js', 'export const ARGUMENT_TYPE={STRING:"string"}; export class SlashCommandArgument{} export class SlashCommandNamedArgument {static fromProps(obj){return obj}}');

const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/canary/style.css"><style>
body{background:#222;color:#eee;font:16px system-ui;margin:16px;max-width:720px}button,select,input,textarea{font:inherit;box-sizing:border-box}
.text_pole{width:100%;padding:8px;background:#333;color:#eee;border:1px solid #777;border-radius:5px}.menu_button{padding:7px;cursor:pointer}
.inline-drawer-content{display:block}.tts_voicemap_block_char{display:flex;justify-content:space-between;gap:8px;margin:8px 0}
.tts_voicemap_block_char select{max-width:55%}#tts_media_control{display:inline-block;padding:10px;border:1px solid #888;cursor:pointer}#tts_media_control:after{content:'Native play / stop'}
</style><h1>Canary integration QA</h1><div id="tts_container"></div><div id="tts_wand_container"></div>
<div class="mes" mesid="0"><button class="mes_narrate">Read Alice</button></div>
<script src="/jquery.js"></script><script>
window.errors=[];window.toastr={error:m=>window.errors.push(String(m)),info:()=>{}};
window.events=new Proxy({},{get:(_,p)=>p});
window.bus={handlers:{},ready:false,on(e,fn){(this.handlers[e]??=[]).push(fn);if(e==='APP_READY'&&this.ready)void fn()},makeLast(e,fn){this.on(e,fn)},removeListener(e,fn){this.handlers[e]=(this.handlers[e]||[]).filter(f=>f!==fn)},async emit(e,...args){if(e==='APP_READY')this.ready=true;for(const fn of [...(this.handlers[e]||[])])await fn(...args)}};
window.settings={tts:{enabled:true,currentProvider:new URLSearchParams(location.search).has('restore')?'Xiaomi MiMo (Canary)':'Edge',auto_generation:false,playback_rate:1,'Xiaomi MiMo (Canary)':{voiceMap:{'[Default Voice]':'Mia',Alice:'Mia'}}}};
window.ctx={eventSource:bus,event_types:events,extensionSettings:settings,chatId:'test-chat',groupId:null,characterId:0,name1:'You',name2:'Alice',characters:[{name:'Alice'}],groups:[],chat:[{name:'Alice',mes:'Hello from Alice.',is_user:false}]};
window.SillyTavern={getContext:()=>ctx};
const nativeFetch=window.fetch;window.mockMode='normal';
window.fetch=(url,opts)=>nativeFetch(typeof url==='string'&&url==='https://api.xiaomimimo.com/v1/chat/completions'?'/mock/mimo?mode='+window.mockMode:url,opts);
window.audioStarts=[];window.audioStops=0;
const createSource=AudioContext.prototype.createBufferSource;
AudioContext.prototype.createBufferSource=function(){const s=createSource.call(this);const start=s.start.bind(s),stop=s.stop.bind(s);s.start=t=>{audioStarts.push({at:performance.now(),time:t,duration:s.buffer.duration});return start(t)};s.stop=()=>{audioStops++;return stop()};return s};
</script><script type="module">
try {const canary=await import('/canary/index.js');await canary.initialize();const tts=await import('/scripts/extensions/tts/index.js');await tts.init();await bus.emit('APP_READY');window.fixtureReady=true;}catch(e){window.fixtureError=e.stack;}
</script></html>`;

const requests = [];
const mockTimers = new Set();
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/mock/mimo') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const record = { body: JSON.parse(body), completed: false, closed: false, mode: url.searchParams.get('mode') };
            requests.push(record);
            if (record.mode === 'unauthorized') { res.writeHead(401); res.end('private text must never reach UI'); return; }
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.flushHeaders();
            let index = 0;
            const timer = setInterval(() => {
                if (record.mode === 'delayed' && index++ < 20) return;
                if (record.mode === 'malformed') { res.end('data: {bad}\n\n'); return; }
                const pcm = Buffer.alloc(8640);
                for (let i = 0; i < 4320; i++) pcm.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 24000) * 500), i * 2);
                res.write('data: ' + JSON.stringify({ choices: [{ delta: { audio: { data: pcm.toString('base64') } } }] }) + '\r\n\r\n');
                index++;
                if (index >= (record.mode === 'short' ? 1 : 18)) { record.completed = true; res.end('data: [DONE]\n\n'); }
            }, 180);
            mockTimers.add(timer);
            res.on('close', () => { record.closed = true; clearInterval(timer); mockTimers.delete(timer); });
        });
        return;
    }
    let content;
    let type = 'text/javascript';
    if (url.pathname === '/') { content = html; type = 'text/html'; }
    else if (url.pathname === '/upstream-settings') { content = fs.readFileSync(path.join(upstream, 'settings.html')); type = 'text/html'; }
    else if (url.pathname === '/jquery.js') content = fs.readFileSync(path.join(upstream, 'jquery.js'));
    else if (url.pathname === '/scripts/extensions/tts/index.js') content = tts;
    else if (stubs.has(url.pathname)) content = stubs.get(url.pathname);
    else if (url.pathname.startsWith('/canary/')) {
        const file = path.resolve(root, '.' + url.pathname.slice('/canary'.length));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
        content = fs.readFileSync(file);
        if (file.endsWith('.css')) type = 'text/css';
    } else { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
});

let browser;
let context;
let page;
let deadline;
async function cleanup() {
    clearTimeout(deadline);
    for (const timer of mockTimers) clearInterval(timer);
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
}
process.once('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

(async () => {
    try {
        deadline = setTimeout(() => { console.error('Browser QA exceeded 150 seconds'); void cleanup().then(() => process.exit(1)); }, 150000);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
        page = await context.newPage();
        page.setDefaultTimeout(10000);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.fixtureReady || window.fixtureError);
        assert.equal(await page.evaluate(() => window.fixtureError), undefined);
        await page.selectOption('#tts_provider', 'Xiaomi MiMo (Canary)');
        await page.locator('#canary-key').fill('qa-key-never-real');
        await page.click('#canary-save-key');
        assert.equal(await page.locator('#canary-preview-voice option').count(), 8);
        assert.equal(await page.inputValue('#canary-preview-language'), 'bilingual');
        await page.locator('#canary-instructions').fill('Speak calmly.');
        assert.ok(!(await page.evaluate(() => JSON.stringify(window.settings))).includes('qa-key-never-real'));
        assert.equal(await page.evaluate(() => localStorage.length), 0);

        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        assert.equal(requests[0].completed, false, 'Audio must start before the HTTP stream completes');
        assert.equal(requests[0].body.stream, true);
        assert.equal(requests[0].body.messages.at(-1).role, 'assistant');
        await page.waitForFunction(() => window.audioStarts.length >= 3);
        const starts = await page.evaluate(() => window.audioStarts.slice(0, 3));
        for (let i = 1; i < starts.length; i++) assert.ok(Math.abs(starts[i].time - starts[i - 1].time - starts[i - 1].duration) < 0.04, 'Chunks should share a continuous audio clock');
        await page.click('#tts_media_control');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Stopped.');
        await page.waitForTimeout(300);
        assert.equal(requests[0].closed, true);
        assert.equal(requests[0].completed, false);
        assert.ok(await page.evaluate(() => window.audioStops > 0));
        console.log('PASS native narration: starts before stream completion, schedules continuous audio, native Stop closes the stream');

        await page.evaluate(() => window.mockMode = 'delayed');
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'waiting');
        const delayedIndex = requests.length;
        await page.waitForTimeout(300);
        await page.click('#tts_media_control');
        await page.waitForTimeout(300);
        assert.ok(requests.slice(delayedIndex - 1).every(r => r.closed));
        console.log('PASS Stop before first audio');

        await page.evaluate(() => window.mockMode = 'normal');
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        await page.evaluate(() => { window.ctx.chatId = 'another-chat'; return window.bus.emit('CHAT_CHANGED'); });
        await page.waitForTimeout(350);
        assert.equal(requests.at(-1).closed, true);
        console.log('PASS chat change cancels playback and request');

        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        await page.selectOption('#tts_provider', 'Edge');
        await page.waitForTimeout(300);
        assert.equal(requests.at(-1).closed, true);
        await page.selectOption('#tts_provider', 'Xiaomi MiMo (Canary)');
        assert.equal(await page.inputValue('#canary-key'), 'qa-key-never-real');
        console.log('PASS provider switch disposes playback; session key survives switching');

        await page.evaluate(() => window.mockMode = 'unauthorized');
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'error');
        assert.ok((await page.textContent('#canary-status')).includes('API key'));
        assert.ok(!(await page.textContent('body')).includes('private text'));
        console.log('PASS authenticated error is actionable and redacted');

        await page.evaluate(() => window.mockMode = 'normal');
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        assert.equal(requests.at(-1).completed, true);
        console.log('PASS complete streamed preview drains playback');

        await page.evaluate(() => window.mockMode = 'short');
        const voices = ['冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'];
        assert.deepEqual(await page.locator('#canary-preview-voice option').allTextContents(), voices);
        for (const voice of voices) {
            await page.selectOption('#canary-preview-voice', voice);
            for (const language of ['en', 'zh', 'bilingual']) {
                await page.selectOption('#canary-preview-language', language);
                const count = requests.length;
                await page.click('#canary-preview');
                await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
                assert.equal(requests.length, count + 1);
                const request = requests.at(-1).body;
                const sample = request.messages.at(-1).content;
                assert.equal(request.audio.voice, voice);
                assert.equal(/[\u4e00-\u9fff]/u.test(sample), language !== 'en');
                assert.equal(/[a-z]/i.test(sample), language !== 'zh');
                assert.equal(request.language, undefined);
            }
        }
        await page.selectOption('#canary-preview-language', 'zh');
        await page.selectOption('#tts_provider', 'Edge');
        await page.selectOption('#tts_provider', 'Xiaomi MiMo (Canary)');
        assert.equal(await page.inputValue('#canary-preview-language'), 'zh');
        assert.equal(await page.inputValue('#tts_voicemap_char_Alice_voice'), 'Mia');
        const mixedText = 'Hello, Alice. 你好，今天我们开始新的故事。';
        await page.evaluate(text => { window.ctx.chat[0].mes = text; }, mixedText);
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        assert.equal(requests.at(-1).body.audio.voice, 'Mia');
        assert.equal(requests.at(-1).body.messages.at(-1).content, mixedText);
        await page.evaluate(() => window.mockMode = 'normal');
        console.log('PASS all eight voices with English, Chinese and bilingual previews; preview preference persists and mixed narration preserves voice/text');

        // /speak resets the native audio element without a click on TTS controls.
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        const replacedRequest = requests.at(-1);
        await page.evaluate(() => window.speakCommand({ voice: 'Alice' }, 'A replacement speech request.'));
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        await page.waitForTimeout(300);
        assert.equal(replacedRequest.closed, true);
        assert.equal(requests.at(-1).body.messages.at(-1).content, 'A replacement speech request.');
        await page.click('#canary-stop');
        await page.waitForTimeout(300);
        console.log('PASS slash-command replacement and Canary Stop');

        await page.evaluate(() => { window.ctx.chat[0].mes = 'First paragraph.\nSecond queued paragraph.'; });
        await page.check('#tts_narrate_by_paragraphs');
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        await page.uncheck('#tts_enabled');
        await page.waitForTimeout(300);
        assert.equal(requests.at(-1).closed, true);
        const disabledCount = requests.length;
        await page.check('#tts_enabled');
        await page.waitForTimeout(1300);
        assert.equal(requests.length, disabledCount, 'Re-enabling must not resume cancelled queued paragraphs');
        await page.uncheck('#tts_narrate_by_paragraphs');
        console.log('PASS disabling TTS cancels active and queued narration');

        await page.check('#canary-remember');
        await page.click('#canary-save-key');
        assert.equal(await page.evaluate(() => localStorage.getItem('canary:mimo:key:qa-user')), 'qa-key-never-real');
        await page.goto(`http://127.0.0.1:${server.address().port}/?restore`);
        await page.waitForFunction(() => window.fixtureReady || window.fixtureError);
        assert.equal(await page.evaluate(() => window.fixtureError), undefined);
        assert.equal(await page.inputValue('#tts_provider'), 'Xiaomi MiMo (Canary)');
        assert.equal(await page.inputValue('#canary-key'), 'qa-key-never-real');
        console.log('PASS saved provider selection and remembered key restore without initialization errors');
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        await page.selectOption('#tts_provider', 'Edge');
        await page.waitForTimeout(300);
        assert.equal(requests.at(-1).closed, true);
        await page.selectOption('#tts_provider', 'Xiaomi MiMo (Canary)');
        console.log('PASS provider change during native narration');
        await page.click('#canary-forget-key');
        assert.equal(await page.evaluate(() => localStorage.getItem('canary:mimo:key:qa-user')), null);
        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.locator('.canary-settings').evaluate(el => el.scrollWidth > el.clientWidth + 1);
        assert.equal(overflow, false);
        await page.screenshot({ path: path.join(root, '.qa', 'canary-mobile.png'), fullPage: true });
        assert.deepEqual(pageErrors, []);
        console.log('PASS key remembering/removal, mobile layout, no uncaught browser errors');
    } finally {
        await cleanup();
        console.log('CLEANUP browser, context, pages, mock streams and server closed');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
