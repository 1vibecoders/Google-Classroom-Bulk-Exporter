// Load the classic content scripts into Node for testing their pure parts.
// They publish their APIs on globalThis.GCX.
import '../../src/shared/protocol.js';
import '../../src/content/namespace.js';
import '../../src/content/dom-utils.js';
import '../../src/content/url-model.js';
import '../../src/content/resource-classifier.js';
import '../../src/content/item-extractor.js';
import '../../src/content/class-info.js';
import '../../src/content/page-loader.js';
import '../../src/content/classwork-scanner.js';
import '../../src/content/stream-scanner.js';
import '../../src/content/detail-loader.js';
import '../../src/content/discovery.js';

export const GCX = globalThis.GCX;
export const P = globalThis.GCX_PROTOCOL;

/** Ordered list of content-script files, as injected by the background. */
export const CONTENT_FILES = [
  'src/shared/protocol.js',
  'src/content/namespace.js',
  'src/content/dom-utils.js',
  'src/content/url-model.js',
  'src/content/resource-classifier.js',
  'src/content/item-extractor.js',
  'src/content/class-info.js',
  'src/content/page-loader.js',
  'src/content/classwork-scanner.js',
  'src/content/stream-scanner.js',
  'src/content/detail-loader.js',
  'src/content/discovery.js',
];
