const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { initDB, getTeams, getArticleCountByTeam, getArticleCountByTeamId, getArticlesByTeam, getAllArticles, getCrawlLogs, getLastCrawlStatus, getTotalStats, createPost, getAllPosts, getPost, updatePost, deletePost } = require('./database');
const { initScheduler } = require('./scheduler');
const { KBO_CHANNELS, getLatestVideos, getChannelInfo, getShorts, getLatestAllTeamVideos, refreshAllYoutubeVideos } = require('./youtube');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads'),
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

initDB();
initScheduler();

// 서버 시작 시 YouTube 데이터 최초 갱신
setTimeout(() => {
  console.log('[YouTube] 서버 시작 - 초기 영상 갱신...');
  refreshAllYoutubeVideos().catch(e => console.error('[YouTube] 초기 갱신 실패:', e.message));
}, 5000);

const TITLE = '스포츠디비 - 스포츠를 더 즐겁고 가깝게';

app.get('/', async (req, res) => {
  try {
    const teams = getTeams();
    const teamCounts = getArticleCountByTeam();
    const allArticles = getAllArticles(999, 0);
    const recentPosts = getAllPosts().slice(0, 6);

    // DB에서 영상 읽기 (API 호출 없음)
    const sportsdbVideos = getLatestVideos('UCMStj0Bzmmf1frzu4WgJq2w', 15);
    const teamYoutubeVideos = getLatestAllTeamVideos(40);

    res.render('home', {
      title: TITLE, activeTab: 'home',
      sportsdbVideos: sportsdbVideos.slice(0, 6),
      teams, teamCounts, allArticles, recentPosts, teamYoutubeVideos
    });
  } catch (err) {
    console.error('[Home] 렌더링 오류:', err.message);
    res.render('home', {
      title: TITLE, activeTab: 'home',
      sportsdbVideos: [], teams: getTeams(), teamCounts: getArticleCountByTeam(),
      allArticles: getAllArticles(999, 0), teamYoutubeVideos: [], recentPosts: []
    });
  }
});

app.get('/sportsdb', async (req, res) => {
  try {
    const channelId = 'UCMStj0Bzmmf1frzu4WgJq2w';
    // 채널 정보만 API로, 영상은 DB에서
    let channelInfo = null;
    try {
      channelInfo = await getChannelInfo(channelId);
    } catch (e) { /* 채널 정보 없으면 넘어감 */ }
    const videos = getLatestVideos(channelId, 15);
    const shorts = getShorts(channelId, 20);
    res.render('sportsdb', { title: TITLE, activeTab: 'sportsdb', channelInfo, videos, shorts });
  } catch (err) {
    res.render('sportsdb', { title: TITLE, activeTab: 'sportsdb', channelInfo: null, videos: [], shorts: [] });
  }
});

app.get('/press', (req, res) => {
  const teams = getTeams();
  const teamCounts = getArticleCountByTeam();
  const selectedTeam = req.query.team || 'all';
  const page = parseInt(req.query.page) || 1;
  const perPage = 10;
  const offset = (page - 1) * perPage;
  let articles = [], totalCount = 0, totalPages = 1, currentPage = page;
  if (selectedTeam === 'all') {
    articles = getAllArticles(999, 0);
    totalCount = articles.length;
  } else {
    totalCount = getArticleCountByTeamId(selectedTeam);
    articles = getArticlesByTeam(selectedTeam, perPage, offset);
    totalPages = Math.ceil(totalCount / perPage);
  }
  res.render('press', { title: TITLE, activeTab: 'press', teams, teamCounts, articles, selectedTeam, currentPage, totalPages, totalCount });
});

app.get('/youtube', async (req, res) => {
  try {
    const teamData = [];
    for (const team of KBO_CHANNELS) {
      const videos = getLatestVideos(team.channelId, 5);
      if (videos.length > 0) {
        teamData.push({ ...team, videos });
      }
    }
    res.render('youtube', { title: TITLE, activeTab: 'youtube', teamData });
  } catch (err) {
    res.render('youtube', { title: TITLE, activeTab: 'youtube', teamData: [] });
  }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.json({ success: false, message: '파일이 없습니다.' });
  res.json({ success: true, url: '/uploads/' + req.file.filename });
});

app.post('/api/articles', (req, res) => {
  upload.single('image')(req, res, function(err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.json({ success: false, message: '파일 크기가 너무 큽니다. 최대 10MB까지 업로드 가능합니다.' });
      return res.json({ success: false, message: '파일 업로드 중 오류가 발생했습니다: ' + err.message });
    }
    const { title, content } = req.body;
    if (!title) return res.json({ success: false, message: '제목을 입력하세요.' });
    res.json({ success: true, id: createPost(title, content, req.file ? '/uploads/' + req.file.filename : null) });
  });
});

app.get('/api/posts', (req, res) => res.json(getAllPosts()));

app.put('/api/posts/:id', upload.single('image'), (req, res) => {
  const { title, content } = req.body;
  if (!title) return res.json({ success: false, message: '제목을 입력하세요.' });
  updatePost(req.params.id, title, content, req.file ? '/uploads/' + req.file.filename : null);
  res.json({ success: true });
});

app.delete('/api/posts/:id', (req, res) => {
  deletePost(req.params.id);
  res.json({ success: true });
});

app.get('/admin/articles/:id/edit', (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return res.redirect('/admin');
  res.render('admin_article_edit', { title: TITLE, activeTab: '', post });
});

app.post('/admin/articles/:id/edit', upload.single('image'), (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return res.redirect('/admin');
  updatePost(req.params.id, req.body.title, req.body.content, req.file ? '/uploads/' + req.file.filename : null);
  res.redirect('/admin');
});

app.get('/articles', (req, res) => {
  res.render('articles', { title: TITLE, activeTab: 'articles', articles: getAllPosts() });
});

app.get('/articles/:id', (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return res.redirect('/articles');
  res.render('article_detail', { title: TITLE, activeTab: 'articles', post });
});

app.get('/admin', (req, res) => {
  res.render('admin', {
    title: TITLE, activeTab: '',
    stats: getTotalStats(),
    teamStatus: getLastCrawlStatus(),
    logs: getCrawlLogs(50)
  });
});

app.listen(PORT, () => console.log(`🏟️  SportsDB 서버 실행 중: http://localhost:${PORT}`));

module.exports = app;
