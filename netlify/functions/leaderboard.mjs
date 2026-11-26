// Shared leaderboard stored in Netlify Blobs (free, no login, no extra service).
// GET  /api/leaderboard?board=<key>        -> top 20
// POST /api/leaderboard {board,name,score,correct,total,best} -> saves, returns rank + top 20
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const KEEP = 100; // entries stored per board
const SHOW = 20;  // entries returned
const BOARD_RE = /^[a-z]+\|(all|set\d{1,3})\|(\d{1,3}|all)$/;

const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const int = v => (Number.isInteger(v) ? v : -1);

export default async (req) => {
  const store = getStore({ name: "leaderboard", consistency: "strong" });

  if (req.method === "GET") {
    const board = new URL(req.url).searchParams.get("board") || "";
    if (!BOARD_RE.test(board)) return json({ error: "Invalid board" }, 400);
    const list = (await store.get(board, { type: "json" })) || [];
    return json({ entries: list.slice(0, SHOW) });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const board = String(body.board || "");
    const name = String(body.name || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 20);
    const score = int(body.score), correct = int(body.correct), total = int(body.total), best = int(body.best);

    // Basic sanity checks: 100 pts per correct answer + up to 200 streak bonus
    const valid = BOARD_RE.test(board) && name &&
      total >= 1 && total <= 1000 &&
      correct >= 0 && correct <= total &&
      best >= 0 && best <= correct &&
      score >= correct * 100 && score <= correct * 300;
    if (!valid) return json({ error: "Invalid score" }, 400);

    const entry = { id: randomUUID(), name, score, correct, total, best, at: Date.now() };
    const list = (await store.get(board, { type: "json" })) || [];
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = list.findIndex(e => e.id === entry.id) + 1;
    await store.setJSON(board, list.slice(0, KEEP));

    return json({ id: entry.id, rank, entries: list.slice(0, SHOW) });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/leaderboard" };
