import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const store = () =>
  getStore({
    name: 'saffron-walls-data',
    consistency: 'strong'
  });

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';

const categories = {
  pichwai: {
    label: 'Pichwai',
    desc: 'Traditional artistry. Timeless character.'
  },
  floral: {
    label: 'Floral',
    desc: 'Botanical beauty. Soft, expressive living.'
  },
  tropical: {
    label: 'Tropical',
    desc: 'Bold natural beauty. Fresh energy.'
  }
};

function seedProducts() {
  const out = [];

  for (const cat of Object.keys(categories)) {
    for (let n = 1; n <= 20; n++) {
      const num = String(n).padStart(2, '0');

      out.push({
        id: cat + '-' + num,
        cat: cat,
        num: num,
        title: categories[cat].label + ' Design ' + num,
        description: categories[cat].desc,
        image: 'assets/images/' + cat + '-' + num + '.jpg',
        active: true,
        price: '',
        notes: ''
      });
    }
  }

  return out;
}

async function readJson(key, fallback) {
  const s = await store();
  const raw = await s.get(key, { type: 'text' });

  if (raw === null) {
    await s.set(key, JSON.stringify(fallback));
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Stored data ' + key + ' is invalid JSON.');
  }
}

async function writeJson(key, value) {
  const s = await store();
  await s.set(key, JSON.stringify(value));
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'SAMEORIGIN',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function safe(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cookieMap(event) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';

  return Object.fromEntries(
    raw
      .split(';')
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => {
        const i = x.indexOf('=');

        return [
          x.slice(0, i),
          decodeURIComponent(x.slice(i + 1) || '')
        ];
      })
  );
}

function tokenFor(exp) {
  const payload = Buffer
    .from(JSON.stringify({ exp: exp }))
    .toString('base64url');

  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  return payload + '.' + signature;
}

function authed(event) {
  if (!SESSION_SECRET) {
    return false;
  }

  let token;

  try {
    token = cookieMap(event).sw_session || '';
  } catch (e) {
    console.error(
      'Session cookie parsing error:',
      e?.stack || e
    );
    return false;
  }

  const parts = token.split('.');
  const payload = parts[0];
  const signature = parts[1];

  if (!payload || !signature) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest();

  let actual;

  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }

  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    return false;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString()
    );

    return decoded.exp > Date.now();
  } catch {
    return false;
  }
}

