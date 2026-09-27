import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // Do not publish browser source maps in production dist.
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/auth": "http://127.0.0.1:3000",
      "/dev": "http://127.0.0.1:3000",
      "/bootstrap": "http://127.0.0.1:3000",
      "/sections": "http://127.0.0.1:3000",
      "/kick": "http://127.0.0.1:3000",
      "/games": "http://127.0.0.1:3000",
      "/rounds": "http://127.0.0.1:3000",
      "/cases": "http://127.0.0.1:3000",
      "/products": "http://127.0.0.1:3000",
      "/tasks": "http://127.0.0.1:3000",
      "/referrals": "http://127.0.0.1:3000",
      "/profile": "http://127.0.0.1:3000",
      "/promo": "http://127.0.0.1:3000",
      "/gram": "http://127.0.0.1:3000",
      "/shop": "http://127.0.0.1:3000",
      "/inventory": "http://127.0.0.1:3000",
      "/recent-wins": "http://127.0.0.1:3000",
      "/leaderboard": "http://127.0.0.1:3000",
      "/stream-streak": "http://127.0.0.1:3000",
      "/giveaways": "http://127.0.0.1:3000",
      "/achievements": "http://127.0.0.1:3000",
      "/welvura": "http://127.0.0.1:3000",
      "/admin": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
