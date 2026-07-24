const axios = require('axios');
const { upsertArticle } = require('../database');

const API_URL = 'https://www.ktwiz.co.kr/api/v2/article/listByCategory';
const DETAIL_URL = 'https://www.ktwiz.co.kr/media/wiznews';

function formatDate(timestamp) {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 재시도 포함 API 호출
async function fetchWithRetry(url, config, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { ...config, timeout: 30000 });
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        console.log(`[KT] 타임아웃, ${attempt}차 재시도 중...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('timeout (3회 재시도 실패)');
}

async function crawlKtPress(maxItems = 200) {
  console.log(`[KT] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  try {
    const response = await fetchWithRetry(API_URL, {
      params: {
        'article.boardCode': '001',
        'search.max': maxItems
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const list = response.data?.data?.list || [];
    if (list.length === 0) {
      console.log('[KT] 데이터 없음');
      return { total: 0, new: 0 };
    }

    let newCount = 0;

    for (const item of list) {
      const title = (item.artcTitle || '').trim();
      const url = `${DETAIL_URL}/${item.artcSeq}`;
      const thumbnail = item.imgFilePath || null;
      const date = item.regDttm ? formatDate(item.regDttm) : null;

      try {
        upsertArticle({
          team_id: 'kt',
          article_seq: String(item.artcSeq),
          title,
          url,
          summary: null,
          thumbnail,
          view_count: item.viewCnt || 0,
          published_at: date
        });
        newCount++;
      } catch (err) {}
    }

    console.log(`[KT] ${list.length}건 중 ${newCount}건 신규 저장`);
    return { total: list.length, new: newCount };

  } catch (err) {
    console.error('[KT] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlKtPress };
