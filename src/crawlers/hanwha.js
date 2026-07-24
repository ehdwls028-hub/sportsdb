const axios = require('axios');
const { upsertArticle } = require('../database');

const API_URL = 'https://www.hanwhaeagles.co.kr/FA/CN/PCFACN01.do';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.hanwhaeagles.co.kr/',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
};

function formatDate(dateStr) {
  if (!dateStr) return null;
  return dateStr.replace(/\./g, '-');
}

// 재시도 포함 API 호출
async function fetchWithRetry(url, config, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { ...config, timeout: 45000 });
    } catch (err) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        console.log(`[한화] 타임아웃, ${attempt}차 재시도 중...`);
        await new Promise(r => setTimeout(r, attempt * 3000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('timeout (3회 재시도 실패)');
}

async function crawlHanwhaPress(maxItems = 200) {
  console.log(`[한화] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  try {
    const response = await fetchWithRetry(API_URL, {
      params: { start: 0, length: maxItems },
      headers: BROWSER_HEADERS
    });

    const list = response.data?.result?.data || [];
    const totalCount = response.data?.result?.total || 0;

    if (list.length === 0) {
      console.log('[한화] 데이터 없음');
      return { total: 0, new: 0, totalCount };
    }

    let newCount = 0;

    for (const item of list) {
      const title = (item.TITLE || '').trim();
      const url = `https://www.hanwhaeagles.co.kr/FA/CN/PCFACN02.do?&id=${item.ID}`;
      const date = item.PUB_DATE ? formatDate(item.PUB_DATE) : null;

      try {
        upsertArticle({
          team_id: 'hanwha',
          article_seq: String(item.ID),
          title,
          url,
          summary: null,
          thumbnail: null,
          view_count: item.VISITS || 0,
          published_at: date
        });
        newCount++;
      } catch (err) {}
    }

    console.log(`[한화] ${list.length}건 중 ${newCount}건 신규 저장 (DB 전체: ${totalCount}건)`);
    return { total: list.length, new: newCount, totalCount };

  } catch (err) {
    console.error('[한화] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlHanwhaPress };
