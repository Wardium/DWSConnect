(function () {
    const DURATION_MS = 2450; // Exact 2.45 seconds
    const FPS = 60;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * FPS); // 147 frames
    const BOOT_SVG_PATH = "/static/assets/boot.svg";

    const overlay = document.getElementById("boot-overlay");
    const container = document.getElementById("boot-svg-container");

    let startTime = null;
    let lastRenderedFrame = -1;

    async function loadAndStartBoot() {
        try {
            const res = await fetch(BOOT_SVG_PATH);
            if (res.ok) {
                const svgText = await res.text();
                container.innerHTML = svgText;

                // Restart any SMIL <animate> elements inside your SVG at frame 0
                const svgEl = container.querySelector("svg");
                if (svgEl) {
                    svgEl.id = "boot-svg";
                    if (typeof svgEl.setCurrentTime === "function") {
                        svgEl.setCurrentTime(0);
                    }
                }
            }
        } catch (err) {
            console.warn("[BOOT] Could not load custom boot.svg:", err);
        }

        requestAnimationFrame(stepBootAnimation);
    }

    function stepBootAnimation(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / DURATION_MS, 1.0);
        const currentFrame = Math.min(Math.floor(progress * TOTAL_FRAMES), TOTAL_FRAMES);

        // Step strictly at 60fps intervals (16.67ms per frame)
        if (currentFrame !== lastRenderedFrame) {
            lastRenderedFrame = currentFrame;
            overlay.style.setProperty("--boot-progress", progress.toFixed(4));
            overlay.style.setProperty("--boot-frame", currentFrame);
        }

        if (elapsed < DURATION_MS) {
            requestAnimationFrame(stepBootAnimation);
        } else {
            // 2.45s finished -> Fade out black screen to reveal parallax dashboard
            overlay.classList.add("fade-out");
            setTimeout(() => overlay.remove(), 700);
        }
    }

    window.addEventListener("DOMContentLoaded", loadAndStartBoot);
})();
