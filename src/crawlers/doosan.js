const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

// GitHub Actions Linux 환경에서 SSL 검증 우회
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_BASE = 'https://www.doosanbears.com/doosan/v1';
const NEWS_URL = 'https://www.doosanbears.com/doorundoorun/news';

const BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.doosanbears.com/doorundoorun/news'
};

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

function makeAgent() {
  return new https.Agent({ rejectUnauthorized: false });
}

// 방법 1: API 직접 호출
async function tryAPIFetch(maxItems) {
  const response = await axios.get(`${API_BASE}/web/doorun/team-news`, {
    params: { page: 0, size: maxItems },
    headers: BROWSER_HEADERS,
    timeout: 30000,
    httpsAgent: makeAgent()
  });
  return response.data?.content || [];
}

// 방법 2: HTML 페이지 스크래핑 (API 실패 시 폴백)
async function tryHTMLScrape(maxItems) {
  const response = await axios.get(NEWS_URL, {
    headers: {
      ...BROWSER_HEADERS,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 30000,
    httpsAgent: makeAgent()
  });

  const $ = cheerio.load(response.data);
  const items = [];

  // 두산 뉴스 페이지에서 기사 목록 추출 시도
  $('a[href*="/doorundoorun/news/"]').each((i, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const idMatch = href.match(/\/news\/(\d+)/);
    if (!idMatch) return;

    const id = idMatch[1];
    const title = ($el.find('.title, h3, strong').text() || $el.text()).trim();
    if (!title || title.length < 3) return;

    // 중복 방지
    if (items.some(item => item.id === id)) return;

    // 날짜 시도
    let date = null;
    const dateEl = $el.closest('li, div, .item').find('.date, time, .time');
    if (dateEl.length) {
      date = dateEl.text().trim();
    }

    items.push({ id, title, date });
  });

  // 만약 위 방식으로 못 찾았으면, script 태그에서 데이터 추출 시도
  if (items.length === 0) {
    const scripts = $('script').map((i, el) => $(el).html()).get();
    for (const script of scripts) {
      if (!script) continue;
      // JSON 데이터 포함 여부 확인
      const matches = script.match(/\"title\"\s*:\s*\"([^\"]+)\"/g);
      if (matches && matches.length > 3) {
        // JSON-LD 또는 초기 상태 데이터에서 추출
        try {
          const jsonMatches = [...script.matchAll(/\{[^}]*\"title\"\s*:\s*\"([^\"]+)\"[^}]*\"id\"\s*:\s*(\d+)[^}]*\}/g)];
          for (const m of jsonMatches) {
            if (items.some(item => item.id === m[2])) continue;
            items.push({ id: m[2], title: m[1], date: null });
          }
        } catch (e) {}
        if (items.length > 0) break;
      }
    }
  }

  return items.slice(0, maxItems);
}

async function crawlDoosanPress(maxItems = 200) {
  console.log(`[두산] 보도자료 크롤링 시작... (최대 ${maxItems}건)`);

  let list = [];

  // 먼저 API 시도
  try {
    list = await tryAPIFetch(maxItems);
    console.log(`[두산] API 호출 성공: ${list.length}건`);
  } catch (apiErr) {
    console.log(`[두산] API 실패 (${apiErr.message}), HTML 스크래핑 시도...`);
    try {
      list = await tryHTMLScrape(maxItems);
      console.log(`[두산] HTML 스크래핑 성공: ${list.length}건`);
    } catch (htmlErr) {
      console.error('[두산] HTML 스크래핑도 실패:', htmlErr.message);
      throw htmlErr;
    }
  }

  if (list.length === 0) {
    console.log('[두산] 데이터 없음');
    return { total: 0, new: 0, totalCount: 0 };
  }

  let newCount = 0;

  for (const item of list) {
    const title = item.title ? stripHtml(item.title) : '';
    if (!title) continue;

    try {
      upsertArticle({
        team_id: 'doosan',
        article_seq: String(item.id),
        title,
        url: `https://www.doosanbears.com/doorundoorun/news/${item.id}`,
        summary: item.summary || null,
        thumbnail: null,
        view_count: 0,
        published_at: item.date || null
      });
      newCount++;
    } catch (err) {}
  }

  console.log(`[두산] ${list.length}건 중 ${newCount}건 신규 저장`);
  return { total: list.length, new: newCount, totalCount: list.length };

}

module.exports = { crawlDoosanPress };
