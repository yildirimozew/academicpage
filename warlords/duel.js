"use strict";

const status = document.querySelector("#status");
const player = window.RufflePlayer.newest().createPlayer();
document.querySelector("#game").append(player);
const api = player.ruffle();

function network(parameters) {
    const legacy = parameters.subarray(0, 22);
    let offset = 22;
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
    const first = layer(105, 96, true);
    const second = layer(96, 96, true);
    const actor = layer(96, 28, false);
    if (offset !== parameters.length) throw new Error("Invalid Agent B checkpoint");
    return (features, cooldowns, kills) => {
        if (cooldowns[0] > 0) return null;
        const logits = actor(second(first(features)));
        let best = logits[0] - 1.25;
        let choice = null;
        for (let lane = 0; lane < 8; lane++) {
            for (let kind = 0; kind < 3; kind++) {
                if (cooldowns[kind] > 0) continue;
                let prior = 0;
                for (let i = 0; i < 7; i++) prior += legacy[kind * 7 + i] * features[lane * 12 + i];
                const score = logits[1 + lane * 3 + kind] + 5 * prior;
                if (score > best) {
                    best = score;
                    choice = {lane: lane + 1, kind, charge: false};
                }
            }
        }
        if (kills >= 20) {
            for (let kind = 0; kind < 3; kind++) {
                const score = logits[25 + kind] + 5 * (legacy[21] + legacy[kind * 7]);
                if (cooldowns[kind] === 0 && score > best) {
                    best = score;
                    choice = {kind, charge: true};
                }
            }
        }
        return choice;
    };
}

function observation(units, tick, ours, theirs, kills, lane, selected, bar, cooldowns) {
    const state = new Float32Array(105);
    for (let index = 0; index < 8; index++) {
        state[12 * index] = 1;
        state[12 * index + 6] = index / 7;
        state[12 * index + 11] = Math.abs(index + 1 - lane) / 7;
    }
    state.set([tick / 7200, ours / 25, theirs / 25, Math.min(kills, 20) / 20,
        ...cooldowns.map(cooldown => cooldown / 70), selected / 2, (700 - bar) / 700], 96);
    for (const unit of units) {
        const [team, position, x, health, range] = unit.split(",").map(Number);
        const start = 12 * (position - 1);
        state[start + 1 + team] += 0.2;
        const progress = team === 0 ? 2850 - x : x;
        state[start + 3 + team] = Math.max(state[start + 3 + team], progress / 2850);
        state[start + 7 + team] += Math.max(health, 0) / 300;
        if (range === 1500) state[start + 9 + team] += 0.25;
    }
    return state;
}

async function start() {
    const response = await fetch("agent.bin");
    if (!response.ok) throw new Error("Could not load Agent B");
    const choose = network(new Float32Array(await response.arrayBuffer()));
    await api.load({url: "warlords-duel.swf", autoplay: "on", unmuteOverlay: "hidden", allowScriptAccess: true});
    status.textContent = "Agent B is ready. Start a 2 Player Battle.";
    let previous = -1;
    let pending = null;
    let moves = 0;
    function drive() {
        const row = api.callExternalInterface("duelState");
        if (!row || typeof row !== "string") {
            previous = -1;
            pending = null;
            moves = 0;
            status.textContent = "Agent B is ready. Start a 2 Player Battle.";
            return;
        }
        const [tickText, own, opposing, winner, chargedText, killsText, laneText, selectedText, barText, ...units] = row.split("|");
        const [tick, charged, kills, lane, selected, bar] = [tickText, chargedText, killsText, laneText, selectedText, barText].map(Number);
        if (winner !== "undefined") {
            status.textContent = winner === "left" ? "You won." : "Agent B won.";
            pending = null;
            return;
        }
        if (tick === previous) return;
        if (tick < previous) { pending = null; moves = 0; }
        previous = tick;
        status.textContent = `Agent B is playing the right side · ${moves} deployments`;
        const cooldowns = [50, 70, 70].map(recharge => Math.max(0, recharge - charged));
        if (!pending && tick % 8 === 0 && Number.isFinite(bar)) {
            pending = choose(observation(units, tick, Number(own), Number(opposing),
                kills, lane, selected, bar, cooldowns), cooldowns, kills);
        }
        if (!pending) return;
        if (selected !== pending.kind) {
            api.callExternalInterface("duelInput", "unit", pending.kind);
        } else if (!pending.charge && lane !== pending.lane) {
            api.callExternalInterface("duelInput", "lane", lane + Math.sign(pending.lane - lane));
        } else if (cooldowns[pending.kind] === 0) {
            if (api.callExternalInterface("duelInput", pending.charge ? "charge" : "deploy", 0)) {
                moves += pending.charge ? 8 : 1;
            }
            pending = null;
        }
    }
    setInterval(drive, 20);
}

start().catch(error => {
    status.textContent = error.message;
    console.error(error);
});
