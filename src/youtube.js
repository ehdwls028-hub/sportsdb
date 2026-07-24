require('dotenv').config();
const axios = require('axios');
const { upsertYoutubeVideo, getStoredVideos, getAllStoredTeamVideos, getLatestStoredAllTeamVideos, clearYoutubeVideos } = require('./database');

const API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = 'https://www.googleapis.com/youtube/v3';

const SPORTSDB_CHANNEL_ID = 'UCMStj0Bzmmf1frzu4WgJq2w';

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

// ===== ISO 8601 duration → 초 =====
function parseDuration(isoDuration) {
  const m = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// ===== API 호출 (재시도 포함) =====
async function callAPI(url, params, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        params: { ...params, key: API_KEY },
        timeout: 10000
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 429) {
        const wait = attempt * 2000;
        console.log(`[YouTube] 429 할당량 초과, ${wait / 1000}초 후 재시도...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('429 retries exhausted');
}

// ===== 채널의 모든 영상 가져와서 DB 저장 =====
async function refreshChannelVideos(channelId, teamId = null, maxResults = 50) {
  try {
    // 1. 검색 API로 최신 영상 목록 가져오기
    const searchData = await callAPI(`${API_BASE}/search`, {
      part: 'snippet',
      channelId,
      order: 'date',
      maxResults,
      type: 'video'
    });

    const items = searchData.items || [];
    if (items.length === 0) return 0;

    // 2. 영상 ID 목록으로 duration 조회
    const videoIds = items.map(i => i.id.videoId).filter(Boolean);
    const durData = await callAPI(`${API_BASE}/videos`, {
      part: 'contentDetails',
      id: videoIds.join(',')
    });

    const durMap = {};
    (durData.items || []).forEach(i => {
      durMap[i.id] = parseDuration(i.contentDetails.duration);
    });

    // 3. DB에 저장
    let saved = 0;
    for (const item of items) {
      const videoId = item.id.videoId;
      if (!videoId) continue;

      const duration = durMap[videoId] || 0;
      const isShort = duration > 0 && duration <= 180;

      try {
        upsertYoutubeVideo({
          video_id: videoId,
          channel_id: channelId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
          published_at: item.snippet.publishedAt,
          duration_seconds: duration,
          team_id: teamId,
          is_short: isShort
        });
        saved++;
      } catch (e) {
        // 중복 무시
      }
    }

    return saved;
  } catch (err) {
    console.error(`[YouTube] ${channelId} 갱신 실패:`, err.message);
    return 0;
  }
}

// ===== 채널 정보 가져오기 =====
async function getChannelInfo(channelId) {
  try {
    const data = await callAPI(`${API_BASE}/channels`, {
      part: 'snippet,statistics',
      id: channelId
    });

    const item = data.items?.[0];
    if (!item) return null;

    return {
      channelId: item.id,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.high?.url,
      subscriberCount: item.statistics?.subscriberCount,
      videoCount: item.statistics?.videoCount,
      viewCount: item.statistics?.viewCount
    };
  } catch (err) {
    console.error(`[YouTube] 채널 정보 실패:`, err.message);
    return null;
  }
}

// ===== 모든 채널 영상 갱신 (스케줄러용) =====
async function refreshAllYoutubeVideos() {
  console.log('[YouTube] 전체 영상 갱신 시작...');

  // SportsDB 채널
  const sportsdbCount = await refreshChannelVideos(SPORTSDB_CHANNEL_ID, null, 50);
  console.log(`[YouTube] SportsDB: ${sportsdbCount}건 저장`);

  // 10개 구단 채널 (순차적으로, API 할당량 고려)
  let totalSaved = sportsdbCount;
  for (const team of KBO_CHANNELS) {
    await new Promise(r => setTimeout(r, 500)); // 호출 간격 0.5초
    const count = await refreshChannelVideos(team.channelId, team.id, 50);
    console.log(`[YouTube] ${team.name}: ${count}건 저장`);
    totalSaved += count;
  }

  console.log(`[YouTube] 전체 갱신 완료: ${totalSaved}건`);
  return totalSaved;
}

// ===== DB에서 영상 조회 (페이지 렌더링용) =====
function getLatestVideos(channelId, maxResults = 15) {
  return getStoredVideos(channelId, maxResults, 0);
}

function getShorts(channelId, maxResults = 20) {
  return getStoredVideos(channelId, maxResults, 1);
}

function getAllTeamVideos(limitPerTeam = 5) {
  return getAllStoredTeamVideos(limitPerTeam, 0);
}

function getLatestAllTeamVideos(limit = 20) {
  return getLatestStoredAllTeamVideos(limit);
}

module.exports = {
  KBO_CHANNELS,
  SPORTSDB_CHANNEL_ID,
  getLatestVideos,
  getAllTeamVideos,
  getChannelInfo,
  getShorts,
  getLatestAllTeamVideos,
  refreshAllYoutubeVideos
};
