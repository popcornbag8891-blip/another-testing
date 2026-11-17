#!/usr/bin/env node
/* Bundles index.html + css + js into one self-contained file.
   node tools/build-single.js [out.html] [--fragment]
   --fragment drops the <!doctype>/<html>/<head>/<body> wrapper (for hosts that supply their own). */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(dir, 'dist', 'eight-deck-coach.html');

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/styles\.css">/, () => `<style>\n${fs.readFileSync(path.join(dir, 'css', 'styles.css'), 'utf8')}\n</style>`);
html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (_, src) => `<script>\n${fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
