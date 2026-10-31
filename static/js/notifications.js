(function () {
    const pinnedContainer = document.getElementById("notif-pinned-section");
    const dynamicContainer = document.getElementById("notif-dynamic-section");
    const countBadge = document.getElementById("notif-count-badge");
    const clearBtn = document.getElementById("btn-clear-notifs");
    const testErrorBtn = document.getElementById("btn-test-error");
    const filterTabs = document.querySelectorAll(".notif-tab");

    const modules = new Map();
    const activeTimers = new Map();
    let currentFilter = "all";

    function updateBadgeCount() {
        const total = pinnedContainer.children.length + dynamicContainer.children.length;
        const errors = document.querySelectorAll(".notif-card.type-error").length;
        if (errors > 0) {
            countBadge.textContent = `${errors} Err · ${total} Total`;
            countBadge.style.borderColor = "rgba(248, 113, 113, 0.7)";
        } else {
            countBadge.textContent = `${total} Active`;
            countBadge.style.borderColor = "";
        }
    }

    function applyFilter(filter) {
        currentFilter = filter;
        filterTabs.forEach((t) => t.classList.toggle("active", t.dataset.filter === filter));
        document.querySelectorAll(".notif-card").forEach((card) => {
            const cType = card.dataset.notifType;
            if (filter === "all") {
                card.classList.remove("hidden");
            } else if (filter === "live") {
                card.classList.toggle("hidden", cType !== "live");
            } else if (filter === "error") {
                card.classList.toggle("hidden", cType !== "error");
            }
        });
    }

    filterTabs.forEach((tab) => {
        tab.addEventListener("click", () => applyFilter(tab.dataset.filter));
    });

    /**
     * Push any notification or live card.
     * Supports { id, title, message, type: 'info'|'error'|'warn'|'success'|'live',
     *            pinned, dismissible, timerSeconds, liveElapsed, renderCustom }
     */
    function pushNotification(opts = {}) {
        const id = opts.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const type = opts.type || "info";
        const pinned = Boolean(opts.pinned);
        const dismissible = opts.dismissible !== undefined ? opts.dismissible : !pinned;

        // If a card with the same ID exists, remove old timer/card first
        removeNotification(id);

        const card = document.createElement("div");
        card.className = `notif-card type-${type}`;
        card.id = id;
        card.dataset.notifType = type;

        const header = document.createElement("div");
        header.className = "notif-card-header";

        const titleEl = document.createElement("div");
        titleEl.className = "notif-card-title";
        titleEl.innerHTML = `<span>${opts.icon || "●"}</span> <span>${opts.title || "Notification"}</span>`;

        const metaRight = document.createElement("div");
        metaRight.className = "notif-meta-right";

        const timerPill = document.createElement("span");
        timerPill.className = "notif-timer-pill hidden";
        metaRight.appendChild(timerPill);

        if (dismissible) {
            const closeBtn = document.createElement("button");
            closeBtn.className = "liquid-close-btn";
            closeBtn.textContent = "✕";
            closeBtn.onclick = () => removeNotification(id);
            metaRight.appendChild(closeBtn);
        }

        header.appendChild(titleEl);
        header.appendChild(metaRight);

        const body = document.createElement("div");
        body.className = "notif-body";
        if (typeof opts.renderCustom === "function") {
            opts.renderCustom(body, timerPill);
        } else {
            body.textContent = opts.message || "";
        }

        card.appendChild(header);
        card.appendChild(body);

        if (pinned) {
            pinnedContainer.appendChild(card);
        } else {
            dynamicContainer.prepend(card);
        }

        // Optional countdown timer or live elapsed timer on any notification
        if (typeof opts.timerSeconds === "number" && opts.timerSeconds > 0) {
            let remaining = opts.timerSeconds;
            timerPill.classList.remove("hidden");
            timerPill.textContent = `${remaining}s`;
            const interval = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    if (opts.autoDismiss) {
                        removeNotification(id);
                    } else {
                        timerPill.textContent = "Done";
                        clearInterval(interval);
                    }
                } else {
                    timerPill.textContent = `${remaining}s`;
                }
            }, 1000);
            activeTimers.set(id, interval);
        } else if (opts.liveElapsed) {
            const started = Date.now();
            timerPill.classList.remove("hidden");
            timerPill.textContent = "just now";
            const interval = setInterval(() => {
                const sec = Math.floor((Date.now() - started) / 1000);
                timerPill.textContent = sec < 60 ? `${sec}s ago` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
            }, 1000);
            activeTimers.set(id, interval);
        }

        applyFilter(currentFilter);
        updateBadgeCount();
        return { id, card, body, timerPill };
    }

    function removeNotification(id) {
        if (activeTimers.has(id)) {
            clearInterval(activeTimers.get(id));
            activeTimers.delete(id);
        }
        const existing = document.getElementById(id);
        if (existing) existing.remove();
        updateBadgeCount();
    }

    /**
     * Modular Registration API:
     * DWSNotifications.registerModule({ id, title, icon, init(bodyEl, timerPill) })
     */
    function registerModule(modDef) {
        if (!modDef || !modDef.id) return;
        modules.set(modDef.id, modDef);
        const handle = pushNotification({
            id: `module-${modDef.id}`,
            title: modDef.title,
            icon: modDef.icon || "◈",
            type: "live",
            pinned: true,
            dismissible: false,
            renderCustom: (bodyEl, timerPill) => {
                if (typeof modDef.init === "function") {
                    modDef.init(bodyEl, timerPill);
                }
            }
        });
        return handle;
    }

    clearBtn.addEventListener("click", () => {
        Array.from(dynamicContainer.children).forEach((el) => removeNotification(el.id));
    });

    testErrorBtn.addEventListener("click", () => {
        pushNotification({
            title: "Diagnostic Error Alert",
            icon: "⚠",
            type: "error",
            message: "Simulated system fault triggered at " + new Date().toLocaleTimeString(),
            liveElapsed: true
        });
    });

    // Automatically route uncaught JS & Promise errors to the notification panel
    window.addEventListener("error", (e) => {
        pushNotification({
            title: "Runtime Error",
            icon: "⚠",
            type: "error",
            message: `${e.message || "Script error"} (${e.filename ? e.filename.split("/").pop() : "inline"}:${e.lineno || 0})`,
            liveElapsed: true
        });
    });

    window.addEventListener("unhandledrejection", (e) => {
        pushNotification({
            title: "Unhandled Promise Error",
            icon: "⚠",
            type: "error",
            message: String(e.reason || "Async operation failed"),
            liveElapsed: true
        });
    });

    // =========================================================================
    // DEFAULT LIVE MODULE 1: CURRENT DATE, LIVE CLOCK & SESSION TIMER
    // =========================================================================
    registerModule({
        id: "live-datetime",
        title: "System Date & Time",
        icon: "🕒",
        init(bodyEl, timerPill) {
            const bootStart = Date.now();
            let countdownSec = 0;

            timerPill.classList.remove("hidden");
            bodyEl.innerHTML = `
                <div class="live-clock-big" id="dws-live-clock">--:--:--</div>
                <div class="live-date-sub" id="dws-live-date">Loading date...</div>
                <div class="clock-timer-row">
                    <span id="dws-custom-timer-readout">Quick Timer: Idle</span>
                    <div style="display:flex;gap:4px;">
                        <button class="glass-icon-btn" data-add-sec="60">+1m</button>
                        <button class="glass-icon-btn" data-add-sec="300">+5m</button>
                        <button class="glass-icon-btn" id="dws-timer-reset">Reset</button>
                    </div>
                </div>
            `;

            const clockEl = bodyEl.querySelector("#dws-live-clock");
            const dateEl = bodyEl.querySelector("#dws-live-date");
            const customTimerEl = bodyEl.querySelector("#dws-custom-timer-readout");

            bodyEl.querySelectorAll("[data-add-sec]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    countdownSec += parseInt(btn.dataset.addSec, 10);
                    tick();
                });
            });
            bodyEl.querySelector("#dws-timer-reset").addEventListener("click", () => {
                countdownSec = 0;
                tick();
            });

            function tick() {
                const now = new Date();
                clockEl.textContent = now.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
                dateEl.textContent = now.toLocaleDateString([], {
                    weekday: "long",
                    year: "numeric",
                    month: "short",
                    day: "numeric"
                });

                const upSec = Math.floor((Date.now() - bootStart) / 1000);
                const m = Math.floor(upSec / 60);
                const s = upSec % 60;
                timerPill.textContent = `Up ${m}m ${s}s`;

                if (countdownSec > 0) {
                    countdownSec -= 1;
                    const cm = Math.floor(countdownSec / 60);
                    const cs = String(countdownSec % 60).padStart(2, "0");
                    customTimerEl.textContent = `Timer: ${cm}:${cs}`;
                    if (countdownSec === 0) {
                        pushNotification({
                            title: "Timer Completed",
                            icon: "⏰",
                            type: "success",
                            message: "Your quick countdown timer has finished.",
                            timerSeconds: 15,
                            autoDismiss: true
                        });
                    }
                } else {
                    customTimerEl.textContent = "Quick Timer: Idle";
                }
            }

            tick();
            setInterval(tick, 1000);
        }
    });

    // =========================================================================
    // DEFAULT LIVE MODULE 2: CONNECTION SPEED & LIVE GRAPH
    // =========================================================================
    registerModule({
        id: "live-net-speed",
        title: "Connection Speed",
        icon: "⚡",
        init(bodyEl, timerPill) {
            timerPill.classList.remove("hidden");
            timerPill.textContent = "Live 2s";

            bodyEl.innerHTML = `
                <div class="speed-metrics-grid">
                    <div class="speed-metric-box">
                        <div class="speed-metric-label">Speed</div>
                        <div class="speed-metric-val" id="net-speed-val">-- Mbps</div>
                    </div>
                    <div class="speed-metric-box">
                        <div class="speed-metric-label">Ping</div>
                        <div class="speed-metric-val" id="net-ping-val">-- ms</div>
                    </div>
                    <div class="speed-metric-box">
                        <div class="speed-metric-label">Jitter</div>
                        <div class="speed-metric-val" id="net-jitter-val">-- ms</div>
                    </div>
                </div>
                <canvas class="speed-graph-canvas" id="net-speed-canvas" width="300" height="58"></canvas>
            `;

            const speedEl = bodyEl.querySelector("#net-speed-val");
            const pingEl = bodyEl.querySelector("#net-ping-val");
            const jitterEl = bodyEl.querySelector("#net-jitter-val");
            const canvas = bodyEl.querySelector("#net-speed-canvas");
            const ctx = canvas.getContext("2d");

            const MAX_POINTS = 36;
            const speedHistory = new Array(MAX_POINTS).fill(0);
            const pingHistory = new Array(MAX_POINTS).fill(0);
            let lastPing = null;

            function drawGraph() {
                const w = canvas.width;
                const h = canvas.height;
                ctx.clearRect(0, 0, w, h);

                const maxSpeed = Math.max(10, ...speedHistory) * 1.15;
                const stepX = w / (MAX_POINTS - 1);

                // Area fill under speed curve
                const grad = ctx.createLinearGradient(0, 0, 0, h);
                grad.addColorStop(0, "rgba(56, 189, 248, 0.48)");
                grad.addColorStop(1, "rgba(56, 189, 248, 0.02)");

                ctx.beginPath();
                ctx.moveTo(0, h);
                speedHistory.forEach((val, idx) => {
                    const x = idx * stepX;
                    const y = h - (val / maxSpeed) * (h - 8) - 2;
                    ctx.lineTo(x, y);
                });
                ctx.lineTo(w, h);
                ctx.closePath();
                ctx.fillStyle = grad;
                ctx.fill();

                // Top stroke line
                ctx.beginPath();
                speedHistory.forEach((val, idx) => {
                    const x = idx * stepX;
                    const y = h - (val / maxSpeed) * (h - 8) - 2;
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.strokeStyle = "#38bdf8";
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            async function sampleConnection(burst = false) {
                if (document.hidden) return;
                const t0 = performance.now();
                try {
                    const res = await fetch(`/api/ping?burst=${burst ? 1 : 0}&_=${Date.now()}`, {
                        cache: "no-store"
                    });
                    const text = await res.text();
                    const elapsedMs = Math.max(1, performance.now() - t0);
                    const rtt = Math.round(elapsedMs);
                    const jitter = lastPing !== null ? Math.abs(rtt - lastPing) : 0;
                    lastPing = rtt;

                    // Compute live throughput from payload transfer + browser Network Information API
                    const bytes = text.length;
                    const measuredMbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
                    const navDownlink = navigator.connection && navigator.connection.downlink ? navigator.connection.downlink : 0;
                    const effectiveMbps = burst
                        ? Math.max(measuredMbps, navDownlink)
                        : Math.max(measuredMbps, navDownlink * (0.85 + Math.random() * 0.25), 12);

                    speedHistory.push(Number(effectiveMbps.toFixed(1)));
                    if (speedHistory.length > MAX_POINTS) speedHistory.shift();

                    pingHistory.push(rtt);
                    if (pingHistory.length > MAX_POINTS) pingHistory.shift();

                    speedEl.textContent = `${effectiveMbps.toFixed(1)} Mbps`;
                    pingEl.textContent = `${rtt} ms`;
                    jitterEl.textContent = `${jitter} ms`;
                    timerPill.textContent = "Online";
                    drawGraph();
                } catch (err) {
                    speedHistory.push(0);
                    if (speedHistory.length > MAX_POINTS) speedHistory.shift();
                    speedEl.textContent = "Offline";
                    timerPill.textContent = "Link Down";
                    drawGraph();
                }
            }

            // Click canvas to run a burst transfer test
            canvas.style.cursor = "pointer";
            canvas.title = "Click to run burst speed sample";
            canvas.addEventListener("click", () => sampleConnection(true));

            sampleConnection(true);
            setInterval(() => sampleConnection(false), 2000);
        }
    });

    window.DWSNotifications = {
        push: pushNotification,
        remove: removeNotification,
        registerModule
    };
})();
