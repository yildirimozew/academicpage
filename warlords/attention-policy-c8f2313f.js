import { CHARGE, LANES, LANE_FEATURES, ROSTER, observation } from "./roster-policy-a6a81447.js";

const HEADS = 4;
const TROOP_WIDTH = 32;
const LANE_WIDTH = 64;
const NEIGHBORS = 4;

function tensors(buffer) {
    const size = new DataView(buffer).getUint32(0, true);
    if (size % 4 !== 0 || size + 4 > buffer.byteLength) {
        throw new Error("Invalid attention checkpoint header");
    }
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
    const data = new Float32Array(buffer, 4 + size);
    return (name, length) => {
        const [offset, count] = header[name] || [];
        if (count !== length || !Number.isInteger(offset) || offset < 0 || offset + count > data.length) {
            throw new Error(`Invalid attention checkpoint tensor ${name}`);
        }
        return data.subarray(offset, offset + count);
    };
}

function add(a, b) {
    return a.map((value, index) => value + b[index]);
}

function silu(x) {
    return x / (1 + Math.exp(-x));
}

function gelu(x) {
    // Approximate erf in the exact GELU formula used by PyTorch.
    const z = Math.abs(x) * Math.SQRT1_2;
    const t = 1 / (1 + .3275911 * z);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
        - .284496736) * t + .254829592) * t) * Math.exp(-z * z);
    return .5 * x * (1 + Math.sign(x) * erf);
}

function attend(query, keys, values, first, end, bias = null) {
    const width = query.length / HEADS;
    const scale = 1 / Math.sqrt(width);
    const output = new Float32Array(query.length);
    const scores = new Float32Array(end - first);
    for (let head = 0; head < HEADS; head++) {
        const offset = head * width;
        let max = -Infinity;
        for (let i = first; i < end; i++) {
            let dot = 0;
            for (let j = offset; j < offset + width; j++) dot += query[j] * keys[i][j];
            const index = i - first;
            scores[index] = dot * scale + (bias === null ? 0 : bias[index][head]);
            max = Math.max(max, scores[index]);
        }
        let total = 0;
        for (let i = 0; i < scores.length; i++) {
            scores[i] = Math.exp(scores[i] - max);
            total += scores[i];
        }
        for (let j = offset; j < offset + width; j++) {
            let weighted = 0;
            for (let i = first; i < end; i++) weighted += values[i][j] * scores[i - first];
            output[j] = weighted / total;
        }
    }
    return output;
}

export function attentionInput(battle, team) {
    const lanes = Array.from({ length: LANES }, () => []);
    for (const [side, lane, kind, x, health] of battle.pieces) {
        if (kind === undefined) continue;
        lanes[lane - 1].push([kind, side, Math.fround(x), Math.fround(health)]);
    }
    for (let lane = 0; lane < LANES; lane++) {
        // The simulator uses world x, then team, kind and HP as tie breakers.
        lanes[lane].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0] || a[3] - b[3]);
        lanes[lane] = lanes[lane].map(([kind, side, x, hp]) => [
            kind, Number(side !== team), Math.fround((team === 0 ? x : Math.fround(2850 - x)) / 2850),
            Math.fround(hp / 300),
        ]);
    }
    return { features: observation(battle, team), lanes };
}

