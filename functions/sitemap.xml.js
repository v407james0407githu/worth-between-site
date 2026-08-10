const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://worthbetween.com/</loc>
  </url>
</urlset>`;

export const onRequestGet = () => new Response(SITEMAP, {
  headers: {
    'content-type': 'application/xml; charset=UTF-8',
    'cache-control': 'public, max-age=3600'
  }
});
