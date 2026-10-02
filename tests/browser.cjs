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
<link rel="stylesheet" href="/upstream/select2.css"><link rel="stylesheet" href="/upstream/select2-overrides.css">
<link rel="stylesheet" href="/canary/style.css"><style>
body{background:#222;color:#eee;font:16px system-ui;margin:16px;max-width:720px}button,select,input,textarea{font:inherit;box-sizing:border-box}
.text_pole{width:100%;padding:8px;background:#333;color:#eee;border:1px solid #777;border-radius:5px}.menu_button{padding:7px;cursor:pointer}
.inline-drawer-content{display:none}#tts_settings>.inline-drawer>.inline-drawer-content{display:block}.inline-drawer-header{display:flex;justify-content:space-between;align-items:center;padding:5px 0;cursor:pointer}.tts_voicemap_block_char{display:flex;justify-content:space-between;gap:8px;margin:8px 0}
.tts_voicemap_block_char select{max-width:55%}#tts_media_control{display:inline-block;padding:10px;border:1px solid #888;cursor:pointer}#tts_media_control:after{content:'Native play / stop'}
</style><h1>Canary integration QA</h1><div id="tts_container"></div><div id="tts_wand_container"></div>
<div class="mes" mesid="0"><button class="mes_narrate">Read Alice</button></div>
<script src="/jquery.js"></script><script src="/upstream/select2.js"></script><script src="/upstream/select2-search-placeholder.js"></script><script>
// Mirrors SillyTavern's global inline-drawer toggle (script.js), without the slide animation.
$(document).on('click','.inline-drawer-toggle',function(e){if($(e.target).hasClass('text_pole'))return;const d=$(this).closest('.inline-drawer');d.find('>.inline-drawer-header .inline-drawer-icon').toggleClass('down up').toggleClass('fa-circle-chevron-down fa-circle-chevron-up');d.find('>.inline-drawer-content').toggle();});
window.errors=[];window.notices=[];window.toastr={error:m=>window.errors.push(String(m)),success:m=>window.notices.push(String(m)),info:()=>{}};
window.events=new Proxy({},{get:(_,p)=>p});
window.bus={handlers:{},ready:false,on(e,fn){(this.handlers[e]??=[]).push(fn);if(e==='APP_READY'&&this.ready)void fn()},makeLast(e,fn){this.on(e,fn)},removeListener(e,fn){this.handlers[e]=(this.handlers[e]||[]).filter(f=>f!==fn)},async emit(e,...args){if(e==='APP_READY')this.ready=true;for(const fn of [...(this.handlers[e]||[])])await fn(...args)}};
window.settings={tts:{enabled:true,currentProvider:new URLSearchParams(location.search).has('restore')?'Xiaomi MiMo (Canary)':'Edge',auto_generation:false,playback_rate:1,'Xiaomi MiMo (Canary)':{voiceMap:{'[Default Voice]':'Mia',Alice:'Mia'}}}};
// sessionStorage stands in for the server copy of settings.json across reloads.
settings.canary=JSON.parse(sessionStorage.getItem('qa-server-settings')||'{}').canary;
window.ctx={eventSource:bus,event_types:events,extensionSettings:settings,saveSettingsDebounced:()=>sessionStorage.setItem('qa-server-settings',JSON.stringify(settings)),chatId:'test-chat',groupId:null,characterId:0,name1:'You',name2:'Alice',characters:[{name:'Alice'}],groups:[],chat:[{name:'Alice',mes:'Hello from Alice.',is_user:false}]};
window.SillyTavern={getContext:()=>ctx};
const nativeFetch=window.fetch;window.mockMode='normal';
window.fetch=(url,opts)=>{
 if(typeof url==='string'&&url==='https://api.xiaomimimo.com/v1/chat/completions')url='/mock/mimo?mode='+window.mockMode;
 // Plain string checks: this template literal would strip regex backslashes.
 const region=typeof url!=='string'?null:url.startsWith('https://api.minimax.io/v1/')?'global':url.startsWith('https://api.minimaxi.com/v1/')?'mainland':null;
 if(region)url='/mock/minimax/'+region+'/'+url.split('/').pop()+'?mode='+window.mockMode;
 if(typeof url==='string'&&url.startsWith('https://api.elevenlabs.io/'))url='/mock/elevenlabs/'+url.slice('https://api.elevenlabs.io/'.length)+(url.includes('?')?'&':'?')+'mode='+window.mockMode;
 return nativeFetch(url,opts);
};
window.audioStarts=[];window.audioStops=0;
const createSource=AudioContext.prototype.createBufferSource;
AudioContext.prototype.createBufferSource=function(){const s=createSource.call(this);const start=s.start.bind(s),stop=s.stop.bind(s);s.start=t=>{audioStarts.push({at:performance.now(),time:t,duration:s.buffer.duration,rate:s.playbackRate.value});return start(t)};s.stop=()=>{audioStops++;return stop()};return s};
</script><script type="module">
try {const canary=await import('/canary/index.js');await canary.initialize();const tts=await import('/scripts/extensions/tts/index.js');await tts.init();await bus.emit('APP_READY');window.fixtureReady=true;}catch(e){window.fixtureError=e.stack;}
</script></html>`;

const requests = [];
const minimaxRequests = [];
const elevenlabsRequests = [];
const mockTimers = new Set();
const tone = () => {
    const pcm = Buffer.alloc(8640);
    for (let i = 0; i < 4320; i++) pcm.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 24000) * 500), i * 2);
    return pcm;
};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/mock/minimax/')) {
        const [region, endpoint] = url.pathname.split('/').slice(3);
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const record = { region, endpoint, auth: req.headers.authorization, body: JSON.parse(body), completed: false, closed: false, mode: url.searchParams.get('mode') };
            minimaxRequests.push(record);
            const ok = { status_code: 0, status_msg: 'success' };
            if (endpoint === 'get_voice') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ system_voice: [{ voice_id: 'English_expressive_narrator', voice_name: 'Expressive Narrator' }, { voice_id: 'English_CalmWoman', voice_name: 'Calm Woman' }], voice_cloning: [{ voice_id: 'qa-clone' }], base_resp: ok }));
                return;
            }
            // MiniMax reports authentication failures as HTTP 200 JSON.
            if (record.mode === 'unauthorized') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'private text must never reach UI' } }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.flushHeaders();
            const sent = [];
            const timer = setInterval(() => {
                const pcm = tone();
                sent.push(pcm);
                res.write('data: ' + JSON.stringify({ data: { audio: pcm.toString('hex'), status: 1 }, base_resp: { status_code: 0, status_msg: '' } }) + '\n\n');
                if (sent.length >= (record.mode === 'short' ? 1 : 18)) {
                    record.completed = true;
                    // The final event repeats every chunk as one aggregated clip.
                    res.end('data: ' + JSON.stringify({ data: { audio: Buffer.concat(sent).toString('hex'), status: 2 }, extra_info: { audio_length: 1 }, base_resp: ok }) + '\n\n');
                }
            }, 180);
            mockTimers.add(timer);
            res.on('close', () => { record.closed = true; clearInterval(timer); mockTimers.delete(timer); });
        });
        return;
    }
    if (url.pathname.startsWith('/mock/elevenlabs/')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const record = { path: url.pathname.slice('/mock/elevenlabs'.length), format: url.searchParams.get('output_format'), key: req.headers['xi-api-key'], body: body ? JSON.parse(body) : null, completed: false, closed: false, mode: url.searchParams.get('mode') };
            elevenlabsRequests.push(record);
            if (record.mode === 'unauthorized') {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'private text must never reach UI' } }));
                return;
            }
            if (record.path === '/v2/voices') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ voices: [{ voice_id: 'qa-el-premade', name: 'Rachel', category: 'premade' }, { voice_id: 'qa-el-clone', name: 'My Clone', category: 'cloned' }], has_more: false }));
                return;
            }
            // Raw 24 kHz PCM, written as it is generated.
            res.writeHead(200, { 'Content-Type': 'audio/pcm' });
            res.flushHeaders();
            let sent = 0;
            const timer = setInterval(() => {
                res.write(tone());
                if (++sent >= (record.mode === 'short' ? 1 : 18)) { record.completed = true; res.end(); }
            }, 180);
            mockTimers.add(timer);
            res.on('close', () => { record.closed = true; clearInterval(timer); mockTimers.delete(timer); });
        });
        return;
    }
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
    else if (/^\/upstream\/select2[\w.-]*\.(js|css)$/.test(url.pathname)) {
        content = fs.readFileSync(path.join(upstream, path.basename(url.pathname)));
        if (url.pathname.endsWith('.css')) type = 'text/css';
    }
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

async function waitUntil(check, ms = 5000) {
    const end = Date.now() + ms;
    while (!check()) {
        if (Date.now() > end) throw new Error('Timed out waiting for a mock request');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

const sectionContent = key => page.locator(`.canary-section[data-section="${key}"] > .inline-drawer-content`);
async function openSection(key) {
    if (!(await sectionContent(key).isVisible())) await page.click(`.canary-section[data-section="${key}"] > .inline-drawer-header`);
    await sectionContent(key).waitFor({ state: 'visible' });
}
const optgroups = () => page.locator('#canary-preview-voice optgroup').evaluateAll(groups => groups.map(group => group.label));
// Drive a searchable (select2) dropdown as a user does: open it, type, read the results.
const searchDropdown = async (id, text) => {
    await page.click(`#${id} + .select2-container .select2-selection`);
    // Type key by key: select2 skips input events that no keydown preceded.
    await page.locator('.select2-container--open .select2-search__field').pressSequentially(text);
    // Wait until the results reflect the search: every option matches (with its group label) or none do.
    await page.waitForFunction(terms => {
        const open = document.querySelector('.select2-container--open .select2-results');
        if (!open) return false;
        if (open.querySelector('.select2-results__message')) return true;
        const options = [...open.querySelectorAll('.select2-results__option--selectable')];
        const group = option => option.closest('.select2-results__option--group')?.querySelector('.select2-results__group')?.textContent ?? '';
        return options.length > 0 && options.every(option => terms.every(term => `${option.textContent} ${group(option)}`.toLowerCase().includes(term)));
    }, text.toLowerCase().split(/\s+/).filter(Boolean));
    return page.locator('.select2-container--open .select2-results__option--selectable').allTextContents();
};
const choose = async (id, text) => {
    const results = await searchDropdown(id, text);
    assert.equal(results.length, 1, `"${text}" should find one option in #${id}, found: ${results.join(', ')}`);
    await page.keyboard.press('Enter');
};

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
        assert.equal(await page.evaluate(() => window.notices.at(-1)), 'Key saved until this page closes or reloads.');
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

        assert.equal(await sectionContent('connection').isVisible(), false, 'Connection folds once a key is saved');
        assert.equal(await page.textContent('#canary-connection-summary'), '✓ Key saved · this session');
        await openSection('connection');
        await page.check('#canary-remember');
        await page.click('#canary-save-key');
        assert.equal(await page.textContent('#canary-connection-summary'), '✓ Key saved · remembered');
        assert.equal(await page.evaluate(() => window.settings.canary.mimoKey), 'qa-key-never-real');
        assert.equal(await page.evaluate(() => window.notices.at(-1)), 'Key saved to this SillyTavern account.');
        assert.ok(!(await page.evaluate(() => JSON.stringify(window.settings.tts))).includes('qa-key-never-real'));
        assert.equal(await page.evaluate(() => localStorage.length), 0);
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
        await openSection('connection');
        await page.click('#canary-forget-key');
        assert.equal(await page.evaluate(() => window.notices.at(-1)), 'Key removed.');
        assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa-server-settings')).canary.mimoKey), undefined);
        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.locator('.canary-settings').evaluate(el => el.scrollWidth > el.clientWidth + 1);
        assert.equal(overflow, false);
        await page.screenshot({ path: path.join(root, '.qa', 'canary-mobile.png'), fullPage: true });
        assert.deepEqual(pageErrors, []);
        console.log('PASS key remembering/removal, mobile layout, no uncaught browser errors');

        await page.setViewportSize({ width: 1100, height: 1000 });
        await page.evaluate(() => { window.mockMode = 'normal'; window.ctx.chat[0].mes = 'Hello from Alice.'; });
        await page.selectOption('#tts_provider', 'MiniMax (Canary)');
        assert.equal(await page.inputValue('#canary-key'), '', 'MiniMax has its own key field');
        assert.equal(await page.locator('#playback_rate_block').isVisible(), false, "MiniMax hides SillyTavern's speed slider");
        assert.equal(await page.inputValue('#canary-speed'), '1.00');
        assert.equal(await page.inputValue('#canary-model'), 'speech-2.8-hd');
        assert.equal(await page.inputValue('#canary-emotion'), '');
        assert.ok(await page.locator('#canary-preview-voice option').count() >= 100, 'Built-in voices are listed without a key');
        assert.equal(await sectionContent('connection').isVisible(), true, 'Connection is open without a key');
        assert.equal(await sectionContent('tuning').isVisible(), false, 'Fine-tuning starts folded');
        assert.equal(await page.textContent('#canary-connection-summary'), 'No key saved · Global');
        assert.deepEqual((await optgroups()).slice(0, 4), ['English', 'Chinese (Mandarin)', 'Cantonese', 'Japanese']);
        assert.equal(await page.locator('#canary-voice-search, #canary-voicemap-search').count(), 0, 'Dropdowns search in place; no separate search boxes');
        await page.evaluate(() => { window.previewChanges = 0; document.getElementById('canary-preview-voice').addEventListener('change', () => window.previewChanges++); });
        assert.deepEqual(await searchDropdown('canary-preview-voice', 'calm japanese'), ['Calm Lady · Japanese_CalmLady'], 'Every term must match the name or its language group');
        await page.keyboard.press('Enter');
        assert.equal(await page.inputValue('#canary-preview-voice'), 'Japanese_CalmLady');
        assert.equal(await page.evaluate(() => window.previewChanges), 1, 'Canary hears a searched choice exactly once');
        assert.deepEqual(await searchDropdown('canary-preview-voice', 'no such voice'), []);
        await page.keyboard.press('Escape');
        assert.equal(await page.inputValue('#canary-preview-voice'), 'Japanese_CalmLady', 'A search without a choice keeps the voice');
        await choose('canary-preview-voice', 'english_expressive_narrator');
        console.log('PASS MiniMax sections, connection summary, grouped built-in voices and searchable preview dropdown');
        await page.locator('#canary-key').fill('qa-minimax-key');
        await page.check('#canary-remember');
        await page.click('#canary-save-key');
        await page.waitForFunction(() => document.querySelector('#canary-preview-voice option')?.value === 'qa-clone');
        assert.equal(await page.inputValue('#canary-preview-voice'), 'English_expressive_narrator');
        assert.equal(await page.textContent('#canary-connection-summary'), '✓ Key saved · remembered · Global');
        assert.deepEqual(await optgroups(), ['Your voices', 'English']);
        const voiceRequest = minimaxRequests.at(-1);
        assert.deepEqual([voiceRequest.endpoint, voiceRequest.region, voiceRequest.auth], ['get_voice', 'global', 'Bearer qa-minimax-key']);
        assert.equal(await page.evaluate(() => window.settings.canary.minimaxKey), 'qa-minimax-key');
        assert.equal(await page.evaluate(() => window.settings.canary.mimoKey), undefined);
        assert.ok(!(await page.evaluate(() => JSON.stringify(window.settings.tts))).includes('qa-minimax-key'));
        await page.waitForFunction(() => [...document.querySelectorAll('#tts_voicemap_char_Alice_voice option')].some(o => o.value === 'qa-clone'));
        await choose('tts_voicemap_char_Alice_voice', 'qa-clone');
        console.log('PASS MiniMax key is separate and account voices, including cloned voices, reach the voice map');

        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        const narration = minimaxRequests.at(-1);
        assert.equal(narration.endpoint, 't2a_v2');
        assert.equal(narration.completed, false, 'MiniMax audio must start before the HTTP stream completes');
        assert.equal(narration.body.model, 'speech-2.8-hd');
        assert.equal(narration.body.stream, true);
        assert.deepEqual(narration.body.stream_options, { exclude_aggregated_audio: true });
        assert.deepEqual(narration.body.voice_setting, { voice_id: 'qa-clone', speed: 1 });
        assert.deepEqual(narration.body.audio_setting, { sample_rate: 24000, format: 'pcm', channel: 1 });
        assert.equal(narration.body.text, 'Hello from Alice.');
        await page.click('#tts_media_control');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Stopped.');
        await page.waitForTimeout(300);
        assert.equal(narration.closed, true);
        console.log('PASS MiniMax narration streams before completion and native Stop closes the stream');

        const aliceOptions = () => page.locator('#tts_voicemap_char_Alice_voice option').evaluateAll(options => options.map(o => o.value));
        assert.equal(await page.locator('#canary-preview-voice option[value="English_expressive_narrator"]').textContent(), 'Expressive Narrator · English_expressive_narrator');
        const allOptions = await aliceOptions();
        assert.ok(allOptions.includes('Calm Woman · English_CalmWoman'), 'The voice map shows readable names');
        assert.deepEqual(await searchDropdown('tts_voicemap_char_Alice_voice', 'calm'), ['Calm Woman · English_CalmWoman'], 'Voice map dropdowns search in place');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.settings.tts['MiniMax (Canary)'].voiceMap.Alice), 'Calm Woman · English_CalmWoman', 'SillyTavern saves a searched choice');
        assert.deepEqual(await aliceOptions(), allOptions, 'Searching never removes options');
        await page.evaluate(() => import('/scripts/extensions/tts/index.js').then(tts => tts.initVoiceMap()));
        await page.waitForFunction(() => document.querySelector('#tts_voicemap_char_Alice_voice + .select2-container'));
        assert.equal(await page.inputValue('#tts_voicemap_char_Alice_voice'), 'Calm Woman · English_CalmWoman', 'Rebuilt dropdowns stay searchable and keep the choice');
        await choose('tts_voicemap_char_Alice_voice', 'qa-clone');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.locator('.canary-settings').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, 'Searchable dropdowns fit a phone width');
        await page.screenshot({ path: path.join(root, '.qa', 'canary-minimax-mobile.png'), fullPage: true });
        await page.setViewportSize({ width: 1100, height: 1000 });
        console.log('PASS MiniMax readable voice names and searchable voice-map dropdowns');

        await page.evaluate(() => window.mockMode = 'short');
        await openSection('custom');
        assert.equal(await page.textContent('#canary-custom-summary'), 'None');
        await page.locator('#canary-custom-voice-id').fill('qa-hand-added');
        await page.locator('#canary-custom-voice-nickname').fill('Hero');
        await page.click('#canary-add-voice');
        assert.equal(await page.textContent('#canary-custom-summary'), '1 added');
        assert.equal(await page.textContent('#canary-custom-voice-list li span'), 'Hero · qa-hand-added');
        assert.equal(await page.inputValue('#canary-preview-voice'), 'qa-hand-added');
        assert.deepEqual(await page.locator('#canary-preview-voice optgroup[label="Your voices"] option').evaluateAll(o => o.map(x => x.value)), ['qa-hand-added', 'qa-clone']);
        await page.waitForFunction(() => [...document.querySelectorAll('#tts_voicemap_char_Alice_voice option')].some(o => o.value === 'Hero · qa-hand-added'));
        await choose('tts_voicemap_char_Alice_voice', 'hero qa-hand-added');
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        assert.equal(minimaxRequests.at(-1).body.voice_setting.voice_id, 'qa-hand-added', 'Custom voices send their ID');
        // Renaming relabels the saved assignment; removing keeps it usable by ID.
        await page.locator('#canary-custom-voice-id').fill('qa-hand-added');
        await page.locator('#canary-custom-voice-nickname').fill('Hero 2');
        await page.locator('#canary-custom-voice-nickname').press('Enter');
        await page.waitForFunction(() => document.querySelector('#tts_voicemap_char_Alice_voice')?.value === 'Hero 2 · qa-hand-added');
        assert.equal(await page.evaluate(() => window.settings.tts['MiniMax (Canary)'].voiceMap.Alice), 'Hero 2 · qa-hand-added');
        await page.click('#canary-custom-voice-list button[data-voice-id="qa-hand-added"]');
        assert.equal(await page.textContent('#canary-custom-summary'), 'None');
        await page.waitForFunction(() => !document.querySelector('#canary-preview-voice option[value="qa-hand-added"]'));
        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        assert.equal(minimaxRequests.at(-1).body.voice_setting.voice_id, 'qa-hand-added', 'A removed custom voice still assigned in the map keeps working');
        await choose('canary-preview-voice', 'english_expressive_narrator');
        await page.evaluate(() => window.mockMode = 'normal');
        console.log('PASS MiniMax custom voices: add with nickname, use in the voice map, rename, remove');

        // SillyTavern's own slider value must be ignored by MiniMax.
        await page.evaluate(() => { window.mockMode = 'short'; window.settings.tts.playback_rate = 2.5; });
        const speedBox = page.locator('#canary-speed');
        await speedBox.fill('3');
        await speedBox.blur();
        assert.equal(await speedBox.inputValue(), '2.00', 'Speed is limited to MiniMax’s range');
        await speedBox.fill('');
        await speedBox.blur();
        assert.equal(await speedBox.inputValue(), '2.00', 'Empty input restores the last speed');
        await speedBox.fill('1.5');
        await speedBox.press('Enter');
        assert.equal(await speedBox.inputValue(), '1.50');
        await page.selectOption('#canary-emotion', 'whisper');
        assert.match(await page.textContent('#canary-emotion-warning'), /speech-2\.6/);
        assert.equal(await page.locator('#canary-emotion-warning').isVisible(), true);
        await page.selectOption('#canary-model', 'speech-2.6-hd');
        assert.equal(await page.locator('#canary-emotion-warning').isVisible(), false);
        await page.selectOption('#canary-model', 'speech-2.8-hd');
        await page.selectOption('#canary-emotion', 'calm');
        assert.equal(await page.locator('#canary-emotion-warning').isVisible(), false);
        await openSection('tuning');
        await page.locator('#canary-custom-model').fill('speech-9-qa');
        const startsBefore = await page.evaluate(() => window.audioStarts.length);
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        const previewStarts = await page.evaluate(count => window.audioStarts.slice(count), startsBefore);
        assert.equal(previewStarts.length, 1, 'The aggregated final event must not replay the passage');
        assert.equal(previewStarts[0].rate, 1, 'MiniMax applies speed natively instead of resampling');
        const preview = minimaxRequests.at(-1).body;
        assert.equal(preview.model, 'speech-9-qa');
        assert.deepEqual(preview.voice_setting, { voice_id: 'English_expressive_narrator', speed: 1.5, emotion: 'calm' });
        await page.evaluate(() => { window.settings.tts.playback_rate = 1; });
        console.log('PASS MiniMax emotion, custom model and its own Speed setting; final aggregated audio is not replayed');

        await page.locator('#canary-volume').fill('2.5');
        await page.locator('#canary-pitch').fill('-3');
        await page.check('#canary-normalize');
        await choose('canary-language', 'japanese');
        assert.equal(await page.textContent('#canary-volume-value'), '2.5');
        assert.equal(await page.textContent('#canary-pitch-value'), '-3');
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        const tuned = minimaxRequests.at(-1).body;
        assert.equal(tuned.language_boost, 'Japanese');
        assert.deepEqual(tuned.voice_setting, { voice_id: 'English_expressive_narrator', speed: 1.5, emotion: 'calm', vol: 2.5, pitch: -3, text_normalization: true });
        await page.click('#canary-reset-tuning');
        assert.equal(await page.inputValue('#canary-custom-model'), '');
        assert.equal(await page.isChecked('#canary-normalize'), false);
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        const reset = minimaxRequests.at(-1).body;
        assert.equal(reset.model, 'speech-2.8-hd');
        assert.deepEqual(reset.voice_setting, { voice_id: 'English_expressive_narrator', speed: 1.5, emotion: 'calm' }, 'Speed is a voice setting, not fine-tuning');
        assert.equal(reset.language_boost, 'Japanese', 'Language is a voice setting, not fine-tuning');
        console.log('PASS MiniMax language, volume, pitch and text normalization; Reset fine-tuning restores defaults');

        await page.selectOption('#canary-region', 'mainland');
        await waitUntil(() => minimaxRequests.at(-1).endpoint === 'get_voice' && minimaxRequests.at(-1).region === 'mainland');
        await page.evaluate(() => window.mockMode = 'unauthorized');
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'error');
        assert.equal(minimaxRequests.at(-1).region, 'mainland');
        assert.ok((await page.textContent('#canary-status')).includes('API key'));
        assert.ok(!(await page.textContent('body')).includes('private text'));
        console.log('PASS MiniMax region switch and redacted HTTP 200 authentication error');

        await page.selectOption('#tts_provider', 'Xiaomi MiMo (Canary)');
        assert.equal(await page.inputValue('#canary-key'), '');
        assert.equal(await page.locator('#canary-preview-voice option').count(), 8);
        assert.equal(await page.locator('#playback_rate_block').isVisible(), true, 'Other providers keep SillyTavern’s speed slider');
        assert.equal(await page.locator('#tts_voicemap_block .select2-container, #tts_voicemap_block .select2-hidden-accessible').count(), 0, 'Voice map dropdowns return to plain selects without MiniMax');
        await page.selectOption('#tts_provider', 'MiniMax (Canary)');
        assert.equal(await page.inputValue('#canary-key'), 'qa-minimax-key');
        assert.equal(await page.inputValue('#canary-region'), 'mainland');
        assert.equal(await page.inputValue('#canary-speed'), '1.50');
        assert.equal(await page.locator('#playback_rate_block').isVisible(), false);
        assert.equal(await page.inputValue('#canary-emotion'), 'calm');
        assert.equal(await page.inputValue('#canary-language'), 'Japanese');
        assert.equal(await sectionContent('connection').isVisible(), false);
        assert.equal(await page.textContent('#canary-connection-summary'), '✓ Key saved · remembered · Mainland China');
        await page.setViewportSize({ width: 390, height: 844 });
        await openSection('tuning');
        await openSection('custom');
        assert.equal(await page.locator('.canary-settings').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        await page.locator('.canary-settings').screenshot({ path: path.join(root, '.qa', 'minimax-mobile.png') });
        assert.deepEqual(pageErrors, []);
        console.log('PASS switching between Canary providers keeps keys and settings separate');

        await page.setViewportSize({ width: 1100, height: 1000 });
        await page.evaluate(() => { window.mockMode = 'normal'; });
        await page.selectOption('#tts_provider', 'ElevenLabs (Canary)');
        assert.equal(await page.inputValue('#canary-key'), '', 'ElevenLabs has its own key field');
        assert.equal(await page.locator('#canary-preview-voice option').count(), 0, 'Account voices need a key');
        assert.equal(await page.locator('#playback_rate_block').isVisible(), true, 'ElevenLabs follows SillyTavern’s speed slider');
        assert.equal(await page.inputValue('#canary-model'), 'eleven_v4');
        assert.equal(await page.inputValue('#canary-stability'), '0.5');
        assert.equal(await page.textContent('#canary-connection-summary'), 'No key saved');
        await page.locator('#canary-key').fill('qa-elevenlabs-key');
        await page.check('#canary-remember');
        await page.click('#canary-save-key');
        await page.waitForFunction(() => document.querySelector('#canary-preview-voice option')?.value === 'qa-el-clone');
        assert.deepEqual(await optgroups(), ['Your voices', 'Default voices']);
        assert.deepEqual([elevenlabsRequests.at(-1).path, elevenlabsRequests.at(-1).key], ['/v2/voices', 'qa-elevenlabs-key']);
        assert.equal(await page.evaluate(() => window.settings.canary.elevenlabsKey), 'qa-elevenlabs-key');
        assert.equal(await page.evaluate(() => window.settings.canary.minimaxKey), 'qa-minimax-key', 'Saving an ElevenLabs key leaves MiniMax alone');
        assert.ok(!(await page.evaluate(() => JSON.stringify(window.settings.tts))).includes('qa-elevenlabs-key'));
        await page.waitForFunction(() => [...document.querySelectorAll('#tts_voicemap_char_Alice_voice option')].some(o => o.value === 'My Clone · qa-el-clone'));
        await choose('tts_voicemap_char_Alice_voice', 'my clone');
        console.log('PASS ElevenLabs key is separate and account voices reach a searchable voice map');

        await page.click('.mes_narrate');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'playing');
        const elevenNarration = elevenlabsRequests.at(-1);
        assert.equal(elevenNarration.path, '/v1/text-to-speech/qa-el-clone/stream');
        assert.equal(elevenNarration.format, 'pcm_24000');
        assert.equal(elevenNarration.completed, false, 'ElevenLabs audio must start before the HTTP stream completes');
        assert.deepEqual(elevenNarration.body, { model_id: 'eleven_v4', text: 'Hello from Alice.', voice_settings: { stability: 0.5 } });
        await page.click('#tts_media_control');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Stopped.');
        await page.waitForTimeout(300);
        assert.equal(elevenNarration.closed, true);
        console.log('PASS ElevenLabs v4 narration streams before completion and native Stop closes the stream');

        await page.evaluate(() => { window.mockMode = 'short'; });
        await page.selectOption('#canary-model', 'eleven_v3');
        await page.selectOption('#canary-stability', '0');
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.textContent === 'Finished. Ready to stream.');
        assert.deepEqual([elevenlabsRequests.at(-1).body.model_id, elevenlabsRequests.at(-1).body.voice_settings.stability], ['eleven_v3', 0]);
        await page.evaluate(() => { window.mockMode = 'unauthorized'; });
        await page.click('#canary-preview');
        await page.waitForFunction(() => document.querySelector('#canary-status')?.dataset.state === 'error');
        assert.ok((await page.textContent('#canary-status')).includes('API key'));
        assert.ok(!(await page.textContent('body')).includes('private text'));
        await page.evaluate(() => { window.mockMode = 'normal'; });
        await page.selectOption('#tts_provider', 'MiniMax (Canary)');
        await page.selectOption('#tts_provider', 'ElevenLabs (Canary)');
        assert.equal(await page.inputValue('#canary-key'), 'qa-elevenlabs-key');
        assert.equal(await page.inputValue('#canary-model'), 'eleven_v3');
        assert.equal(await page.inputValue('#canary-stability'), '0');
        assert.equal(await page.textContent('#canary-connection-summary'), '✓ Key saved · remembered');
        await page.setViewportSize({ width: 390, height: 844 });
        await openSection('tuning');
        assert.equal(await page.locator('.canary-settings').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        await page.locator('.canary-settings').screenshot({ path: path.join(root, '.qa', 'elevenlabs-mobile.png') });
        assert.deepEqual(pageErrors, []);
        console.log('PASS ElevenLabs model and stability, redacted key error, settings kept across provider switches');
    } finally {
        await cleanup();
        console.log('CLEANUP browser, context, pages, mock streams and server closed');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