function bodyOf(event) {
  try {
    if (!event.body) {
      return {};
    }

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body;

    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function handler(event) {
  const method = event.httpMethod || 'GET';

  let path = event.path || '/';

  const marker = '/.netlify/functions/api';

  if (path.startsWith(marker)) {
    path = path.slice(marker.length) || '/';
  }

  if (!path.startsWith('/api')) {
    path = '/api' + (path === '/' ? '' : path);
  }

  try {
    // API health check
    if (method === 'GET' && path === '/api/health') {
      const products = await readJson(
        'products.json',
        seedProducts()
      );

      return response(200, {
        ok: true,
        storage: 'Netlify Blobs JSON files',
        products: products.length
      });
    }

    // Public product catalogue
    if (method === 'GET' && path === '/api/products') {
      const products = await readJson(
        'products.json',
        seedProducts()
      );

      const activeProducts = products
        .filter(product => product.active !== false)
        .map(({
          id,
          cat,
          num,
          title,
          description,
          image,
          price
        }) => ({
          id,
          cat,
          num,
          title,
          description,
          image,
          price
        }));

      return response(200, activeProducts);
    }

    // Public business settings
    if (method === 'GET' && path === '/api/settings') {
      const settings = await readJson('settings.json', {
        businessName: 'Saffron Walls',
        tagline: 'Arts & Designing Studio',
        phone: '919136917691'
      });

      return response(200, settings);
    }

    // Submit a website enquiry
    if (method === 'POST' && path === '/api/leads') {
      const body = bodyOf(event);

      if (!body) {
        return response(400, {
          error: 'Invalid JSON body.'
        });
      }

      const name = safe(body.name, 120);
      const phone = safe(body.phone, 40);

      if (!name) {
        return response(400, {
          error: 'Name is required.'
        });
      }

      const leads = await readJson('leads.json', []);

      const lead = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'New',
        name: name,
        phone: phone,
        city: safe(body.city, 120),
        room: safe(body.room, 80),
        designs: safe(body.designs, 500),
        message: safe(body.message, 3000),
        source: 'Website'
      };

      leads.unshift(lead);

      await writeJson('leads.json', leads);

      return response(201, {
        ok: true,
        id: lead.id,
        message: 'Enquiry saved.'
      });
    }

    // Admin login
    if (method === 'POST' && path === '/api/admin/login') {
      const body = bodyOf(event);

      if (!body) {
        return response(400, {
          error: 'Invalid JSON body.'
        });
      }

      const password = String(body.password || '');

      const userOk =
        safe(body.username, 100) === ADMIN_USER;

      const passwordOk =
        Boolean(ADMIN_PASSWORD) &&
        password.length <= 1000 &&
        crypto.timingSafeEqual(
          crypto.createHash('sha256')
            .update(password)
            .digest(),
          crypto.createHash('sha256')
            .update(ADMIN_PASSWORD)
            .digest()
        );

      if (!userOk || !passwordOk || !SESSION_SECRET) {
        return response(401, {
          error: 'Invalid credentials or server secrets are not configured.'
        });
      }

      const cookie =
        'sw_session=' +
        tokenFor(Date.now() + 8 * 60 * 60 * 1000) +
        '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';

      return response(
        200,
        { ok: true },
        { 'set-cookie': cookie }
      );
    }

    // Admin logout
    if (method === 'POST' && path === '/api/admin/logout') {
      return response(
        200,
        { ok: true },
        {
          'set-cookie':
            'sw_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
        }
      );
    }

    // Protected admin endpoints
    if (path.startsWith('/api/admin/')) {
      if (!authed(event)) {
        return response(401, {
          error: 'Please sign in again.'
        });
      }

      // Get enquiries
      if (
        method === 'GET' &&
        path === '/api/admin/leads'
      ) {
        const leads = await readJson('leads.json', []);
        return response(200, leads);
      }

      // Update an enquiry
      if (
        method === 'PATCH' &&
        path.startsWith('/api/admin/leads/')
      ) {
        const id = path.split('/').pop();
        const body = bodyOf(event);

        if (!body) {
          return response(400, {
            error: 'Invalid JSON body.'
          });
        }

        const leads = await readJson('leads.json', []);
        const lead = leads.find(item => item.id === id);

        if (!lead) {
          return response(404, {
            error: 'Enquiry not found.'
          });
        }

        if (body.status !== undefined) {
          const allowedStatuses = [
            'New',
            'Contacted',
            'Quoted',
            'Converted',
            'Closed'
          ];

          if (!allowedStatuses.includes(body.status)) {
            return response(400, {
              error: 'Invalid status.'
            });
          }

          lead.status = body.status;
        }

        await writeJson('leads.json', leads);

        return response(200, lead);
      }

      // Delete an enquiry
      if (
        method === 'DELETE' &&
        path.startsWith('/api/admin/leads/')
      ) {
        const id = path.split('/').pop();
        const leads = await readJson('leads.json', []);

        const updated = leads.filter(item => item.id !== id);

        if (updated.length === leads.length) {
          return response(404, {
            error: 'Enquiry not found.'
          });
        }

        await writeJson('leads.json', updated);

        return response(200, {
          ok: true
        });
      }

      // Get products in admin dashboard
      if (
        method === 'GET' &&
        path === '/api/admin/products'
      ) {
        const products = await readJson(
          'products.json',
          seedProducts()
        );

        return response(200, products);
      }

      // Update a product
      if (
        method === 'PATCH' &&
        path.startsWith('/api/admin/products/')
      ) {
        const id = path.split('/').pop();
        const body = bodyOf(event);

        if (!body) {
          return response(400, {
            error: 'Invalid JSON body.'
          });
        }

        const products = await readJson(
          'products.json',
          seedProducts()
        );

        const product = products.find(item => item.id === id);

        if (!product) {
          return response(404, {
            error: 'Design not found.'
          });
        }

        if (body.title !== undefined) {
          product.title = safe(body.title, 160);
        }

        if (body.description !== undefined) {
          product.description = safe(body.description, 500);
        }

        if (body.price !== undefined) {
          product.price = safe(body.price, 80);
        }

        if (body.notes !== undefined) {
          product.notes = safe(body.notes, 1000);
        }

        if (body.active !== undefined) {
          product.active = Boolean(body.active);
        }

        await writeJson('products.json', products);

        return response(200, product);
      }

      // Get admin settings
      if (
        method === 'GET' &&
        path === '/api/admin/settings'
      ) {
        const settings = await readJson('settings.json', {
          businessName: 'Saffron Walls',
          tagline: 'Arts & Designing Studio',
          phone: '919136917691'
        });

        return response(200, settings);
      }

      // Update admin settings
      if (
        method === 'PATCH' &&
        path === '/api/admin/settings'
      ) {
        const body = bodyOf(event);

        if (!body) {
          return response(400, {
            error: 'Invalid JSON body.'
          });
        }

        const settings = await readJson('settings.json', {
          businessName: 'Saffron Walls',
          tagline: 'Arts & Designing Studio',
          phone: '919136917691'
        });

        if (body.businessName !== undefined) {
          settings.businessName = safe(body.businessName, 120);
        }

        if (body.tagline !== undefined) {
          settings.tagline = safe(body.tagline, 160);
        }

        if (body.phone !== undefined) {
          const phone = safe(body.phone, 20).replace(/\D/g, '');

          if (phone.length < 10 || phone.length > 15) {
            return response(400, {
              error: 'Enter a valid phone number including country code.'
            });
          }

          settings.phone = phone;
        }

        await writeJson('settings.json', settings);

        return response(200, settings);
      }
    }

    return response(404, {
      error: 'API endpoint not found.'
    });

  } catch (error) {
    // Detailed error is visible in Netlify Function logs.
    console.error(
      'Saffron Walls API error:',
      error?.stack || error
    );

    return response(500, {
      error: 'Server error. Check Netlify function logs.'
    });
  }
}
```
