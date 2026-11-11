export const UNITS = [
    "Spearman", "Swordsman", "Archer", "Mage", "Halberdier", "Mounted Halberdier",
    "Mounted Spearman", "Scout", "Longswordsman", "Axeman", "King's Guard",
];
export const LANES = 8;
export const ROSTER = UNITS.length;
export const LANE_FEATURES = 7 + 2 * ROSTER;
export const CHARGE = 1 + LANES * ROSTER;
const INPUTS = LANES * LANE_FEATURES + 10;
const ACTIONS = CHARGE + ROSTER;
const WIDTH = 128;

export function network(buffer) {
    const parameters = new Float32Array(buffer);
    let offset = 0;
    function layer(inputs, outputs, activated) {
        const weights = parameters.subarray(offset, offset + inputs * outputs);
        offset += weights.length;
        const biases = parameters.subarray(offset, offset + outputs);
        offset += biases.length;
        return input => {
            const result = new Float32Array(outputs);
            for (let row = 0; row < outputs; row++) {
                let sum = biases[row];
                for (let i = 0; i < inputs; i++) sum += weights[row * inputs + i] * input[i];
                result[row] = activated ? Math.tanh(sum) : sum;
            }
            return result;
        };
    }
    const first = layer(INPUTS, WIDTH, true);
    const second = layer(WIDTH, WIDTH, true);
    const actor = layer(WIDTH, ACTIONS, false);
    if (parameters.length !== WIDTH * (INPUTS + WIDTH + ACTIONS + 2) + ACTIONS) {
        throw new Error("Invalid full-roster checkpoint");
    }
    return (features, canCharge) => {
        const logits = actor(second(first(features)));
        let best = 0;
        for (let action = 1; action < (canCharge ? ACTIONS : CHARGE); action++) {
            if (logits[action] > logits[best]) best = action;
        }
        return best;
    };
}

export function readBattle(row) {
    if (typeof row !== "string" || !row) return null;
    const [match, tick, left, right, winner, bar, first, second, ...pieces] = row.split("|");
    const controllers = [first, second].map(field => field.split(",").map(Number));
    return {
        match: Number(match), tick: Number(tick), score: [Number(left), Number(right)], winner,
        bar: Number(bar), controllers, pieces: pieces.map(piece => piece.split(",").map(Number)),
    };
}

export function observation(battle, team) {
    const { tick, score, bar, controllers, pieces } = battle;
    const [lane, selected, charged, kills] = controllers[team];
    const [, opposingUnit, opposingRecharge, opposingKills] = controllers[1 - team];
    const state = new Float32Array(INPUTS);
    for (let i = 0; i < LANES; i++) state[i * LANE_FEATURES + 4] = Math.abs(lane - i - 1) / 7;
    for (const [side, position, kind, x, health] of pieces) {
        const relative = Number(side !== team);
        const start = (position - 1) * LANE_FEATURES;
        if (kind === undefined) {
            state[start + 5 + relative] += Math.fround(.2);
        } else {
            const progress = side === 0 ? x : 2850 - x;
            state[start + relative] = Math.max(state[start + relative], progress / 2850);
            state[start + 2 + relative] += Math.max(health, 0) / 300;
            state[start + 7 + relative * ROSTER + kind] += Math.fround(.2);
        }
    }
    state.set([
        tick / 7200, score[team] / 25, score[1 - team] / 25, (team === 0 ? bar : 700 - bar) / 700,
        Math.min(kills, 20) / 20, Math.min(opposingKills, 20) / 20,
        Math.min(charged, 180) / 180, Math.min(opposingRecharge, 180) / 180,
        selected / (ROSTER - 1), opposingUnit / (ROSTER - 1),
    ], LANES * LANE_FEATURES);
    return state;
}
