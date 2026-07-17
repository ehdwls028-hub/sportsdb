const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sportsdb.db');

let db;

function initDB() {
  // data 디렉토리 없으면 생성
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      color TEXT NOT NULL,
      logo_url TEXT DEFAULT NULL,
      icon_url TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      article_seq TEXT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      summary TEXT,
      thumbnail TEXT,
      view_count INTEGER DEFAULT 0,
      published_at TEXT,
      crawled_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_articles_team ON articles(team_id);
    CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_seq ON articles(article_seq);

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER DEFAULT 0,
      new_items INTEGER DEFAULT 0,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_crawl_logs_team ON crawl_logs(team_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_logs_date ON crawl_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS youtube_cache (
      cache_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      thumbnail TEXT,
      published_at TEXT DEFAULT (datetime('now', 'localtime')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // 기본 구단 데이터
  const count = db.prepare('SELECT COUNT(*) as cnt FROM teams').get();
  if (count.cnt === 0) {
    const insert = db.prepare('INSERT INTO teams (id, name, emoji, color, logo_url, icon_url) VALUES (?, ?, ?, ?, ?, ?)');
    const teams = [
      ['kia', 'KIA 타이거즈', '🐯', '#EA0029', 'https://tigers.co.kr/img/sub/emblem01_01.png', 'https://tigers.co.kr/img/sub/emblem02_01.png'],
      ['samsung', '삼성 라이온즈', '🦅', '#0055A5', null, null],
      ['lg', 'LG 트윈스', '🦁', '#C30452', null, null],
      ['doosan', '두산 베어스', '🐻', '#131230', null, null],
      ['kt', 'KT 위즈', '🦊', '#E41E2B', null, null],
      ['ssg', 'SSG 랜더스', '⚾', '#CE0E2D', null, null],
      ['nc', 'NC 다이노스', '🦎', '#1D467A', null, null],
      ['lotte', '롯데 자이언츠', '🐋', '#041E42', null, null],
      ['hanwha', '한화 이글스', '🐯', '#FF6600', null, null],
      ['kiwoom', '키움 히어로즈', '🏹', '#820024', null, null]
    ];
    const insertMany = db.transaction((list) => {
      for (const t of list) insert.run(...t);
    });
    insertMany(teams);
  }

  return db;
}

function getDB() {
  if (!db) initDB();
  return db;
}

// ===== 기사 관련 함수 =====

// 중복 체크 후 삽입
function upsertArticle(article) {
  const d = getDB();
  const existing = d.prepare('SELECT id FROM articles WHERE url = ?').get(article.url);
  if (existing) return existing.id;

  const result = d.prepare(`
    INSERT INTO articles (team_id, article_seq, title, url, summary, thumbnail, view_count, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    article.team_id,
    article.article_seq || null,
    article.title,
    article.url,
    article.summary || null,
    article.thumbnail || null,
    article.view_count || 0,
    article.published_at || null
  );
  return result.lastInsertRowid;
}

// 팀별 기사 목록 조회 (페이지네이션)
function getArticlesByTeam(teamId, limit = 10, offset = 0) {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM articles
    WHERE team_id = ?
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).all(teamId, limit, offset);
}

// 팀별 기사 전체 개수
function getArticleCountByTeamId(teamId) {
  const d = getDB();
  const row = d.prepare('SELECT COUNT(*) as count FROM articles WHERE team_id = ?').get(teamId);
  return row.count;
}

// 전체 기사 조회 (전체 팀)
function getAllArticles(limit = 100, offset = 0) {
  const d = getDB();
  return d.prepare(`
    SELECT a.*, t.name as team_name, t.emoji as team_emoji, t.color as team_color
    FROM articles a
    JOIN teams t ON a.team_id = t.id
    ORDER BY a.published_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

// 팀 목록 조회
function getTeams() {
  const d = getDB();
  return d.prepare('SELECT * FROM teams ORDER BY id').all();
}

// 팀별 기사 개수
function getArticleCountByTeam() {
  const d = getDB();
  return d.prepare(`
    SELECT t.id, t.name, t.emoji, t.color, COUNT(a.id) as count
    FROM teams t
    LEFT JOIN articles a ON t.id = a.team_id
    GROUP BY t.id
    ORDER BY t.id
  `).all();
}

// 최근 크롤링 시간 조회
function getLastCrawlTime(teamId) {
  const d = getDB();
  const row = d.prepare(`
    SELECT crawled_at FROM articles
    WHERE team_id = ?
    ORDER BY crawled_at DESC
    LIMIT 1
  `).get(teamId);
  return row ? row.crawled_at : null;
}

// 크롤링 로그 저장
function addCrawlLog(teamId, status, total, newItems, message) {
  const d = getDB();
  d.prepare(`
    INSERT INTO crawl_logs (team_id, status, total, new_items, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(teamId, status, total || 0, newItems || 0, message || null);
}

// 최근 크롤링 로그 조회
function getCrawlLogs(limit = 50) {
  const d = getDB();
  return d.prepare(`
    SELECT c.*, t.name as team_name, t.emoji as team_emoji
    FROM crawl_logs c
    JOIN teams t ON c.team_id = t.id
    ORDER BY c.created_at DESC
    LIMIT ?
  `).all(limit);
}

// 팀별 마지막 크롤링 상태
function getLastCrawlStatus() {
  const d = getDB();
  return d.prepare(`
    SELECT t.id, t.name, t.emoji, t.color,
           (SELECT COUNT(*) FROM articles a WHERE a.team_id = t.id) as article_count,
           (SELECT created_at FROM crawl_logs WHERE team_id = t.id ORDER BY created_at DESC LIMIT 1) as last_crawl,
           (SELECT status FROM crawl_logs WHERE team_id = t.id ORDER BY created_at DESC LIMIT 1) as last_status
    FROM teams t
    ORDER BY t.id
  `).all();
}

// 전체 통계
function getTotalStats() {
  const d = getDB();
  const totalArticles = d.prepare('SELECT COUNT(*) as count FROM articles').get();
  const totalCrawls = d.prepare('SELECT COUNT(*) as count FROM crawl_logs').get();
  const lastCrawl = d.prepare('SELECT created_at FROM crawl_logs ORDER BY created_at DESC LIMIT 1').get();
  return {
    totalArticles: totalArticles.count,
    totalCrawls: totalCrawls.count,
    lastCrawl: lastCrawl ? lastCrawl.created_at : null
  };
}

// YouTube 캐시 저장
function setYoutubeCache(cacheKey, data) {
  const d = getDB();
  d.prepare(`
    INSERT OR REPLACE INTO youtube_cache (cache_key, data, created_at)
    VALUES (?, ?, datetime('now', 'localtime'))
  `).run(cacheKey, JSON.stringify(data));
}

// YouTube 캐시 조회 (1시간 이내만 유효)
function getYoutubeCache(cacheKey) {
  const d = getDB();
  const row = d.prepare(`
    SELECT data, created_at FROM youtube_cache
    WHERE cache_key = ?
      AND datetime(created_at) > datetime('now', '-1 hour')
  `).get(cacheKey);
  if (!row) return null;
  return JSON.parse(row.data);
}

// ===== 포스트 (Admin 기사) =====
function createPost(title, content, thumbnail) {
  const d = getDB();
  const result = d.prepare(`
    INSERT INTO posts (title, content, thumbnail) VALUES (?, ?, ?)
  `).run(title, content || null, thumbnail || null);
  return result.lastInsertRowid;
}

function getAllPosts() {
  const d = getDB();
  return d.prepare(`
    SELECT * FROM posts ORDER BY published_at DESC
  `).all();
}

function updatePost(id, title, content, thumbnail) {
  const d = getDB();
  d.prepare(`
    UPDATE posts SET title = ?, content = ?, thumbnail = COALESCE(?, thumbnail)
    WHERE id = ?
  `).run(title, content || null, thumbnail, id);
}

function deletePost(id) {
  const d = getDB();
  d.prepare('DELETE FROM posts WHERE id = ?').run(id);
}

function getPost(id) {
  const d = getDB();
  return d.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

module.exports = {
  initDB,
  getDB,
  upsertArticle,
  getArticlesByTeam,
  getArticleCountByTeamId,
  getAllArticles,
  getTeams,
  getArticleCountByTeam,
  getLastCrawlTime,
  addCrawlLog,
  getCrawlLogs,
  getLastCrawlStatus,
  getTotalStats,
  setYoutubeCache,
  getYoutubeCache,
  createPost,
  getAllPosts,
  getPost,
  updatePost,
  deletePost
};
