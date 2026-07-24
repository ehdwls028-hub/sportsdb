const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const BASE_URL = 'https://www.giantsclub.com/html/';
const LIST_PARAMS = { pcode: 783, bcIdx: 2, PC: 20 };

async function fetchPage(page) {
  const response = await axios.get(BASE_URL, {
    params: { ...LIST_PARAMS, P: page },
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

  $('.news-list-item').each((i, el) => {
    const $el = $(el);

    // 카테고리
    const category = $el.find('.news-list-type p').text().trim();

    // 링크에서 bidx 추출
    const link = $el.find('a[href*="bidx="]').attr('href');
    if (!link) return;
    const bidxMatch = link.match(/bidx=(\d+)/);
    if (!bidxMatch) return;
    const bidx = bidxMatch[1];

    // 제목
    const title = $el.find('strong').text().trim();
    if (!title) return;

    // 날짜
    const day = $el.find('.news-list-date-day').text().trim();
    const monthYear = $el.find('.news-list-date-month').text().trim();
    let date = null;
    if (day && monthYear) {
      date = monthYear.replace(/\./g, '-') + '-' + day.padStart(2, '0');
    }

    // 썸네일
    let thumbnail = null;
    const img = $el.find('.news-thum img');
    if (img.length) {
      thumbnail = img.attr('src');
    }

    // 요약
    const summary = $el.find('.news-list-conts').text().trim().substring(0, 200);

    if (items.some(item => item.bidx === bidx)) return;
    items.push({ bidx, title, date, thumbnail, summary, category });
  });

  return items;
}

async function crawlLottePress(maxPages = 5) {
  console.log(`[롯데] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      let html;
      try {
        html = await fetchPage(page);
      } catch (err) {
        console.log(`[롯데] ${page}페이지 에러, 중단 (${err.message})`);
        break;
      }

      const items = parsePage(html);
      if (items.length === 0) {
        console.log(`[롯데] ${page}페이지: 데이터 없음, 중단`);
        break;
      }

      totalFetched += items.length;

      for (const item of items) {
        const url = `${BASE_URL}?pcode=783&bcIdx=2&MODE=V&bidx=${item.bidx}`;

        try {
          upsertArticle({
            team_id: 'lotte',
            article_seq: item.bidx,
            title: item.title,
            url,
            summary: item.summary || null,
            thumbnail: item.thumbnail || null,
            view_count: 0,
            published_at: item.date || null
          });
          newCount++;
        } catch (err) {}
      }

      console.log(`[롯데] ${page}/${maxPages}페이지 완료 (${items.length}건)`);
    }

    console.log(`[롯데] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[롯데] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlLottePress };
