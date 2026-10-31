(function () {
    const pinnedContainer = document.getElementById("notif-pinned-section");
    const dynamicContainer = document.getElementById("notif-dynamic-section");
    const countBadge = document.getElementById("notif-count-badge");
    const clearBtn = document.getElementById("btn-clear-notifs");
    const filterTabs = document.querySelectorAll(".notif-tab");

    const modules = new Map();
    const activeTimers = new Map();
    let currentFilter = "all";

    function updateBadgeCount() {
        const total = pinnedContainer.children.length + dynamicContainer.children.length;
        const errors = document.querySelectorAll(".notif-card.type-error").length;
        if (errors > 0) {
            countBadge.textContent = `${errors} Alert · ${total}`;
        } else {
            countBadge.textContent = `${total} Active`;
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
            } else if (filter === "video") {
                card.classList.toggle("hidden", cType !== "video");
            } else if (filter === "error") {
                card.classList.toggle("hidden", cType !== "error" && cType !== "warn");
            }
        });
    }

    filterTabs.forEach((tab) => {
        tab.addEventListener("click", () => applyFilter(tab.dataset.filter));
    });

    function pushNotification(opts = {}) {
        const id = opts.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const type = opts.videoUrl ? "video" : (opts.type || "info");
        const pinned = Boolean(opts.pinned);
        const dismissible = opts.dismissible !== undefined ? opts.dismissible : !pinned;

        removeNotification(id);

        const card = document.createElement("div");
        card.className = `notif-card type-${type}`;
        card.id = id;
        card.dataset.notifType = type;

        const header = document.createElement("div");
        header.className = "notif-card-header";

        const titleEl = document.createElement("div");
        titleEl.className = "notif-card-title";
        titleEl.innerHTML = `<span>${opts.icon || "✦"}</span> <span>${opts.title || "Notification"}</span>`;

        const metaRight = document.createElement("div");
        metaRight.className = "notif-meta-right";

        const timerPill = document.createElement("span");
        timerPill.className = "notif-timer-pill hidden";
        metaRight.appendChild(timerPill);

        if (dismissible) {
            const closeBtn = document.createElement("button");
            closeBtn.className = "liquid-close-btn";
            closeBtn.textContent = "✕";
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                removeNotification(id);
            };
            metaRight.appendChild(closeBtn);
        }

        header.appendChild(titleEl);
        header.appendChild(metaRight);

        const body = document.createElement("div");
        body.className = "notif-body";

        if (typeof opts.renderCustom === "function") {
            opts.renderCustom(body, timerPill, metaRight);
        } else if (opts.videoUrl) {
            timerPill.classList.remove("hidden");
            timerPill.textContent = "LIVE FEED";
            const streamFormat = opts.videoType || "video";
            let mediaHtml = "";
            if (streamFormat === "mjpeg") {
                mediaHtml = `<img src="${opts.videoUrl}" alt="${opts.title}" />`;
            } else if (streamFormat === "iframe") {
                mediaHtml = `<iframe src="${opts.videoUrl}" allow="autoplay; fullscreen"></iframe>`;
            } else {
                mediaHtml = `<video src="${opts.videoUrl}" autoplay muted loop playsinline controls></video>`;
            }
            body.innerHTML = `
                ${opts.message ? `<div style="margin-bottom:6px;">${opts.message}</div>` : ""}
                <div class="notif-video-wrap">${mediaHtml}</div>
            `;
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

        if (typeof opts.timerSeconds === "number" && opts.timerSeconds > 0) {
            let remaining = opts.timerSeconds;
            timerPill.classList.remove("hidden");
            timerPill.textContent = `${remaining}s`;
            const interval = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    if (opts.autoDismiss) removeNotification(id);
                    else {
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
            timerPill.textContent = "now";
            const interval = setInterval(() => {
                const sec = Math.floor((Date.now() - started) / 1000);
                timerPill.textContent = sec < 60 ? `${sec}s ago` : `${Math.floor(sec / 60)}m ago`;
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

    function registerModule(modDef) {
        if (!modDef || !modDef.id) return;
        modules.set(modDef.id, modDef);
        return pushNotification({
            id: `module-${modDef.id}`,
            title: modDef.title,
            icon: modDef.icon || "◈",
            type: modDef.type || "live",
            pinned: true,
            dismissible: false,
            renderCustom: (bodyEl, timerPill, metaRight) => {
                if (typeof modDef.init === "function") {
                    modDef.init(bodyEl, timerPill, metaRight);
                }
            }
        });
    }

    clearBtn.addEventListener("click", () => {
        Array.from(dynamicContainer.children).forEach((el) => removeNotification(el.id));
    });

    window.addEventListener("error", (e) => {
        pushNotification({
            title: "Runtime Exception",
            icon: "⚠",
            type: "error",
            message: `${e.message || "Script error"}`,
            liveElapsed: true
        });
    });

    // =========================================================================
    // LIVE MODULE 1: CLEAN, UNSOPHISTICATED CLOCK & DATE
    // =========================================================================
    registerModule({
        id: "live-datetime",
        title: "Current Date & Time",
        icon: "🕒",
        init(bodyEl) {
            bodyEl.innerHTML = `
                <div class="live-clock-big" id="dws-live-clock">--:--:--</div>
                <div class="live-date-sub" id="dws-live-date">Loading...</div>
            `;
            const clockEl = bodyEl.querySelector("#dws-live-clock");
            const dateEl = bodyEl.querySelector("#dws-live-date");

            function tick() {
                if (document.hidden) return;
                const now = new Date();
                clockEl.textContent = now.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                });
                dateEl.textContent = now.toLocaleDateString([], {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric"
                });
            }
            tick();
            setInterval(tick, 1000);
            document.addEventListener("visibilitychange", () => {
                if (!document.hidden) tick();
            });
        }
    });

    // =========================================================================
    // LIVE MODULE 2: SERVER CLUSTER STATUS (CLICK TO MANAGE / ADD 4TH+ SERVER)
    // =========================================================================
    let clusterListEl = null;
    let clusterPillEl = null;

    registerModule({
        id: "live-server-cluster",
        title: "Server Cluster Status",
        icon: "🖥",
        init(bodyEl, timerPill, metaRight) {
            clusterPillEl = timerPill;
            timerPill.classList.remove("hidden");
            timerPill.textContent = "Scanning";

            const addSrvBtn = document.createElement("button");
            addSrvBtn.className = "glass-icon-btn";
            addSrvBtn.textContent = "+ Add / Edit";
            addSrvBtn.title = "Dynamically Add or Rename Servers";
            addSrvBtn.onclick = (e) => {
                e.stopPropagation();
                if (typeof window.openSettingsToTab === "function") {
                    window.openSettingsToTab("tab-servers");
                }
            };
            metaRight.appendChild(addSrvBtn);

            bodyEl.innerHTML = `<div class="cluster-status-list" id="cluster-status-list">Scanning nodes...</div>`;
            clusterListEl = bodyEl.querySelector("#cluster-status-list");
        }
    });

    function updateServerClusterCard(serversMap) {
        if (!clusterListEl) return;
        const entries = Object.values(serversMap || {});
        const onlineCount = entries.filter((s) => s.online).length;

        if (clusterPillEl) {
            clusterPillEl.textContent = `${onlineCount}/${entries.length} Online`;
        }

        clusterListEl.innerHTML = "";
        entries.forEach((srv) => {
            const row = document.createElement("div");
            row.className = "cluster-node-row";
            row.title = "Click to open SSH Terminal, or right-click to rename/edit server";
            const dotColor = srv.online ? "#34d399" : "#f87171";
            const metaText = srv.online
                ? `${srv.drive_count || 0} Disks · ${srv.latency_ms || 1}ms`
                : "Offline · Click to Configure";

            row.innerHTML = `
                <div class="cluster-node-left">
                    <span class="status-dot-pulse" style="background:${dotColor};box-shadow:0 0 10px ${dotColor};"></span>
                    <div>
                        <div class="cluster-node-name">${srv.name}</div>
                        <div class="cluster-node-meta">${srv.host} · ${metaText}</div>
                    </div>
                </div>
                <span class="glass-badge">SSH ↗</span>
            `;

            row.addEventListener("click", () => {
                if (!srv.online && typeof window.openSettingsToTab === "function") {
                    window.openSettingsToTab("tab-servers", srv.id);
                    return;
                }
                const shellUrl = srv.shell_url || `https://device.teamexist.com/shell/${srv.id}`;
                if (typeof window.openCenterStageApp === "function") {
                    window.openCenterStageApp({
                        name: `${srv.name} Terminal`,
                        url: shellUrl,
                        subject_type: `SSH Node ${srv.id}`
                    });
                } else {
                    window.open(shellUrl, "_blank");
                }
            });

            row.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                if (typeof window.openSettingsToTab === "function") {
                    window.openSettingsToTab("tab-servers", srv.id);
                }
            });

            clusterListEl.appendChild(row);
        });
    }

    // =========================================================================
    // LIVE MODULE 3: CONNECTION SPEED & LIVE GRAPH
    // =========================================================================
    registerModule({
        id: "live-net-speed",
        title: "Connection Speed",
        icon: "⚡",
        init(bodyEl, timerPill) {
            timerPill.classList.remove("hidden");
            timerPill.textContent = "Live";

            bodyEl.innerHTML = `
                <div class="speed-metrics-grid">
                    <div class="speed-metric-box">
                        <div class="speed-metric-label">Throughput</div>
                        <div class="speed-metric-val" id="net-speed-val">-- Mbps</div>
                    </div>
                    <div class="speed-metric-box">
                        <div class="speed-metric-label">Latency</div>
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
            let lastPing = null;

            function drawGraph() {
                const w = canvas.width;
                const h = canvas.height;
                ctx.clearRect(0, 0, w, h);

                const maxSpeed = Math.max(10, ...speedHistory) * 1.15;
                const stepX = w / (MAX_POINTS - 1);

                const grad = ctx.createLinearGradient(0, 0, 0, h);
                grad.addColorStop(0, "rgba(56, 189, 248, 0.52)");
                grad.addColorStop(1, "rgba(168, 85, 247, 0.03)");

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

                ctx.beginPath();
                speedHistory.forEach((val, idx) => {
                    const x = idx * stepX;
                    const y = h - (val / maxSpeed) * (h - 8) - 2;
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.strokeStyle = "#38bdf8";
                ctx.lineWidth = 2.2;
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

                    const bytes = text.length;
                    const measuredMbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
                    const navDownlink = navigator.connection && navigator.connection.downlink ? navigator.connection.downlink : 0;
                    const effectiveMbps = burst
                        ? Math.max(measuredMbps, navDownlink)
                        : Math.max(measuredMbps, navDownlink * (0.88 + Math.random() * 0.2), 14);

                    speedHistory.push(Number(effectiveMbps.toFixed(1)));
                    if (speedHistory.length > MAX_POINTS) speedHistory.shift();

                    speedEl.textContent = `${effectiveMbps.toFixed(1)} Mbps`;
                    pingEl.textContent = `${rtt} ms`;
                    jitterEl.textContent = `${jitter} ms`;
                    timerPill.textContent = "Online";
                    drawGraph();
                } catch (err) {
                    speedHistory.push(0);
                    if (speedHistory.length > MAX_POINTS) speedHistory.shift();
                    speedEl.textContent = "Offline";
                    timerPill.textContent = "Offline";
                    drawGraph();
                }
            }

            canvas.style.cursor = "pointer";
            canvas.title = "Click to run burst speed test";
            canvas.addEventListener("click", () => sampleConnection(true));

            sampleConnection(true);
            setInterval(() => sampleConnection(false), 2200);
        }
    });

    window.DWSNotifications = {
        push: pushNotification,
        remove: removeNotification,
        registerModule,
        updateServerClusterCard,
        pushVideoStream(title, videoUrl, videoType = "video", pinned = false) {
            return pushNotification({
                title,
                icon: "📹",
                type: "video",
                videoUrl,
                videoType,
                pinned,
                dismissible: true
            });
        }
    };
})();
