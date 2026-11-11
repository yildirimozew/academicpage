import { attentionNetwork } from "./attention-policy-c8f2313f.js";
import { UNITS, network, observation, readBattle } from "./roster-policy-a6a81447.js";

const status = document.querySelector("#status");
const selectedUnit = document.querySelector("#selected-unit");
const player = window.RufflePlayer.newest().createPlayer();
document.querySelector("#game").append(player);
const api = player.ruffle();
const READY = "AI opponent is ready. Start a 2 Player Battle.";
const humanMode = document.querySelector("#human-mode");
const watchMode = document.querySelector("#ai-mode");
let selectedMode = "human";
let activeMode = "human";

function update(element, message) {
    if (element.textContent !== message) element.textContent = message;
}

function legacyNetwork(buffer) {
    const choose = network(buffer);
    return (battle, side, canCharge) => choose(observation(battle, side), canCharge);
}

const championNetwork = attentionNetwork;

async function start() {
    const responses = await Promise.all([
        fetch("./roster-agent-9cf0755f.bin?v=9cf0755f"), fetch("./roster-challenger-bcec97c4.bin?v=bcec97c4"),
    ]);
    if (responses.some(response => !response.ok)) throw new Error("Could not load the AI opponents");
    const [championWeights, challengerWeights] = await Promise.all(
        responses.map(response => response.arrayBuffer()),
    );
    const champion = championNetwork(championWeights);
    const challenger = legacyNetwork(challengerWeights);
    await api.load({ url: "warlords-roster-dd0dc894.swf", autoplay: "on", unmuteOverlay: "hidden", allowScriptAccess: true });
    update(status, READY);
    let match = 0;
    let previousDecision = -1;
    function selectMode(mode) {
        selectedMode = mode;
        humanMode.setAttribute("aria-pressed", String(mode === "human"));
        watchMode.setAttribute("aria-pressed", String(mode === "watch"));
        update(status, mode === "human" ? READY : "AI vs AI selected. Start a 2 Player Battle.");
    }
    humanMode.addEventListener("click", () => selectMode("human"));
    watchMode.addEventListener("click", () => selectMode("watch"));
    function drive() {
        const battle = readBattle(api.callExternalInterface("duelState"));
        if (!battle) {
            update(status, READY);
            update(selectedUnit, "");
            match = 0;
            previousDecision = -1;
            return;
        }
        if (battle.match !== match) {
            match = battle.match;
            activeMode = selectedMode;
            previousDecision = -1;
        }
        const [, leftUnit] = battle.controllers[0];
        const [, rightUnit] = battle.controllers[1];
        update(selectedUnit, activeMode === "human" ? UNITS[leftUnit] || "" :
            `Blue champion: ${UNITS[leftUnit]} · Red challenger: ${UNITS[rightUnit]}`);
        if (battle.winner !== "undefined") {
            if (activeMode === "human") {
                update(status, battle.winner === "left" ? "You won." : "The AI won.");
            } else {
                update(status, battle.winner === "left" ? "The blue champion won." : "The red challenger won.");
            }
            return;
        }
        update(status, activeMode === "human" ? "You are blue. The AI plays red." :
            "AI vs AI: league champion (blue) against checkpoint 52 (red)." );
        const decision = Math.floor(battle.tick / 8);
        if (decision === previousDecision || !Number.isFinite(battle.bar)) return;
        previousDecision = decision;
        const sides = activeMode === "human" ? [1] : [0, 1];
        for (const side of sides) {
            const [, , , kills, pending] = battle.controllers[side];
            if (pending) continue;
            const choose = side === 0 ? champion : activeMode === "human" ? champion : challenger;
            const action = choose(battle, side, kills >= 20);
            if (action) api.callExternalInterface("duelOrder", side, action);
        }
    }
    setInterval(drive, 20);
}

start().catch(error => {
    update(status, error.message);
    console.error(error);
});
