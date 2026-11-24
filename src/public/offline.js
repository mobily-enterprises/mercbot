// The offline page's Try again, and going back to the page the person was opening once they're online (D-133).
// readable-check: allow released-listeners - shared resource: the offline page's button, for the page's whole life
document.getElementById("again").addEventListener("click", () => location.reload());
// readable-check: allow released-listeners - shared resource: the page waits to be online for its whole life
window.addEventListener("online", () => location.reload());
