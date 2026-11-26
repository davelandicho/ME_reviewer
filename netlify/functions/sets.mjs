// Shared reviewer sets uploaded from the website (stored in Netlify Blobs).
// GET    /api/sets               -> all uploaded sets
// POST   /api/sets  {pin, subject, set, title, questions[]}  -> saves a set
// DELETE /api/sets?id=<id>  header x-upload-pin               -> removes a set
//
// Set the UPLOAD_PIN environment variable in Netlify (Site configuration →
// Environment variables). Uploading and deleting are disabled until it is set.
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const SUBJECTS = ["md", "math", "powerplant", "pipe"];
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function checkPin(given) {
  const pin = process.env.UPLOAD_PIN;
  if (!pin) return "Uploading is turned off: set UPLOAD_PIN in Netlify first.";
  if (String(given || "") !== pin) return "Wrong PIN.";
  return null;
}

function cleanQuestions(list) {
  if (!Array.isArray(list) || !list.length || list.length > 500) return null;
  const out = [];
  for (const q of list) {
    const text = str(q?.q, 1500);
    const choices = Array.isArray(q?.choices) ? q.choices.map(c => str(c, 500)) : [];
    const correct = q?.correct;
    if (!text || choices.length !== 4 || choices.some(c => !c) || ![0, 1, 2, 3].includes(correct)) return null;
    out.push({ q: text, choices, correct, keyword: str(q.keyword, 800) || "No hint yet." });
  }
  return out;
}

export default async (req) => {
  const store = getStore({ name: "reviewer-sets", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const sets = (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
    sets.sort((a, b) => a.uploadedAt - b.uploadedAt);
    return json({ sets });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const pinError = checkPin(body.pin);
    if (pinError) return json({ error: pinError }, 403);

    const subject = String(body.subject || "");
    const set = Number(body.set);
    const questions = cleanQuestions(body.questions);
    if (!SUBJECTS.includes(subject)) return json({ error: "Unknown subject" }, 400);
    if (!Number.isInteger(set) || set < 1 || set > 99) return json({ error: "Set must be 1–99" }, 400);
    if (!questions) return json({ error: "Some questions are incomplete" }, 400);

    const entry = { id: randomUUID(), subject, set, title: str(body.title, 120), questions, uploadedAt: Date.now() };
    await store.setJSON(entry.id, entry);
    return json({ set: entry });
  }

  if (req.method === "DELETE") {
    const pinError = checkPin(req.headers.get("x-upload-pin"));
    if (pinError) return json({ error: pinError }, 403);
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Invalid id" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/sets" };
