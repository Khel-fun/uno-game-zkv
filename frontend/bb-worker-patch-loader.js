/**
 * Custom webpack loader that rewrites bb.js browser factory files to use
 * webpack 5's native Worker syntax: `new Worker(new URL('./x.worker.js', import.meta.url))`.
 *
 * The original factory files do:
 *   import MainWorker from './main.worker.js';
 *   const worker = new MainWorker();
 *
 * But main.worker.js has `export default null;` — so webpack imports `null`
 * and `new null()` throws "is not a constructor".
 *
 * By rewriting to `new Worker(new URL(...))`, webpack:
 *  1. Bundles the worker file and its dependencies (comlink, etc.) separately
 *  2. Returns a proper Worker constructor URL
 *
 * Also strips `webpackIgnore: true` comments from fetch_code files so webpack
 * can resolve .wasm.gz asset paths.
 */
module.exports = function (source) {
  // Rewrite main worker factory:
  //   import MainWorker from './main.worker.js';  →  (removed)
  //   new MainWorker()  →  new Worker(new URL('./main.worker.js', import.meta.url))
  if (source.includes("from './main.worker.js'")) {
    source = source.replace(/import\s+MainWorker\s+from\s+'\.\/main\.worker\.js';\s*/g, '');
    source = source.replace(/new\s+MainWorker\(\)/g,
      "new Worker(new URL('./main.worker.js', import.meta.url))");
  }

  // Rewrite thread worker factory:
  //   import ThreadWorker from './thread.worker.js';  →  (removed)
  //   new ThreadWorker()  →  new Worker(new URL('./thread.worker.js', import.meta.url))
  if (source.includes("from './thread.worker.js'")) {
    source = source.replace(/import\s+ThreadWorker\s+from\s+'\.\/thread\.worker\.js';\s*/g, '');
    source = source.replace(/new\s+ThreadWorker\(\)/g,
      "new Worker(new URL('./thread.worker.js', import.meta.url))");
  }

  // Strip webpackIgnore comments from fetch_code files
  source = source.replace(/\/\* webpackIgnore: true \*\/ /g, '');

  return source;
};
