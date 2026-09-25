/** A copy of `value` whose typed arrays are backed by shared memory, so that posting it to a worker shares them. */
export function shareDeep(value, seen = new Map()) {
    if (value === null || typeof value !== 'object')
        return value;
    if (seen.has(value))
        return seen.get(value);
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        const typed = value;
        if (typed.buffer instanceof SharedArrayBuffer)
            return value;
        const Kind = typed.constructor, copy = new Kind(new SharedArrayBuffer(typed.byteLength));
        copy.set(typed);
        seen.set(value, copy);
        return copy;
    }
    if (Array.isArray(value)) {
        const out = [];
        seen.set(value, out);
        for (const item of value)
            out.push(shareDeep(item, seen));
        return out;
    }
    const out = {};
    seen.set(value, out);
    for (const [key, item] of Object.entries(value))
        if (typeof item !== 'function')
            out[key] = shareDeep(item, seen);
    return out;
}
/** The items from `first` up to `end` in `parts` contiguous ranges of near-equal length, empty ones left out. */
export function splitRange(first, end, parts) {
    const out = [], n = end - first;
    for (let k = 0; k < parts; k++) {
        const a = first + Math.floor(n * k / parts), b = first + Math.floor(n * (k + 1) / parts);
        if (b > a)
            out.push([a, b]);
    }
    return out;
}
