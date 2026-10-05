const express = require("express");
const requireDatabase = require("../middleware/require-database");
const requireAuth = require("../middleware/require-auth");
const { optionalAuth } = requireAuth;
const { query } = require("../db/connection");
const { fetchPosts, publicUser } = require("../lib/posts");
const { cleanString, parseImageUrl, parseId, parseLimit } = require("../lib/validate");

const router = express.Router();
router.use(requireDatabase);

function pageOptions(req) {
  return { viewerId: req.user?.id || 0, before: parseId(req.query.before), limit: parseLimit(req.query.limit) };
}

// Home feed: your posts plus posts from people you follow.
router.get("/feed", requireAuth, async (req, res, next) => {
  try {
    res.json(await fetchPosts({
      where: "(p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?))",
      params: [req.user.id, req.user.id],
      ...pageOptions(req)
    }));
  } catch (error) {
    next(error);
  }
});

// Explore: every post, newest first.
router.get("/", optionalAuth, async (req, res, next) => {
  try {
    res.json(await fetchPosts(pageOptions(req)));
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  const content = cleanString(req.body?.content);
  const imageUrl = parseImageUrl(req.body?.image_url);
  if (!content) return res.status(400).json({ error: "Write something before you post." });
  if (content.length > 500) return res.status(400).json({ error: "Posts can be at most 500 characters." });
  if (imageUrl === null) return res.status(400).json({ error: "Enter a valid http(s) link for the image." });

  try {
    const result = await query("INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)", [req.user.id, content, imageUrl || null]);
    const { posts } = await fetchPosts({ where: "p.id = ?", params: [result.insertId], viewerId: req.user.id });
    res.status(201).json({ post: posts[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", optionalAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "That post does not exist." });
  try {
    const { posts } = await fetchPosts({ where: "p.id = ?", params: [id], viewerId: req.user?.id || 0 });
    if (!posts[0]) return res.status(404).json({ error: "That post does not exist." });
    res.json({ post: posts[0] });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: "That post does not exist." });
  try {
    const rows = await query("SELECT user_id FROM posts WHERE id = ?", [id]);
    if (!rows[0]) return res.status(404).json({ error: "That post does not exist." });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: "You can only delete your own posts." });
    await query("DELETE FROM posts WHERE id = ?", [id]);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

async function postExists(id) {
  const rows = await query("SELECT id FROM posts WHERE id = ?", [id]);
  return Boolean(rows[0]);
}

async function likeCount(postId) {
  const rows = await query("SELECT COUNT(*) AS total FROM likes WHERE post_id = ?", [postId]);
  return Number(rows[0].total);
}

router.post("/:id/like", requireAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  try {
    if (!id || !(await postExists(id))) return res.status(404).json({ error: "That post does not exist." });
    await query("INSERT IGNORE INTO likes (user_id, post_id) VALUES (?, ?)", [req.user.id, id]);
    res.json({ liked: true, like_count: await likeCount(id) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id/like", requireAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  try {
    if (!id || !(await postExists(id))) return res.status(404).json({ error: "That post does not exist." });
    await query("DELETE FROM likes WHERE user_id = ? AND post_id = ?", [req.user.id, id]);
    res.json({ liked: false, like_count: await likeCount(id) });
  } catch (error) {
    next(error);
  }
});

function mapComment(row, viewerId, postOwnerId) {
  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    author: publicUser(row),
    can_delete: Boolean(viewerId) && (viewerId === row.author_id || viewerId === postOwnerId)
  };
}

const COMMENT_SELECT = `SELECT c.id, c.content, c.created_at, u.id AS author_id, u.username, u.name AS author_name, u.avatar_url
                          FROM comments c JOIN users u ON u.id = c.user_id`;

router.get("/:id/comments", optionalAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  try {
    const posts = id ? await query("SELECT user_id FROM posts WHERE id = ?", [id]) : [];
    if (!posts[0]) return res.status(404).json({ error: "That post does not exist." });
    const rows = await query(`${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 100`, [id]);
    res.json({ comments: rows.map((row) => mapComment(row, req.user?.id || 0, posts[0].user_id)) });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/comments", requireAuth, async (req, res, next) => {
  const id = parseId(req.params.id);
  const content = cleanString(req.body?.content);
  if (!content) return res.status(400).json({ error: "Write a comment first." });
  if (content.length > 300) return res.status(400).json({ error: "Comments can be at most 300 characters." });
  try {
    const posts = id ? await query("SELECT user_id FROM posts WHERE id = ?", [id]) : [];
    if (!posts[0]) return res.status(404).json({ error: "That post does not exist." });
    const result = await query("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", [id, req.user.id, content]);
    const rows = await query(`${COMMENT_SELECT} WHERE c.id = ?`, [result.insertId]);
    const total = await query("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?", [id]);
    res.status(201).json({ comment: mapComment(rows[0], req.user.id, posts[0].user_id), comment_count: Number(total[0].total) });
  } catch (error) {
    next(error);
  }
});

// A comment can be removed by its author or by the owner of the post.
router.delete("/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  const postId = parseId(req.params.id);
  const commentId = parseId(req.params.commentId);
  try {
    const rows = postId && commentId
      ? await query("SELECT c.user_id AS commenter_id, p.user_id AS owner_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND c.post_id = ?", [commentId, postId])
      : [];
    if (!rows[0]) return res.status(404).json({ error: "That comment does not exist." });
    if (req.user.id !== rows[0].commenter_id && req.user.id !== rows[0].owner_id) {
      return res.status(403).json({ error: "You can only delete your own comments." });
    }
    await query("DELETE FROM comments WHERE id = ?", [commentId]);
    const total = await query("SELECT COUNT(*) AS total FROM comments WHERE post_id = ?", [postId]);
    res.json({ deleted: true, comment_count: Number(total[0].total) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
