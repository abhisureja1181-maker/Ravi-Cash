#!/usr/bin/env node
'use strict';
/* Builds Ravi-Cash-DEMO.html — the whole app (demo mode) in ONE file: double-click it on a PC, or open it on a phone / in
 * the Claude app. Needs no server and no internet. Demo mode only: sample data, kept inside that browser on that device.
 * (Real shared use — every phone on the same books — needs the server: see EASY-ONLINE.md.) */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'app');
const OUT = path.join(__dirname, '..', 'Ravi-Cash-DEMO.html');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
const b64 = (p) => fs.readFileSync(path.join(SRC, p)).toString('base64');

let html = read('index.html');
// stylesheets (+ fonts as data: URIs)
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = read(href).replace(/url\('\.\.\/fonts\/([^']+\.woff)'\)/g, (mm, f) => "url('data:font/woff;base64," + b64('fonts/' + f) + "')");
  if (/<\/style/i.test(css)) throw new Error(href + ' contains </style');
  return '<style>\n' + css + '\n</style>';
});
// scripts
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  let js = read(src);
  if (src === 'config.js') {
    // PDF fonts normally load with fetch('fonts/…ttf'), which a single file cannot do — embed them (RW.assets, see voucher.js)
    const assets = {};
    for (const n of ['Regular', 'Medium', 'SemiBold', 'Bold']) assets['fonts/Inter-' + n + '.ttf'] = b64('fonts/Inter-' + n + '.ttf');
    for (const f of ['img/logo.jpg', 'img/logo-mark.jpg']) assets[f] = b64(f);   // the company logo (voucher, PDFs and screens)
    js = "window.RW_CONFIG = { mode: 'demo' };\nwindow.RW = window.RW || {}; window.RW.assets = " + JSON.stringify(assets) + ';';
  }
  return '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
// app-install files are not needed (and would be missing) in a single file
html = html.replace(/\s*<link rel="(?:manifest|preload)"[^>]*>/g, '')
           .replace(/<link rel="icon"[^>]*>/, '<link rel="icon" href="data:image/png;base64,' + b64('icons/icon-192.png') + '">')
           .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '');
const left = html.match(/(?:src|href)="(?!data:|#)[^"]*"/g);
if (left && left.some((x) => /\.(js|css|woff|png|webmanifest)"/.test(x))) throw new Error('unresolved files left in the page: ' + left.join(', '));
fs.writeFileSync(OUT, html);
console.log('Ravi-Cash-DEMO.html ready: ' + (html.length / 1024 | 0) + ' KB');
