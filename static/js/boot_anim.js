(function () {
    const DURATION_MS = 2450; // Exact 2.45 seconds
    const FPS = 60;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * FPS); // 147 frames
    const BOOT_SVG_PATH = "/static/assets/boot.svg";

    const curtain = document.getElementById("boot-curtain");
    const brandHeader = document.getElementById("brand-header");
    const container = document.getElementById("boot-svg-container");
    const appGrid = document.getElementById("app-grid");
    const settingsBtn = document.getElementById("settings-trigger");

    let startTime = null;
    let lastRenderedFrame = -1;
    let svgElement = null;

    const FALLBACK_SVG = `
        <svg viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#60a5fa"/>
                    <stop offset="50%" stop-color="#c084fc"/>
                    <stop offset="100%" stop-color="#38bdf8"/>
                </linearGradient>
            </defs>
            <rect id="fallback-squircle" x="140" y="20" width="80" height="80" rx="20"
                  fill="none" stroke="url(#lg)" stroke-width="4" stroke-dasharray="320" stroke-dashoffset="320"/>
        </svg>
    `;

    function waitForWindowLoad() {
        if (document.readyState === "complete") {
            return Promise.resolve();
        }
        return new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
    }

    function pauseAndRewindSvg(svg) {
        if (!svg) return;
        // Pause & rewind SMIL <animate> tags
        if (typeof svg.pauseAnimations === "function") svg.pauseAnimations();
        if (typeof svg.setCurrentTime === "function") svg.setCurrentTime(0);

        // Pause & rewind CSS @keyframes / Web Animations
        if (typeof svg.getAnimations === "function") {
            svg.getAnimations({ subtree: true }).forEach((anim) => {
                anim.pause();
                anim.currentTime = 0;
            });
        }
    }

    function unpauseAndRestartSvg(svg) {
        if (!svg) return;
        // Restart & unpause SMIL <animate> tags at 0.00s
        if (typeof svg.unpauseAnimations === "function") svg.unpauseAnimations();
        if (typeof svg.setCurrentTime === "function") svg.setCurrentTime(0);

        // Restart & unpause all CSS @keyframes / Web Animations at 0.00s
        if (typeof svg.getAnimations === "function") {
            svg.getAnimations({ subtree: true }).forEach((anim) => {
                anim.cancel();
                anim.play();
                anim.currentTime = 0;
            });
        }
    }

    async function initBootSequence() {
        if (brandHeader) {
            brandHeader.classList.add("waiting-to-boot");
        }

        // 1. Fetch boot.svg text
        let svgCode = FALLBACK_SVG;
        try {
            const res = await fetch(BOOT_SVG_PATH);
            if (res.ok) {
                svgCode = await res.text();
            }
        } catch (err) {}

        // 2. Inject SVG while paused and immediately rewind to frame 0
        container.innerHTML = svgCode;
        svgElement = container.querySelector("svg");
        pauseAndRewindSvg(svgElement);

        // 3. Wait until the entire website, window.load, settings API, and background image are 100% loaded
        await Promise.all([
            waitForWindowLoad(),
            window.dashboardReadyPromise || Promise.resolve(),
            document.fonts ? document.fonts.ready : Promise.resolve()
        ]);

        // 4. Let the browser settle for 2 paint frames, then unpause and start from 0.00s
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (brandHeader) {
                    brandHeader.classList.remove("waiting-to-boot");
                }
                unpauseAndRestartSvg(svgElement);
                requestAnimationFrame(stepBootAnimation);
            });
        });
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
            runPostBootChoreography();
        }
    }

    function runPostBootChoreography() {
        // 1. Freeze SVG on its exact final frame (both CSS and SMIL)
        if (brandHeader) {
            brandHeader.classList.add("svg-frozen");
            brandHeader.classList.remove("state-booting");
            brandHeader.classList.add("state-docked");
        }
        if (svgElement) {
            if (typeof svgElement.pauseAnimations === "function") {
                svgElement.pauseAnimations();
            }
            if (typeof svgElement.getAnimations === "function") {
                svgElement.getAnimations({ subtree: true }).forEach((anim) => anim.pause());
            }
        }

        // 2. Dissolve the black curtain smoothly
        if (curtain) {
            curtain.classList.add("fade-away");
        }

        // 3. Unfold the centered widget box along the X-axis
        setTimeout(() => {
            if (appGrid) appGrid.classList.add("box-open-x");
        }, 750);

        // 4. Cascade icons top-to-bottom
        setTimeout(() => {
            if (typeof window.recalculateTopToBottomStagger === "function") {
                window.recalculateTopToBottomStagger();
            }
            if (appGrid) appGrid.classList.add("icons-revealed");
            if (settingsBtn) settingsBtn.classList.add("chrome-visible");
        }, 1680);
    }

    initBootSequence();
})();
