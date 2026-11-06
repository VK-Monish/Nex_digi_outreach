const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);

for (const file of ["index.html", "styles.css", "app.js"]) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const config = {
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  googleClientId: process.env.GOOGLE_CLIENT_ID || ""
};

fs.writeFileSync(
  path.join(dist, "config.js"),
  `window.NEX_CONFIG = ${JSON.stringify(config)};\n`
);

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  console.warn("SUPABASE_URL or SUPABASE_ANON_KEY is missing. Add both in Vercel Environment Variables, then redeploy.");
}
