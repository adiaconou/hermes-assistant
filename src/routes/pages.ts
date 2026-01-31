/**
 * @fileoverview Route for serving generated UI pages.
 *
 * GET /u/:id - Serves a generated page with security headers.
 *
 * The page content is fetched from storage and served with CSP headers
 * that block all network requests from the page.
 */

import { Router, type Request, type Response } from 'express';
import { getStorage, getShortener, CSP_POLICY } from '../services/ui/index.js';

const router = Router();

/**
 * Serve a generated page by its short URL ID.
 *
 * Security headers applied:
 * - Content-Security-Policy: blocks all network requests
 * - Referrer-Policy: no-referrer
 * - X-Content-Type-Options: nosniff
 * - Cross-Origin-Opener-Policy: same-origin
 * - Cross-Origin-Resource-Policy: same-origin
 * - Cache-Control: private, no-cache
 */
router.get('/u/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const shortener = getShortener();
    const storage = getStorage();

    // Resolve short URL to page info
    const resolved = await shortener.resolve(req.params.id);

    if (!resolved) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Not Found</title></head>
        <body>
          <h1>🔗 Link expired or not found</h1>
          <p>This page may have expired or the link may be invalid.</p>
        </body>
        </html>
      `);
    }

    // Fetch HTML from storage
    const html = await storage.fetch(resolved.key);

    // Set security headers (primary CSP enforcement)
    res.setHeader('Content-Security-Policy', CSP_POLICY);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-cache');

    res.type('html').send(html);
  } catch (error) {
    console.error('Error serving page:', error);

    // Check if it's a file not found error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Not Found</title></head>
        <body>
          <h1>🔍 Page not found</h1>
          <p>The requested page could not be found.</p>
        </body>
        </html>
      `);
    }

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body>
        <h1>⚠️ Error loading page</h1>
        <p>Something went wrong. Please try again later.</p>
      </body>
      </html>
    `);
  }
});

export default router;
