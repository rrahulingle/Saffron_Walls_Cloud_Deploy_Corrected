import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const store = () => getStore({ name: 'saffron-walls-data', consistency: 'strong' });
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const categories = {
  pichwai: { label: 'Pichwai', desc: 'Traditional artistry. Timeless character.' },
  floral: { label: 'Floral', desc: 'Botanical beauty. Soft, expressive living.' },
  tropical: { label: 'Tropical', desc: 'Bold natural beauty. Fresh energy.' }
};
function seedProducts() {
  const out = [];
  for (const cat of Object.keys(categories)) for (let n = 1; n <= 20; n++) {
    const num = String(n).padStart(2, '0');
    out.push({ id: `${cat}-${num}`, cat, num, title: `${categories[cat].label} Design ${num}`, description: categories[cat].desc, image: `assets/images/${cat}-${num}.jpg`, active: true, price: '', notes: '' });
  }
  return out;
}
async function readJson(key, fallback) {
  const s = await store();
  const raw = await s.get(key, { type: 'text' });
  if (raw === null) { await s.set(key, JSON.stringify(fallback)); return fallback; }
  try { return JSON.parse(raw); } catch { throw new Error(`Stored data ${key} is invalid JSON.`); }
}
async function writeJson(key, value) { await (await store()).set(key, JSON.stringify(value)); }
function response(statusCode, body, extraHeaders = {}) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN', ...extraHeaders }, body: JSON.stringify(body) };
}
function safe(v, max = 2000) { return String(v ?? '').trim().slice(0, max); }
function cookieMap(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  return Object.fromEntries(raw.split(';').map(x => x.trim()).filter(Boolean).map(x => { const i=x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1)||'')]; }));
}
function tokenFor(exp) { const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url'); const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function authed(event) {
  if (!SESSION_SECRET) return false;
  const token = cookieMap(event).sw_session || ''; const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let actual; try { actual = Buffer.from(sig, 'base64url'); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function bodyOf(event) { try { return event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body,'base64').toString() : event.body) : {}; } catch { return null; } }
