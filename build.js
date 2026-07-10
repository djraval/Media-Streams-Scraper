#!/usr/bin/env node

/**
 * Build script — bundles each provider from src/<name>/ into providers/<name>.js
 *
 * Usage:
 *   node build.js              # Build all providers
 *   node build.js desi-serials-to  # Build one provider
 *   node build.js --minify     # Build all with minification
 *   node build.js --watch      # Watch mode
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const outDir = path.join(__dirname, 'providers');

// Modules provided by the Nuvio sandbox — don't bundle these
const EXTERNAL_MODULES = [
  'cheerio-without-node-native',
  'react-native-cheerio',
  'cheerio',
  'crypto-js',
  'axios',
];

function getProvidersToBuild() {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  if (args.length > 0) return args;

  if (!fs.existsSync(srcDir)) {
    console.error('src/ directory not found');
    process.exit(1);
  }

  // Only include directories that have an index.js (skip src/lib/)
  return fs.readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(srcDir, d.name, 'index.js')))
    .map(d => d.name);
}

async function buildProvider(providerName, options) {
  const entryPoint = path.join(srcDir, providerName, 'index.js');
  const outFile = path.join(outDir, providerName + '.js');

  if (!fs.existsSync(entryPoint)) {
    console.warn('Skipping ' + providerName + ': no src/' + providerName + '/index.js');
    return false;
  }

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2020',
      minify: options.minify || false,
      sourcemap: false,
      external: EXTERNAL_MODULES,
      logLevel: 'warning',
    });

    const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log('Built ' + providerName + '.js (' + sizeKB + ' KB)');
    return true;
  } catch (err) {
    console.error('Failed to build ' + providerName + ':', err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldMinify = args.includes('--minify');
  const shouldWatch = args.includes('--watch');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  if (shouldWatch) {
    const ctx = await esbuild.context({
      entryPoints: getProvidersToBuild().map(p => path.join(srcDir, p, 'index.js')),
      bundle: true,
      outdir: outDir,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2020',
      minify: shouldMinify,
      sourcemap: false,
      external: EXTERNAL_MODULES,
    });
    await ctx.watch();
    console.log('Watching src/ for changes...');
    return;
  }

  const providers = getProvidersToBuild();
  if (providers.length === 0) {
    console.log('No providers found in src/');
    return;
  }

  console.log('Building ' + providers.length + ' provider(s)...');
  let ok = 0, fail = 0;
  for (const name of providers) {
    if (await buildProvider(name, { minify: shouldMinify })) ok++;
    else fail++;
  }
  console.log('Done: ' + ok + ' built, ' + fail + ' failed');
}

main().catch(err => { console.error('Build failed:', err); process.exit(1); });
