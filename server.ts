import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { searchYouTubeServer } from "./lib/youtubeSearch";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const ALLOWED_MODELS = new Set(["gemini-4-hydrogen", "gemini-3.1-flash-lite"]);

function resolveModel(requested?: string): string {
  if (requested && ALLOWED_MODELS.has(requested)) {
    return requested;
  }
  return "gemini-4-hydrogen";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"
      ),
    });
  });

  // Real-time YouTube Karaoke search (multi-provider cascade)
  app.get("/api/youtube/search", async (req, res) => {
    const rawQuery = String(req.query.q || "").trim();
    if (!rawQuery) {
      return res.status(400).json({ error: "Se requiere un término de búsqueda." });
    }

    try {
      const items = await searchYouTubeServer(rawQuery);
      if (items.length === 0) {
        return res.status(502).json({
          error:
            "YouTube no devolvió resultados. Puedes pegar directamente un link de YouTube.",
        });
      }
      return res.json({ items });
    } catch (err: any) {
      return res.status(500).json({
        error:
          err?.message ||
          "Error al conectar con YouTube. Puedes pegar un link o ID de video de YouTube.",
      });
    }
  });

  // Gemini AI: Generate synced Karaoke lyrics (Letra IA)
  app.post("/api/ai/lyrics", async (req, res) => {
    const { trackName, artist, durationSec = 180, language = "es", model } =
      req.body || {};

    if (!trackName || typeof trackName !== "string") {
      return res.status(400).json({ error: "El nombre de la pista es obligatorio." });
    }

    const ai = getAiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          "GEMINI_API_KEY no está configurada. Configúrala en Settings > Secrets para generar Letra IA.",
      });
    }

    try {
      const selectedModel = resolveModel(model);
      const cleanTitle = trackName
        .replace(/^\d+\.\s*/, "")
        .replace(/\.(mp3|wav|ogg|m4a|mp4|webm)$/i, "");

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: `Genera una guía de letra karaoke estructurada y sincronizada por tiempos para animar en vivo la canción "${cleanTitle}"${
          artist ? ` de "${artist}"` : ""
        }. Duración estimada de la pista: ${Math.max(
          30,
          Math.round(Number(durationSec) || 180)
        )} segundos. Idioma preferido: ${language}.
Si es una canción conocida, incluye las estrofas y coros más representativos para cantar en vivo (sin exceder 16-24 líneas clave distribuidas en el tiempo de la canción) más señales de animación para DJ/cantante como [Intro], [Coro], [Puente].`,
        config: {
          systemInstruction:
            "Eres un director musical y operador de karaoke profesional para shows en vivo. Devuelve únicamente JSON válido según el esquema solicitado.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedTitle: { type: Type.STRING },
              detectedArtist: { type: Type.STRING },
              bpm: { type: Type.INTEGER },
              musicalKey: { type: Type.STRING },
              lines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timeSec: { type: Type.NUMBER },
                    section: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ["timeSec", "section", "text"],
                },
              },
            },
            required: ["detectedTitle", "detectedArtist", "bpm", "musicalKey", "lines"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      return res.json(parsed);
    } catch (err: any) {
      console.error("Error /api/ai/lyrics:", err);
      return res.status(500).json({
        error: err?.message || "No se pudo generar la letra IA con Gemini.",
      });
    }
  });

  // Gemini AI: Stem Separation EQ Profile & Musical Analysis (Separar Pista IA)
  app.post("/api/ai/stems", async (req, res) => {
    const { trackName, targetMode = "instrumental", model } = req.body || {};

    if (!trackName || typeof trackName !== "string") {
      return res.status(400).json({ error: "Falta el nombre de la pista." });
    }

    const ai = getAiClient();
    if (!ai) {
      return res.status(503).json({
        error:
          "GEMINI_API_KEY no está configurada. Configúrala en Settings > Secrets para análisis IA.",
      });
    }

    try {
      const selectedModel = resolveModel(model);
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: `Analiza esta pista musical para show en vivo: "${trackName}" y el modo de separación "${targetMode}" (full, instrumental, vocals, drums_bass).
Devuelve el género probable, BPM estimado, tonalidad musical, recomendación de ajuste de voz/tono para cantante en vivo, y parámetros DSP óptimos en decibelios para HIGH/MID/LOW y nivel de cancelación central (0 a 1).`,
        config: {
          systemInstruction:
            "Eres un ingeniero de mezcla y masterización en vivo. Devuelve JSON estricto con valores numéricos realistas.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genre: { type: Type.STRING },
              bpm: { type: Type.INTEGER },
              key: { type: Type.STRING },
              vocalTip: { type: Type.STRING },
              recommendedEq: {
                type: Type.OBJECT,
                properties: {
                  highDb: { type: Type.NUMBER },
                  midDb: { type: Type.NUMBER },
                  lowDb: { type: Type.NUMBER },
                  midSideCancel: { type: Type.NUMBER },
                },
                required: ["highDb", "midDb", "lowDb", "midSideCancel"],
              },
            },
            required: ["genre", "bpm", "key", "vocalTip", "recommendedEq"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      return res.json(parsed);
    } catch (err: any) {
      console.error("Error /api/ai/stems:", err);
      return res.status(500).json({
        error: err?.message || "No se pudo analizar la separación de pista con Gemini.",
      });
    }
  });

  if (process.env.NODE_ENV === "production") {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ShowLive server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
