import fs from 'fs';
import path from 'path';

export const DEFAULT_TRACKER_CODE = `/**
 * Revamp SaaS — Real-time Landing Telemetry Tracker (revamp-tracker.js)
 * Measures Dwell Time, Scroll Depth, and CTA interactions via Beacon API.
 */
(function() {
  'use strict';

  var currentScript = document.currentScript;
  var token =
    (currentScript && currentScript.getAttribute('data-token')) ||
    (window.__REVAMP_TRACKING_TOKEN__) ||
    (new URLSearchParams(window.location.search).get('token')) ||
    (new URLSearchParams(window.location.search).get('t')) ||
    '';

  var apiBase =
    (currentScript && currentScript.getAttribute('data-api')) ||
    (window.__REVAMP_API_BASE__) ||
    '';

  var endpoint = (apiBase.replace(/\\/$/, '') || '') + '/api/v1/track/mvp-event';

  var startTime = Date.now();
  var totalActiveSeconds = 0;
  var lastActiveStamp = Date.now();
  var isVisible = document.visibilityState !== 'hidden';
  var engaged30sSent = false;
  var maxScrollReached = 0;
  var scrollMilestones = { 25: false, 50: false, 75: false, 100: false };

  function sendEvent(eventType, payload) {
    if (!token) return;
    var data = Object.assign(
      {
        token: token,
        eventType: eventType,
        timestamp: new Date().toISOString(),
      },
      payload || {}
    );

    var jsonStr = JSON.stringify(data);

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([jsonStr], { type: 'application/json' });
        var sent = navigator.sendBeacon(endpoint, blob);
        if (sent) return;
      }
    } catch (e) {}

    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr,
        keepalive: true,
      }).catch(function() {});
    } catch (e) {}
  }

  // 1. Initial Pageview
  sendEvent('pageview');

  // 2. Active Dwell Time Accounting
  function updateDwellTime() {
    if (isVisible) {
      var now = Date.now();
      var deltaSec = Math.floor((now - lastActiveStamp) / 1000);
      if (deltaSec > 0) {
        totalActiveSeconds += deltaSec;
        lastActiveStamp = now;
      }

      if (totalActiveSeconds >= 30 && !engaged30sSent) {
        engaged30sSent = true;
        sendEvent('dwell_time', { dwellTimeSeconds: totalActiveSeconds });
      }
    }
  }

  setInterval(updateDwellTime, 1000);

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      updateDwellTime();
      isVisible = false;
      sendEvent('dwell_time', { dwellTimeSeconds: totalActiveSeconds });
    } else {
      isVisible = true;
      lastActiveStamp = Date.now();
    }
  });

  window.addEventListener('pagehide', function() {
    updateDwellTime();
    sendEvent('dwell_time', { dwellTimeSeconds: totalActiveSeconds });
  });

  // 3. CTA and Booking Interactions
  document.addEventListener('click', function(event) {
    var target = event.target;
    var ctaEl = target.closest(
      'a[href^="tel:"], a[href^="mailto:"], [data-revamp-cta], button[type="submit"], .cta-btn, .cta-button'
    );

    if (ctaEl) {
      var ctaType = ctaEl.getAttribute('data-revamp-cta') || (ctaEl.tagName === 'A' ? 'link' : 'button');
      var label = (ctaEl.innerText || ctaEl.textContent || '').trim().slice(0, 80);
      var href = ctaEl.getAttribute('href') || '';

      sendEvent('cta_click', {
        metadata: {
          ctaType: ctaType,
          label: label,
          href: href,
        },
      });
    }
  }, true);

  // Form Submissions (Booking Intent)
  document.addEventListener('submit', function(event) {
    var form = event.target;
    var formId = form.id || form.getAttribute('name') || 'booking-form';
    sendEvent('booking_intent', {
      metadata: {
        formId: formId,
      },
    });
  }, true);

  // 4. Scroll Depth Tracking
  window.addEventListener('scroll', function() {
    var scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight <= 0) return;
    var scrollPercent = Math.min(100, Math.round((window.scrollY / scrollHeight) * 100));

    if (scrollPercent > maxScrollReached) {
      maxScrollReached = scrollPercent;
    }

    [25, 50, 75, 100].forEach(function(m) {
      if (maxScrollReached >= m && !scrollMilestones[m]) {
        scrollMilestones[m] = true;
        sendEvent('scroll_depth', { scrollDepthPercent: m });
      }
    });
  }, { passive: true });

  window.__REVAMP_TRACKER__ = {
    getToken: function() { return token; },
    getDwellTime: function() { return totalActiveSeconds; },
    sendEvent: sendEvent,
  };
})();
`;

export function getTrackerScript(): string {
  try {
    const candidatePaths = [
      path.join(__dirname, '../public/revamp-tracker.js'),
      path.join(__dirname, '../../src/public/revamp-tracker.js'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, 'utf-8');
      }
    }
  } catch {}
  return DEFAULT_TRACKER_CODE;
}