export function attentionLogits(buffer) {
    const tensor = tensors(buffer);
    function linear(name, inputs, outputs, bias = true, activation = null) {
        const weights = tensor(name + ".weight", inputs * outputs);
        const biases = bias ? tensor(name + ".bias", outputs) : null;
        return vector => {
            const result = new Float32Array(outputs);
            for (let row = 0; row < outputs; row++) {
                let sum = biases === null ? 0 : biases[row];
                const offset = row * inputs;
                for (let j = 0; j < inputs; j++) sum += weights[offset + j] * vector[j];
                result[row] = activation === null ? sum : activation(Math.fround(sum));
            }
            return result;
        };
    }

    function norm(name, width) {
        const gain = tensor(name + ".weight", width);
        const bias = tensor(name + ".bias", width);
        return vector => {
            let mean = 0;
            for (const value of vector) mean += value;
            mean /= width;
            let variance = 0;
            for (const value of vector) variance += (value - mean) ** 2;
            const scale = 1 / Math.sqrt(variance / width + 1e-5);
            return vector.map((value, index) => (value - mean) * scale * gain[index] + bias[index]);
        };
    }

    const kindEmbedding = tensor("kind.weight", ROSTER * 8);
    const troopHidden = linear("troop.0", 11, 32, true, silu);
    const troopOutput = linear("troop.2", 32, TROOP_WIDTH);
    const localNorm = norm("local.norm", TROOP_WIDTH);
    const localQkv = linear("local.qkv", TROOP_WIDTH, 3 * TROOP_WIDTH);
    const relationHidden = linear("local.relation.0", 3, 16, true, silu);
    const relationOutput = linear("local.relation.2", 16, HEADS);
    const localOutput = linear("local.output", TROOP_WIDTH, TROOP_WIDTH);
    const localFeedNorm = norm("local.feed_forward.0", TROOP_WIDTH);
    const localFeedHidden = linear("local.feed_forward.1", TROOP_WIDTH, 64, true, gelu);
    const localFeedOutput = linear("local.feed_forward.3", 64, TROOP_WIDTH);
    const laneHidden = linear("lane.0", 7, 64, true, silu);
    const laneOutput = linear("lane.2", 64, LANE_WIDTH);
    const lanePositions = tensor("lane_position", LANES * LANE_WIDTH);
    const poolQuery = linear("pool_query", LANE_WIDTH, LANE_WIDTH);
    const poolKv = linear("pool_kv", TROOP_WIDTH, 2 * LANE_WIDTH);
    const poolOutput = linear("pool_output", LANE_WIDTH, LANE_WIDTH, false);
    const globalToken = linear("global_token", 10, LANE_WIDTH);
    const compareNorm = norm("compare.norm1", LANE_WIDTH);
    const compareWeights = tensor("compare.self_attn.in_proj_weight", 3 * LANE_WIDTH ** 2);
    const compareBias = tensor("compare.self_attn.in_proj_bias", 3 * LANE_WIDTH);
    const compareOutput = linear("compare.self_attn.out_proj", LANE_WIDTH, LANE_WIDTH);
    const compareFeedNorm = norm("compare.norm2", LANE_WIDTH);
    const compareFeedHidden = linear("compare.linear1", LANE_WIDTH, 128, true, gelu);
    const compareFeedOutput = linear("compare.linear2", 128, LANE_WIDTH);
    const outputNorm = norm("norm", LANE_WIDTH);
    const deploy = linear("deploy", LANE_WIDTH, ROSTER);
    const waitCharge = linear("wait_charge", LANE_WIDTH, 1 + ROSTER);

    function compareQkv(vector) {
        // PyTorch stores the three self-attention projections in one matrix.
        const output = new Float32Array(compareBias);
        for (let row = 0; row < output.length; row++) {
            let sum = compareBias[row];
            for (let i = 0; i < LANE_WIDTH; i++) sum += compareWeights[row * LANE_WIDTH + i] * vector[i];
            output[row] = sum;
        }
        return output;
    }

    function laneEmbedding(features, records, lane) {
        const start = lane * LANE_FEATURES;
        const base = add(laneOutput(laneHidden(features.subarray(start, start + 7))),
            lanePositions.subarray(lane * LANE_WIDTH, (lane + 1) * LANE_WIDTH));
        if (!records.length) return base;
        const tokens = records.map(([kind, side, position, hp]) => {
            const input = new Float32Array(11);
            input.set(kindEmbedding.subarray(kind * 8, kind * 8 + 8));
            input.set([side, position, hp], 8);
            return troopOutput(troopHidden(input));
        });
        const projected = tokens.map(token => localQkv(localNorm(token)));
        const keys = projected.map(row => row.subarray(TROOP_WIDTH, 2 * TROOP_WIDTH));
        const values = projected.map(row => row.subarray(2 * TROOP_WIDTH));
        const pooled = tokens.map((token, i) => {
            const first = Math.max(0, i - NEIGHBORS);
            const end = Math.min(records.length, i + NEIGHBORS + 1);
            const bias = [];
            const [, side, position] = records[i];
            for (let j = first; j < end; j++) {
                const distance = Math.fround(records[j][2] - position);
                bias.push(relationOutput(relationHidden([distance, Math.abs(distance),
                    Number(side === records[j][1])])));
            }
            const query = projected[i].subarray(0, TROOP_WIDTH);
            const residual = add(token, localOutput(attend(query, keys, values, first, end, bias)));
            return poolKv(add(residual, localFeedOutput(localFeedHidden(localFeedNorm(residual)))));
        });
        const poolKeys = pooled.map(row => row.subarray(0, LANE_WIDTH));
        const poolValues = pooled.map(row => row.subarray(LANE_WIDTH));
        return add(base, poolOutput(attend(poolQuery(base), poolKeys, poolValues, 0, pooled.length)));
    }

    return ({ features, lanes }) => {
        const tokens = [globalToken(features.subarray(LANES * LANE_FEATURES))];
        for (let lane = 0; lane < LANES; lane++) tokens.push(laneEmbedding(features, lanes[lane], lane));
        const qkv = tokens.map(token => compareQkv(compareNorm(token)));
        const keys = qkv.map(row => row.subarray(LANE_WIDTH, 2 * LANE_WIDTH));
        const values = qkv.map(row => row.subarray(2 * LANE_WIDTH));
        const compared = tokens.map((token, i) => {
            const query = qkv[i].subarray(0, LANE_WIDTH);
            const residual = add(token, compareOutput(attend(query, keys, values, 0, tokens.length)));
            return outputNorm(add(residual, compareFeedOutput(compareFeedHidden(compareFeedNorm(residual)))));
        });
        const global = waitCharge(compared[0]);
        const logits = new Float32Array(CHARGE + ROSTER);
        logits[0] = global[0];
        for (let lane = 0; lane < LANES; lane++) logits.set(deploy(compared[lane + 1]), 1 + lane * ROSTER);
        logits.set(global.subarray(1), CHARGE);
        return logits;
    };
}

export function attentionNetwork(buffer) {
    const infer = attentionLogits(buffer);
    return (battle, team, canCharge) => {
        const logits = infer(attentionInput(battle, team));
        let best = 0;
        for (let action = 1; action < (canCharge ? logits.length : CHARGE); action++) {
            if (logits[action] > logits[best]) best = action;
        }
        return best;
    };
}
