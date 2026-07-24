const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const LIST_URL = 'https://www.ncdinos.com/dinos/news.do';

async function fetchPage(page) {
  const response = await axios.get(LIST_URL, {
    params: { pageNo: page },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    },
    timeout: 30000
  });
  return response.data;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];
  const dateMap = {};

  // 1차: notice/event 전용 섹션에서 날짜 수집 (더 정확함)
  $('#board_list_notice li, #board_list_event li').each((i, li) => {
    const $li = $(li);
    const link = $li.find('a[href*="view.do?seq="]').first();
    if (!link.length) return;
    const seq = link.attr('href').match(/seq=(\d+)/);
    if (seq) {
      const date = $li.find('.date').first().text().trim();
      if (date.match(/\d{4}-\d{2}-\d{2}/)) {
        dateMap[seq[1]] = date;
      }
    }
  });

  // 2차: 모든 <li>에서 기사 수집 (날짜는 dateMap 활용)
  $('li').each((i, li) => {
    const $li = $(li);
    const link = $li.find('a[href*="view.do?seq="]').first();
    if (!link.length) return;

    const href = link.attr('href');
    const seqMatch = href.match(/seq=(\d+)/);
    if (!seqMatch) return;
    const seq = seqMatch[1];

    let title = link.text().trim();
    if (!title || title.length < 2) return;

    // 카테고리
    const category = $li.find('.cate').first().text().trim();
    const type = category === '이벤트' ? 'event' : 'notice';

    // 날짜 (dateMap 우선, 없으면 현재 li에서 찾기)
    let date = dateMap[seq] || null;
    if (!date) {
      const d = $li.find('.date').first().text().trim();
      if (d.match(/\d{4}-\d{2}-\d{2}/)) date = d;
    }

    title = title.replace(/&amp;/g, '&').replace(/&hellip;/g, '…').replace(/&middot;/g, '·').replace(/&#39;/g, "'");

    items.push({
      seq,
      title,
      url: `https://www.ncdinos.com/dinos/${type}/view.do?seq=${seq}`,
      date
    });
  });

  // URL 기준 중복 제거
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function crawlNcPress(maxPages = 7) {
  console.log(`[NC] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      let html;
      try {
        html = await fetchPage(page);
      } catch (err) {
        console.log(`[NC] ${page}페이지 에러, 중단 (${err.message})`);
        break;
      }

      const items = parsePage(html);
      if (items.length === 0) {
        console.log(`[NC] ${page}페이지: 데이터 없음`);
        break;
      }

      totalFetched += items.length;

      for (const item of items) {
        try {
          upsertArticle({
            team_id: 'nc',
            article_seq: item.seq,
            title: item.title,
            url: item.url,
            summary: null,
            thumbnail: null,
            view_count: 0,
            published_at: item.date
          });
          newCount++;
        } catch (err) {}
      }

      console.log(`[NC] ${page}/${maxPages}페이지 완료 (${items.length}건)`);
    }

    console.log(`[NC] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[NC] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlNcPress };
