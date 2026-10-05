const { query } = require("../db/connection");

const USER_FIELDS = "u.id AS author_id, u.username, u.name AS author_name, u.avatar_url";

function publicUser(row) {
  return { id: row.author_id ?? row.id, username: row.username, name: row.author_name ?? row.name, avatar_url: row.avatar_url || null };
}

function mapPost(row) {
  return {
    id: row.id,
    content: row.content,
    image_url: row.image_url || null,
    created_at: row.created_at,
    like_count: Number(row.like_count),
    comment_count: Number(row.comment_count),
    liked_by_me: Boolean(Number(row.liked_by_me)),
    author: publicUser(row)
  };
}

// Fetches one page of posts, newest first. `where` is a trusted SQL fragment
// (never user input) and `params` are its bound values. The page size is
// clamped by the caller and inlined because LIMIT cannot be bound reliably.
async function fetchPosts({ where = "1 = 1", params = [], viewerId = 0, before = null, limit = 10 }) {
  const pageSize = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 30);
  const conditions = [where];
  const values = [viewerId, ...params];
  if (before) {
    conditions.push("p.id < ?");
    values.push(before);
  }
  const rows = await query(
    `SELECT p.id, p.content, p.image_url, p.created_at, ${USER_FIELDS},
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
            EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
       FROM posts p JOIN users u ON u.id = p.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.id DESC
      LIMIT ${pageSize + 1}`,
    values
  );
  const hasMore = rows.length > pageSize;
  const posts = rows.slice(0, pageSize).map(mapPost);
  return { posts, next_before: hasMore ? posts[posts.length - 1].id : null };
}

module.exports = { fetchPosts, mapPost, publicUser };
