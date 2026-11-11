import { UNITS, network, observation, readBattle } from "./roster-policy-a6a81447.js";

const status = document.querySelector("#status");
const selectedUnit = document.querySelector("#selected-unit");
const player = window.RufflePlayer.newest().createPlayer();
document.querySelector("#game").append(player);
const api = player.ruffle();
const READY = "AI opponent is ready. Start a 2 Player Battle.";

function update(element, message) {
    if (element.textContent !== message) element.textContent = message;
}

async function start() {
    const response = await fetch("./roster-agent-374ef3a3.bin");
    if (!response.ok) throw new Error("Could not load the AI opponent");
    const choose = network(await response.arrayBuffer());
    await api.load({ url: "warlords-roster-e1f4a4d8.swf", autoplay: "on", unmuteOverlay: "hidden", allowScriptAccess: true });
    update(status, READY);
    let match = 0;
    let previousDecision = -1;
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
            previousDecision = -1;
        }
        const [, selected] = battle.controllers[0];
        update(selectedUnit, UNITS[selected] || "");
        if (battle.winner !== "undefined") {
            update(status, battle.winner === "left" ? "You won." : "The AI won.");
            return;
        }
        update(status, "You are blue. The AI plays red.");
        const [, , , kills, pending] = battle.controllers[1];
        const decision = Math.floor(battle.tick / 8);
        if (decision === previousDecision || !Number.isFinite(battle.bar)) return;
        previousDecision = decision;
        if (pending) return;
        const action = choose(observation(battle, 1), kills >= 20);
        if (action) api.callExternalInterface("duelOrder", 1, action);
    }
    setInterval(drive, 20);
}

start().catch(error => {
    update(status, error.message);
    console.error(error);
});
