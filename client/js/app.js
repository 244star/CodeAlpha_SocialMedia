(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const ICONS = {
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3 5 6.5 5c2 0 3.7 1.1 5.5 3.2C13.800 6.100 15.500 5 17.500 5 21 5 22.800 8.600 21.500 11.800 19.500 16.400 12 21 12 21z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.800 7L3 21l2-5.500A8 8 0 1 1 21 12z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>'
  };

  const store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
  };

  const state = {
    token: store.get("murmur-token", null),
    user: store.get("murmur-user", null),
    feed: null,
    renderId: 0
  };

  /* ---------- helpers ---------- */

  async function api(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try {
      response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error("Could not reach the server. Check your connection.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.token) signOut(false);
      const error = new Error(payload.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function timeAgo(value) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 45) return "just now";
    const units = [["y", 31536000], ["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]];
    for (const [label, size] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${label}`;
    return "just now";
  }

  function hueFor(username) {
    let hash = 0;
    for (const char of String(username)) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
  }

  function avatar(user, size = "") {
    const cls = size ? ` avatar-${size}` : "";
    if (user.avatar_url) return `<img class="avatar${cls}" src="${esc(user.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-avatar>`;
    const initial = esc((user.name || user.username || "?").trim().charAt(0).toUpperCase());
    return `<span class="avatar-initial${cls}" style="--h:${hueFor(user.username)}" aria-hidden="true">${initial}</span>`;
  }

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  const dialog = $("#dialog");
  function openDialog(html) {
    dialog.innerHTML = `<div class="dialog-body">${html}</div>`;
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector("input, textarea");
    if (first) first.focus();
  }
  function closeDialog() { if (dialog.open) dialog.close(); }
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(); });

  /* ---------- session ---------- */

  function setSession(user, token) {
    state.user = user;
    state.token = token || state.token;
    store.set("murmur-user", user);
    if (token) store.set("murmur-token", token);
    renderAccount();
  }

  function signOut(announce = true) {
    state.user = null;
    state.token = null;
    store.remove("murmur-user");
    store.remove("murmur-token");
    renderAccount();
    loadSuggestions();
    if (announce) toast("You have signed out.");
    if (location.hash === "#/me" || location.hash === "" || location.hash === "#/") route();
    else location.hash = "#/";
  }

  function renderAccount() {
    const box = $("#nav-account");
    if (state.user) {
      box.innerHTML = `<div class="nav-user"><a href="#/u/${esc(state.user.username)}" aria-label="Your profile">${avatar(state.user, "sm")}</a><div class="who"><strong>${esc(state.user.name)}</strong><span>@${esc(state.user.username)}</span></div><button class="btn btn-ghost btn-small" data-action="signout">Sign out</button></div>`;
    } else {
      box.innerHTML = `<button class="btn btn-accent btn-block" data-action="signin">Sign in</button>`;
    }
  }

  function authDialog(mode = "login", message = "") {
    const registering = mode === "register";
    openDialog(`
      <h2>${registering ? "Join Murmur" : "Welcome back"}</h2>
      <p class="sub">${registering ? "Create an account to post, follow and join the conversation." : "Sign in with your email or username."}</p>
      <form id="auth-form" data-mode="${registering ? "register" : "login"}" novalidate>
        ${registering ? `
          <div class="form-row"><label for="f-name">Name</label><input class="field-input" id="f-name" name="name" autocomplete="name" maxlength="80" required></div>
          <div class="form-row"><label for="f-username">Username</label><input class="field-input" id="f-username" name="username" autocomplete="username" maxlength="30" required><div class="hint">3-30 letters, numbers or underscores.</div></div>
          <div class="form-row"><label for="f-email">Email</label><input class="field-input" id="f-email" name="email" type="email" autocomplete="email" maxlength="254" required></div>
        ` : `
          <div class="form-row"><label for="f-id">Email or username</label><input class="field-input" id="f-id" name="identifier" autocomplete="username" maxlength="254" required></div>
        `}
        <div class="form-row"><label for="f-password">Password</label><input class="field-input" id="f-password" name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" maxlength="128" required>${registering ? '<div class="hint">At least 8 characters.</div>' : ""}</div>
        <p class="error-note" id="auth-error" role="alert">${esc(message)}</p>
        <button class="btn btn-accent btn-block" type="submit">${registering ? "Create account" : "Sign in"}</button>
      </form>
      <p class="switch">${registering ? "Already a member?" : "New here?"} <button class="link-button" data-action="auth-switch" data-mode="${registering ? "login" : "register"}">${registering ? "Sign in" : "Create an account"}</button></p>`);
  }

  /* ---------- posts ---------- */

  function postHtml(post) {
    const mine = state.user && state.user.id === post.author.id;
    const profile = `#/u/${esc(post.author.username)}`;
    return `
      <article class="post" data-post-id="${Number(post.id)}">
        <a href="${profile}" aria-label="${esc(post.author.name)}'s profile">${avatar(post.author)}</a>
        <div class="post-body">
          <div class="post-head">
            <a class="author" href="${profile}">${esc(post.author.name)}</a>
            <span class="handle">@${esc(post.author.username)}</span>
            <span class="muted" aria-hidden="true">&middot;</span>
            <time datetime="${esc(post.created_at)}" title="${esc(new Date(post.created_at).toLocaleString())}">${timeAgo(post.created_at)}</time>
          </div>
          <p class="post-text">${esc(post.content)}</p>
          ${post.image_url ? `<img class="post-img" src="${esc(post.image_url)}" alt="Image attached to ${esc(post.author.name)}'s post" loading="lazy" referrerpolicy="no-referrer">` : ""}
          <div class="actions">
            <button class="action like" data-action="like" aria-pressed="${post.liked_by_me}" aria-label="Like">${ICONS.heart}<span data-count="likes">${post.like_count}</span></button>
            <button class="action" data-action="comments" aria-expanded="false" aria-label="Comments">${ICONS.comment}<span data-count="comments">${post.comment_count}</span></button>
            ${mine ? `<button class="action delete" data-action="delete-post" aria-label="Delete post">${ICONS.trash}</button>` : ""}
          </div>
          <section class="comments" hidden></section>
        </div>
      </article>`;
  }

  function commentHtml(comment) {
    return `
      <div class="comment" data-comment-id="${Number(comment.id)}">
        <a href="#/u/${esc(comment.author.username)}">${avatar(comment.author, "sm")}</a>
        <div class="comment-body">
          <div class="meta"><strong>${esc(comment.author.name)}</strong> @${esc(comment.author.username)} &middot; ${timeAgo(comment.created_at)}
            ${comment.can_delete ? `<button class="link-button" data-action="delete-comment" aria-label="Delete comment">Delete</button>` : ""}</div>
          <p>${esc(comment.content)}</p>
        </div>
      </div>`;
  }

  // A feed is a list container plus a "load more" button for the next page.
  async function mountFeed(container, fetchPage, emptyHtml) {
    const renderId = state.renderId;
    const list = document.createElement("div");
    list.className = "post-list";
    const more = document.createElement("button");
    more.className = "btn btn-ghost load-more";
    more.textContent = "Load more";
    more.hidden = true;
    container.append(list, more);
    state.feed = { list, more, next: null };

    async function load(before) {
      more.disabled = true;
      try {
        const page = await fetchPage(before);
        if (renderId !== state.renderId) return;
        if (!before) list.innerHTML = "";
        if (!before && !page.posts.length) list.innerHTML = emptyHtml;
        else list.insertAdjacentHTML("beforeend", page.posts.map(postHtml).join(""));
        state.feed.next = page.next_before;
        more.hidden = !page.next_before;
      } catch (error) {
        if (renderId !== state.renderId) return;
        list.insertAdjacentHTML("beforeend", `<div class="empty"><h3>Could not load posts</h3><p>${esc(error.message)}</p></div>`);
      } finally {
        more.disabled = false;
      }
    }
    more.addEventListener("click", () => load(state.feed.next));
    list.innerHTML = '<div class="empty"><p>Loading&hellip;</p></div>';
    await load(null);
  }

  function composerHtml() {
    return `
      <div class="composer" id="composer">
        <a href="#/u/${esc(state.user.username)}">${avatar(state.user)}</a>
        <form id="compose-form" novalidate>
          <label class="sr-only" for="compose-text">What is on your mind?</label>
          <textarea id="compose-text" name="content" maxlength="500" placeholder="What is on your mind?"></textarea>
          <div class="image-field"><label class="sr-only" for="compose-image">Image link</label><input type="url" id="compose-image" name="image_url" placeholder="Paste an image link (https://...)" maxlength="500"></div>
          <p class="error-note" id="compose-error" role="alert"></p>
          <div class="tools">
            <button class="icon-btn" type="button" data-action="toggle-image" aria-label="Add an image link" title="Add an image link">${ICONS.image}</button>
            <span class="counter" id="compose-counter">0 / 500</span>
            <button class="btn btn-accent btn-small" type="submit" id="compose-submit" disabled>Post</button>
          </div>
        </form>
      </div>`;
  }

  /* ---------- views ---------- */

  const main = $("#main");

  function setActiveNav(name) {
    document.querySelectorAll("[data-nav]").forEach((link) => link.classList.toggle("active", link.dataset.nav === name));
  }

  function emptyFeedHtml(title, text) {
    return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  async function viewHome() {
    setActiveNav("home");
    if (!state.user) return viewExplore(true);
    main.innerHTML = `
      <header class="page-head"><h1>Home</h1><nav class="tabs" aria-label="Feeds"><a class="active" href="#/">Following</a><a href="#/explore">Everyone</a></nav></header>
      ${composerHtml()}`;
    await mountFeed(main, (before) => api(`/api/posts/feed?limit=10${before ? `&before=${before}` : ""}`),
      emptyFeedHtml("Your feed is quiet", "Follow a few people, or write your first post above. Explore shows everyone."));
  }

  async function viewExplore(asGuestHome = false) {
    setActiveNav(asGuestHome ? "home" : "explore");
    const tabs = state.user
      ? `<nav class="tabs" aria-label="Feeds"><a href="#/">Following</a><a class="active" href="#/explore">Everyone</a></nav>`
      : "";
    main.innerHTML = `
      <header class="page-head"><h1>${asGuestHome ? "Murmur" : "Explore"}</h1>${tabs}</header>
      ${state.user ? composerHtml() : `
        <section class="welcome"><h2>Say it small. Say it often.</h2><p>Murmur is a tiny social network. Post a thought, follow people you like, and join the conversation.</p>
          <div class="row"><button class="btn btn-accent" data-action="signup">Create an account</button><button class="btn btn-ghost" data-action="signin">Sign in</button></div></section>`}`;
    await mountFeed(main, (before) => api(`/api/posts?limit=10${before ? `&before=${before}` : ""}`),
      emptyFeedHtml("No posts yet", "Be the first to say something."));
  }

  function profileHeaderHtml(user) {
    let action = "";
    if (user.is_me) action = `<button class="btn btn-ghost" data-action="edit-profile">Edit profile</button> <button class="btn btn-ghost" data-action="signout">Sign out</button>`;
    else action = followButtonHtml(user.username, user.is_following);
    return `
      <div class="profile-banner" style="--h:${hueFor(user.username)}"></div>
      <div class="profile-top">${avatar(user, "xl")}<div>${action}</div></div>
      <div class="profile-info">
        <h2>${esc(user.name)}</h2>
        <div class="handle">@${esc(user.username)}</div>
        ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ""}
        <div class="stats">
          <span><strong>${user.posts_count}</strong> posts</span>
          <button data-action="show-followers" data-username="${esc(user.username)}"><strong data-stat="followers">${user.followers_count}</strong> followers</button>
          <button data-action="show-following" data-username="${esc(user.username)}"><strong>${user.following_count}</strong> following</button>
          <span>Joined ${esc(new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</span>
        </div>
      </div>`;
  }

  function followButtonHtml(username, following, small = false) {
    return `<button class="btn ${following ? "btn-ghost" : "btn-accent"}${small ? " btn-small" : ""}" data-action="follow" data-username="${esc(username)}" data-following="${following}">${following ? "Following" : "Follow"}</button>`;
  }

  async function viewProfile(username) {
    setActiveNav(state.user && state.user.username === username ? "me" : "");
    main.innerHTML = `<header class="page-head"><h1>Profile</h1></header><div class="empty"><p>Loading&hellip;</p></div>`;
    const renderId = state.renderId;
    try {
      const { user } = await api(`/api/users/${encodeURIComponent(username)}`);
      if (renderId !== state.renderId) return;
      document.title = `${user.name} (@${user.username}) - Murmur`;
      main.innerHTML = `<header class="page-head"><h1>${esc(user.name)}</h1><span class="muted">${user.posts_count} posts</span></header>
        <div id="profile-card">${profileHeaderHtml(user)}</div>`;
      main.dataset.profile = JSON.stringify({ username: user.username });
      await mountFeed(main, (before) => api(`/api/users/${encodeURIComponent(user.username)}/posts?limit=10${before ? `&before=${before}` : ""}`),
        emptyFeedHtml("No posts yet", user.is_me ? "Share your first thought from the Home page." : `${user.name} has not posted anything yet.`));
    } catch (error) {
      if (renderId !== state.renderId) return;
      main.innerHTML = `<header class="page-head"><h1>Profile</h1></header><div class="empty"><h3>${error.status === 404 ? "Nobody here" : "Something went wrong"}</h3><p>${esc(error.message)}</p></div>`;
    }
  }

  async function route() {
    state.renderId += 1;
    state.feed = null;
    delete main.dataset.profile;
    document.title = "Murmur";
    const hash = location.hash.replace(/^#/, "") || "/";
    const profileMatch = hash.match(/^\/u\/([A-Za-z0-9_]+)$/);

    if (hash === "/me") {
      if (!state.user) { location.replace("#/"); return; }
      location.replace(`#/u/${state.user.username}`);
      return;
    }
    window.scrollTo(0, 0);
    if (profileMatch) await viewProfile(profileMatch[1].toLowerCase());
    else if (hash === "/explore") await viewExplore();
    else await viewHome();
  }

  /* ---------- side column ---------- */

  async function loadSuggestions() {
    const box = $("#suggestions");
    if (!state.user) { box.hidden = true; box.innerHTML = ""; return; }
    try {
      const { users } = await api("/api/users/suggestions");
      if (!users.length) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<h2>Who to follow</h2>${users.map((u) => `
        <div class="person"><a href="#/u/${esc(u.username)}">${avatar(u, "sm")}</a>
          <a class="who" href="#/u/${esc(u.username)}"><strong>${esc(u.name)}</strong><span>@${esc(u.username)}</span></a>
          ${followButtonHtml(u.username, false, true)}</div>`).join("")}`;
    } catch { box.hidden = true; }
  }

  let searchTimer;
  const searchInput = $("#search-input");
  const searchResults = $("#search-results");
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const term = searchInput.value.trim();
    if (!term) { searchResults.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      try {
        const { users } = await api(`/api/users?q=${encodeURIComponent(term)}`);
        if (searchInput.value.trim() !== term) return;
        searchResults.hidden = false;
        searchResults.innerHTML = users.length
          ? users.map((u) => `<a class="person" href="#/u/${esc(u.username)}">${avatar(u, "sm")}<span class="who"><strong>${esc(u.name)}</strong><span>@${esc(u.username)}</span></span></a>`).join("")
          : `<p class="muted" style="margin:10px 0">No one found.</p>`;
      } catch { searchResults.hidden = true; }
    }, 250);
  });
  searchInput.addEventListener("keydown", (event) => { if (event.key === "Escape") { searchResults.hidden = true; searchInput.blur(); } });
  searchResults.addEventListener("mousedown", (event) => event.preventDefault());
  searchResults.addEventListener("click", () => { searchResults.hidden = true; searchInput.value = ""; });
  searchInput.addEventListener("blur", () => { searchResults.hidden = true; });

  /* ---------- actions ---------- */

  function requireSignIn(message) {
    if (state.user) return false;
    authDialog("login", message || "Sign in to do that.");
    return true;
  }

  async function toggleLike(button) {
    if (requireSignIn("Sign in to like posts.")) return;
    const card = button.closest(".post");
    const id = card.dataset.postId;
    const counter = button.querySelector("[data-count]");
    const wasLiked = button.getAttribute("aria-pressed") === "true";
    const before = Number(counter.textContent);
    button.setAttribute("aria-pressed", String(!wasLiked));
    counter.textContent = Math.max(0, before + (wasLiked ? -1 : 1));
    try {
      const result = await api(`/api/posts/${id}/like`, { method: wasLiked ? "DELETE" : "POST" });
      counter.textContent = result.like_count;
    } catch (error) {
      button.setAttribute("aria-pressed", String(wasLiked));
      counter.textContent = before;
      toast(error.message);
    }
  }

  async function toggleComments(button) {
    const card = button.closest(".post");
    const panel = card.querySelector(".comments");
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (!open || panel.dataset.loaded) return;
    panel.innerHTML = '<p class="muted">Loading&hellip;</p>';
    try {
      const { comments } = await api(`/api/posts/${card.dataset.postId}/comments`);
      panel.dataset.loaded = "true";
      panel.innerHTML = `<div class="comment-list">${comments.map(commentHtml).join("") || '<p class="muted empty-comments">No comments yet.</p>'}</div>
        ${state.user
          ? `<form class="comment-form" data-post-id="${card.dataset.postId}"><label class="sr-only" for="c-${card.dataset.postId}">Add a comment</label><input id="c-${card.dataset.postId}" name="content" maxlength="300" placeholder="Write a comment" autocomplete="off"><button class="btn btn-accent btn-small" type="submit">Reply</button></form>`
          : `<p class="muted"><button class="link-button" data-action="signin">Sign in</button> to comment.</p>`}`;
    } catch (error) {
      panel.innerHTML = `<p class="error-note">${esc(error.message)}</p>`;
    }
  }

  async function toggleFollow(button) {
    if (requireSignIn("Sign in to follow people.")) return;
    const username = button.dataset.username;
    const following = button.dataset.following === "true";
    button.disabled = true;
    try {
      const result = await api(`/api/users/${encodeURIComponent(username)}/follow`, { method: following ? "DELETE" : "POST" });
      const small = button.classList.contains("btn-small");
      button.outerHTML = followButtonHtml(username, result.is_following, small);
      const stat = $("[data-stat=followers]");
      if (stat && main.dataset.profile && JSON.parse(main.dataset.profile).username === username) stat.textContent = result.followers_count;
      if (button.closest("#suggestions")) toast(`You are following @${username}.`);
      loadSuggestions();
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
  }

  async function showConnections(username, kind) {
    openDialog(`<h2>${kind === "followers" ? "Followers" : "Following"}</h2><p class="sub">@${esc(username)}</p><div class="dialog-list"><p class="muted">Loading&hellip;</p></div><div class="dialog-actions"><button class="btn btn-ghost" data-action="close">Close</button></div>`);
    try {
      const { users } = await api(`/api/users/${encodeURIComponent(username)}/${kind}`);
      $(".dialog-list", dialog).innerHTML = users.length
        ? users.map((u) => `<div class="person"><a href="#/u/${esc(u.username)}" data-action="close">${avatar(u, "sm")}</a>
            <a class="who" href="#/u/${esc(u.username)}" data-action="close"><strong>${esc(u.name)}</strong><span>@${esc(u.username)}</span></a>
            ${u.is_me ? "" : followButtonHtml(u.username, u.is_following, true)}</div>`).join("")
        : `<p class="muted">Nobody yet.</p>`;
    } catch (error) {
      $(".dialog-list", dialog).innerHTML = `<p class="error-note">${esc(error.message)}</p>`;
    }
  }

  function editProfileDialog() {
    const user = state.user;
    openDialog(`
      <h2>Edit profile</h2><p class="sub">@${esc(user.username)}</p>
      <form id="profile-form" novalidate>
        <div class="form-row"><label for="e-name">Name</label><input class="field-input" id="e-name" name="name" maxlength="80" value="${esc(user.name)}" required></div>
        <div class="form-row"><label for="e-bio">Bio</label><textarea class="field-input" id="e-bio" name="bio" rows="3" maxlength="280">${esc(user.bio || "")}</textarea></div>
        <div class="form-row"><label for="e-avatar">Photo link</label><input class="field-input" id="e-avatar" name="avatar_url" type="url" maxlength="500" placeholder="https://..." value="${esc(user.avatar_url || "")}"><div class="hint">Leave empty to use your initial.</div></div>
        <p class="error-note" id="profile-error" role="alert"></p>
        <div class="dialog-actions"><button class="btn btn-ghost" type="button" data-action="close">Cancel</button><button class="btn btn-accent" type="submit">Save</button></div>
      </form>`);
  }

  /* ---------- events ---------- */

  document.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "signin") authDialog("login");
    else if (action === "signup") authDialog("register");
    else if (action === "auth-switch") authDialog(target.dataset.mode);
    else if (action === "signout") signOut();
    else if (action === "close") closeDialog();
    else if (action === "like") toggleLike(target);
    else if (action === "comments") toggleComments(target);
    else if (action === "follow") toggleFollow(target);
    else if (action === "show-followers") showConnections(target.dataset.username, "followers");
    else if (action === "show-following") showConnections(target.dataset.username, "following");
    else if (action === "edit-profile") editProfileDialog();
    else if (action === "toggle-image") {
      const composer = $("#composer");
      composer.classList.toggle("with-image");
      if (composer.classList.contains("with-image")) $("#compose-image").focus();
    } else if (action === "delete-post") {
      if (!confirm("Delete this post? This cannot be undone.")) return;
      const card = target.closest(".post");
      try {
        await api(`/api/posts/${card.dataset.postId}`, { method: "DELETE" });
        card.remove();
        toast("Post deleted.");
      } catch (error) { toast(error.message); }
    } else if (action === "delete-comment") {
      const card = target.closest(".post");
      const comment = target.closest(".comment");
      try {
        const result = await api(`/api/posts/${card.dataset.postId}/comments/${comment.dataset.commentId}`, { method: "DELETE" });
        comment.remove();
        card.querySelector('[data-count="comments"]').textContent = result.comment_count;
      } catch (error) { toast(error.message); }
    }
    // Links inside the dialog (data-action="close") still navigate normally.
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "compose-text") return;
    const length = event.target.value.length;
    const counter = $("#compose-counter");
    counter.textContent = `${length} / 500`;
    counter.classList.toggle("warn", length > 460);
    $("#compose-submit").disabled = !event.target.value.trim();
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const submit = form.querySelector("[type=submit]");

    if (form.id === "auth-form") {
      const mode = form.dataset.mode;
      submit.disabled = true;
      try {
        const result = await api(`/api/auth/${mode}`, { method: "POST", body: data });
        setSession(result.user, result.token);
        closeDialog();
        toast(mode === "register" ? `Welcome to Murmur, ${result.user.name.split(" ")[0]}!` : `Welcome back, ${result.user.name.split(" ")[0]}.`);
        loadSuggestions();
        route();
      } catch (error) {
        $("#auth-error").textContent = error.message;
        submit.disabled = false;
      }
    } else if (form.id === "compose-form") {
      submit.disabled = true;
      $("#compose-error").textContent = "";
      try {
        const { post } = await api("/api/posts", { method: "POST", body: data });
        form.reset();
        $("#compose-counter").textContent = "0 / 500";
        $("#composer").classList.remove("with-image");
        const onProfile = main.dataset.profile ? JSON.parse(main.dataset.profile).username : null;
        if (state.feed && (!onProfile || onProfile === state.user.username)) {
          state.feed.list.querySelector(".empty")?.remove();
          state.feed.list.insertAdjacentHTML("afterbegin", postHtml(post));
        }
        toast("Posted.");
      } catch (error) {
        $("#compose-error").textContent = error.message;
        submit.disabled = false;
      }
    } else if (form.id === "profile-form") {
      submit.disabled = true;
      try {
        const { user } = await api("/api/users/me", { method: "PATCH", body: data });
        setSession({ ...state.user, ...user });
        closeDialog();
        toast("Profile updated.");
        route();
      } catch (error) {
        $("#profile-error").textContent = error.message;
        submit.disabled = false;
      }
    } else if (form.classList.contains("comment-form")) {
      const input = form.querySelector("input");
      if (!input.value.trim()) return;
      submit.disabled = true;
      try {
        const result = await api(`/api/posts/${form.dataset.postId}/comments`, { method: "POST", body: { content: input.value } });
        const list = form.closest(".comments").querySelector(".comment-list");
        list.querySelector(".empty-comments")?.remove();
        list.insertAdjacentHTML("beforeend", commentHtml(result.comment));
        form.closest(".post").querySelector('[data-count="comments"]').textContent = result.comment_count;
        input.value = "";
      } catch (error) { toast(error.message); }
      submit.disabled = false;
      input.focus();
    }
  });

  // Broken image links should not leave an ugly empty box.
  document.addEventListener("error", (event) => {
    const el = event.target;
    if (el.tagName !== "IMG") return;
    if (el.classList.contains("post-img")) el.remove();
    else if (el.hasAttribute("data-avatar")) el.replaceWith(Object.assign(document.createElement("span"), { className: el.className.replace("avatar", "avatar-initial"), textContent: "?" }));
  }, true);

  window.addEventListener("hashchange", route);

  /* ---------- start ---------- */

  renderAccount();
  loadSuggestions();
  route();
  if (state.token) {
    api("/api/auth/me").then(({ user }) => setSession(user)).catch(() => { /* signOut already handled a 401 */ });
  }
})();
