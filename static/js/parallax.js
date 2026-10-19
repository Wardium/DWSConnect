(function () {
    const layers = document.querySelectorAll(".parallax-layer");
    const orb1 = document.getElementById("svg-orb-1");
    const orb2 = document.getElementById("svg-orb-2");
    const orb3 = document.getElementById("svg-orb-3");

    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    let tick = 0;

    // Desktop Mouse Parallax
    window.addEventListener("mousemove", (e) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    // Mobile Touch Parallax
    window.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) {
            targetX = (e.touches[0].clientX / window.innerWidth - 0.5) * 1.5;
            targetY = (e.touches[0].clientY / window.innerHeight - 0.5) * 1.5;
        }
    }, { passive: true });

    // Mobile Gyroscope Tilt Parallax
    window.addEventListener("deviceorientation", (e) => {
        if (e.gamma !== null && e.beta !== null) {
            targetX = Math.max(-1, Math.min(1, e.gamma / 30));
            targetY = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
        }
    });

    function animateParallax() {
        tick += 0.012;
        currentX += (targetX - currentX) * 0.075;
        currentY += (targetY - currentY) * 0.075;

        layers.forEach((layer) => {
            const depth = parseFloat(layer.dataset.depth || 0.05);
            const moveX = -currentX * (window.innerWidth * depth);
            const moveY = -currentY * (window.innerHeight * depth);
            layer.style.transform = `translate3d(${moveX.toFixed(2)}px, ${moveY.toFixed(2)}px, 0)`;
        });

        if (orb1 && orb2 && orb3) {
            orb1.setAttribute("cx", 550 + Math.sin(tick) * 90);
            orb1.setAttribute("cy", 380 + Math.cos(tick * 0.8) * 70);
            orb2.setAttribute("cx", 1350 + Math.cos(tick * 0.9) * 110);
            orb2.setAttribute("cy", 700 + Math.sin(tick * 0.7) * 85);
            orb3.setAttribute("cx", 960 + Math.sin(tick * 1.1) * 75);
        }

        requestAnimationFrame(animateParallax);
    }

    requestAnimationFrame(animateParallax);
})();
