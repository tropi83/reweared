// Status bar of the Vinted window. No IPC: Rust pushes the text with `window.__aivBar.set(text)` (vinted.rs).
(function () {
  var text = document.getElementById("text");
  window.__aivBar = {
    set: function (value) {
      text.textContent = typeof value === "string" ? value : "";
    },
  };
})();
