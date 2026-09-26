import { frameOffset } from "./pixel-drawings.js";
const NONE = 0, SCENERY = 1, LAYER = 2, UNDECIDED = 3, NO_VERDICT = UNDECIDED + 4 * UNDECIDED + 16 * 3;
// Changed pixels a transition needs, half the central luma gradient of a pixel that votes, the pixels across the
// motion's line read on each side of it, and how many times over with how many votes a side wins.
const LEAST = 8, TEXTURE = 12, BAND = 3, DECIDE = 2, SIDE_VOTES = 3;
// Atlas rows whose frames the transition pass holds world-aligned at once: about 410 MB on market-pan.
const BAND_ROWS = 128;
/** A frame's bilinear weights at a camera position: pixel columns `x + ix` and `x + ix + ex` (rows alike). */
function bilinear(gx, gy) {
    const ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
    return { ix, iy, ex: ax > 0 ? 1 : 0, ey: ay > 0 ? 1 : 0, w00: (1 - ax) * (1 - ay), w10: ax * (1 - ay), w01: (1 - ax) * ay, w11: ax * ay };
}
/**
 * The first pass of the vote over the atlas rows from `rows`' first up to its second (`VoteStretches`). Per point,
 * every stretch of `hold` frames within `tolerance` of its mean luma and `chromaTolerance` of its color, read as
 * `heldPlateRows` reads them, up to one per `hold` frames of the shot. The points that vote are those a silhouette
 * covers in some frame, grown by `near` (every point without `silhouettes`); the others take their first held
 * stretch unless it arrived. At each voting stretch's start (the pair before it) and end (the pair after it), unless
 * at the edge of the point's view, the shift that best explains the pixels changing near the point is the moving
 * layer's motion, and textured pixels on each side of the point tell which side moved: a start whose own side moved
 * arrived and an end whose own side moved left, both a layer's; a side held still says scenery. The split reading
 * judges the edges of the stretch's value chain, followed across `chain` frames of other values (an arm swinging
 * over a stopped body splits its value into stretches whose edges are the arm's); the sides reading judges the
 * stretch's own edges.
 */
