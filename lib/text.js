// Each provider passes its own batching policy; this is not a claimed provider input limit.
export function splitText(text, limit) {
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
