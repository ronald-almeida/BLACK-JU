import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pix from '../api/pix.js';
import status from '../api/pix-status.js';
import health from '../api/health.js';
const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon' };
const handlers = { '/api/pix':pix, '/api/pix-status':status, '/api/health':health };
createServer(async (request,response) => {
  const url = new URL(request.url,'http://localhost');
  response.setHeader('Cache-Control','no-store');
  if(handlers[url.pathname]) {
    response.status = value => { response.statusCode=value; return response; };
    response.json = value => { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(value)); };
    let size=0; const chunks=[];
    for await(const chunk of request) { size+=chunk.length; if(size>4096)return response.status(413).json({error:'Requisição muito grande.',retryable:true}); chunks.push(chunk); }
    request.body=Buffer.concat(chunks).toString()||undefined;
    return handlers[url.pathname](request,response);
  }
  try {
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(path.resolve(root)+path.sep))throw new Error();
    const contents=await readFile(file);response.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');response.end(contents);
  } catch {response.writeHead(404).end('Não encontrado');}
}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
