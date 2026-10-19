(function () {
    const DURATION_MS = 2450; // Exact 2.45 seconds
    const FPS = 60;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * FPS); // 147 frames
    const CIRCUMFERENCE = 2 * Math.PI * 110; // r = 110 -> 691.15

    const overlay = document.getElementById("boot-overlay");
    const ringProg = document.getElementById("boot-ring-prog");
    const squircle = document.getElementById("boot-squircle");
    const telemetry = document.getElementById("boot-telemetry");

    let startTime = null;
    let lastRenderedFrame = -1;

    function stepBootAnimation(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / DURATION_MS, 1.0);
        const currentFrame = Math.min(Math.floor(progress * TOTAL_FRAMES), TOTAL_FRAMES);

        // Lock SVG state updates to discrete 60fps steps
        if (currentFrame !== lastRenderedFrame) {
            lastRenderedFrame = currentFrame;

            // Ease-in-out cubic curve
            const eased = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            // Update circular stroke dashoffset
            const offset = CIRCUMFERENCE * (1 - eased);
            ringProg.style.strokeDashoffset = offset.toFixed(2);

            // Rotate & breathe center squircle
            const angle = (eased * 180).toFixed(2);
            const scale = (0.75 + 0.25 * Math.sin(progress * Math.PI)).toFixed(3);
            squircle.setAttribute(
                "transform",
                `translate(200 200) rotate(${angle}) scale(${scale}) translate(-200 -200)`
            );

            telemetry.textContent = `FRAME ${String(currentFrame).padStart(3, "0")} / ${TOTAL_FRAMES}`;
        }

        if (elapsed < DURATION_MS) {
            requestAnimationFrame(stepBootAnimation);
        } else {
            // 2.45s reached: fade away black screen to reveal website
            overlay.classList.add("fade-out");
            setTimeout(() => overlay.remove(), 700);
        }
    }

    window.addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(stepBootAnimation);
    });
})();
