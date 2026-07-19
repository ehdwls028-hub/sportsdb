require('dotenv').config();
const axios = require('axios');
const { setYoutubeCache, getYoutubeCache } = require('./database');

const API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL = 60 * 60 * 1000; // 1시간

const KBO_CHANNELS = [
  { id: 'kia', name: 'KIA 타이거즈', channelId: 'UCKp8knO8a6tSI1oaLjfd9XA' },
  { id: 'samsung', name: '삼성 라이온즈', channelId: 'UCMWAku3a3h65QpLm63Jf2pw' },
  { id: 'lg', name: 'LG 트윈스', channelId: 'UCL6QZZxb-HR4hCh_eFAnQWA' },
  { id: 'doosan', name: '두산 베어스', channelId: 'UCsebzRfMhwYfjeBIxNX1brg' },
  { id: 'kt', name: 'KT 위즈', channelId: 'UCvScyjGkBUx2CJDMNAi9Twg' },
  { id: 'ssg', name: 'SSG 랜더스', channelId: 'UCt8iRtgjVqm5rJHNl1TUojg' },
  { id: 'nc', name: 'NC 다이노스', channelId: 'UC8_FRgynMX8wlGsU6Jh3zKg' },
  { id: 'lotte', name: '롯데 자이언츠', channelId: 'UCAZQZdSY5_YrziMPqXi-Zfw' },
  { id: 'hanwha', name: '한화 이글스', channelId: 'UCdq4Ji3772xudYRUatdzRrg' },
  { id: 'kiwoom', name: '키움 히어로즈', channelId: 'UC_MA8-XEaVmvyayPzG66IKg' }
];

// ===== DB 캐시 시스템 (서버 재시행에도 유지) =====
function getCache(key) {
  return getYoutubeCache(key);
}
function setCache(key, data) {
  setYoutubeCache(key, data);
}

// ===== API 호출 (캐시 적용) =====
async function callAPI(url, params) {
  const res = await axios.get(url, { params: { ...params, key: API_KEY }, timeout: 3000 });
  return res.data;
}

// ===== ISO 8601 duration → 초 =====
function parseDuration(isoDuration) {
  const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// ===== 채널별 일반 영상 (3분 초과) =====
async function getLatestVideos(channelId, maxResults = 15) {
  const cacheKey = `videos_${channelId}_${maxResults}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await callAPI(`${API_BASE}/search`, {
      part: 'snippet', channelId, order: 'date',
      maxResults: maxResults * 3, type: 'video'
    });

    const items = data.items || [];
    if (items.length === 0) return [];

    const videoIds = items.map(i => i.id.videoId).filter(Boolean);
    const durData = await callAPI(`${API_BASE}/videos`, {
      part: 'contentDetails', id: videoIds.join(',')
    });

    const durMap = {};
    (durData.items || []).forEach(i => { durMap[i.id] = parseDuration(i.contentDetails.duration); });

    const result = items
      .filter(i => (durMap[i.id.videoId] || 0) > 180)
      .slice(0, maxResults)
      .map(i => ({
        videoId: i.id.videoId,
        title: i.snippet.title,
        thumbnail: i.snippet.thumbnails?.high?.url || i.snippet.thumbnails?.medium?.url,
        publishedAt: i.snippet.publishedAt,
        channelTitle: i.snippet.channelTitle,
        channelId: i.snippet.channelId
      }));

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[YouTube] 영상 실패:`, err.message);
    return [];
  }
}

// ===== 쇼츠 (3분 이하) =====
async function getShorts(channelId, maxResults = 20) {
  const cacheKey = `shorts_${channelId}_${maxResults}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await callAPI(`${API_BASE}/search`, {
      part: 'snippet', channelId, order: 'date',
      maxResults: maxResults * 2, type: 'video'
    });

    const items = data.items || [];
    if (items.length === 0) return [];

    const videoIds = items.map(i => i.id.videoId).filter(Boolean);
    const durData = await callAPI(`${API_BASE}/videos`, {
      part: 'contentDetails', id: videoIds.join(',')
    });

    const durMap = {};
    (durData.items || []).forEach(i => { durMap[i.id] = parseDuration(i.contentDetails.duration); });

    const result = items
      .filter(i => (durMap[i.id.videoId] || 999) <= 180)
      .slice(0, maxResults)
      .map(i => ({
        videoId: i.id.videoId,
        title: i.snippet.title,
        thumbnail: i.snippet.thumbnails?.high?.url || i.snippet.thumbnails?.medium?.url,
        publishedAt: i.snippet.publishedAt
      }));

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[YouTube] 쇼츠 실패:`, err.message);
    return [];
  }
}

// ===== 채널 정보 =====
async function getChannelInfo(channelId) {
  const cacheKey = `channel_${channelId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await callAPI(`${API_BASE}/channels`, {
      part: 'snippet,statistics', id: channelId
    });

    const item = data.items?.[0];
    if (!item) return null;

    const result = {
      channelId: item.id,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.high?.url,
      subscriberCount: item.statistics?.subscriberCount,
      videoCount: item.statistics?.videoCount,
      viewCount: item.statistics?.viewCount
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error(`[YouTube] 채널 정보 실패:`, err.message);
    return null;
  }
}

// ===== 모든 구단 영상 =====
async function getAllTeamVideos(maxPerTeam = 5) {
  const results = [];
  for (const team of KBO_CHANNELS) {
    const videos = await getLatestVideos(team.channelId, maxPerTeam);
    results.push({ ...team, videos });
  }
  return results;
}

module.exports = {
  KBO_CHANNELS,
  getLatestVideos,
  getAllTeamVideos,
  getChannelInfo,
  getShorts
};
