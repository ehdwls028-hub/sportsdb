const cron = require('node-cron');
const { addCrawlLog } = require('./database');
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
const { refreshAllYoutubeVideos } = require('./youtube');

// 크롤링 실행 + 로그 저장
async function crawlAndLog(teamId, crawlerFn, label, ...args) {
  try {
    const result = await crawlerFn(...args);
    addCrawlLog(teamId, 'success', result.total, result.new, null);
    console.log(`[${label}] ✅ ${result.new}건 신규 (총 ${result.total}건)`);
    return { team: label, ...result };
  } catch (err) {
    addCrawlLog(teamId, 'error', 0, 0, err.message);
    console.log(`[${label}] ❌ 에러: ${err.message}`);
    return { team: label, error: err.message };
  }
}

async function runAllCrawlers() {
  console.log('🕷️ 크롤러 시작:', new Date().toLocaleString());
  const results = [];
  results.push(await crawlAndLog('kia', crawlKiaPress, 'KIA'));
  results.push(await crawlAndLog('doosan', crawlDoosanPress, '두산'));
  results.push(await crawlAndLog('hanwha', crawlHanwhaPress, '한화'));
  results.push(await crawlAndLog('kiwoom', () => crawlKiwoomPress(1), '키움'));
  results.push(await crawlAndLog('kt', crawlKtPress, 'KT'));
  results.push(await crawlAndLog('lg', () => crawlLgPress(1), 'LG'));
  results.push(await crawlAndLog('lotte', () => crawlLottePress(1), '롯데'));
  results.push(await crawlAndLog('nc', () => crawlNcPress(1), 'NC'));
  results.push(await crawlAndLog('samsung', () => crawlSamsungPress(1), '삼성'));
  results.push(await crawlAndLog('ssg', () => crawlSsgPress(1), 'SSG'));
  console.log('✅ 크롤러 완료:', JSON.stringify(results));
  return results;
}

async function backfillAll() {
  console.log('🔄 최초 데이터 수집 시작...');
  const results = [];
  results.push(await crawlAndLog('kia', crawlKiaPress, 'KIA'));
  results.push(await crawlAndLog('doosan', crawlDoosanPress, '두산'));
  results.push(await crawlAndLog('hanwha', crawlHanwhaPress, '한화'));
  results.push(await crawlAndLog('kiwoom', () => crawlKiwoomPress(11), '키움'));
  results.push(await crawlAndLog('kt', crawlKtPress, 'KT'));
  results.push(await crawlAndLog('lg', () => crawlLgPress(1), 'LG'));
  results.push(await crawlAndLog('lotte', () => crawlLottePress(20), '롯데'));
  results.push(await crawlAndLog('nc', () => crawlNcPress(8), 'NC'));
  results.push(await crawlAndLog('samsung', () => crawlSamsungPress(20), '삼성'));
  results.push(await crawlAndLog('ssg', () => crawlSsgPress(25), 'SSG'));
  console.log('✅ 크롤러 완료:', JSON.stringify(results));
  return results;
}

function initScheduler() {
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏰ 스케줄 실행: 30분 간격 크롤링');
    await runAllCrawlers();
  });

  console.log('⏰ 크론 스케줄 등록 완료 (30분 간격)');

  // YouTube 4시간마다 갱신 (할당량 10,000 units/day 고려)
  cron.schedule('0 */4 * * *', async () => {
    console.log('⏰ 유튜브 영상 갱신 시작...');
    try {
      await refreshAllYoutubeVideos();
      console.log('✅ 유튜브 영상 갱신 완료');
    } catch (err) {
      console.error('❌ 유튜브 갱신 실패:', err.message);
    }
  });

  setTimeout(async () => {
    console.log('🚀 첫 번째 실행: 과거 데이터 수집 시작...');
    await backfillAll();
  }, 10000);
}

async function runOnce() {
  return await runAllCrawlers();
}

module.exports = { initScheduler, runOnce };
