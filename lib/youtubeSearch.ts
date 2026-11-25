export interface YouTubeSearchItem {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  views: string;
}

export function extractDirectYouTubeId(rawQuery: string): string | null {
  const trimmed = rawQuery.trim();
  const urlMatch = trimmed.match(
    /(?:(?:music\.|m\.|www\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (urlMatch?.[1]) return urlMatch[1];
  const idMatch = trimmed.match(/^[A-Za-z0-9_-]{11}$/);
  return idMatch?.[0] || null;
}

function extractVideosFromYtInitialData(data: any): YouTubeSearchItem[] {
  const results: YouTubeSearchItem[] = [];
  const seen = new Set<string>();

  const pushRenderer = (v: any) => {
    if (!v || !v.videoId || seen.has(v.videoId)) return;
    seen.add(v.videoId);
    const title =
      v.title?.runs?.map((r: any) => r.text).join('') ||
      v.title?.simpleText ||
      'YouTube Video';
    const channel =
      v.ownerText?.runs?.[0]?.text ||
      v.longBylineText?.runs?.[0]?.text ||
      v.shortBylineText?.runs?.[0]?.text ||
      'YouTube';
    const duration =
      v.lengthText?.simpleText ||
      v.thumbnailOverlays?.find(
        (o: any) => o.thumbnailOverlayTimeStatusRenderer
      )?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText ||
      'HD';
    const views =
      v.shortViewCountText?.simpleText ||
      v.viewCountText?.simpleText ||
      '';
    results.push({
      videoId: v.videoId,
      title,
      channel,
      duration,
      thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      views,
    });
  };

  try {
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        if (item?.videoRenderer) {
          pushRenderer(item.videoRenderer);
        } else if (item?.shelfRenderer?.content?.verticalListRenderer?.items) {
          for (const sub of item.shelfRenderer.content.verticalListRenderer.items) {
            if (sub?.videoRenderer) pushRenderer(sub.videoRenderer);
          }
        }
        if (results.length >= 18) return results;
      }
    }
  } catch {
    // Ignore parse edge cases
  }
  return results;
}

function formatSeconds(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return 'HD';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 7000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchViaYouTubeDataApi(
  query: string,
  apiKey: string
): Promise<YouTubeSearchItem[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=15&q=${encodeURIComponent(
    query
  )}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, { method: 'GET' }, 7000);
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data.items)) return [];
  return data.items
    .filter((it: any) => it?.id?.videoId)
    .map((it: any) => ({
      videoId: it.id.videoId,
      title: it.snippet?.title || 'YouTube Video',
      channel: it.snippet?.channelTitle || 'YouTube',
      duration: 'HD',
      thumbnail:
        it.snippet?.thumbnails?.high?.url ||
        `https://i.ytimg.com/vi/${it.id.videoId}/hqdefault.jpg`,
      views: '',
    }));
}

async function searchViaInnerTube(query: string): Promise<YouTubeSearchItem[]> {
  const res = await fetchWithTimeout(
    'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
        Origin: 'https://www.youtube.com',
        Referer: 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240726.00.00',
            hl: 'es',
            gl: 'PE',
          },
        },
        query,
      }),
    },
    7000
  );
  if (!res.ok) return [];
  const json = await res.json();
  return extractVideosFromYtInitialData(json);
}

async function searchViaYouTubeHtml(query: string): Promise<YouTubeSearchItem[]> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    query
  )}`;
  const ytRes = await fetchWithTimeout(
    searchUrl,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
        Cookie: 'SOCS=CAI; CONSENT=YES+cb.20210328-17-p0.en+FX+999',
      },
    },
    7500
  );
  if (!ytRes.ok) return [];
  const html = await ytRes.text();
  const marker = 'var ytInitialData = ';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];
  const start = idx + marker.length;
  const end = html.indexOf(';</script>', start);
  const jsonStr = end !== -1 ? html.slice(start, end) : '';
  if (!jsonStr) return [];
  const ytData = JSON.parse(jsonStr);
  return extractVideosFromYtInitialData(ytData);
}

async function searchViaPipedOrInvidious(
  query: string
): Promise<YouTubeSearchItem[]> {
  const pipedMirrors = [
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=videos`,
    `https://pipedapi.adminforge.de/search?q=${encodeURIComponent(query)}&filter=videos`,
  ];

  for (const url of pipedMirrors) {
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, 5000);
      if (!res.ok) continue;
      const data = await res.json();
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      const mapped: YouTubeSearchItem[] = rawItems
        .map((it: any) => {
          const match = String(it?.url || '').match(/v=([A-Za-z0-9_-]{11})/);
          const videoId = match?.[1];
          if (!videoId) return null;
          return {
            videoId,
            title: it.title || 'YouTube Video',
            channel: it.uploaderName || 'YouTube',
            duration: formatSeconds(it.duration),
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            views: it.views ? `${Number(it.views).toLocaleString()} vistas` : '',
          };
        })
        .filter(Boolean) as YouTubeSearchItem[];
      if (mapped.length > 0) return mapped.slice(0, 16);
    } catch {
      // Try next mirror
    }
  }

  const invidiousMirrors = [
    `https://invidious.nerdvpn.de/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
    `https://yt.artemislena.eu/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
  ];

  for (const url of invidiousMirrors) {
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, 5000);
      if (!res.ok) continue;
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      const mapped: YouTubeSearchItem[] = list
        .filter((it: any) => it?.videoId)
        .slice(0, 16)
        .map((it: any) => ({
          videoId: it.videoId,
          title: it.title || 'YouTube Video',
          channel: it.author || 'YouTube',
          duration: formatSeconds(it.lengthSeconds),
          thumbnail: `https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`,
          views: it.viewCountText || '',
        }));
      if (mapped.length > 0) return mapped;
    } catch {
      // Try next mirror
    }
  }

  return [];
}

export async function searchYouTubeServer(
  rawQuery: string
): Promise<YouTubeSearchItem[]> {
  const directId = extractDirectYouTubeId(rawQuery);
  if (directId) {
    return [
      {
        videoId: directId,
        title: `YouTube Video (${directId})`,
        channel: 'Enlace directo',
        duration: 'HD',
        thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
        views: 'Directo',
      },
    ];
  }

  const ytApiKey = process.env.YOUTUBE_API_KEY;
  if (ytApiKey) {
    try {
      const apiItems = await searchViaYouTubeDataApi(rawQuery, ytApiKey);
      if (apiItems.length > 0) return apiItems;
    } catch {
      // Fall through to InnerTube
    }
  }

  try {
    const innerItems = await searchViaInnerTube(rawQuery);
    if (innerItems.length > 0) return innerItems;
  } catch {
    // Fall through to HTML
  }

  try {
    const htmlItems = await searchViaYouTubeHtml(rawQuery);
    if (htmlItems.length > 0) return htmlItems;
  } catch {
    // Fall through to Piped/Invidious
  }

  return searchViaPipedOrInvidious(rawQuery);
}
