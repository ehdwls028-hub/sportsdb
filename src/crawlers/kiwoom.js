const axios = require('axios');
const cheerio = require('cheerio');
const { upsertArticle } = require('../database');

const API_URL = 'https://heroesbaseball.co.kr/story/heroesNews/list.do';
const VIEW_URL = 'https://heroesbaseball.co.kr/story/heroesNews/view.do';

// 페이지당 10~13개, 최대 11페이지 = 약 110건
// 평소 크론: 1페이지(최신 10건), 최초 백필: 11페이지(전체)

async function fetchPage(page) {
  const response = await axios.get(API_URL, {
    params: { cPage: page },
    timeout: 10000
  });
  return response.data;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  // 구단 소식 리스트 파싱
  $('a[href*="view.do?num="]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const numMatch = href.match(/num=(\d+)/);
    if (!numMatch) return;

    const id = numMatch[1];
    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    // 중복 제거 (같은 ID가 여러 선택자에 걸릴 수 있음)
    if (items.some(item => item.id === id)) return;

    items.push({ id, title });
  });

  // 날짜 찾기 (숫자 패턴으로)
  const dateRegex = /(\d{4})\.(\d{2})\.(\d{2})/g;
  const dates = [];
  let match;
  while ((match = dateRegex.exec(html)) !== null) {
    dates.push(`${match[1]}-${match[2]}-${match[3]}`);
  }

  // 아이템과 날짜 매칭 (최신순으로 정렬되어 있음)
  dates.reverse(); // HTML에서 찾은 순서대로
  items.forEach((item, i) => {
    if (i < dates.length) {
      item.date = dates[i];
    }
  });

  return items;
}

async function crawlKiwoomPress(maxPages = 11) {
  console.log(`[키움] 보도자료 크롤링 시작... (최대 ${maxPages}페이지)`);

  try {
    let totalFetched = 0;
    let newCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      const html = await fetchPage(page);
      const items = parsePage(html);

      if (items.length === 0) {
        console.log(`[키움] ${page}페이지: 데이터 없음, 중단`);
        break;
      }

      totalFetched += items.length;

      for (const item of items) {
        const url = `${VIEW_URL}?num=${item.id}`;

        try {
          upsertArticle({
            team_id: 'kiwoom',
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

      console.log(`[키움] ${page}/${maxPages}페이지 완료 (${items.length}건)`);
    }

    console.log(`[키움] 총 ${totalFetched}건 중 ${newCount}건 신규 저장`);
    return { total: totalFetched, new: newCount };

  } catch (err) {
    console.error('[키움] 크롤링 에러:', err.message);
    throw err;
  }
}

module.exports = { crawlKiwoomPress };
