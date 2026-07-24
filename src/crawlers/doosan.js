const axios = require('axios');
const https = require('https');
const { upsertArticle } = require('../database');

// GitHub Actions Linux 환경에서 SSL 검증 우회
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'https://www.doosanbears.com/doosan/v1';

const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json-patch+json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  timeout: 30000,
  httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true })
});

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&rsquo;|&lsquo;|&ldquo;|&rdquo;|&nbsp;|&lt;|&gt;|&quot;/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return dateStr.split('T')[0];
}

async function crawlDoosanPress(maxItems = 200) {
  console.log(`[두산] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  try {
    const response = await apiClient.get('/web/doorun/team-news', {
      params: { page: 0, size: maxItems },
      headers: {
        'Referer': 'https://www.doosanbears.com/doorundoorun/news'
      }
    });

    const list = response.data?.content || [];
    const totalCount = response.data?.pageInfo?.totalElements || 0;

    if (list.length === 0) {
      console.log('[두산] 데이터 없음');
      return { total: 0, new: 0, totalCount };
    }

    let newCount = 0;

    for (const item of list) {
      const title = stripHtml(item.title);
      const summary = stripHtml(item.content || '');
      const url = `https://www.doosanbears.com/doorundoorun/news/${item.id}`;
      const date = item.showDate ? formatDate(item.showDate) : null;

      try {
        upsertArticle({
          team_id: 'doosan',
          article_seq: String(item.id),
          title,
          url,
          summary: summary.length > 200 ? summary.substring(0, 200) + '...' : summary,
          thumbnail: null, // 두산 API는 이미지 없음
          view_count: 0,
          published_at: date
        });
        newCount++;
      } catch (err) {}
    }

    console.log(`[두산] ${list.length}건 중 ${newCount}건 신규 저장 (DB 전체: ${totalCount}건)`);
    return { total: list.length, new: newCount, totalCount };

  } catch (err) {
    console.error('[두산] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlDoosanPress };
