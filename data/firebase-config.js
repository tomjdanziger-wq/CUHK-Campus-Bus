/**
 * firebase-config.js — where rider reports are stored.
 *
 * This is the web config from the Firebase console (Project settings →
 * General → Your apps). It is an identifier, not a secret: every Firebase web
 * app ships it to the browser. What protects the data is firestore.rules.
 *
 * Set to null to switch tracking off; the Track page then says so and the
 * rest of the app is unaffected.
 */
(function (root) {
  'use strict';
  root.FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCryxbcC98nFJM_VwAF2mqpVkUJGF1F6os',
    authDomain: 'cuhk-buses.firebaseapp.com',
    projectId: 'cuhk-buses',
    storageBucket: 'cuhk-buses.firebasestorage.app',
    messagingSenderId: '670161824369',
    appId: '1:670161824369:web:2fb0eacaeb2628d822c9d0'
  };

  // Firebase account ids (not emails) allowed to read ALL reports, for the
  // private stats page. Everyone else — the app included — can only read the
  // last few hours. Find yours by signing in on stats.html; after changing
  // this, run `node scripts/build-firestore-rules.js` and publish the rules.
  root.FIREBASE_ADMIN_UIDS = [];
})(typeof globalThis !== 'undefined' ? globalThis : this);