export async function handler(event) {
  const method = event.httpMethod || 'GET';
  let p = event.path || '/';
  const marker = '/.netlify/functions/api';
  if (p.startsWith(marker)) p = p.slice(marker.length) || '/';
  if (!p.startsWith('/api')) p = `/api${p === '/' ? '' : p}`;
  try {
    if (method === 'GET' && p === '/api/health') return response(200, { ok: true, storage: 'Netlify Blobs JSON files', products: (await readJson('products.json', seedProducts())).length });
    if (method === 'GET' && p === '/api/products') {
      const products = await readJson('products.json', seedProducts());
      return response(200, products.filter(x => x.active !== false).map(({ id, cat, num, title, description, image, price }) => ({ id, cat, num, title, description, image, price })));
    }
    if (method === 'GET' && p === '/api/settings') return response(200, await readJson('settings.json', { businessName: 'Saffron Walls', tagline: 'Arts & Designing Studio', phone: '919136917691' }));
    if (method === 'POST' && p === '/api/leads') {
      const b = bodyOf(event); if (!b) return response(400, { error: 'Invalid JSON body.' });
      const name = safe(b.name,120), phone = safe(b.phone,40); if (!name) return response(400,{error:'Name is required.'});
      const leads = await readJson('leads.json', []);
      const lead = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'New', name, phone, city: safe(b.city,120), room: safe(b.room,80), designs: safe(b.designs,500), message: safe(b.message,3000), source: 'Website' };
      leads.unshift(lead); await writeJson('leads.json', leads); return response(201,{ok:true,id:lead.id,message:'Enquiry saved.'});
    }
    if (method === 'POST' && p === '/api/admin/login') {
      const b = bodyOf(event); if (!b) return response(400,{error:'Invalid JSON body.'});
      const pass = String(b.password || '');
      const userOk = safe(b.username,100) === ADMIN_USER;
      const passOk = Boolean(ADMIN_PASSWORD) && pass.length <= 1000 && crypto.timingSafeEqual(crypto.createHash('sha256').update(pass).digest(), crypto.createHash('sha256').update(ADMIN_PASSWORD).digest());
      if (!userOk || !passOk || !SESSION_SECRET) return response(401,{error:'Invalid credentials or server secrets are not configured.'});
      const cookie = `sw_session=${tokenFor(Date.now()+8*60*60*1000)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
      return response(200,{ok:true},{'set-cookie':cookie});
    }
    if (method === 'POST' && p === '/api/admin/logout') return response(200,{ok:true},{'set-cookie':'sw_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
    if (p.startsWith('/api/admin/')) {
      if (!authed(event)) return response(401,{error:'Please sign in again.'});
      if (method === 'GET' && p === '/api/admin/leads') return response(200, await readJson('leads.json', []));
      if (method === 'PATCH' && p.startsWith('/api/admin/leads/')) {
        const id = p.split('/').pop(), b = bodyOf(event); if (!b) return response(400,{error:'Invalid JSON body.'});
        const leads = await readJson('leads.json', []), lead = leads.find(x => x.id === id); if (!lead) return response(404,{error:'Enquiry not found.'});
        if (b.status !== undefined) { if (!['New','Contacted','Quoted','Converted','Closed'].includes(b.status)) return response(400,{error:'Invalid status.'}); lead.status = b.status; }
        await writeJson('leads.json', leads); return response(200,lead);
      }
      if (method === 'DELETE' && p.startsWith('/api/admin/leads/')) {
        const id = p.split('/').pop(), leads = await readJson('leads.json', []), updated = leads.filter(x => x.id !== id); if (updated.length === leads.length) return response(404,{error:'Enquiry not found.'}); await writeJson('leads.json',updated); return response(200,{ok:true});
      }
      if (method === 'GET' && p === '/api/admin/products') return response(200, await readJson('products.json', seedProducts()));
      if (method === 'PATCH' && p.startsWith('/api/admin/products/')) {
        const id = p.split('/').pop(), b = bodyOf(event); if (!b) return response(400,{error:'Invalid JSON body.'});
        const products = await readJson('products.json', seedProducts()), product = products.find(x => x.id === id); if (!product) return response(404,{error:'Design not found.'});
        if (b.title !== undefined) product.title = safe(b.title,160); if (b.description !== undefined) product.description = safe(b.description,500); if (b.price !== undefined) product.price = safe(b.price,80); if (b.notes !== undefined) product.notes = safe(b.notes,1000); if (b.active !== undefined) product.active = Boolean(b.active);
        await writeJson('products.json',products); return response(200,product);
      }
      if (method === 'GET' && p === '/api/admin/settings') return response(200, await readJson('settings.json',{businessName:'Saffron Walls',tagline:'Arts & Designing Studio',phone:'919136917691'}));
      if (method === 'PATCH' && p === '/api/admin/settings') {
        const b = bodyOf(event); if (!b) return response(400,{error:'Invalid JSON body.'});
        const settings = await readJson('settings.json',{businessName:'Saffron Walls',tagline:'Arts & Designing Studio',phone:'919136917691'});
        if (b.businessName !== undefined) settings.businessName = safe(b.businessName,120); if (b.tagline !== undefined) settings.tagline = safe(b.tagline,160);
        if (b.phone !== undefined) { const phone = safe(b.phone,20).replace(/\D/g,''); if (phone.length<10 || phone.length>15) return response(400,{error:'Enter a valid phone number including country code.'}); settings.phone=phone; }
        await writeJson('settings.json',settings); return response(200,settings);
      }
    }
    return response(404,{error:'API endpoint not found.'});
  } catch (e) { console.error(e); return response(500,{error:'Server error. Check Netlify function logs.'}); }
}
