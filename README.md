# [TidBit](https://harsh98trivedi.github.io/TidBit) — Notes & Reminders (Svelte)

TidBit is a lightweight, **Google‑Keep‑style** notes app built with **Svelte + Vite**.  
Create rich notes (rich‑text or Markdown), add tags & color labels, pin/complete items, and set **browser reminders**. Everything is stored locally so your notes persist until you clear your browser storage.

[![TidBit](public/meta.jpg)](https://harsh98trivedi.github.io/TidBit)

> Designed to work on **GitHub Pages** (static hosting, HTTPS, no server).

---

## ✨ Features

- **Notes + Todos**: headings, rich text (bold/italic/underline, lists, quote, alignment), images (URL or upload), links.
- **Markdown mode** with on‑screen helpers (renders via `marked`).
- **Reminders** using the Web Notifications API (asks permission once).
- **Tags & colors** to organize notes; quick filter and full‑text search.
- **Pin** & **Done** states; sort by pin, reminder, and recency.
- **Local persistence** (`localStorage`) with “persist” hint to the browser.
- **Responsive & accessible** UI (keyboard‑friendly; reduced‑motion aware).
- **GSAP micro‑animations** for pleasant, non‑intrusive motion.

---

## 🧱 Tech

- [Svelte](https://svelte.dev/) + [Vite](https://vitejs.dev/)
- [Font Awesome](https://fontawesome.com/) (icons, via CDN)
- [GSAP](https://greensock.com/gsap/) (micro animations, via CDN)
- [marked](https://marked.js.org/) (Markdown parser, via CDN)

> The app references these via CDN in `index.html`. No server is required.

---

## 🚀 Getting started (local)

**Requirements:** Node.js 18+ (LTS) and npm (or pnpm/yarn).

```bash
# install deps
npm install

# run locally
npm run dev

# build for production
npm run build

# preview the built site
npm run preview
```
