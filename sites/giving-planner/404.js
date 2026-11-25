// The 404 jar: press it to drop in coins until "month 13" is full.
const jar = document.getElementById("lost-jar");
const count = document.getElementById("lost-count");
const fill = jar?.querySelector(".fill-404");
let coins = 0;
const lines = ["", "One coin. A good start.", "Two coins, still a long way to go.", "Halfway there.", "Nearly full.", "Full! Now go fill the twelve real ones."];

function drop() {
  coins = Math.min(coins + 1, 5);
  fill.style.setProperty("--lvl", String(coins / 5));
  count.textContent = lines[coins];
  jar.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(-5deg)" }, { transform: "rotate(4deg)" }, { transform: "rotate(0deg)" }],
    { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

jar?.addEventListener("click", drop);
