const LEGACY_HOSTNAME = 'worth-between-site.pages.dev';
const CANONICAL_ORIGIN = 'https://worthbetween.com';

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);

  if (url.hostname === LEGACY_HOSTNAME) {
    return Response.redirect(`${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 301);
  }

  return next();
};
