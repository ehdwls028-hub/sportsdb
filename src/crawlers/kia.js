const axios = require('axios');
const { upsertArticle } = require('../database');

const API_BASE = 'https://tigers.co.kr/v1';
const API_HEADERS = {
  'AKey': 'f68cNbKYSKJYan41zIcjOmbRUxQ=',
  'App-Agent': 'platformCode=70;platformVer=1.0.0;deviceId=WEB;appName=tigersWeb;appVer=1.0.0;deviceModel=Browser;'
};

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&rsquo;|&lsquo;|&ldquo;|&rdquo;|&nbsp;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// KIA 보도자료 크롤링 (search.max 지원)
async function crawlKiaPress(maxItems = 200) {
  console.log(`[KIA] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  try {
    const response = await axios.get(`${API_BASE}/article/getArticleList`, {
      headers: API_HEADERS,
      params: {
        'article.boardCode': 'press_release',
        'search.max': maxItems
      },
      timeout: 15000
    });

    const list = response.data?.data?.list || [];
    if (list.length === 0) {
      console.log('[KIA] 데이터 없음');
      return { total: 0, new: 0 };
    }

    let newCount = 0;

    for (const item of list) {
      const title = stripHtml(item.artcTitle);
      const content = stripHtml(item.artcContent);
      const summary = content.length > 200 ? content.substring(0, 200) + '...' : content;
      const url = `https://tigers.co.kr/contents/press/${item.artcSeq}`;
      const thumbnail = item.imgFilePath || null;
      const date = item.regDttm ? formatDate(item.regDttm) : null;

      try {
        upsertArticle({
          team_id: 'kia',
          article_seq: String(item.artcSeq),
          title,
          url,
          summary,
          thumbnail,
          view_count: item.viewCnt || 0,
          published_at: date
        });
        newCount++;
      } catch (err) {}
    }

    console.log(`[KIA] ${list.length}건 중 ${newCount}건 신규 저장`);
    return { total: list.length, new: newCount };

  } catch (err) {
    console.error('[KIA] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlKiaPress };
