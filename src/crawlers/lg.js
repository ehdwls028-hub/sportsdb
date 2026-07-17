const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const LIST_URL = 'https://www.lgtwins.com/twins/feed/news';
const DETAIL_URL = 'https://www.lgtwins.com/twins/feed/news/detail';

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

  $('a[href*="snSeq="]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const match = href.match(/snSeq=(\d+)/);
    if (!match) return;

    const id = match[1];
    let title = $(el).text().trim();
    if (!title || title.length < 2) return;
    if (items.some(item => item.id === id)) return;

    // 앞에 붙은 숫자(글번호) 제거
    title = title.replace(/^\d+\s*/, '');

    items.push({ id, title });
  });

  return items;
}

function extractDate(html, id) {
  // HTML에서 해당 ID 근처의 날짜 찾기
  const $ = cheerio.load(html);
  let foundDate = null;

  $(`a[href*="snSeq=${id}"]`).each((i, el) => {
    const parentHtml = $(el).parent().html() || '';
    const dateMatch = parentHtml.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    if (dateMatch) {
      foundDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
  });

  return foundDate;
}

async function crawlLgPress(maxPages = 47) {
  console.log(`[LG] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    // 첫 페이지에서 전체 구조 파악
    const firstHtml = await fetchPage(1);
    const firstItems = parsePage(firstHtml);

    // 첫 페이지에서 각 항목의 날짜 추출 시도
    for (const item of firstItems) {
      item.date = extractDate(firstHtml, item.id);
    }

    if (firstItems.length === 0) {
      console.log('[LG] 데이터 없음');
      return { total: 0, new: 0 };
    }

    totalFetched += firstItems.length;

    for (const item of firstItems) {
      const url = `${DETAIL_URL}?snSeq=${item.id}`;

      try {
        upsertArticle({
          team_id: 'lg',
          article_seq: item.id,
          title: item.title,
          url,
          summary: null,
          thumbnail: null,
          view_count: 0,
          published_at: item.date || null
        });
        newCount++;
      } catch (err) {}
    }

    console.log(`[LG] 1/${maxPages}페이지 완료 (${firstItems.length}건)`);

    // 나머지 페이지 처리 (2페이지부터)
    for (let page = 2; page <= maxPages; page++) {
      try {
        const html = await fetchPage(page);
        const items = parsePage(html);

        if (items.length === 0) break;

        // 각 항목의 날짜 추출
        for (const item of items) {
          item.date = extractDate(html, item.id);
        }

        totalFetched += items.length;

        for (const item of items) {
          const url = `${DETAIL_URL}?snSeq=${item.id}`;

          try {
            upsertArticle({
              team_id: 'lg',
              article_seq: item.id,
              title: item.title,
              url,
              summary: null,
              thumbnail: null,
              view_count: 0,
              published_at: item.date || null
            });
            newCount++;
          } catch (err) {}
        }

        console.log(`[LG] ${page}/${maxPages}페이지 완료 (${items.length}건)`);
      } catch (err) {
        console.log(`[LG] ${page}페이지 에러, 중단`);
        break;
      }
    }

    console.log(`[LG] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[LG] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlLgPress };
