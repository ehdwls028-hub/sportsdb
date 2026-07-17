const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const LIST_URL = 'https://www.samsunglions.com/intro/intro02.asp';

async function fetchPage(page) {
  const response = await axios.get(LIST_URL, {
    params: { page },
    timeout: 10000
  });
  return response.data;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('a[href*="act=view&idx="]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const match = href.match(/idx=(\d+)/);
    if (!match) return;

    const idx = match[1];
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;
    if (items.some(item => item.idx === idx)) return;

    // 날짜: 부모 tr에서 dat 클래스 찾기
    const $tr = $(el).closest('tr');
    const dateText = $tr.find('.dat').first().text().trim();
    const date = dateText.match(/\d{4}-\d{2}-\d{2}/) ? dateText : null;

    items.push({
      idx,
      title,
      url: `https://www.samsunglions.com/intro/intro02.asp?act=view&idx=${idx}`,
      date
    });
  });

  return items;
}

async function crawlSamsungPress(maxPages = 16) {
  console.log(`[삼성] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      let html;
      try {
        html = await fetchPage(page);
      } catch (err) {
        console.log(`[삼성] ${page}페이지 에러, 중단`);
        break;
      }

      const items = parsePage(html);
      if (items.length === 0) {
        console.log(`[삼성] ${page}페이지: 데이터 없음`);
        break;
      }

      totalFetched += items.length;

      for (const item of items) {
        try {
          upsertArticle({
            team_id: 'samsung',
            article_seq: item.idx,
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

      console.log(`[삼성] ${page}/${maxPages}페이지 완료 (${items.length}건)`);
    }

    console.log(`[삼성] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[삼성] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlSamsungPress };
