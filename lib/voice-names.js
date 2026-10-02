// ST stores a voice's `name` in the voice map, so names must be unique: a readable
// label plus the voice ID, e.g. "Expressive Narrator · English_expressive_narrator".
const LABEL_SEPARATOR = ' · ';
export function voiceName(id, label) {
    const text = typeof label === 'string' ? label.trim() : '';
    return text && text !== id ? `${text}${LABEL_SEPARATOR}${id}` : id;
}
// The voice ID in a stored voice map entry: a bare ID from earlier versions, or a label.
export function voiceIdOf(name) {
    const index = name.lastIndexOf(LABEL_SEPARATOR);
    return index === -1 ? name : name.slice(index + LABEL_SEPARATOR.length);
}
