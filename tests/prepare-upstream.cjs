// QA fixtures stay in ignored .qa; no upstream implementation is redistributed.
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
    const root = path.join(__dirname, '..', '.qa', 'upstream');
    await fs.mkdir(root, { recursive: true });
    for (const [source, destination] of [
        ['public/scripts/extensions/tts/index.js', 'tts.js'],
        ['public/scripts/extensions/tts/settings.html', 'settings.html'],
        ['public/lib/jquery-3.5.1.min.js', 'jquery.js'],
    ]) {
        const response = await fetch(`https://raw.githubusercontent.com/SillyTavern/SillyTavern/1.19.0/${source}`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Fixture download failed: HTTP ${response.status}`);
        await fs.writeFile(path.join(root, destination), Buffer.from(await response.arrayBuffer()));
    }
    console.log('Downloaded SillyTavern 1.19.0 TTS fixtures.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
