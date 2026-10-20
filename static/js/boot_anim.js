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

    async function loadAndStartBoot() {
        try {
            const res = await fetch(BOOT_SVG_PATH);
            if (res.ok) {
                container.innerHTML = await res.text();
            } else {
                container.innerHTML = FALLBACK_SVG;
            }
        } catch (err) {
            container.innerHTML = FALLBACK_SVG;
        }

        svgElement = container.querySelector("svg");
        if (svgElement && typeof svgElement.setCurrentTime === "function") {
            svgElement.setCurrentTime(0);
        }

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
            runPostBootChoreography();
        }
    }

    function runPostBootChoreography() {
        // 1. Freeze the SVG on its exact final frame (2.45s)
        if (brandHeader) {
            brandHeader.classList.add("svg-frozen");
            brandHeader.classList.remove("state-booting");
            brandHeader.classList.add("state-docked");
        }
        if (svgElement && typeof svgElement.pauseAnimations === "function") {
            svgElement.pauseAnimations();
        }

        // 2. Slowly dissolve the black curtain (2.8s)
        if (curtain) {
            curtain.classList.add("fade-away");
        }

        // 3. Unfold the centered widget box along the X-axis (starts 750ms into the header glide)
        setTimeout(() => {
            if (appGrid) appGrid.classList.add("box-open-x");
        }, 750);

        // 4. Cascade icons inside the box from top to bottom as the X-expansion settles
        setTimeout(() => {
            if (typeof window.recalculateTopToBottomStagger === "function") {
                window.recalculateTopToBottomStagger();
            }
            if (appGrid) appGrid.classList.add("icons-revealed");
            if (settingsBtn) settingsBtn.classList.add("chrome-visible");
        }, 1680);
    }

    window.addEventListener("DOMContentLoaded", loadAndStartBoot);
})();
