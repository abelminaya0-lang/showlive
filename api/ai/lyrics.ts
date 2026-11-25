import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const { trackName, artist, durationSec = 180, language = 'es', model } =
    req.body || {};

  if (!trackName || typeof trackName !== 'string') {
    return res.status(400).json({ error: 'El nombre de la pista es obligatorio.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return res.status(503).json({
      error: 'GEMINI_API_KEY no está configurada para generar Letra IA.',
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const selectedModel =
      model && ALLOWED_MODELS.has(model) ? model : 'gemini-4-hydrogen';
    const cleanTitle = trackName
      .replace(/^\d+\.\s*/, '')
      .replace(/\.(mp3|wav|ogg|m4a|mp4|webm)$/i, '');

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `Genera una guía de letra karaoke estructurada y sincronizada por tiempos para animar en vivo la canción "${cleanTitle}"${
        artist ? ` de "${artist}"` : ''
      }. Duración estimada de la pista: ${Math.max(
        30,
        Math.round(Number(durationSec) || 180)
      )} segundos. Idioma preferido: ${language}.
Si es una canción conocida, incluye las estrofas y coros más representativos para cantar en vivo (sin exceder 16-24 líneas clave distribuidas en el tiempo de la canción) más señales de animación para DJ/cantante como [Intro], [Coro], [Puente].`,
      config: {
        systemInstruction:
          'Eres un director musical y operador de karaoke profesional para shows en vivo. Devuelve únicamente JSON válido según el esquema solicitado.',
        responseMimeType: 'application/json',
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
                required: ['timeSec', 'section', 'text'],
              },
            },
          },
          required: ['detectedTitle', 'detectedArtist', 'bpm', 'musicalKey', 'lines'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return res.status(200).json(parsed);
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'No se pudo generar la letra IA con Gemini.',
    });
  }
}
