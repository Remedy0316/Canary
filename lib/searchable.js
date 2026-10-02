// Searchable dropdowns through SillyTavern's bundled select2, as ST uses for its
// model lists. Without select2 (or jQuery) a select stays a plain native dropdown.
const select2 = () => globalThis.jQuery?.fn?.select2 ? globalThis.jQuery : null;
const isSearchable = select => Boolean(select?.classList.contains('select2-hidden-accessible'));

// Every search term must appear in the option text or its group label, so
// "calm english" finds "Calm Woman · English_CalmWoman".
export function matchTerms(params, data) {
    const terms = (params.term ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return data;
    const hit = text => terms.every(term => text.toLowerCase().includes(term));
    if (!data.children) return hit(data.text) ? data : null;
    const children = data.children.filter(child => hit(`${child.text} ${data.text}`));
    return children.length ? { ...data, children } : null;
}

// select2 reports a choice with jQuery events only. SillyTavern's own selects listen
// through jQuery; nativeChange re-dispatches it for addEventListener listeners.
export function makeSearchable(select, { placeholder = 'Search', nativeChange = false } = {}) {
    const $ = select2();
    if (!$ || !select || isSearchable(select)) return;
    $(select).select2({ width: '100%', matcher: matchTerms, searchInputPlaceholder: placeholder, searchInputCssClass: 'text_pole' });
    // A native event also reaches jQuery handlers; originalEvent marks it as ours.
    if (nativeChange) $(select).on('change.canary', event => { if (!event.originalEvent) select.dispatchEvent(new Event('change', { bubbles: true })); });
}

// Show a value set in code.
export function refreshSearchable(select) {
    if (isSearchable(select)) select2()?.(select).trigger('change.select2');
}

export function removeSearchable(select) {
    const $ = select2();
    if (!$ || !isSearchable(select)) return;
    $(select).off('change.canary').select2('destroy');
}

// Make SillyTavern's voice map dropdowns searchable. ST rebuilds them on chat
// changes and voice refreshes, so enhance each new dropdown as it appears.
// Returns a function that stops watching and restores the plain dropdowns,
// or null while ST has not built the voice map yet.
export function searchVoiceMap() {
    const block = document.getElementById('tts_voicemap_block');
    if (!block) return null;
    const enhance = () => block.querySelectorAll('select').forEach(select => makeSearchable(select, { placeholder: 'Search voices' }));
    const observer = new MutationObserver(enhance);
    observer.observe(block, { childList: true, subtree: true });
    enhance();
    return () => {
        observer.disconnect();
        block.querySelectorAll('select').forEach(removeSearchable);
    };
}
