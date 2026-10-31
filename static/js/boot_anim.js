(function () {
    const DURATION_MS = 2250;
    const FPS = 60;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * FPS);
    const BOOT_SVG_PATH = "/static/assets/boot.svg";

    const curtain = document.getElementById("boot-curtain");
    const brandHeader = document.getElementById("brand-header");
    const container = document.getElementById("boot-svg-container");
    const appGrid = document.getElementById("app-grid");
    const sidePanels = document.querySelectorAll(".liquid-side-panel");

    let startTime = null;
    let lastRenderedFrame = -1;
    let svgElement = null;

    const FALLBACK_SVG = `
        <svg viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#38bdf8"/>
                    <stop offset="50%" stop-color="#a855f7"/>
                    <stop offset="100%" stop-color="#ec4899"/>
                </linearGradient>
            </defs>
            <rect id="fallback-squircle" x="140" y="20" width="80" height="80" rx="22"
                  fill="none" stroke="url(#lg)" stroke-width="4.5" stroke-dasharray="320" stroke-dashoffset="320"/>
        </svg>
    `;

    function maxWait(promise, ms = 500) {
        return Promise.race([
            promise,
            new Promise((resolve) => setTimeout(resolve, ms))
        ]);
    }

    function isPageReload() {
        try {
            const nav = performance.getEntriesByType("navigation")[0];
            if (nav && nav.type === "reload") return true;
        } catch (e) {}
        return sessionStorage.getItem("dws_boot_seen") === "1";
    }

    function restartSvgAnimations(svg) {
        if (!svg) return;
        svg.style.animationPlayState = "running";
        svg.querySelectorAll("*").forEach((el) => {
            el.style.animationPlayState = "running";
        });
        if (typeof svg.unpauseAnimations === "function") {
            try {
                svg.setCurrentTime(0);
                svg.unpauseAnimations();
            } catch (e) {}
        }
        if (typeof svg.getAnimations === "function") {
            svg.getAnimations({ subtree: true }).forEach((anim) => {
                try {
                    anim.cancel();
                    anim.play();
                    anim.currentTime = 0;
                } catch (e) {}
            });
        }
    }

    function seekSvgToFinalFrame(svg) {
        if (!svg) return;
        if (typeof svg.setCurrentTime === "function") {
            try {
                svg.unpauseAnimations();
                svg.setCurrentTime(DURATION_MS / 1000);
                svg.pauseAnimations();
            } catch (e) {}
        }
        if (typeof svg.getAnimations === "function") {
            svg.getAnimations({ subtree: true }).forEach((anim) => {
                try {
                    anim.play();
                    anim.currentTime = DURATION_MS;
                    anim.pause();
                } catch (e) {}
            });
        }
        const fbRect = document.getElementById("fallback-squircle");
        if (fbRect) fbRect.style.strokeDashoffset = "0";
    }

    function revealWorkspace(fast = false) {
        sessionStorage.setItem("dws_boot_seen", "1");

        seekSvgToFinalFrame(svgElement);

        if (brandHeader) {
            if (fast) brandHeader.classList.add("fast-boot");
            brandHeader.classList.remove("state-booting");
            brandHeader.classList.add("state-docked");
        }

        if (curtain) {
            if (fast) curtain.classList.add("fast-boot");
            curtain.classList.add("fade-away");
        }

        const gridDelay = fast ? 30 : 220;
        const iconDelay = fast ? 90 : 520;

        setTimeout(() => {
            if (appGrid) appGrid.classList.add("box-open-x");
            sidePanels.forEach((p) => p.classList.add("panel-revealed"));
        }, gridDelay);

        setTimeout(() => {
            if (typeof window.recalculateTopToBottomStagger === "function") {
                window.recalculateTopToBottomStagger();
            }
            if (appGrid) appGrid.classList.add("icons-revealed");
        }, iconDelay);
    }

    async function initBootSequence(forceFull = false) {
        const fastBoot = !forceFull && isPageReload();

        let svgCode = FALLBACK_SVG;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 450);
            const res = await fetch(BOOT_SVG_PATH, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) svgCode = await res.text();
        } catch (err) {}

        container.innerHTML = svgCode;
        svgElement = container.querySelector("svg");

        await maxWait(window.dashboardReadyPromise || Promise.resolve(), 450);

        if (fastBoot) {
            revealWorkspace(true);
            return;
        }

        restartSvgAnimations(svgElement);
        startTime = null;
        lastRenderedFrame = -1;
        requestAnimationFrame(stepBootAnimation);
    }

    function stepBootAnimation(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / DURATION_MS, 1.0);
        const currentFrame = Math.min(Math.floor(progress * TOTAL_FRAMES), TOTAL_FRAMES);

        if (currentFrame !== lastRenderedFrame) {
            lastRenderedFrame = currentFrame;
            if (brandHeader) {
                brandHeader.style.setProperty("--boot-progress", progress.toFixed(4));
                brandHeader.style.setProperty("--boot-frame", currentFrame);
            }
            const fbRect = document.getElementById("fallback-squircle");
            if (fbRect) {
                fbRect.style.strokeDashoffset = (320 * (1 - progress)).toFixed(2);
            }
        }

        if (elapsed < DURATION_MS) {
            requestAnimationFrame(stepBootAnimation);
        } else {
            revealWorkspace(false);
        }
    }

    const replayBtn = document.getElementById("btn-replay-boot");
    if (replayBtn) {
        replayBtn.addEventListener("click", () => {
            document.getElementById("settings-modal").classList.add("hidden");
            curtain.classList.remove("fast-boot", "fade-away");
            brandHeader.classList.remove("fast-boot", "state-docked");
            brandHeader.classList.add("state-booting");
            appGrid.classList.remove("box-open-x", "icons-revealed");
            sidePanels.forEach((p) => p.classList.remove("panel-revealed"));
            initBootSequence(true);
        });
    }

    initBootSequence(false);
})();
