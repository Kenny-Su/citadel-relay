import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, Response } from 'express';
import express from 'express';

export function mountAdminFrontend(app: Express, directory: string): boolean {
  const indexPath = join(directory, 'index.html');
  if (!existsSync(indexPath)) return false;

  app.get('/admin', (_request, response) => {
    applyDocumentHeaders(response);
    response.redirect(308, '/admin/');
  });

  app.use('/admin', express.static(directory, {
    index: false,
    setHeaders(response, path) {
      applySecurityHeaders(response);
      response.setHeader(
        'Cache-Control',
        path.endsWith('.html')
          ? 'no-store'
          : 'public, max-age=31536000, immutable'
      );
    }
  }));

  app.get(
    /^\/admin(?:\/(?!assets(?:\/|$)|api(?:\/|$)).*)?$/,
    (_request, response) => {
    applyDocumentHeaders(response);
    response.sendFile(indexPath);
    }
  );
  return true;
}

function applyDocumentHeaders(response: Response): void {
  applySecurityHeaders(response);
  response.setHeader('Cache-Control', 'no-store');
}

function applySecurityHeaders(response: Response): void {
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}
