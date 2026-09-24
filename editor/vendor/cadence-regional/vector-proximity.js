const distanceSquared = (a, b) => {
    const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
    const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
    return dx * dx + dy * dy;
};
/** Separate distant supported islands without letting small fragments bridge them. */
export function spatialIslands(cells, grid, gap) {
    const unseen = new Set(cells.filter(index => grid.cells[index].coherent)), anchors = [];
    for (const seed of cells) {
        if (!unseen.delete(seed))
            continue;
        const component = [seed];
        for (let cursor = 0; cursor < component.length; cursor++) {
            const index = component[cursor], x = index % grid.columns, y = Math.floor(index / grid.columns);
            for (let j = -1; j <= 1; j++)
                for (let i = -1; i <= 1; i++) {
                    if (x + i < 0 || x + i >= grid.columns || y + j < 0 || y + j >= grid.rows)
                        continue;
                    const next = (y + j) * grid.columns + x + i;
                    if (unseen.delete(next))
                        component.push(next);
                }
        }
        if (component.length >= 3)
            anchors.push(component);
    }
    if (anchors.length < 2)
        return [cells];
    const owners = new Int32Array(grid.cells.length).fill(-1), roots = anchors.map((_, index) => index);
    const root = (index) => {
        while (roots[index] !== index) {
            roots[index] = roots[roots[index]];
            index = roots[index];
        }
        return index;
    };
    for (const [id, component] of anchors.entries())
        for (const index of component)
            owners[index] = id;
    const range = Math.ceil(gap) + 1, limit = (gap * grid.cellSize) ** 2;
    for (const [id, component] of anchors.entries())
        for (const index of component) {
            const x = index % grid.columns, y = Math.floor(index / grid.columns);
            for (let j = Math.max(0, y - range); j <= Math.min(grid.rows - 1, y + range); j++) {
                for (let i = Math.max(0, x - range); i <= Math.min(grid.columns - 1, x + range); i++) {
                    const next = j * grid.columns + i, other = owners[next];
                    if (other <= id || root(id) === root(other) || distanceSquared(grid.cells[index], grid.cells[next]) > limit + 1e-9)
                        continue;
                    roots[root(other)] = root(id);
                }
            }
        }
    const merged = new Map();
    for (const [id, component] of anchors.entries()) {
        const key = root(id);
        if (!merged.has(key))
            merged.set(key, []);
        merged.get(key).push(...component);
    }
    if (merged.size < 2)
        return [cells];
    const first = (cells) => cells.reduce((lowest, index) => Math.min(lowest, index), Infinity);
    const islands = [...merged.values()].sort((a, b) => first(a) - first(b));
    const frozen = islands.map(island => [...island]);
    // Attach weak/tiny fragments to frozen support, never to another attachment.
    // This preserves candidates without a trail of noise joining distant actors.
    for (const index of cells) {
        if (owners[index] >= 0)
            continue;
        let best = 0, distance = Infinity;
        for (const [id, support] of frozen.entries())
            for (const anchor of support) {
                const candidate = distanceSquared(grid.cells[index], grid.cells[anchor]);
                if (candidate < distance) {
                    distance = candidate;
                    best = id;
                }
            }
        islands[best].push(index);
    }
    for (const island of islands)
        island.sort((a, b) => a - b);
    return islands.sort((a, b) => b.length - a.length || a[0] - b[0]);
}