export async function voteStretches(source, camera, atlas, rows, options = {}, silhouettes) {
    const hold = options.hold ?? 12, tolerance = options.tolerance ?? 8, slack = options.arrivalSlack ?? 2, chroma = options.chromaTolerance ?? 10, vote = options.vote || {};
    const R = vote.radius ?? 10, D = vote.search ?? 10, DY = vote.searchY ?? 2, changedBy = vote.changed ?? 12, support = vote.support ?? .4, match = vote.match ?? 8, chain = vote.chain ?? 6, near = vote.near ?? 4;
    const { width, height } = source, W = atlas.width, H = atlas.height, [v0, v1] = rows, base = v0 * W, size = W * (v1 - v0), count = camera.positions.length, slots = Math.max(1, Math.floor(count / hold));
    // Frame s over atlas rows lo up to hi, read at its exact camera position: each point by its index in the atlas.
    const each = async (s, lo, hi, take) => {
        const data = (await source.frame(s)).data, { dx, dy } = camera.positions[s], k = bilinear(atlas.x + dx, atlas.y + dy);
        const u0 = Math.max(0, -k.ix), u1 = Math.min(W - 1, width - 1 - k.ex - k.ix), va = Math.max(lo, 0, -k.iy), vb = Math.min(hi - 1, H - 1, height - 1 - k.ey - k.iy);
        for (let v = va; v <= vb; v++) {
            const row = ((v + k.iy) * width + k.ix) * 3, right = k.ex * 3, down = k.ey * width * 3;
            for (let u = u0; u <= u1; u++) {
                const q = row + u * 3, q10 = q + right, q01 = q + down, q11 = q01 + right;
                const b = k.w00 * data[q] + k.w10 * data[q10] + k.w01 * data[q01] + k.w11 * data[q11];
                const g = k.w00 * data[q + 1] + k.w10 * data[q10 + 1] + k.w01 * data[q01 + 1] + k.w11 * data[q11 + 1];
                const r = k.w00 * data[q + 2] + k.w10 * data[q10 + 2] + k.w01 * data[q01 + 2] + k.w11 * data[q11 + 2];
                const y = .0722 * b + .7152 * g + .2126 * r;
                take(v * W + u, y, b - y, r - y);
            }
        }
    };
    const n = new Uint8Array(size), sFrom = new Int16Array(size * slots), sTo = new Int16Array(size * slots), sY = new Float32Array(size * slots), sB = new Float32Array(size * slots), sR = new Float32Array(size * slots);
    const first = new Int16Array(size).fill(-1), last = new Int16Array(size).fill(-1);
    {
        const mean = new Float32Array(size), meanBlue = new Float32Array(size), meanRed = new Float32Array(size), length = new Uint16Array(size), start = new Int16Array(size), seen = new Int16Array(size).fill(-2);
        const close = (i) => {
            if (length[i] < hold || n[i] >= slots)
                return;
            const k = i * slots + n[i]++;
            sFrom[k] = start[i];
            sTo[k] = start[i] + length[i] - 1;
            sY[k] = mean[i];
            sB[k] = meanBlue[i];
            sR[k] = meanRed[i];
        };
        for (let s = 0; s < count; s++)
            await each(s, v0, v1, (at, y, b, r) => {
                const i = at - base;
                if (first[i] < 0)
                    first[i] = s;
                last[i] = s;
                const m = seen[i] === s - 1 ? length[i] : 0;
                seen[i] = s;
                if (m && Math.abs(y - mean[i]) <= tolerance && Math.abs(b - meanBlue[i]) <= chroma && Math.abs(r - meanRed[i]) <= chroma) {
                    mean[i] = (mean[i] * m + y) / (m + 1);
                    meanBlue[i] = (meanBlue[i] * m + b) / (m + 1);
                    meanRed[i] = (meanRed[i] * m + r) / (m + 1);
                    length[i] = Math.min(65535, m + 1);
                }
                else {
                    if (length[i])
                        close(i);
                    mean[i] = y;
                    meanBlue[i] = b;
                    meanRed[i] = r;
                    length[i] = 1;
                    start[i] = s;
                }
            });
        for (let i = 0; i < size; i++)
            if (length[i])
                close(i);
    }
    const arrival = (i, k) => sFrom[k] > first[i] + slack && sTo[k] === last[i];
    // The union of the silhouettes over `near` more rows each side, so that its growth by `near` is exact on the band.
    const voting = new Uint8Array(size);
    if (!silhouettes)
        voting.fill(1);
    else {
        const w0 = Math.max(0, v0 - near), w1 = Math.min(H, v1 + near), h = w1 - w0, grown = new Uint8Array(W * h);
        for (let s = 0; s < count; s++) {
            const packed = silhouettes.frames[s].packed, o = frameOffset(camera, atlas, s);
            for (let y = Math.max(0, w0 - o.y); y < Math.min(height, w1 - o.y); y++)
                for (let x = Math.max(0, -o.x); x < Math.min(width, W - o.x); x++) {
                    const p = y * width + x;
                    if ((packed[p >> 3] >> (7 - (p & 7))) & 1)
                        grown[(y + o.y - w0) * W + x + o.x] = 1;
                }
        }
        for (let step = 0; step < near; step++) {
            const was = grown.slice();
            for (let v = 0; v < h; v++)
                for (let u = 0; u < W; u++) {
                    const a = v * W + u;
                    if (!was[a] && ((u > 0 && was[a - 1]) || (u < W - 1 && was[a + 1]) || (v > 0 && was[a - W]) || (v < h - 1 && was[a + W])))
                        grown[a] = 1;
                }
        }
        voting.set(grown.subarray((v0 - w0) * W, (v1 - w0) * W));
    }
    const luma = new Float32Array(size).fill(-1), blue = new Float32Array(size), red = new Float32Array(size), held = new Uint8Array(size), at = new Uint32Array(size + 1);
    for (let i = 0; i < size; i++) {
        if (voting[i])
            held[i] = n[i];
        else if (n[i] && !arrival(i, i * slots)) {
            luma[i] = sY[i * slots];
            blue[i] = sB[i * slots];
            red[i] = sR[i * slots];
        }
        at[i + 1] = at[i] + held[i];
    }
    const N = at[size], stretches = {
        from: new Int16Array(N), to: new Int16Array(N), luma: new Float32Array(N), blue: new Float32Array(N), red: new Float32Array(N),
        startSplit: new Uint8Array(N), endSplit: new Uint8Array(N), startSides: new Uint8Array(N), endSides: new Uint8Array(N),
    };
    for (let i = 0; i < size; i++)
        for (let j = 0; j < held[i]; j++) {
            const k = i * slots + j, e = at[i] + j;
            stretches.from[e] = sFrom[k];
            stretches.to[e] = sTo[k];
            stretches.luma[e] = sY[k];
            stretches.blue[e] = sB[k];
            stretches.red[e] = sR[k];
        }
    // Per shift, the offsets behind and ahead of the point along it that vote, deduplicated as rounded.
    const lines = [];
    for (let dy = -DY; dy <= DY; dy++)
        for (let dx = -D; dx <= D; dx++) {
            if (!dx && !dy)
                continue;
            const len = Math.hypot(dx, dy), nx = dx / len, ny = dy / len, behind = [], ahead = [], seenB = new Set(), seenA = new Set();
            for (let k = 2; k <= R; k++)
                for (let w = -BAND; w <= BAND; w++) {
                    const px = Math.round(-k * nx - w * ny), py = Math.round(-k * ny + w * nx), qx = Math.round(k * nx - w * ny), qy = Math.round(k * ny + w * nx);
                    if (!seenB.has(px * 1000 + py)) {
                        seenB.add(px * 1000 + py);
                        behind.push([px, py]);
                    }
                    if (!seenA.has(qx * 1000 + qy)) {
                        seenA.add(qx * 1000 + qy);
                        ahead.push([qx, qy]);
                    }
                }
            lines[(dy + DY) * (2 * D + 1) + dx + D] = { behind, ahead };
        }
    // Each band of rows' frames world-aligned, luma only, padded by the reach of a judgment: -1 out of view. The
    // band's own rows keep their color too, rounded, for following a value by it.
    const M = R + D + 2, BW = W + 2 * M, changed = new Int32Array((2 * R + 1) ** 2);
    let L = new Float32Array(0), CB = new Int8Array(0), CR = new Int8Array(0);
    for (let b0 = v0; b0 < v1; b0 += BAND_ROWS) {
        const b1 = Math.min(v1, b0 + BAND_ROWS), plane = (b1 - b0 + 2 * M) * BW, own = W * (b1 - b0);
        // A band whose stretches all run from the start of their view to its end has no pair to judge.
        let work = false;
        for (let i = (b0 - v0) * W; i < (b1 - v0) * W && !work; i++)
            for (let k = i * slots; k < i * slots + held[i]; k++)
                if (sFrom[k] > first[i] + slack || sTo[k] < last[i]) {
                    work = true;
                    break;
                }
        if (!work)
            continue;
        if (L.length < plane * count)
            L = new Float32Array(plane * count);
        L.fill(-1);
        if (CB.length < own * count) {
            CB = new Int8Array(own * count);
            CR = new Int8Array(own * count);
        }
        for (let s = 0; s < count; s++)
            await each(s, b0 - M, b1 + M, (i, y, b, r) => {
                const u = i % W, v = (i - u) / W;
                L[s * plane + (v - b0 + M) * BW + u + M] = y;
                if (v >= b0 && v < b1) {
                    const j = s * own + (v - b0) * W + u;
                    CB[j] = Math.max(-128, Math.min(127, Math.round(b)));
                    CR[j] = Math.max(-128, Math.min(127, Math.round(r)));
                }
            });
        const textured = (c) => {
            const l = L[c - 1], r = L[c + 1], t = L[c - BW], b = L[c + BW];
            return l >= 0 && r >= 0 && t >= 0 && b >= 0 && Math.hypot(r - l, b - t) / 2 >= TEXTURE;
        };
        // The pair (s, s + 1) at the point whose padded index is c, as the split reading's start vote, plus 4 times its
        // end vote, plus 16 times the sides reading (1 the point's side revealed, 2 it arrived, 3 undecided).
        const judge = (c, s) => {
            const A = s * plane + c, B = A + plane;
            if (L[A] < 0 || L[B] < 0)
                return NO_VERDICT;
            let many = 0;
            for (let y = -R; y <= R; y++)
                for (let x = -R; x <= R; x++) {
                    const o = y * BW + x, p = L[A + o], q = L[B + o];
                    if (p >= 0 && q >= 0 && Math.abs(p - q) > changedBy)
                        changed[many++] = o;
                }
            if (many < LEAST)
                return NO_VERDICT;
            let best = -1, bx = 0, by = 0;
            for (let dy = -DY; dy <= DY; dy++)
                for (let dx = -D; dx <= D; dx++) {
                    if (!dx && !dy)
                        continue;
                    const shift = dy * BW + dx;
                    let score = 0;
                    for (let m = 0; m < many; m++) {
                        const o = changed[m], old = L[A + o - shift];
                        if (old >= 0 && Math.abs(L[B + o] - old) <= match)
                            score++;
                    }
                    if (score > best || (score === best && Math.abs(dx) + Math.abs(dy) < Math.abs(bx) + Math.abs(by))) {
                        best = score;
                        bx = dx;
                        by = dy;
                    }
                }
            if (best < support * many)
                return NO_VERDICT;
            // A textured pixel behind the motion held still when the frame after has it where it was, and moved when it
            // has what the shift brings there, which changed where it came from; ahead alike, the other way. Read side
            // by side, a pixel counts only when it did one and not the other; read together, held still wins.
            const shift = by * BW + bx, { behind, ahead } = lines[(by + DY) * (2 * D + 1) + bx + D];
            let bs = 0, bm = 0, as = 0, am = 0, bothBs = 0, bothBm = 0, bothAs = 0, bothAm = 0;
            for (const [px, py] of behind) {
                const o = py * BW + px;
                if (!textured(B + o))
                    continue;
                const now = L[B + o], before = L[A + o], from = L[A + o - shift];
                const still = before >= 0 && Math.abs(now - before) <= match;
                const moved = from >= 0 && Math.abs(now - from) <= match && L[B + o - shift] >= 0 && Math.abs(L[B + o - shift] - from) > match;
                if (still && !moved)
                    bs++;
                else if (moved && !still)
                    bm++;
                if (still)
                    bothBs++;
                else if (moved)
                    bothBm++;
            }
            for (const [qx, qy] of ahead) {
                const o = qy * BW + qx;
                if (!textured(A + o))
                    continue;
                const then = L[A + o], after = L[B + o], to = L[B + o + shift];
                const still = after >= 0 && Math.abs(then - after) <= match;
                const moved = to >= 0 && Math.abs(then - to) <= match && L[A + o + shift] >= 0 && Math.abs(L[A + o + shift] - to) > match;
                if (still && !moved)
                    as++;
                else if (moved && !still)
                    am++;
                if (still)
                    bothAs++;
                else if (moved)
                    bothAm++;
            }
            const side = (still, moved) => moved >= SIDE_VOTES && moved >= DECIDE * still ? LAYER : still >= SIDE_VOTES && still >= DECIDE * moved ? SCENERY : NONE;
            const fresh = side(bs, bm), old = side(as, am);
            const start = fresh === LAYER ? LAYER : fresh === SCENERY && old !== SCENERY ? SCENERY : UNDECIDED, end = old === LAYER ? LAYER : old === SCENERY && fresh !== SCENERY ? SCENERY : UNDECIDED;
            const reveal = bothBs + bothAm, arrived = bothBm + bothAs, sides = reveal >= SIDE_VOTES && reveal >= DECIDE * arrived ? 1 : arrived >= SIDE_VOTES && arrived >= DECIDE * reveal ? 2 : 3;
            return start + 4 * end + 16 * sides;
        };
        for (let v = b0; v < b1; v++)
            for (let u = 0; u < W; u++) {
                const i = (v - v0) * W + u;
                if (!held[i])
                    continue;
                const c = (v - b0 + M) * BW + u + M, done = new Map(), pair = (s) => { let x = done.get(s); if (x === undefined) {
                    x = judge(c, s);
                    done.set(s, x);
                } return x; };
                const own0 = (v - b0) * W + u;
                for (let j = 0; j < held[i]; j++) {
                    const k = i * slots + j, e = at[i] + j, y = sY[k], cb = sB[k], cr = sR[k];
                    const alike = (s) => { const l = L[s * plane + c], q = s * own + own0; return l >= 0 && Math.abs(l - y) <= tolerance && Math.abs(CB[q] - cb) <= chroma && Math.abs(CR[q] - cr) <= chroma; };
                    let begin = sFrom[k], end = sTo[k];
                    // A frame joins the chain when it and a neighbour on the chain's side hold the stretch's value.
                    if (chain) {
                        for (let s = sFrom[k] - 1, gap = 0; s >= first[i]; s--)
                            if (alike(s) && (s + 1 === begin || alike(s + 1))) {
                                begin = s;
                                gap = 0;
                            }
                            else if (++gap > chain)
                                break;
                        for (let s = sTo[k] + 1, gap = 0; s <= last[i]; s++)
                            if (alike(s) && (s - 1 === end || alike(s - 1))) {
                                end = s;
                                gap = 0;
                            }
                            else if (++gap > chain)
                                break;
                    }
                    stretches.startSplit[e] = begin <= first[i] + slack ? NONE : pair(begin - 1) & 3;
                    stretches.endSplit[e] = end >= last[i] ? NONE : (pair(end) >> 2) & 3;
                    // Read over both sides, a start whose side revealed says scenery, an end whose side revealed says layer.
                    stretches.startSides[e] = sFrom[k] <= first[i] + slack ? NONE : pair(sFrom[k] - 1) >> 4;
                    const endSides = sTo[k] >= last[i] ? NONE : pair(sTo[k]) >> 4;
                    stretches.endSides[e] = endSides === 1 ? LAYER : endSides === 2 ? SCENERY : endSides;
                }
            }
    }
    return { first, last, luma, blue, red, held, stretches };
}
/**
 * The second pass of the vote, over the whole atlas: the regions, what each stretch is, and the plate. Stretches
 * of 4-adjacent voting points starting and ending within `link` frames, with means within `tolerance` luma and
 * `chromaTolerance` color, join a region, and so do they on timing alone in a coarser one that decides a
 * stretch its own region leaves undecided. A region with `minVotes` split votes or more is decided: a layer
 * when `layer` of them say so and `layerSides` of its sides votes do, else scenery. A stretch no region decides
 * is a layer when its own split votes say layer at least as often as scenery, and some. The plate is the first
 * stretch that is no layer's and whose region is scenery revealed (`minVotes` split starts, under `layer` of them
 * arrivals), failing that the longest that is no layer's. A stretch that arrived and stayed to the end is allowed
 * only when its value also showed earlier at the point, its own start was revealed, or its region is scenery with
 * at most `arrivalShare` of its votes, either reading, saying layer. `bands` are `voteStretches`' results for
 * consecutive bands of rows covering the atlas, in order.
 */
