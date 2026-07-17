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

async function crawlKtPress(maxItems = 200) {
  console.log(`[KT] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  try {
    const response = await axios.get(API_URL, {
      params: {
        'article.boardCode': '001',
        'search.max': maxItems
      },
      timeout: 15000
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
