// End-to-end API tests against a real MySQL database.
// Run with: npm run test:integration   (needs the DB_* values in .env)
// The test creates its own users with a random suffix and deletes them afterwards.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const skip = enabled ? false : 'set RUN_INTEGRATION_TESTS=true (npm run test:integration) to run';

test('social API end to end', { skip }, async (t) => {
  const app = require('../app');
  const { pool } = require('../server/db/connection');
  const { ensureDatabaseSchema } = require('../server/db/migrate');
  await ensureDatabaseSchema();

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const suffix = Math.random().toString(36).slice(2, 8);
  const names = { a: `ita_${suffix}`, b: `itb_${suffix}`, c: `itc_${suffix}` };

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  async function register(key) {
    const res = await call('POST', '/api/auth/register', {
      body: { name: `Tester ${key.toUpperCase()}`, username: names[key], email: `${names[key]}@example.com`, password: 'Password123!' }
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.token;
  }

  try {
    await t.test('registration validates input and rejects duplicates', async () => {
      assert.equal((await call('POST', '/api/auth/register', { body: { name: 'X', username: 'no', email: 'bad', password: 'short' } })).status, 400);
      const tokenA = await register('a');
      assert.ok(tokenA);
      const dup = await call('POST', '/api/auth/register', { body: { name: 'Tester Again', username: names.a, email: `other_${suffix}@example.com`, password: 'Password123!' } });
      assert.equal(dup.status, 409);
      assert.match(dup.body.error, /username/i);
      const dupEmail = await call('POST', '/api/auth/register', { body: { name: 'Tester Again', username: `x${names.a}`, email: `${names.a}@example.com`, password: 'Password123!' } });
      assert.equal(dupEmail.status, 409);
      assert.match(dupEmail.body.error, /email/i);
    });

    await t.test('login works with email or username and rejects bad passwords', async () => {
      assert.equal((await call('POST', '/api/auth/login', { body: { identifier: names.a, password: 'Password123!' } })).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { body: { identifier: `${names.a}@example.com`, password: 'Password123!' } })).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { body: { identifier: names.a, password: 'wrong-password' } })).status, 401);
    });

    const tokenA = (await call('POST', '/api/auth/login', { body: { identifier: names.a, password: 'Password123!' } })).body.token;
    const tokenB = await register('b');
    const tokenC = await register('c');

    let postId;
    await t.test('posting requires auth and validates content', async () => {
      assert.equal((await call('POST', '/api/posts', { body: { content: 'hi' } })).status, 401);
      assert.equal((await call('POST', '/api/posts', { token: tokenA, body: { content: '   ' } })).status, 400);
      assert.equal((await call('POST', '/api/posts', { token: tokenA, body: { content: 'x'.repeat(501) } })).status, 400);
      assert.equal((await call('POST', '/api/posts', { token: tokenA, body: { content: 'hi', image_url: 'javascript:alert(1)' } })).status, 400);
      const created = await call('POST', '/api/posts', { token: tokenA, body: { content: 'Hello from A <b>bold</b>', image_url: 'https://example.com/a.png' } });
      assert.equal(created.status, 201);
      assert.equal(created.body.post.author.username, names.a);
      assert.equal(created.body.post.content, 'Hello from A <b>bold</b>');
      assert.equal(created.body.post.like_count, 0);
      postId = created.body.post.id;
    });

    await t.test('feed only shows people you follow (plus yourself)', async () => {
      const empty = await call('GET', '/api/posts/feed', { token: tokenB });
      assert.equal(empty.body.posts.some((p) => p.id === postId), false);

      const follow = await call('POST', `/api/users/${names.a}/follow`, { token: tokenB });
      assert.equal(follow.status, 200);
      assert.equal(follow.body.is_following, true);
      assert.equal(follow.body.followers_count, 1);
      // following twice is harmless
      assert.equal((await call('POST', `/api/users/${names.a}/follow`, { token: tokenB })).body.followers_count, 1);

      const feed = await call('GET', '/api/posts/feed', { token: tokenB });
      assert.ok(feed.body.posts.some((p) => p.id === postId));
      const feedC = await call('GET', '/api/posts/feed', { token: tokenC });
      assert.equal(feedC.body.posts.some((p) => p.id === postId), false);
    });

    await t.test('you cannot follow yourself or a missing user', async () => {
      assert.equal((await call('POST', `/api/users/${names.a}/follow`, { token: tokenA })).status, 400);
      assert.equal((await call('POST', '/api/users/nobody_here_zz/follow', { token: tokenA })).status, 404);
    });

    await t.test('profiles report counts and follow state per viewer', async () => {
      const asB = await call('GET', `/api/users/${names.a}`, { token: tokenB });
      assert.equal(asB.body.user.followers_count, 1);
      assert.equal(asB.body.user.posts_count, 1);
      assert.equal(asB.body.user.is_following, true);
      assert.equal(asB.body.user.is_me, false);
      const asA = await call('GET', `/api/users/${names.a}`, { token: tokenA });
      assert.equal(asA.body.user.is_me, true);
      assert.equal(asA.body.user.is_following, false);
      assert.equal(asA.body.user.email, undefined, 'profiles must not expose email');
      assert.equal((await call('GET', '/api/users/nobody_here_zz')).status, 404);
      const followers = await call('GET', `/api/users/${names.a}/followers`, { token: tokenA });
      assert.deepEqual(followers.body.users.map((u) => u.username), [names.b]);
      const following = await call('GET', `/api/users/${names.b}/following`, { token: tokenA });
      assert.deepEqual(following.body.users.map((u) => u.username), [names.a]);
    });

    await t.test('likes are idempotent and counted', async () => {
      assert.equal((await call('POST', `/api/posts/${postId}/like`)).status, 401);
      assert.equal((await call('POST', `/api/posts/${postId}/like`, { token: tokenB })).body.like_count, 1);
      assert.equal((await call('POST', `/api/posts/${postId}/like`, { token: tokenB })).body.like_count, 1);
      assert.equal((await call('POST', `/api/posts/${postId}/like`, { token: tokenC })).body.like_count, 2);
      const seenByB = await call('GET', `/api/posts/${postId}`, { token: tokenB });
      assert.equal(seenByB.body.post.liked_by_me, true);
      assert.equal(seenByB.body.post.like_count, 2);
      assert.equal((await call('GET', `/api/posts/${postId}`)).body.post.liked_by_me, false);
      assert.equal((await call('DELETE', `/api/posts/${postId}/like`, { token: tokenB })).body.like_count, 1);
      assert.equal((await call('POST', '/api/posts/999999999/like', { token: tokenB })).status, 404);
    });

    let commentId;
    await t.test('comments can be added, listed, and removed by the right people', async () => {
      assert.equal((await call('POST', `/api/posts/${postId}/comments`, { body: { content: 'hey' } })).status, 401);
      assert.equal((await call('POST', `/api/posts/${postId}/comments`, { token: tokenB, body: { content: ' ' } })).status, 400);
      assert.equal((await call('POST', `/api/posts/${postId}/comments`, { token: tokenB, body: { content: 'x'.repeat(301) } })).status, 400);
      const added = await call('POST', `/api/posts/${postId}/comments`, { token: tokenB, body: { content: 'Nice one' } });
      assert.equal(added.status, 201);
      assert.equal(added.body.comment_count, 1);
      commentId = added.body.comment.id;

      const listed = await call('GET', `/api/posts/${postId}/comments`, { token: tokenB });
      assert.equal(listed.body.comments.length, 1);
      assert.equal(listed.body.comments[0].can_delete, true);
      assert.equal((await call('GET', `/api/posts/${postId}/comments`, { token: tokenC })).body.comments[0].can_delete, false);
      assert.equal((await call('GET', `/api/posts/${postId}`, { token: tokenB })).body.post.comment_count, 1);

      assert.equal((await call('DELETE', `/api/posts/${postId}/comments/${commentId}`, { token: tokenC })).status, 403);
      const removed = await call('DELETE', `/api/posts/${postId}/comments/${commentId}`, { token: tokenA }); // post owner
      assert.equal(removed.status, 200);
      assert.equal(removed.body.comment_count, 0);
    });

    await t.test('only the author can delete a post, and its data goes with it', async () => {
      assert.equal((await call('DELETE', `/api/posts/${postId}`, { token: tokenB })).status, 403);
      assert.equal((await call('DELETE', `/api/posts/${postId}`)).status, 401);
      assert.equal((await call('DELETE', `/api/posts/${postId}`, { token: tokenA })).status, 200);
      assert.equal((await call('GET', `/api/posts/${postId}`)).status, 404);
      assert.equal((await call('DELETE', `/api/posts/${postId}`, { token: tokenA })).status, 404);
    });

    await t.test('profile updates are validated and only change your own account', async () => {
      assert.equal((await call('PATCH', '/api/users/me', { body: { bio: 'x' } })).status, 401);
      assert.equal((await call('PATCH', '/api/users/me', { token: tokenA, body: {} })).status, 400);
      assert.equal((await call('PATCH', '/api/users/me', { token: tokenA, body: { bio: 'x'.repeat(281) } })).status, 400);
      assert.equal((await call('PATCH', '/api/users/me', { token: tokenA, body: { avatar_url: 'ftp://x/y.png' } })).status, 400);
      const ok = await call('PATCH', '/api/users/me', { token: tokenA, body: { name: 'Renamed A', bio: 'Hello world', username: 'hijack', password_hash: 'x' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.user.name, 'Renamed A');
      assert.equal(ok.body.user.username, names.a, 'username cannot be changed');
      assert.equal((await call('GET', `/api/users/${names.b}`)).body.user.name, `Tester B`);
    });

    await t.test('pagination, search, and suggestions', async () => {
      for (let i = 1; i <= 5; i += 1) await call('POST', '/api/posts', { token: tokenC, body: { content: `C post ${i}` } });
      const page1 = await call('GET', `/api/users/${names.c}/posts?limit=2`);
      assert.equal(page1.body.posts.length, 2);
      assert.equal(page1.body.posts[0].content, 'C post 5');
      assert.ok(page1.body.next_before);
      const page2 = await call('GET', `/api/users/${names.c}/posts?limit=2&before=${page1.body.next_before}`);
      assert.equal(page2.body.posts[0].content, 'C post 3');
      const last = await call('GET', `/api/users/${names.c}/posts?limit=10&before=${page2.body.next_before}`);
      assert.equal(last.body.next_before, null);

      const found = await call('GET', `/api/users?q=${names.c.slice(0, 6)}`);
      assert.ok(found.body.users.some((u) => u.username === names.c));
      assert.equal(found.body.users[0].email, undefined);
      assert.deepEqual((await call('GET', '/api/users?q=%25')).body.users.filter((u) => u.username.startsWith('zzz')), []);

      const suggestions = await call('GET', '/api/users/suggestions', { token: tokenB });
      assert.equal(suggestions.body.users.some((u) => u.username === names.b), false, 'never suggests yourself');
      assert.equal(suggestions.body.users.some((u) => u.username === names.a), false, 'never suggests someone already followed');
    });

    await t.test('unfollow removes the post from the feed', async () => {
      await call('POST', '/api/posts', { token: tokenA, body: { content: 'second post from A' } });
      assert.ok((await call('GET', '/api/posts/feed', { token: tokenB })).body.posts.some((p) => p.content === 'second post from A'));
      const res = await call('DELETE', `/api/users/${names.a}/follow`, { token: tokenB });
      assert.equal(res.body.is_following, false);
      assert.equal(res.body.followers_count, 0);
      assert.equal((await call('GET', '/api/posts/feed', { token: tokenB })).body.posts.some((p) => p.content === 'second post from A'), false);
    });

    await t.test('malformed JSON and unknown routes return clean errors', async () => {
      const res = await fetch(`${base}/api/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` }, body: '{bad json' });
      assert.equal(res.status, 400);
      assert.equal((await call('GET', '/api/does-not-exist')).status, 404);
    });
  } finally {
    await pool.query('DELETE FROM users WHERE username IN (?, ?, ?)', [names.a, names.b, names.c]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
