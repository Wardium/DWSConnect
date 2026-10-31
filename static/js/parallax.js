(function () {
    const layers = document.querySelectorAll(".parallax-layer");
    const orb1 = document.getElementById("svg-orb-1");
    const orb2 = document.getElementById("svg-orb-2");
    const orb3 = document.getElementById("svg-orb-3");

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let tick = 0;
    let rafId = null;

    window.dwsParallaxIntensity = 28;

    window.addEventListener("mousemove", (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) {
            targetX = (e.touches[0].clientX / window.innerWidth - 0.5) * 1.5;
            targetY = (e.touches[0].clientY / window.innerHeight - 0.5) * 1.5;
        }
    }, { passive: true });

    function animateParallax() {
        if (document.hidden) {
            rafId = null;
            return;
        }
        tick += 0.014;
        currentX += (targetX - currentX) * 0.08;
        currentY += (targetY - currentY) * 0.08;

        const scale = (window.dwsParallaxIntensity !== undefined ? window.dwsParallaxIntensity : 28) / 28;

        layers.forEach((layer) => {
            const depth = parseFloat(layer.dataset.depth || 0.04) * scale;
            const moveX = -currentX * (window.innerWidth * depth);
            const moveY = -currentY * (window.innerHeight * depth);
            layer.style.transform = `translate3d(${moveX.toFixed(1)}px, ${moveY.toFixed(1)}px, 0)`;
        });

        if (orb1 && orb2 && orb3) {
            orb1.style.transform = `translate3d(${(Math.sin(tick) * 75).toFixed(1)}px, ${(Math.cos(tick * 0.8) * 55).toFixed(1)}px, 0)`;
            orb2.style.transform = `translate3d(${(Math.cos(tick * 0.9) * 85).toFixed(1)}px, ${(Math.sin(tick * 0.7) * 65).toFixed(1)}px, 0)`;
            orb3.style.transform = `translate3d(${(Math.sin(tick * 1.1) * 60).toFixed(1)}px, ${(Math.cos(tick * 0.6) * 50).toFixed(1)}px, 0)`;
        }

        rafId = requestAnimationFrame(animateParallax);
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !rafId) {
            rafId = requestAnimationFrame(animateParallax);
        }
    });

    rafId = requestAnimationFrame(animateParallax);
})();
