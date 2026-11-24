# Iischi Party — Openair Gampel 2027

Public playable rhythm game concept. 45 seconds, 84 authored notes, local precision scoring, 90ms shared input lock, touch/physical keyboard, countdown, pause, reduced motion, original synchronized music, local best and score sharing.

The prize campaign is explicitly a preview. No official leaderboard, prize entry, analytics, personal-data collection or purchase service is active. Ticket info links to the official festival site until the real campaign shop is available.

Brand assets: official Openair Gampel logo and RT Rondelle from https://www.openairgampel.ch/de/home and its published template_styles_2026-8.css. Festival dates shown there: 18–22 August 2027. Stage repositioning and four-day prizes come from the user's brief. Stage name remains a working title.

Rules are pure and deterministic in app/src/logic.js, copied to app/public/logic.js. A runtime script in app/scripts/verify-game.mjs checks the scoring and input boundaries. Full platform build is run by Higgsfield deployment; no dependency installation was performed in the editing sandbox.
