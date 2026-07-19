const { initDB, upsertArticle } = require('./database');

// 크롤러 임포트
const { crawlKiaPress } = require('./crawlers/kia');
const { crawlDoosanPress } = require('./crawlers/doosan');
const { crawlHanwhaPress } = require('./crawlers/hanwha');
const { crawlKiwoomPress } = require('./crawlers/kiwoom');
const { crawlKtPress } = require('./crawlers/kt');
const { crawlLgPress } = require('./crawlers/lg');
const { crawlLottePress } = require('./crawlers/lotte');
const { crawlNcPress } = require('./crawlers/nc');
const { crawlSamsungPress } = require('./crawlers/samsung');
const { crawlSsgPress } = require('./crawlers/ssg');

// DB 초기화
initDB();

async function run() {
  console.log('🕷️ GitHub Actions 크롤러 시작:', new Date().toLocaleString());
  
  const crawlers = [
    ['KIA',   () => crawlKiaPress(200)],
    ['두산',  () => crawlDoosanPress(200)],
    ['한화',  () => crawlHanwhaPress(200)],
    ['키움',  () => crawlKiwoomPress(1)],
    ['KT',    () => crawlKtPress(200)],
    ['LG',    () => crawlLgPress(1)],
    ['롯데',  () => crawlLottePress(1)],
    ['NC',    () => crawlNcPress(1)],
    ['삼성',  () => crawlSamsungPress(1)],
    ['SSG',   () => crawlSsgPress(1)]
  ];

  let success = 0;
  let fail = 0;

  for (const [name, fn] of crawlers) {
    try {
      const result = await fn();
      console.log(`✅ ${name}: ${result.total}건 중 ${result.new}건 신규`);
      success++;
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n📊 결과: ${success}성공 / ${fail}실패`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
