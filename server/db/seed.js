// Adds a few demo people, posts, follows, likes and comments so the app looks
// alive in a demo. Safe to run more than once. Run with: npm run seed
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool } = require("./connection");
const { ensureDatabaseSchema } = require("./migrate");

const DEMO_PASSWORD = "Password123!";

const people = [
  { username: "ama_designs", name: "Ama Mensah", bio: "Product designer in Accra. Sketching, coffee, repeat." },
  { username: "kofi_codes", name: "Kofi Boateng", bio: "Backend developer. Node, SQL, and too many side projects." },
  { username: "esi_reads", name: "Esi Owusu", bio: "Books, bad puns, and good tea." },
  { username: "yaw_runs", name: "Yaw Asante", bio: "Early morning runner. Chasing a sub-25 5K." }
];

const posts = [
  ["ama_designs", "Shipped a new landing page today. Spent longer picking the button colour than writing the code, and I regret nothing."],
  ["kofi_codes", "Reminder: add an index before you blame the database. Query time went from 2s to 12ms."],
  ["esi_reads", "Finished a book in one sitting and now I do not know what to do with myself. Recommendations welcome."],
  ["yaw_runs", "5K in 26:10 this morning. Getting closer."],
  ["kofi_codes", "Hot take: the best feature of any project is a README that actually works on a fresh machine."],
  ["ama_designs", "Whiteboard sessions are underrated. Ten minutes of drawing beats an hour of talking."]
];

async function seed() {
  if (!pool) {
    console.error("Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in .env first.");
    process.exitCode = 1;
    return;
  }
  await ensureDatabaseSchema();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const person of people) {
    await pool.execute(
      "INSERT IGNORE INTO users (username, name, email, password_hash, bio) VALUES (?, ?, ?, ?, ?)",
      [person.username, person.name, `${person.username}@example.com`, hash, person.bio]
    );
  }
  const [users] = await pool.query("SELECT id, username FROM users WHERE username IN (?)", [people.map((p) => p.username)]);
  const idOf = Object.fromEntries(users.map((u) => [u.username, u.id]));

  const [existing] = await pool.query("SELECT COUNT(*) AS total FROM posts WHERE user_id IN (?)", [Object.values(idOf)]);
  if (existing[0].total === 0) {
    const postIds = [];
    for (const [username, content] of posts) {
      const [result] = await pool.execute("INSERT INTO posts (user_id, content) VALUES (?, ?)", [idOf[username], content]);
      postIds.push(result.insertId);
    }
    const follows = [["ama_designs", "kofi_codes"], ["ama_designs", "esi_reads"], ["kofi_codes", "ama_designs"], ["esi_reads", "yaw_runs"], ["yaw_runs", "kofi_codes"], ["esi_reads", "ama_designs"]];
    for (const [follower, following] of follows) {
      await pool.execute("INSERT IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", [idOf[follower], idOf[following]]);
    }
    const likes = [[0, "kofi_codes"], [0, "esi_reads"], [1, "ama_designs"], [1, "yaw_runs"], [1, "esi_reads"], [3, "esi_reads"], [4, "ama_designs"]];
    for (const [index, username] of likes) {
      await pool.execute("INSERT IGNORE INTO likes (user_id, post_id) VALUES (?, ?)", [idOf[username], postIds[index]]);
    }
    const comments = [[0, "kofi_codes", "Looks great. Which colour won?"], [1, "ama_designs", "Saving this one for later."], [3, "esi_reads", "Almost there!"]];
    for (const [index, username, content] of comments) {
      await pool.execute("INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)", [postIds[index], idOf[username], content]);
    }
  }

  console.log(`Demo data ready. Sign in as any of: ${people.map((p) => p.username).join(", ")}`);
  console.log(`Password for all demo accounts: ${DEMO_PASSWORD}`);
}

seed()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool && pool.end());
