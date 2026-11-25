import { searchYouTubeServer } from '../../lib/youtubeSearch';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawQuery = String(req.query?.q || '').trim();
  if (!rawQuery) {
    return res.status(400).json({ error: 'Se requiere un término de búsqueda.' });
  }

  try {
    const items = await searchYouTubeServer(rawQuery);
    if (items.length === 0) {
      return res.status(502).json({
        error:
          'YouTube no devolvió resultados desde el servidor. Pega directamente un link de YouTube.',
      });
    }
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(500).json({
      error:
        err?.message ||
        'Error al conectar con YouTube. Puedes pegar un link o ID de video de YouTube.',
    });
  }
}