export function voteRegions(atlas, bands, options = {}) {
    const tolerance = options.tolerance ?? 8, slack = options.arrivalSlack ?? 2, chroma = options.chromaTolerance ?? 10, vote = options.vote || {};
    const link = vote.link ?? 3, layerShare = vote.layer ?? .17, layerSides = vote.layerSides ?? .125, minVotes = Math.max(1, vote.minVotes ?? 5), arrivalShare = vote.arrivalShare ?? .02;
    const join = (list) => {
        const out = new list[0].constructor(list.reduce((n, a) => n + a.length, 0));
        let offset = 0;
        for (const a of list) {
            out.set(a, offset);
            offset += a.length;
        }
        return out;
    };
    const luma = join(bands.map(b => b.luma)), blue = join(bands.map(b => b.blue)), red = join(bands.map(b => b.red)), first = join(bands.map(b => b.first)), last = join(bands.map(b => b.last)), held = join(bands.map(b => b.held));
    const from = join(bands.map(b => b.stretches.from)), to = join(bands.map(b => b.stretches.to)), Y = join(bands.map(b => b.stretches.luma)), CB = join(bands.map(b => b.stretches.blue)), CR = join(bands.map(b => b.stretches.red));
    const startSplit = join(bands.map(b => b.stretches.startSplit)), endSplit = join(bands.map(b => b.stretches.endSplit)), startSides = join(bands.map(b => b.stretches.startSides)), endSides = join(bands.map(b => b.stretches.endSides));
    const W = atlas.width, size = held.length, start = new Uint32Array(size + 1);
    for (let a = 0; a < size; a++)
        start[a + 1] = start[a] + held[a];
    const N = start[size];
    const unite = (byValue) => {
        const parent = new Int32Array(N);
        for (let e = 0; e < N; e++)
            parent[e] = e;
        const find = (e) => { while (parent[e] !== e) {
            parent[e] = parent[parent[e]];
            e = parent[e];
        } return e; };
        for (let a = 0; a < size; a++) {
            if (!held[a])
                continue;
            for (const b of [a % W + 1 < W ? a + 1 : -1, a + W < size ? a + W : -1]) {
                if (b < 0 || !held[b])
                    continue;
                for (let i = start[a]; i < start[a + 1]; i++)
                    for (let j = start[b]; j < start[b + 1]; j++) {
                        if (Math.abs(from[i] - from[j]) > link || Math.abs(to[i] - to[j]) > link)
                            continue;
                        if (byValue && (Math.abs(Y[i] - Y[j]) > tolerance || Math.abs(CB[i] - CB[j]) > chroma || Math.abs(CR[i] - CR[j]) > chroma))
                            continue;
                        const x = find(i), y = find(j);
                        if (x !== y)
                            parent[x] = y;
                    }
            }
        }
        const root = new Int32Array(N);
        for (let e = 0; e < N; e++)
            root[e] = find(e);
        return root;
    };
    // Fine regions' roots are stretch ids, the coarse ones' N more.
    const fine = unite(true), coarse = unite(false);
    const startLayer = new Int32Array(2 * N), startScenery = new Int32Array(2 * N), endLayer = new Int32Array(2 * N), endScenery = new Int32Array(2 * N), sidesLayer = new Int32Array(2 * N), sidesScenery = new Int32Array(2 * N);
    for (let e = 0; e < N; e++)
        for (const r of [fine[e], N + coarse[e]]) {
            startLayer[r] += Number(startSplit[e] === LAYER);
            startScenery[r] += Number(startSplit[e] === SCENERY);
            endLayer[r] += Number(endSplit[e] === LAYER);
            endScenery[r] += Number(endSplit[e] === SCENERY);
            sidesLayer[r] += Number(startSides[e] === LAYER) + Number(endSides[e] === LAYER);
            sidesScenery[r] += Number(startSides[e] === SCENERY) + Number(endSides[e] === SCENERY);
        }
    // Per region, 0 undecided, SCENERY or LAYER.
    const state = new Uint8Array(2 * N);
    for (let r = 0; r < 2 * N; r++) {
        const layerVotes = startLayer[r] + endLayer[r], decided = layerVotes + startScenery[r] + endScenery[r];
        if (decided >= minVotes)
            state[r] = layerVotes >= layerShare * decided && sidesLayer[r] >= layerSides * (sidesLayer[r] + sidesScenery[r]) ? LAYER : SCENERY;
    }
    const region = new Int32Array(N), layer = new Uint8Array(N);
    for (let e = 0; e < N; e++) {
        region[e] = state[fine[e]] ? fine[e] : N + coarse[e];
        const s = state[region[e]];
        if (s) {
            layer[e] = Number(s === LAYER);
            continue;
        }
        const mine = Number(startSplit[e] === LAYER) + Number(endSplit[e] === LAYER), theirs = Number(startSplit[e] === SCENERY) + Number(endSplit[e] === SCENERY);
        layer[e] = Number(mine > 0 && mine >= theirs);
    }
    // A value the point holds again after other values is what stood there and came back, not a drawing that arrived and stopped.
    const back = new Uint8Array(N);
    for (let a = 0; a < size; a++)
        for (let i = start[a]; i < start[a + 1]; i++)
            for (let j = i + 1; j < start[a + 1]; j++) {
                if (from[j] <= to[i] + 1 || Math.abs(Y[i] - Y[j]) > tolerance || Math.abs(CB[i] - CB[j]) > chroma || Math.abs(CR[i] - CR[j]) > chroma)
                    continue;
                back[i] = 1;
                back[j] = 1;
            }
    const clear = (layerVotes, sceneryVotes) => layerVotes <= arrivalShare * (layerVotes + sceneryVotes);
    for (let a = 0; a < size; a++) {
        let pick = -1;
        for (let e = start[a]; e < start[a + 1]; e++) {
            if (layer[e])
                continue;
            const r = region[e];
            if (from[e] > first[a] + slack && to[e] === last[a] && !back[e]) {
                const scenery = state[r] === SCENERY && (clear(startLayer[r] + endLayer[r], startScenery[r] + endScenery[r]) || clear(sidesLayer[r], sidesScenery[r]));
                if (startSplit[e] !== SCENERY && !scenery)
                    continue;
            }
            const starts = startLayer[r] + startScenery[r];
            if (state[r] === SCENERY && starts >= minVotes && startLayer[r] < layerShare * starts) {
                pick = e;
                break;
            }
            if (pick < 0 || to[e] - from[e] > to[pick] - from[pick])
                pick = e;
        }
        if (pick >= 0) {
            luma[a] = Y[pick];
            blue[a] = CB[pick];
            red[a] = CR[pick];
        }
    }
    return { luma, blue, red, first, last, runs: { start, from, to, layer } };
}
