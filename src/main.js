import App from "./App.svelte";

const app = new App({ target: document.getElementById("app") });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js")
      .catch(console.error);
  });
}

export default app;
