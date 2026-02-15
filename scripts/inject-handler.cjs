const fs = require('fs');
const path = require('path');

const handlerCode = `const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

exports.handler = async (event) => {
  try {
    let filePath = event.rawPath || '/';
    
    // Remove query string
    filePath = filePath.split('?')[0];
    
    // Normalize path
    if (filePath.endsWith('/')) {
      filePath = filePath + 'index.html';
    }
    
    const fullPath = path.join(__dirname, filePath);
    const normalizedPath = path.normalize(fullPath);
    
    // Security: ensure path is within __dirname
    if (!normalizedPath.startsWith(__dirname)) {
      return {
        statusCode: 403,
        headers: SECURITY_HEADERS,
        body: 'Forbidden',
      };
    }
    
    // Try to serve the file
    if (fs.existsSync(normalizedPath)) {
      const ext = path.extname(normalizedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(normalizedPath, 'utf8');

      return {
        statusCode: 200,
        headers: { 'Content-Type': contentType, ...SECURITY_HEADERS },
        body: content,
      };
    }

    // File not found, serve index.html for SPA routing
    const indexPath = path.join(__dirname, 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', ...SECURITY_HEADERS },
      body: indexContent,
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};`;

const outputPath = path.join(__dirname, '../build/client/index.js');
fs.writeFileSync(outputPath, handlerCode);
console.log(`✓ Handler injected to ${outputPath}`);
