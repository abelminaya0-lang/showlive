import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

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

interface YouTubeSearchItem {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  views: string;
}

function extractVideosFromYtInitialData(data: any): YouTubeSearchItem[] {
  const results: YouTubeSearchItem[] = [];
  try {
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        const title =
          v.title?.runs?.map((r: any) => r.text).join("") ||
          v.title?.simpleText ||
          "YouTube Video";
        const channel =
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          "YouTube";
        const duration =
          v.lengthText?.simpleText ||
          v.thumbnailOverlays?.find(
            (o: any) => o.thumbnailOverlayTimeStatusRenderer
          )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText ||
          "LIVE";
        const views = v.shortViewCountText?.simpleText || "";
        const thumbnail = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        results.push({
          videoId: v.videoId,
          title,
          channel,
          duration,
          thumbnail,
          views,
        });
        if (results.length >= 16) return results;
      }
    }
  } catch {
    // Ignore parse edge cases
  }
  return results;
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

  // Real-time YouTube Karaoke search
  app.get("/api/youtube/search", async (req, res) => {
    const rawQuery = String(req.query.q || "").trim();
    if (!rawQuery) {
      return res.status(400).json({ error: "Se requiere un término de búsqueda." });
    }

    // Check if user pasted a direct YouTube URL or 11-char Video ID
    const urlMatch = rawQuery.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    const idMatch = rawQuery.match(/^[A-Za-z0-9_-]{11}$/);
    const directId = urlMatch?.[1] || idMatch?.[0];
    if (directId) {
      return res.json({
        items: [
          {
            videoId: directId,
            title: `YouTube Video (${directId})`,
            channel: "Enlace directo",
            duration: "HD",
            thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
            views: "Directo",
          },
        ],
      });
    }

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        rawQuery
      )}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const ytRes = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        },
      });
      clearTimeout(timer);

      if (!ytRes.ok) {
        return res.status(502).json({
          error: `YouTube devolvió estado ${ytRes.status}. Puedes pegar directamente un link de YouTube.`,
        });
      }

      const html = await ytRes.text();
      const marker = "var ytInitialData = ";
      const idx = html.indexOf(marker);
      if (idx === -1) {
        return res.status(502).json({
          error:
            "No se pudo interpretar la respuesta de YouTube. Pega una URL de YouTube directamente.",
        });
      }
      const start = idx + marker.length;
      const end = html.indexOf(";</script>", start);
      const jsonStr = end !== -1 ? html.slice(start, end) : "";
      if (!jsonStr) {
        return res.status(502).json({
          error: "No se encontraron resultados estructurados en YouTube.",
        });
      }

      const ytData = JSON.parse(jsonStr);
      const items = extractVideosFromYtInitialData(ytData);
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
