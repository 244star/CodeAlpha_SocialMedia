const express = require("express");
const requireDatabase = require("../middleware/require-database");
const requireAuth = require("../middleware/require-auth");
const { optionalAuth } = requireAuth;
const { query } = require("../db/connection");
const { fetchPosts } = require("../lib/posts");
const { cleanString, normalizeUsername, parseImageUrl, parseId, parseLimit, escapeLike } = require("../lib/validate");

const router = express.Router();
router.use(requireDatabase);

const PROFILE_SQL = `
  SELECT u.id, u.username, u.name, u.bio, u.avatar_url, u.created_at,
         (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts_count,
         (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers_count,
         (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
         EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS is_following
    FROM users u`;

function mapProfile(row, viewerId) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    bio: row.bio,
    avatar_url: row.avatar_url || null,
    created_at: row.created_at,
    posts_count: Number(row.posts_count),
    followers_count: Number(row.followers_count),
    following_count: Number(row.following_count),
    is_following: Boolean(Number(row.is_following)),
    is_me: Boolean(viewerId) && viewerId === row.id
  };
}

async function findUserByUsername(username) {
  const rows = await query("SELECT id, username FROM users WHERE username = ?", [normalizeUsername(username)]);
  return rows[0] || null;
}

// Search people by username or name prefix.
router.get("/", optionalAuth, async (req, res, next) => {
  const term = cleanString(req.query.q).replace(/^@/, "").slice(0, 50);
  if (term.length < 1) return res.json({ users: [] });
  try {
    const pattern = `${escapeLike(term)}%`;
    const rows = await query(
      `SELECT id, username, name, avatar_url FROM users
        WHERE username LIKE ? OR name LIKE ?
        ORDER BY username LIMIT 8`,
      [pattern, pattern]
    );
    res.json({ users: rows.map((row) => ({ id: row.id, username: row.username, name: row.name, avatar_url: row.avatar_url || null })) });
  } catch (error) {
    next(error);
  }
});

// People the signed-in user might want to follow.
router.get("/suggestions", requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.username, u.name, u.avatar_url,
              (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS followers_count
         FROM users u
        WHERE u.id <> ?
          AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id)
        ORDER BY followers_count DESC, u.id DESC
        LIMIT 5`,
      [req.user.id, req.user.id]
    );
    res.json({ users: rows.map((row) => ({ id: row.id, username: row.username, name: row.name, avatar_url: row.avatar_url || null, followers_count: Number(row.followers_count) })) });
  } catch (error) {
    next(error);
  }
});

// Update the signed-in user's own profile.
router.patch("/me", requireAuth, async (req, res, next) => {
  const updates = [];
  const values = [];

  if (req.body?.name !== undefined) {
    const name = cleanString(req.body.name);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
    updates.push("name = ?");
    values.push(name);
  }
  if (req.body?.bio !== undefined) {
    const bio = cleanString(req.body.bio);
    if (bio.length > 280) return res.status(400).json({ error: "Your bio can be at most 280 characters." });
    updates.push("bio = ?");
    values.push(bio);
  }
  if (req.body?.avatar_url !== undefined) {
    const avatar = parseImageUrl(req.body.avatar_url);
    if (avatar === null) return res.status(400).json({ error: "Enter a valid http(s) image link for your photo." });
    updates.push("avatar_url = ?");
    values.push(avatar || null);
  }
  if (!updates.length) return res.status(400).json({ error: "There is nothing to update." });

  try {
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...values, req.user.id]);
    const rows = await query("SELECT id, username, name, email, bio, avatar_url FROM users WHERE id = ?", [req.user.id]);
    res.json({ user: { ...rows[0], avatar_url: rows[0].avatar_url || null } });
  } catch (error) {
    next(error);
  }
});

router.get("/:username", optionalAuth, async (req, res, next) => {
  try {
    const viewerId = req.user?.id || 0;
    const rows = await query(`${PROFILE_SQL} WHERE u.username = ?`, [viewerId, normalizeUsername(req.params.username)]);
    if (!rows[0]) return res.status(404).json({ error: "We could not find that person." });
    res.json({ user: mapProfile(rows[0], viewerId) });
  } catch (error) {
    next(error);
  }
});

router.get("/:username/posts", optionalAuth, async (req, res, next) => {
  try {
    const user = await findUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: "We could not find that person." });
    res.json(await fetchPosts({
      where: "p.user_id = ?",
      params: [user.id],
      viewerId: req.user?.id || 0,
      before: parseId(req.query.before),
      limit: parseLimit(req.query.limit)
    }));
  } catch (error) {
    next(error);
  }
});

async function listConnections(req, res, next, direction) {
  try {
    const user = await findUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: "We could not find that person." });
    const [selfColumn, otherColumn] = direction === "followers" ? ["following_id", "follower_id"] : ["follower_id", "following_id"];
    const viewerId = req.user?.id || 0;
    const rows = await query(
      `SELECT u.id, u.username, u.name, u.avatar_url,
              EXISTS(SELECT 1 FROM follows v WHERE v.follower_id = ? AND v.following_id = u.id) AS is_following
         FROM follows f JOIN users u ON u.id = f.${otherColumn}
        WHERE f.${selfColumn} = ?
        ORDER BY f.created_at DESC, u.id DESC
        LIMIT 100`,
      [viewerId, user.id]
    );
    res.json({
      users: rows.map((row) => ({
        id: row.id,
        username: row.username,
        name: row.name,
        avatar_url: row.avatar_url || null,
        is_following: Boolean(Number(row.is_following)),
        is_me: viewerId === row.id
      }))
    });
  } catch (error) {
    next(error);
  }
}

router.get("/:username/followers", optionalAuth, (req, res, next) => listConnections(req, res, next, "followers"));
router.get("/:username/following", optionalAuth, (req, res, next) => listConnections(req, res, next, "following"));

async function followCount(userId) {
  const rows = await query("SELECT COUNT(*) AS total FROM follows WHERE following_id = ?", [userId]);
  return Number(rows[0].total);
}

router.post("/:username/follow", requireAuth, async (req, res, next) => {
  try {
    const target = await findUserByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "We could not find that person." });
    if (target.id === req.user.id) return res.status(400).json({ error: "You cannot follow yourself." });
    await query("INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [req.user.id, target.id]);
    res.json({ is_following: true, followers_count: await followCount(target.id) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:username/follow", requireAuth, async (req, res, next) => {
  try {
    const target = await findUserByUsername(req.params.username);
    if (!target) return res.status(404).json({ error: "We could not find that person." });
    await query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.user.id, target.id]);
    res.json({ is_following: false, followers_count: await followCount(target.id) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
