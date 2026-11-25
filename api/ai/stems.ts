import { GoogleGenAI, Type } from '@google/genai';

const ALLOWED_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const { trackName, targetMode = 'instrumental', model } = req.body || {};
  if (!trackName || typeof trackName !== 'string') {
    return res.status(400).json({ error: 'Falta el nombre de la pista.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return res.status(503).json({
      error: 'GEMINI_API_KEY no está configurada para análisis IA.',
    });
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const selectedModel =
      model && ALLOWED_MODELS.has(model) ? model : 'gemini-4-hydrogen';
    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: `Analiza esta pista musical para show en vivo: "${trackName}" y el modo de separación "${targetMode}" (full, instrumental, vocals, drums_bass).
Devuelve el género probable, BPM estimado, tonalidad musical, recomendación de ajuste de voz/tono para cantante en vivo, y parámetros DSP óptimos en decibelios para HIGH/MID/LOW y nivel de cancelación central (0 a 1).`,
      config: {
        systemInstruction:
          'Eres un ingeniero de mezcla y masterización en vivo. Devuelve JSON estricto con valores numéricos realistas.',
        responseMimeType: 'application/json',
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
              required: ['highDb', 'midDb', 'lowDb', 'midSideCancel'],
            },
          },
          required: ['genre', 'bpm', 'key', 'vocalTip', 'recommendedEq'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return res.status(200).json(parsed);
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'No se pudo analizar la separación de pista con Gemini.',
    });
  }
}
