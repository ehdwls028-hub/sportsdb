const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const LIST_URL = 'https://www.ssglanders.com/media/news';
const DETAIL_URL = 'https://www.ssglanders.com/media/news/detail';

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

  $('[onclick*="idx="]').each((i, el) => {
    const onclick = $(el).attr('onclick');
    if (!onclick) return;

    const match = onclick.match(/idx=(\d+)/);
    if (!match) return;
    const idx = match[1];

    // 부모 블록(.inline-block 스타일)
    const $parent = $(el).closest('[style*="inline-block"]');
    if (!$parent.length) return;

    // 제목
    const title = $parent.find('h4').first().text().trim();
    if (!title || title.length < 2) return;

    // 썸네일 (background-image)
    let thumbnail = null;
    const bgDiv = $parent.find('[style*="background-image"]').first();
    if (bgDiv.length) {
      const bgStyle = bgDiv.attr('style') || '';
      const bgMatch = bgStyle.match(/url\(([^)]+)\)/);
      if (bgMatch) thumbnail = bgMatch[1];
    }

    // 날짜 (컨텐츠 끝부분의 "2026.07.16" 패턴)
    const contentText = $parent.text();
    const dateMatch = contentText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;

    if (items.some(item => item.idx === idx)) return;

    items.push({
      idx,
      title,
      url: `${DETAIL_URL}?idx=${idx}`,
      thumbnail,
      date
    });
  });

  return items;
}

async function crawlSsgPress(maxPages = 25) {
  console.log(`[SSG] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      let html;
      try {
        html = await fetchPage(page);
      } catch (err) {
        console.log(`[SSG] ${page}페이지 에러, 중단`);
        break;
      }

      const items = parsePage(html);
      if (items.length === 0) {
        console.log(`[SSG] ${page}페이지: 데이터 없음`);
        break;
      }

      totalFetched += items.length;

      for (const item of items) {
        try {
          upsertArticle({
            team_id: 'ssg',
            article_seq: item.idx,
            title: item.title,
            url: item.url,
            summary: null,
            thumbnail: item.thumbnail,
            view_count: 0,
            published_at: item.date
          });
          newCount++;
        } catch (err) {}
      }

      if (page % 5 === 0) console.log(`[SSG] ${page}/${maxPages}페이지 완료 (누적 ${totalFetched}건)`);
    }

    console.log(`[SSG] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[SSG] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlSsgPress };
