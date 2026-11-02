# Saffron Walls — Netlify Free Tier deployment

This version is adapted for Netlify's serverless runtime. It does **not** run `server.js` or write to local JSON files. Website assets are static files; API endpoints run as Netlify Functions; persistent application records are stored as JSON values in Netlify Blobs (key-value object storage).

## Deploy using Netlify Drop (quickest)

1. Extract this ZIP.
2. Create a Git repository from the contents of this folder and push it to GitHub/GitLab, or use Netlify's manual deploy only for static previews. Because this site uses Functions and persistent Blobs, a Git-connected deployment is recommended.
3. In Netlify, choose **Add new project / Import an existing project**, select the repository, and deploy. `netlify.toml` defines the publish and function directories.
4. In **Site configuration → Environment variables**, add:
   - `ADMIN_USER` — your admin username (default `admin` if omitted)
   - `ADMIN_PASSWORD` — a strong unique password
   - `SESSION_SECRET` — a random secret of at least 32 characters
5. Trigger a new deploy after adding the variables.
6. Open `/admin` on the deployed domain.

## Persistent file-based data

The functions store these JSON documents in Netlify Blobs under the `saffron-walls-data` store:
- `products.json` — 60 wallpaper designs and admin edits
- `leads.json` — website enquiries and their statuses
- `settings.json` — business name, tagline and phone number

Netlify Blobs is persistent object storage, not a writable local filesystem. This is the required adaptation for Netlify Functions' ephemeral runtime. It is not an SQLite `.db` file; it stores JSON documents as persistent objects.

## Local development

Install Node.js 20+ then run:

```bash
npm install
npx netlify dev
```

Set the three environment variables above in your local shell or a local `.env` file (do not commit `.env`). Netlify Dev uses a local sandbox for Blobs and does not access production data.

## Important limitations

- Netlify Free currently uses a monthly usage-credit limit. Check current account usage and limits before a public launch.
- Blobs is key-value storage, not a transactional database. The simple whole-document JSON pattern suits a low-volume catalogue and lead inbox, but concurrent writes can overwrite each other. For high-volume enquiries or strict transactional needs, use Netlify Database or a transactional database.
- Admin sessions are signed, secure, HTTP-only cookies. Always set strong secrets and use the production HTTPS domain.
- Do not upload secrets to the repository.
